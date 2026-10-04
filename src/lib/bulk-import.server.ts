// Server side of the slim bulk installer import. Parses the customer list (CSV/XLSX) and uploaded
// files, uses AI only to map messy spreadsheet columns onto known fields, matches files to rows,
// sorts each job, and — only after explicit confirmation — creates installer-sourced jobs.
// Nothing customer-facing is ever sent from here. Old/non-geotagged photos inform sorting only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent } from "./workflow.server";
import { logPartner } from "./pilot.server";
import { ghgEquivalentReduction, type LocationVariables } from "./activity48.core";
import { HIVIC_PIESA_INC_GST } from "./installer-led.core";
import {
  dedupeKey, findDuplicates, matchFiles, missingEvidence, normaliseAddress, sortJob,
  type BulkExtracted, type BulkFile,
} from "./bulk-import.core";

export class BulkImportError extends Error {}

// ---------- file parsing ----------

/** Parse a CSV/XLSX customer list into raw string records (any column layout). */
export async function parseListFile(name: string, buf: ArrayBuffer): Promise<Record<string, string>[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const sheet = wb.Sheets[firstSheet];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), String(v ?? "").trim()])));
}

/** Unzip an archive (or accept loose files) into a manifest with EXIF GPS/date for photos. */
export async function buildManifest(files: { name: string; type: string; buf: ArrayBuffer }[]): Promise<BulkFile[]> {
  const out: BulkFile[] = [];
  const push = async (path: string, name: string, type: string, buf: ArrayBuffer) => {
    const f: BulkFile = { path, name, folder: path.includes("/") ? path.split("/").slice(0, -1).join("/") : null, type };
    if (/^image\//.test(type) || /\.(jpe?g|heic)$/i.test(name)) {
      try {
        const exifr = (await import("exifr")).default;
        const gps = await exifr.gps(Buffer.from(buf)).catch(() => null);
        const exif = await exifr.parse(Buffer.from(buf), { pick: ["DateTimeOriginal", "CreateDate"] }).catch(() => null);
        if (gps && Number.isFinite(gps.latitude)) { f.gps_lat = gps.latitude; f.gps_lng = gps.longitude; }
        const taken = exif?.DateTimeOriginal ?? exif?.CreateDate;
        if (taken) f.taken_at = new Date(taken).toISOString();
      } catch { /* unreadable EXIF — fine, photo just carries no GPS */ }
    }
    out.push(f);
  };
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file.buf);
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || path.split("/").some((p) => p.startsWith("__MACOSX") || p.startsWith("."))) continue;
        const buf = await entry.async("arraybuffer");
        await push(path, path.split("/").pop()!, guessType(path), buf);
      }
    } else {
      await push(file.name, file.name, file.type || guessType(file.name), file.buf);
    }
  }
  return out;
}

function guessType(name: string): string {
  if (/\.(jpe?g)$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  return "application/octet-stream";
}

// ---------- AI column mapping (only AI use: messy spreadsheet → known fields) ----------

const EXTRACT_PROMPT = `You map rows from a messy installer customer list onto known fields.
Return ONLY a JSON array, one object per input row, same order, with these keys (null when absent):
full_name, email, phone, address_line (street number + street only), suburb, postcode (4 digits),
area_m2 (number, ceiling/roof area in m2), existing_insulation (short text or "unknown"),
access (short text about ceiling access/manhole or "unknown"), notes (anything else useful, short),
price_inc_gst (number, the installer's quoted total price including GST if present).
Never invent values. If a column is ambiguous, put it in notes.`;

export async function aiExtractRows(rawRows: Record<string, string>[]): Promise<BulkExtracted[]> {
  if (rawRows.length === 0) return [];
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new BulkImportError("AI reading is not configured (missing key). The office can still enter rows one at a time.");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { streamText } = await import("ai");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    messages: [
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: JSON.stringify(rawRows).slice(0, 120_000) },
    ],
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  const text = await result.text;
  const jsonText = text.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch { throw new BulkImportError("AI could not read this list. Try a simpler spreadsheet (one row per customer)."); }
  if (!Array.isArray(parsed)) throw new BulkImportError("AI returned an unexpected shape.");
  return parsed.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const num = (k: string) => { const n = Number(o[k]); return Number.isFinite(n) && n > 0 ? n : null; };
    const str = (k: string) => { const v = o[k]; return typeof v === "string" && v.trim() ? v.trim() : null; };
    return {
      full_name: str("full_name"), email: str("email"), phone: str("phone"),
      address_line: str("address_line"), suburb: str("suburb"), postcode: str("postcode"),
      area_m2: num("area_m2"), existing_insulation: str("existing_insulation"), access: str("access"),
      notes: str("notes"), price_inc_gst: num("price_inc_gst"),
    } satisfies BulkExtracted;
  });
}

// ---------- analysis ----------

