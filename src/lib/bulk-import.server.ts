// Server side of the slim bulk installer import. Parses the customer list (CSV/XLSX) and uploaded
// files, uses AI only to map messy spreadsheet columns onto known fields, matches files to rows,
// sorts each job, and — only after explicit confirmation — creates installer-sourced jobs.
// Nothing customer-facing is ever sent from here. Old/non-geotagged photos inform sorting only.
import { exactLike } from "./email-match";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent } from "./workflow.server";
import { logPartner } from "./pilot.server";
import { type LocationVariables } from "./activity48.core";
import { confirmedQuoteDecision } from "./quote-release.core";
import { hashToken, newToken } from "./worker-links.core";
import { linkFiles, chunkRows, readInChunks, READ_CHUNK_ROWS, type LeadStage } from "./bulk-import.core";
import { applyDiscountRules, discountNotes, wholeVeecDiscount } from "./estimate.core";
import {
  customerDetailsReason, outsideVictoria, quotedGap, QUOTED_ANSWER_NEEDED, effectiveSiteCheck, cleanLead, gridToRecords, dedupeKey, parseSiteCheck, QUOTE_NEEDED_LABEL, quoteNeeded, siteCheckFromFile, siteCheckLabel, fileResults, findDuplicates, leadStage, type FileResult, LEAD_STAGE_LABEL, matchFiles, missingEvidence, normaliseAddress, sortJob,
  type BulkExtracted, type BulkFile, type FileMatch,
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
  // Header may not be on row 1, blank rows and extra columns are common: detect the header row ourselves.
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
  return gridToRecords(grid);
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

const EXTRACT_PROMPT = `You read whatever an installer dropped in (spreadsheet rows, forwarded emails, exports, notes,
text read from PDFs and photos, and the list of uploaded file/folder names with any address looked up from photo GPS)
and list each distinct customer lead once. Input is JSON {rows, documents, files}. Merge information about the
same address/customer into one lead. When there is no customer list, still create a lead for each distinct property
address you can see in folder names, file names, document/photo text or a photo's gps_address — set unsure=true for
leads that come only from names, photo text or GPS. Documents are often free-text notes written in ordinary sentences
(e.g. "Spoke to Mary Smith on 0412 345 678, about 120 m2, old batts, quoted $3,200") — read every sentence and pull out
names, addresses, phones, emails, measurements, insulation details and prices. A person or property described with NO address
is still a lead: return it with address_line/suburb/postcode null and unsure=true so the office can add the address. Return ONLY a JSON array, one object per lead, with these keys (null when absent):
full_name, email, phone (exactly as written), address_line (unit/flat number if any, street number and street — e.g. "Unit 3/12 Smith St" or "3/12 Smith St"; when the address is in one column, split off the suburb and postcode), suburb, postcode (4 digits),
area_m2 (number, ceiling/roof area in m2), existing_insulation (short text or "unknown"),
access (short text about ceiling access/manhole or "unknown"),
roof_type (short text, e.g. "tiled"/"tin", or "unknown"), hazards (short text or "unknown"),
building_age (short text, e.g. "built 1978", or "unknown"), notes (anything else useful, short),
price_inc_gst (number, the installer's quoted total price including GST, exactly as given; null when there is no price — never work one out),
price_includes (short free text: what the quoted price includes, e.g. R-value/product, area, removal, extras — from the price/quote column, notes or a quote document; null if not stated),
site_check (text exactly as written in a "Visited"/"Measured"/"Site check done"/"Measure-up" column or note, e.g. "Y", "No", "Visited 3/10/26"; null when nothing says whether the site check was done — never guess from area or photos),
site_check_date (the site check / measure-up date as YYYY-MM-DD if stated, else null),
unsure (boolean), source_files (array of the uploaded file names/paths this lead was read from).
If the same customer appears more than once in the list, return it once and add "Listed N times in the upload" to notes. Never invent values. If a column is ambiguous, put it in notes. Return [] only if there is truly no customer, contact, address or property detail anywhere.`;

export type BulkDocument = { name: string; text: string };
export type BulkFileRef = { name: string; folder?: string | null; geo_address?: string | null };

function lovableProvider() {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new BulkImportError("AI reading is not configured (missing key). The office can still enter rows one at a time.");
  return import("@ai-sdk/openai").then(({ createOpenAI }) => createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1", apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  }));
}
const AI_OPTIONS = { openai: { store: false, forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] } } as const;

export async function aiExtractRows(rawRows: Record<string, string>[], documents: BulkDocument[] = [], files: BulkFileRef[] = []): Promise<BulkExtracted[]> {
  if (rawRows.length === 0 && documents.length === 0 && files.length === 0) return [];
  const provider = await lovableProvider();
  const { streamText } = await import("ai");
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions: EXTRACT_PROMPT,
    messages: [
      { role: "user", content: JSON.stringify({ rows: rawRows, documents: documents.map((d) => ({ name: d.name, text: d.text.slice(0, 20_000) })), files: files.slice(0, 1500) }).slice(0, 180_000) },
    ],
    providerOptions: AI_OPTIONS,
    abortSignal: AbortSignal.timeout(rawRows.length > 40 ? 300_000 : 120_000),
  });
  const text = await result.text;
  const jsonText = text.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch { throw new BulkImportError("AI could not read this upload. Try again, or add a simple list (one row per customer)."); }
  if (!Array.isArray(parsed)) throw new BulkImportError("AI returned an unexpected shape.");
  return parsed.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const num = (k: string) => { const n = Number(o[k]); return Number.isFinite(n) && n > 0 ? n : null; };
    const str = (k: string) => { const v = o[k]; return typeof v === "string" && v.trim() ? v.trim() : null; };
    return {
      full_name: str("full_name"), email: str("email"), phone: str("phone"),
      address_line: str("address_line"), suburb: str("suburb"), postcode: str("postcode"),
      area_m2: num("area_m2"), existing_insulation: str("existing_insulation"), access: str("access"),
      roof_type: str("roof_type"), hazards: str("hazards"), building_age: str("building_age"),
      notes: str("notes"), price_inc_gst: num("price_inc_gst"), price_includes: str("price_includes"),
      ...(() => {
        const sc = parseSiteCheck(o["site_check"]);
        const date = (typeof o["site_check_date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o["site_check_date"] as string) ? o["site_check_date"] as string : null) ?? sc.date;
        const check = sc.check ?? (date ? "yes" as const : null);
        return { site_check: check, site_check_date: check === "yes" ? date : null, site_check_source: check ? "file" as const : null };
      })(),
      unsure: o["unsure"] === true,
      source_files: Array.isArray(o["source_files"]) ? (o["source_files"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 50) : [],
    } satisfies BulkExtracted;
  });
}

const MEDIA_PROMPT = `You are reading one file an insulation installer uploaded (a PDF, a scanned page or a photo).
Write out, as plain text, every customer name, street address, suburb, postcode, phone, email, measured ceiling area (m2),
measurement method and date, existing insulation and R-value, whether removal is needed and removal area (m2), ceiling access,
roof type, hazards, building age, quoted price inc GST and exactly what that price includes. For a list or
table, write one line per customer. Free-text notes and paragraphs count too: read every sentence and copy out any of
those details mentioned in it. Copy what is written; never guess. If nothing like that is visible, reply with
exactly NONE followed by a few words describing the picture.`;

/** AI vision/PDF reading of one uploaded file → plain text for the lead finder. Matching/sorting only, never evidence. */
export async function aiReadMedia(name: string, mime: string, base64: string): Promise<string> {
  const provider = await lovableProvider();
  const { streamText } = await import("ai");
  const part = mime === "application/pdf"
    ? ({ type: "file", filename: name, data: base64, mediaType: "application/pdf" } as const)
    : ({ type: "image", image: new URL(`data:${mime};base64,${base64}`) } as const);
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions: MEDIA_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: `File name: ${name}` }, part] }],
    providerOptions: AI_OPTIONS,
  });
  return (await result.text).trim();
}