/** Keys already in the portal (normalised address+postcode, emails) for duplicate detection. */
async function existingPortalKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const { data: props } = await admin.from("properties").select("address_line, postcode").limit(5000);
  for (const p of props ?? []) {
    const a = normaliseAddress(p.address_line);
    if (a && p.postcode) keys.add(`addr:${a}|${p.postcode}`);
  }
  const { data: owners } = await admin.from("owners").select("email").not("email", "is", null).limit(5000);
  for (const o of owners ?? []) if (o.email) keys.add(`email:${o.email.toLowerCase()}`);
  return keys;
}

export async function analyseBatch(batchId: string, actorId: string) {
  const { data: batch } = await admin.from("bulk_import_batches").select("*").eq("id", batchId).single();
  if (!batch || batch.status !== "draft") throw new BulkImportError("This upload was already analysed or confirmed.");
  const manifest = (batch.file_manifest ?? []) as unknown as BulkFile[];
  const { data: listFile } = await admin.from("bulk_import_batches").select("id").eq("id", batchId).single();
  void listFile;
  // The parsed raw rows are stored on the batch by the upload step (summary.raw_rows) to avoid re-downloading.
  const rawRows = ((batch.summary as { raw_rows?: Record<string, string>[] } | null)?.raw_rows ?? []) as Record<string, string>[];
  if (rawRows.length === 0) throw new BulkImportError("No customer rows found in the uploaded list.");
  const extracted = await aiExtractRows(rawRows);
  const existing = await existingPortalKeys();
  const dupNotes = findDuplicates(extracted, existing);

  await admin.from("bulk_import_rows").delete().eq("batch_id", batchId);
  const rows = extracted.map((e, i) => {
    const { matched, confidence } = matchFiles(e, manifest);
    const duplicate = dupNotes.has(i);
    const { result, reasons } = sortJob(e, { matchConfidence: confidence, duplicate });
    if (matched.length > 0 && confidence === "low") reasons.push("Files matched by filename only — please check");
    return {
      batch_id: batchId, row_index: i, extracted: e as unknown as Json,
      matched_files: matched as unknown as Json, match_confidence: confidence,
      sort_result: result, sort_reasons: reasons as unknown as Json,
      missing_evidence: missingEvidence(e, matched) as unknown as Json,
      duplicate_note: dupNotes.get(i) ?? null,
    };
  });
  const { error } = await admin.from("bulk_import_rows").insert(rows);
  if (error) throw new BulkImportError(error.message);
  const summary = {
    rows: rows.length,
    ready_to_quote: rows.filter((r) => r.sort_result === "ready_to_quote").length,
    needs_visit: rows.filter((r) => r.sort_result === "needs_visit").length,
    office_review: rows.filter((r) => r.sort_result === "office_review").length,
    duplicates: rows.filter((r) => r.duplicate_note).length,
  };
  await admin.from("bulk_import_batches").update({ status: "analysed", summary: summary as unknown as Json }).eq("id", batchId);
  await logPartner(null, actorId, "bulk_import_analysed", `Bulk upload analysed: ${summary.rows} jobs found (${summary.ready_to_quote} ready to quote, ${summary.needs_visit} need a visit, ${summary.office_review} for office review)`, { batch_id: batchId, ...summary });
  return summary;
}

// ---------- confirmation: create the jobs ----------

async function createBulkJob(e: BulkExtracted, batch: { id: string; business_id: string }, actorId: string, rowId: string) {
  const email = e.email?.toLowerCase() ?? null;
  let ownerId: string;
  if (email) {
    const { data: existing } = await admin.from("owners").select("id").ilike("email", email).maybeSingle();
    if (existing) ownerId = existing.id;
    else {
      const { data, error } = await admin.from("owners").insert({ full_name: e.full_name ?? "Unknown", email, phone: e.phone ?? null }).select("id").single();
      if (error || !data) throw new BulkImportError(error?.message ?? "Owner could not be created.");
      ownerId = data.id;
    }
  } else {
    const { data, error } = await admin.from("owners").insert({ full_name: e.full_name ?? "Unknown", email: null, phone: e.phone ?? null }).select("id").single();
    if (error || !data) throw new BulkImportError(error?.message ?? "Owner could not be created.");
    ownerId = data.id;
  }
  const { data: prop, error: pe } = await admin.from("properties").insert({
    owner_id: ownerId, address_line: e.address_line!, suburb: e.suburb ?? null, postcode: e.postcode ?? null, state: "VIC",
  }).select("id").single();
  if (pe || !prop) throw new BulkImportError(pe?.message ?? "Property could not be created.");
  const { data: job, error: je } = await admin.from("jobs").insert({
    owner_id: ownerId, property_id: prop.id, stage: "new_enquiry", source: "bulk_import",
    channel: "installer_sourced", originating_installer_business_id: batch.business_id, originating_installer_user_id: actorId,
    external_enquiry_id: `bulk:${rowId}`,
    next_action: "Office review — imported from installer bulk upload",
  }).select("id, job_number").single();
  if (je || !job) throw new BulkImportError(je?.message ?? "Job could not be created.");
  await admin.from("job_assignments").insert({ job_id: job.id, user_id: actorId, role: "installer", business_id: batch.business_id, assigned_by: actorId });
  return job;
}