/** Approximate street address for photo GPS points (OpenStreetMap; points ~10 m apart share one lookup). */
export async function reverseGeocode(points: { lat: number; lng: number }[]): Promise<(string | null)[]> {
  const cache = new Map<string, string | null>();
  const out: (string | null)[] = [];
  for (const p of points.slice(0, 40)) {
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (!cache.has(key)) {
      if (cache.size > 0) await new Promise((r) => setTimeout(r, 1100)); // OpenStreetMap fair-use: 1 request/second
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${p.lat}&lon=${p.lng}`, {
          headers: { "User-Agent": "HomeInsulationVictoria-Portal/1.0 (bulk upload photo matching)", "Accept-Language": "en-AU" },
        });
        const j = res.ok ? ((await res.json()) as { address?: Record<string, string> }) : null;
        const a = j?.address;
        const street = a ? [a["house_number"], a["road"]].filter(Boolean).join(" ") : "";
        const suburb = a?.["suburb"] ?? a?.["town"] ?? a?.["city_district"] ?? a?.["village"] ?? a?.["city"] ?? "";
        cache.set(key, street ? [street, suburb, a?.["state"] === "Victoria" ? "VIC" : a?.["state"], a?.["postcode"]].filter(Boolean).join(" ") : null);
      } catch { cache.set(key, null); }
    }
    out.push(cache.get(key) ?? null);
  }
  while (out.length < points.length) out.push(null);
  return out;
}

// ---------- analysis ----------

/** Keys already in the portal (normalised address+postcode, emails) for duplicate detection. */
async function existingPortalKeys(): Promise<Set<string>> {
  // Page through every row (the Data API caps a single read at 1000 rows).
  const keys = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("properties").select("address_line, postcode").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't check existing addresses: ${error.message}`);
    for (const p of data ?? []) { const a = normaliseAddress(p.address_line); if (a && p.postcode) keys.add(`addr:${a}|${p.postcode}`); }
    if ((data?.length ?? 0) < PAGE) break;
  }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("owners").select("email").not("email", "is", null).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't check existing owners: ${error.message}`);
    for (const o of data ?? []) if (o.email) keys.add(`email:${o.email.toLowerCase()}`);
    if ((data?.length ?? 0) < PAGE) break;
  }
  return keys;
}

/** Server-side fallback for big lists: same chunks and retries as the page. Throws only if nothing could be read. */
export async function readRowsInChunks(rawRows: Record<string, string>[]): Promise<BulkExtracted[]> {
  const res = await readInChunks(chunkRows(rawRows), (c) => aiExtractRows(c.rows), { parallel: 4 });
  if (!res.leads.length && res.failed.length) throw new BulkImportError("This list couldn't be read. Try again in a minute.");
  return res.leads;
}

export async function analyseBatch(batchId: string, actorId: string) {
  const { data: batch } = await admin.from("bulk_import_batches").select("*").eq("id", batchId).single();
  if (!batch || batch.status !== "draft") throw new BulkImportError("This upload was already analysed or confirmed.");
  const manifest = (batch.file_manifest ?? []) as unknown as BulkFile[];
  const { data: listFile } = await admin.from("bulk_import_batches").select("id").eq("id", batchId).single();
  void listFile;
  // The parsed raw rows are stored on the batch by the upload step (summary.raw_rows) to avoid re-downloading.
  const stored = (batch.summary ?? {}) as { raw_rows?: Record<string, string>[]; documents?: BulkDocument[]; permission?: unknown; file_reads?: FileResult[] };
  const rawRows = stored.raw_rows ?? [];
  const documents = stored.documents ?? [];
  // Never a dead end: with no list, leads still come from file/folder names, photo/PDF text and photo GPS.
  const fileRefs = manifest.map((f) => ({ name: f.path, folder: f.folder ?? null, geo_address: f.geo_address ?? null }));
  const pre = (batch.summary as { pre_extracted?: BulkExtracted[] } | null)?.pre_extracted;
  // Big lists are read in chunks first (by the page, or here) so one slow reply can't fail the whole upload.
  const fromRows = pre ?? (rawRows.length > READ_CHUNK_ROWS ? await readRowsInChunks(rawRows) : null);
  const cleaned0 = (fromRows
    ? [...fromRows, ...(documents.length || fileRefs.length ? await aiExtractRows([], documents, fileRefs) : [])]
    : await aiExtractRows(rawRows, documents, fileRefs)).map(cleanLead);
  // Photos with no customer details still make one row ("Customer details needed") so the installer can fill it in.
  const cleaned = cleaned0.length || !manifest.length ? cleaned0 : [cleanLead<BulkExtracted>({ full_name: null, email: null, phone: null, address_line: null, suburb: null, postcode: null })];
  const extracted = cleaned.map((c) => c.lead);
  const existing = await existingPortalKeys();
  const dupNotes = findDuplicates(extracted, existing);

  await admin.from("bulk_import_rows").delete().eq("batch_id", batchId);
  const allMatches: ReturnType<typeof matchFiles>["matched"][] = [];
  const links = linkFiles(extracted, manifest);
  const rows = extracted.map((e, i) => {
    const { matched, confidence } = links[i]!;
    allMatches.push(matched);
    const duplicate = dupNotes.has(i);
    const { result, reasons } = sortJob(e, { matchConfidence: confidence, duplicate });
    const photos = matched.filter((m) => /\.(jpe?g|png|heic|heif|webp)$/i.test(m.name)).length; // photos count as visit evidence; a PDF/list does not
    const stage = leadStage(e, photos);
    const sc = effectiveSiteCheck(e, photos);
    reasons.unshift(`Stage: ${LEAD_STAGE_LABEL[stage]}`, siteCheckLabel(sc.check, sc.date));
    const gapReason = customerDetailsReason(e); if (gapReason) reasons.push(gapReason);
    if (quoteNeeded(e)) reasons.push(QUOTE_NEEDED_LABEL);
    reasons.push(...cleaned[i]!.issues);
    if (matched.some((m) => m.how === "only_lead")) reasons.push("Photos attached because this is the only customer in the upload — please check");
    else if (matched.length > 0 && confidence === "low") reasons.push("Files matched by filename only — please check");
    return {
      batch_id: batchId, row_index: i, extracted: { ...e, lead_stage: stage, site_check: sc.check, site_check_date: sc.date, site_check_source: sc.check ? "file" : null } as unknown as Json,
      import_stage: stage,
      matched_files: matched as unknown as Json, match_confidence: confidence,
      sort_result: result, sort_reasons: reasons as unknown as Json,
      missing_evidence: missingEvidence(e, matched) as unknown as Json,
      duplicate_note: dupNotes.get(i) ?? null,
    };
  });
  if (rows.length) {
    const { error } = await admin.from("bulk_import_rows").insert(rows);
    if (error) throw new BulkImportError(error.message);
  }
  const summary = {
    rows: rows.length,
    covers_ready_check: rows.filter((r) => r.sort_result === "covers_ready_check").length,
    needs_visit: rows.filter((r) => r.sort_result === "needs_visit").length,
    office_review: rows.filter((r) => r.sort_result === "office_review").length,
    duplicates: rows.filter((r) => r.duplicate_note).length,
    not_visited: extracted.filter((e, i) => leadStage(e, (rows[i]!.matched_files as unknown[]).length) === "not_visited").length,
    visited: extracted.filter((e, i) => leadStage(e, (rows[i]!.matched_files as unknown[]).length) === "visited").length,
    visited_quoted: extracted.filter((e) => e.price_inc_gst && e.price_inc_gst > 0).length,
    site_check_unclear: extracted.filter((e) => siteCheckFromFile(e).check == null).length,
    quote_needed: extracted.filter((e) => quoteNeeded(e)).length,
    permission: stored.permission ?? null,
    file_results: fileResults(stored.file_reads ?? [], extracted, allMatches),
  };
  await admin.from("bulk_import_batches").update({ status: "analysed", summary: summary as unknown as Json }).eq("id", batchId);
  await logPartner(null, actorId, "bulk_import_analysed", `Bulk upload analysed: ${summary.rows} jobs found (${summary.covers_ready_check} cover the Ready Check, ${summary.needs_visit} need a visit, ${summary.office_review} for office review)`, { batch_id: batchId, ...summary });
  return summary;
}

// ---------- confirmation: create the jobs ----------

type ImportStage = "not_visited" | "visited" | "quoted" | "installed";
type ElectricianPlan = { mode?: "mine" | "hivic"; nomination_id?: string | null; business_id?: string | null };

// Security review (Jo, 6 Oct): no upload ever lands at a quote-acceptance or complete stage.
// "Quoted" rows start at the normal entry for visited work; the supplied price stays a DRAFT quote for office review.
// "Installed" rows are history only — on hold, never complete, never claimable, never in payouts.
export const INSTALLED_HISTORY_NOTE = "History: already installed before Home Insulation Victoria — not claimable. Office review only.";
export const stagePlacement: Record<ImportStage, { stage: "ready_check_ready_to_schedule" | "ready_check_complete" | "on_hold"; next: string }> = {
  not_visited: { stage: "ready_check_ready_to_schedule", next: "Owner chooses Ready Check times" },
  visited: { stage: "ready_check_complete", next: "Office reviews the supplied measure-up and evidence" },
  quoted: { stage: "ready_check_complete", next: "Office reviews the supplied measure-up and draft quote — it only goes to the owner through the usual gates" },
  installed: { stage: "on_hold", next: INSTALLED_HISTORY_NOTE },
};