async function draftQuoteFromImport(jobId: string, e: BulkExtracted, actorId: string) {
  if (!(e.price_inc_gst && e.price_inc_gst > 0) || !(e.area_m2 && e.area_m2 > 0)) return false;
  const { data: job } = await admin.from("jobs").select("ap_fee_override_inc_gst, properties(postcode)").eq("id", jobId).single();
  const postcode = String((job?.properties as { postcode: string | null } | null)?.postcode ?? "").trim();
  const [{ data: loc }, { data: rs }] = await Promise.all([
    admin.from("veu_location_variables").select("*").eq("postcode", postcode).maybeSingle(),
    admin.from("retail_estimator_settings").select("ap_management_inc_gst, indicative_veec_value").eq("is_current", true).maybeSingle(),
  ]);
  const ghg = loc ? ghgEquivalentReduction(e.area_m2, loc as unknown as LocationVariables).ghgReduction : null;
  const veecValue = rs ? Number(rs.indicative_veec_value) : null;
  const apFee = job?.ap_fee_override_inc_gst != null ? Number(job.ap_fee_override_inc_gst) : rs ? Number(rs.ap_management_inc_gst) : null;
  if (ghg == null || veecValue == null || apFee == null) return false; // office quotes manually
  const discount = Math.round(ghg * veecValue * 100) / 100;
  const lines = [
    { code: "INSTALLER_PRICE", description: "Insulation works by your installer", quantity: 1, unit: "flat", unit_price_inc_gst: e.price_inc_gst, line_total_inc_gst: e.price_inc_gst, is_other: false, explanation: null, sort: 0 },
    { code: "PIESA", description: "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", quantity: 1, unit: "flat", unit_price_inc_gst: HIVIC_PIESA_INC_GST, line_total_inc_gst: HIVIC_PIESA_INC_GST, is_other: false, explanation: null, sort: 1 },
    { code: "AP_FEE", description: "Home Insulation Victoria — Accredited Person fee", quantity: 1, unit: "flat", unit_price_inc_gst: apFee, line_total_inc_gst: apFee, is_other: false, explanation: null, sort: 2 },
  ];
  const subtotal = Math.round((e.price_inc_gst + HIVIC_PIESA_INC_GST + apFee) * 100) / 100;
  const { data: q, error } = await admin.from("quotes").insert({
    job_id: jobId, kind: "installation", option_label: "Installer's quote (from bulk upload)", option_code: "INSTALLER_A1", status: "draft",
    subtotal_inc_gst: subtotal, gst_amount: Math.round((subtotal - subtotal / 1.1) * 100) / 100,
    veec_discount_inc_gst: discount, customer_total_inc_gst: Math.round((subtotal - discount) * 100) / 100, created_by: actorId,
  }).select("id").single();
  if (error || !q) throw new BulkImportError(error?.message ?? "Quote could not be saved.");
  const { error: ie } = await admin.from("quote_items").insert(lines.map((l) => ({ ...l, quote_id: q.id })));
  if (ie) throw new BulkImportError(ie.message);
  return true;
}

export async function confirmBatch(batchId: string, actorId: string, skipRowIds: string[]) {
  const { data: batch } = await admin.from("bulk_import_batches").select("*").eq("id", batchId).single();
  if (!batch || batch.status !== "analysed") throw new BulkImportError("This upload is not ready to confirm.");
  const { data: rows } = await admin.from("bulk_import_rows").select("*").eq("batch_id", batchId).eq("status", "pending").order("row_index");
  let created = 0, skipped = 0, failed = 0;
  for (const row of rows ?? []) {
    if (skipRowIds.includes(row.id) || row.duplicate_note) {
      await admin.from("bulk_import_rows").update({ status: "skipped" }).eq("id", row.id);
      skipped++;
      continue;
    }
    const e = row.extracted as unknown as BulkExtracted;
    try {
      const job = await createBulkJob(e, batch, actorId, row.id);
      const quoted = await draftQuoteFromImport(job.id, e, actorId).catch(() => false);
      await admin.from("bulk_import_rows").update({ status: "confirmed", job_id: job.id }).eq("id", row.id);
      await logEvent(job.id, actorId, "bulk_import_confirmed", `Job created from installer bulk upload (row ${row.row_index + 1})`, {
        batch_id: batchId, row_id: row.id, sort_result: row.sort_result,
        missing_evidence: row.missing_evidence, draft_quote: quoted,
      });
      created++;
    } catch (err) {
      failed++;
      await logPartner(null, actorId, "bulk_import_row_failed", `Row ${row.row_index + 1} could not be imported: ${(err as Error).message}`, { batch_id: batchId, row_id: row.id });
    }
  }
  await admin.from("bulk_import_batches").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", batchId);
  return { created, skipped, failed };
}