async function createBulkJob(e: BulkExtracted, batch: { id: string; business_id: string }, actorId: string, rowId: string, importStage: ImportStage) {
  // Security review (Jo, 6 Oct): an installer upload NEVER reuses an existing owner. A new owner is always created;
  // an exact (case-insensitive) email match is only flagged for the office under Possible duplicates.
  const email = e.email?.trim().toLowerCase() || null;
  const { createInstallerOwner } = await import("./installer-owner.server");
  const created = await createInstallerOwner(admin, batch.business_id, { full_name: e.full_name ?? "Unknown", email, phone: e.phone ?? null });
  const ownerId = created.id;
  const sameEmail = email ? (await admin.from("owners").select("id").ilike("email", exactLike(email)).neq("id", ownerId).limit(5)).data ?? [] : [];
  const { data: prop, error: pe } = await admin.from("properties").insert({
    owner_id: ownerId, address_line: e.address_line!, suburb: e.suburb ?? null, postcode: e.postcode ?? null, state: "VIC",
  }).select("id").single();
  if (pe || !prop) throw new BulkImportError(pe?.message ?? "Property could not be created.");
  const { intakeSourceFor } = await import("./pilot.server");
  const source = await intakeSourceFor(actorId, batch.business_id, "bulk_import");
  const placement = stagePlacement[importStage];
  const { data: job, error: je } = await admin.from("jobs").insert({
    owner_id: ownerId, property_id: prop.id, stage: placement.stage, source, business_unit: "hivic", installer_led: true,
    channel: "installer_sourced", originating_installer_business_id: batch.business_id, originating_installer_user_id: actorId,
    external_enquiry_id: `bulk:${rowId}`,
    // Jo (7 Oct): the installer's own price exactly as given (none = quote needed) and whether he already did the site check.
    installer_site_check: siteCheckFromFile(e).check, installer_site_check_date: siteCheckFromFile(e).date,
    installer_quoted: e.quoted_answer ?? null,
    installer_quoted_price_inc_gst: e.quoted_answer === "yes" ? e.price_inc_gst ?? null : null, installer_price_includes: e.quoted_answer === "yes" ? e.price_includes ?? null : null,
    next_action: importStage === "installed" ? placement.next : e.quoted_answer == null ? `${placement.next} · ${QUOTED_ANSWER_NEEDED}` : e.quoted_answer === "no" ? `${placement.next} · ${QUOTE_NEEDED_LABEL}` : placement.next,
  }).select("id, job_number").single();
  if (je || !job) throw new BulkImportError(je?.message ?? "Job could not be created.");
  if (sameEmail.length) await admin.from("workflow_events").insert({ job_id: job.id, actor_id: actorId, event_type: "possible_duplicate_owner", summary: "Possible duplicate owner (same email) — office to check", details: { note: "Bulk upload: this owner's email matches an existing owner. A new owner was created; office to check under Possible duplicates.", existing_owner_ids: sameEmail.map((o) => o.id), source: "bulk_import" } as unknown as Json });
  await admin.from("job_assignments").insert({ job_id: job.id, user_id: actorId, role: "installer", business_id: batch.business_id, assigned_by: actorId });
  if (importStage !== "not_visited" && e.area_m2 && e.area_m2 > 0) {
    const { error: me } = await admin.from("ceiling_measurements").insert({
      job_id: job.id, source_role: "installer", status: "needs_review", is_current: true,
      supplied_area_m2: e.area_m2, measured_area_m2: e.area_m2, measured_by_business_id: batch.business_id,
      provenance: "installer_supplied_provisional", external_source: "bulk_import", external_id: rowId,
      raw_snapshot: { row_id: rowId, import_stage: importStage, supplied: e } as unknown as Json,
      review_flags: ["Imported installer measurement requires office acceptance"] as unknown as Json,
    });
    if (me) throw new BulkImportError(`Measure-up could not be saved: ${me.message}`);
  }
  return job;
}

async function draftQuoteFromImport(jobId: string, e: BulkExtracted, actorId: string, partnerBusinessId: string) {
  if (!(e.price_inc_gst && e.price_inc_gst > 0) || !(e.area_m2 && e.area_m2 > 0)) return false;
  const { data: job } = await admin.from("jobs").select("ap_fee_override_inc_gst, electrician_choice, properties(postcode)").eq("id", jobId).single();
  const postcode = String((job?.properties as { postcode: string | null } | null)?.postcode ?? "").trim();
  const [{ data: loc }, { data: rs }] = await Promise.all([
    admin.from("veu_location_variables").select("*").eq("postcode", postcode).maybeSingle(),
    admin.from("retail_estimator_settings").select("ap_management_inc_gst, piesa_assessment_inc_gst, indicative_veec_value, minimum_customer_copayment_inc_gst").eq("is_current", true).maybeSingle(),
  ]);
  const veecValue = rs ? Number(rs.indicative_veec_value) : null;
  const apFee = job?.ap_fee_override_inc_gst != null ? Number(job.ap_fee_override_inc_gst) : rs ? Number(rs.ap_management_inc_gst) : null;
  // Current recorded payer: own electrician = no HIV PIESA line; undecided = no automatic quote (office quotes later).
  const { piesaChargeIncGst } = await import("./installer-led.core");
  const piesa = piesaChargeIncGst(job?.electrician_choice ?? null, rs ? Number(rs.piesa_assessment_inc_gst) : null);
  if (!loc || veecValue == null || apFee == null || piesa == null) return false; // office quotes manually
  const rawDiscount = wholeVeecDiscount(e.area_m2, loc as unknown as LocationVariables, veecValue).raw;
  const lines = [
    { code: "INSTALLER_PRICE", description: e.price_includes ? `Insulation works by your installer — includes: ${e.price_includes}`.slice(0, 500) : "Insulation works by your installer", quantity: 1, unit: "flat", unit_price_inc_gst: e.price_inc_gst, line_total_inc_gst: e.price_inc_gst, is_other: false, explanation: null, sort: 0 },
    ...(piesa > 0 ? [{ code: "PIESA", description: "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", quantity: 1, unit: "flat", unit_price_inc_gst: piesa, line_total_inc_gst: piesa, is_other: false, explanation: null, sort: 1 }] : []),
    { code: "AP_FEE", description: "Home Insulation Victoria — Accredited Person fee", quantity: 1, unit: "flat", unit_price_inc_gst: apFee, line_total_inc_gst: apFee, is_other: false, explanation: null, sort: 2 },
  ];
  const subtotal = Math.round((e.price_inc_gst + piesa + apFee) * 100) / 100;
  // Same guardrail as every other quote: the $200 minimum contribution (no maximum discount exists).
  const rules = applyDiscountRules(rawDiscount, subtotal, loc ? (loc as unknown as LocationVariables).metropolitan_or_regional === "Metropolitan" : null, {
    minimum_customer_copayment_inc_gst: rs ? Number(rs.minimum_customer_copayment_inc_gst) : 200,
  });
  const discount = Math.round(rules.discount * 100) / 100;
  const customerTotal = Math.round((subtotal - discount) * 100) / 100;
  const release = confirmedQuoteDecision({ estimateTotal: null, quoteTotal: customerTotal, tolerancePct: 15, hasUnratedExtras: false, externalSendingEnabled: false });
  const { data: q, error } = await admin.from("quotes").insert({
    job_id: jobId, kind: "installation", option_label: "Installer's quote (from bulk upload)", option_code: "INSTALLER_A1", status: "draft",
    subtotal_inc_gst: subtotal, gst_amount: Math.round((subtotal - subtotal / 1.1) * 100) / 100,
    veec_discount_inc_gst: discount, discount_note: discountNotes(rules).join(" ") || null, customer_total_inc_gst: customerTotal, created_by: actorId,
    partner_business_id: partnerBusinessId, release_state: release.state, release_hold_reason: release.reason,
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
  type Perm = { confirmed_by: string; confirmed_at: string; wording: string };
  // Owner consent (Jo, 7 Oct): ticked per customer on the review card; older uploads carry one tick for the whole upload.
  const batchPermission = (batch.summary as { permission?: Perm } | null)?.permission ?? null;
  let created = 0, skipped = 0, failed = 0, alreadyTaken = 0;
  const ownerLinks: { jobNumber: string; owner: string; path: string }[] = [];
  for (const row of rows ?? []) {
    if (skipRowIds.includes(row.id) || row.duplicate_note) {
      const { data: sk } = await admin.from("bulk_import_rows").update({ status: "skipped" }).eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
      if (sk) skipped++;
      continue;
    }
    const e = row.extracted as unknown as BulkExtracted;
    const gap = customerDetailsReason(e);
    if (gap) {
      failed++;
      await logPartner(null, actorId, "bulk_import_row_failed", `Row ${row.row_index + 1}: ${gap} in the review table, then confirm again`, { batch_id: batchId, row_id: row.id });
      continue;
    }
    const permission = ((e as { owner_consent?: Perm | null }).owner_consent ?? batchPermission) as Perm | null;
    if (!permission?.confirmed_by || !permission.confirmed_at || (e as { owner_consent?: unknown }).owner_consent === false) {
      failed++;
      await logPartner(null, actorId, "bulk_import_row_failed", `Row ${row.row_index + 1}: owner consent not ticked — tick it on the card, then confirm again`, { batch_id: batchId, row_id: row.id });
      continue;
    }
    if (outsideVictoria(e.postcode)) {
      const { data: sk } = await admin.from("bulk_import_rows").update({ status: "skipped" }).eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
      if (sk) skipped++;
      continue;
    }
    // Quoted? never blocks (Jo, 5:46pm): blank = confirm anyway, job shows "Quoted? – answer needed". Only Yes-without-price stops a row.
    const qg = e.quoted_answer === "yes" ? quotedGap(e.quoted_answer, e.price_inc_gst) : null;
    if (qg) {
      failed++;
      await logPartner(null, actorId, "bulk_import_row_failed", `Row ${row.row_index + 1}: ${qg} in the review table, then confirm again`, { batch_id: batchId, row_id: row.id });
      continue;
    }
    if (siteCheckFromFile(e).check == null && row.import_stage !== "installed") {
      failed++;
      await logPartner(null, actorId, "bulk_import_row_failed", `Row ${row.row_index + 1}: tell us whether you've already done the site check (Yes or No), then confirm again`, { batch_id: batchId, row_id: row.id });
      continue;
    }
    if (row.sort_result === "office_review") {
      failed++;
      await logPartner(null, actorId, "bulk_import_row_failed", `Row ${row.row_index + 1} needs office review first — clear it, then confirm again`, { batch_id: batchId, row_id: row.id });
      continue;
    }
    // Atomic claim: only one click/tab can move this row out of "pending"; the other skips it.
    const { data: claimed } = await admin.from("bulk_import_rows").update({ status: "confirmed" }).eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) { alreadyTaken++; continue; }
    try {
      const importStage = row.import_stage as ImportStage;
      // Backstop: a job already made for this row (unique bulk:<row>) is reused, never duplicated.
      const { data: prior } = await admin.from("jobs").select("id, job_number").eq("external_enquiry_id", `bulk:${row.id}`).maybeSingle();
      if (prior) { await admin.from("bulk_import_rows").update({ job_id: prior.id }).eq("id", row.id); alreadyTaken++; continue; }
      const job = await createBulkJob(e, batch, actorId, row.id, importStage);
      const quoted = importStage === "quoted" ? await draftQuoteFromImport(job.id, e, actorId, batch.business_id).catch(() => false) : false;
      const plan = ((row.electrician_plan ?? batch.electrician_plan ?? { mode: "hivic" }) as ElectricianPlan);
      await (await import("./job-electrician.server")).recordJobElectricianChoice(job.id, batch.business_id, plan as never, actorId);
      await admin.from("bulk_import_rows").update({ job_id: job.id }).eq("id", row.id);
      const ownerToken = newToken();
      await admin.from("owner_eligibility_links").insert({ job_id: job.id, business_id: batch.business_id, token_hash: await hashToken(ownerToken), created_by: actorId, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() });
      ownerLinks.push({ jobNumber: job.job_number, owner: e.full_name ?? "Customer", path: `/eligibility/${ownerToken}` });
      await logEvent(job.id, actorId, "bulk_import_confirmed", `Job created from installer bulk upload (row ${row.row_index + 1})`, {
        batch_id: batchId, row_id: row.id, sort_result: row.sort_result,
        missing_evidence: row.missing_evidence, draft_quote: quoted,
        import_stage: importStage, electrician_plan: plan,
      });
      await logEvent(job.id, permission.confirmed_by, "bulk_import_contact_permission", permission.wording, {
        batch_id: batchId, confirmed_by: permission.confirmed_by, confirmed_at: permission.confirmed_at, wording: permission.wording,
      });
      created++;
    } catch (err) {
      failed++;
      // Release the claim only if no job was made, so the row can be fixed and confirmed again.
      const { data: made } = await admin.from("jobs").select("id").eq("external_enquiry_id", `bulk:${row.id}`).maybeSingle();
      if (made) await admin.from("bulk_import_rows").update({ job_id: made.id }).eq("id", row.id);
      else await admin.from("bulk_import_rows").update({ status: "pending", job_id: null }).eq("id", row.id);
      await logPartner(null, actorId, "bulk_import_row_failed", `Row ${row.row_index + 1} could not be imported: ${(err as Error).message}`, { batch_id: batchId, row_id: row.id });
    }
  }
  // The batch is only closed once nothing is left to fix; otherwise it stays open for another confirm.
  const { count: left } = await admin.from("bulk_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("status", "pending");
  if (!left) await admin.from("bulk_import_batches").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", batchId).eq("status", "analysed");
  return { created, skipped, failed, alreadyTaken, remaining: left ?? 0, ownerLinks };
}

/** Office/installer adds the missing address to a review row; the row is re-sorted (never auto-confirmed). */
export async function setRowAddress(rowId: string, addr: { full_name?: string; email?: string; phone?: string; address_line: string; suburb: string | null; postcode: string | null; second_contact?: { name: string | null; phone: string | null; email: string | null } | null }) {
  const { data: row } = await admin.from("bulk_import_rows").select("*").eq("id", rowId).single();
  if (!row || row.status !== "pending") throw new BulkImportError("This row can no longer be changed.");
  const { lead: e, issues } = cleanLead({ ...(row.extracted as unknown as BulkExtracted), ...addr });
  if (customerDetailsReason(e)) throw new BulkImportError(`${customerDetailsReason(e)}.`);
  if (issues.length) throw new BulkImportError(issues[0]!);
  const existing = await existingPortalKeys();
  const dn = findDuplicates([e], existing); const duplicate = dn.has(0);
  const { result, reasons } = sortJob(e, { matchConfidence: (row.match_confidence ?? "none") as "high" | "low" | "none", duplicate });
  const stage = (e as { lead_stage?: LeadStage }).lead_stage;
  if (stage) reasons.unshift(`Stage: ${LEAD_STAGE_LABEL[stage]}`);
  reasons.push("Customer details added by hand in the review table");
  const { error } = await admin.from("bulk_import_rows").update({
    extracted: e as unknown as Json, sort_result: result, sort_reasons: reasons as unknown as Json,
    duplicate_note: dn.get(0) ?? null,
  }).eq("id", rowId);
  if (error) throw new BulkImportError(error.message);
  return { batch_id: row.batch_id };
}

/** Installer attaches photos/files to one customer card (camera or files). Photos count as a visit, like upload matches. */
export async function addRowFiles(rowId: string, businessId: string, files: { path: string; name: string; type: string }[]) {
  const { data: row } = await admin.from("bulk_import_rows").select("matched_files, status, extracted, import_stage").eq("id", rowId).single();
  if (!row || row.status !== "pending") throw new BulkImportError("This customer can no longer be changed.");
  const { allowedUpload } = await import("./upload-safety.core"); const { verifyStoredUpload } = await import("./upload-safety.server");
  for (const f of files) {
    if (!f.path.startsWith(`partners/${businessId}/imports/`)) throw new BulkImportError("Invalid file path");
    const m = allowedUpload(f.name, f.type, { imports: true }); if (!m) throw new BulkImportError(`${f.name}: that file type isn't accepted.`);
    await verifyStoredUpload("job-files", f.path, m);
  }
  const have = (row.matched_files as unknown as FileMatch[]) ?? [];
  const next = [...have, ...files.filter((f) => !have.some((h) => h.path === f.path)).map((f) => ({ path: f.path, name: f.name, how: "added" as const }))];
  const photos = next.filter((m) => /\.(jpe?g|png|heic|heif|webp)$/i.test(m.name)).length;
  const e = row.extracted as unknown as BulkExtracted;
  const stage = row.import_stage === "installed" ? "installed" : leadStage(e, photos);
  await admin.from("bulk_import_rows").update({ matched_files: next as unknown as Json, import_stage: stage, extracted: { ...e, lead_stage: stage } as unknown as Json }).eq("id", rowId);
  return { files: next };
}
export async function removeRowFile(rowId: string, path: string) {
  const { data: row } = await admin.from("bulk_import_rows").select("matched_files, status").eq("id", rowId).single();
  if (!row || row.status !== "pending") throw new BulkImportError("This customer can no longer be changed.");
  const next = ((row.matched_files as unknown as FileMatch[]) ?? []).filter((m) => m.path !== path);
  await admin.from("bulk_import_rows").update({ matched_files: next as unknown as Json }).eq("id", rowId);
  return { files: next };
}
