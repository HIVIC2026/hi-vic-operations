// Add one job (installer import) persistence, shared by the RPC in pilot.functions.ts and the installer test.
// Moved verbatim from the server function handlers; the caller passes the verified user id.
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { confirmBlockers, extractFromCsvRow, extractFromText, mergeExtracted, parseCsv, planImportedMeasurement, relationshipOwnerFor, type ConfirmedFacts, type Extracted } from "./pilot.core";
import { requireApprovedPartner, requireMember } from "./pilot.server";

export type CreateImportInput = { businessId: string; sourceSystem: "easymate" | "manual_import" | "csv" | "email"; text?: undefined | string; csv?: undefined | string; csvRow: number; sourceUrl?: undefined | string; externalRefs?: undefined | Record<string, string>; files: { path: string; name: string; type: string }[] };
export type ConfirmImportInput = { importId: string; facts: Record<string, string | number | boolean | null>; progress?: undefined | "not_visited" | "measured" | "quoted"; occupancy?: undefined | "owner_occupied" | "rental"; details?: undefined | Record<string, unknown>;
  installer?: undefined | { site_check: "yes" | "no"; site_check_date?: undefined | string | null; quoted_price_inc_gst?: undefined | number | null; price_includes?: undefined | string | null; contact_permission?: undefined | boolean } };

export async function createImportFor(userId: string, data: CreateImportInput) {
  const context = { userId };
  await requireMember(context.userId, data.businessId, true); // business owner only
  await requireApprovedPartner(data.businessId);
  for (const f of data.files) if (!f.path.startsWith(`partners/${data.businessId}/imports/`)) throw new WorkflowError("Invalid file path");
  { const { allowedUpload } = await import("./upload-safety.core"); const { verifyStoredUpload } = await import("./upload-safety.server");
    for (const f of data.files) { const m = allowedUpload(f.name, f.type, { imports: true }); if (!m) throw new WorkflowError(`${f.name}: that file type isn't accepted.`); await verifyStoredUpload("job-files", f.path, m); } }
  const parts: Extracted[] = [];
  if (data.csv) { const rows = parseCsv(data.csv); const r = rows[data.csvRow]; if (!r) throw new WorkflowError("That CSV row was not found."); parts.push(extractFromCsvRow(r)); }
  if (data.text) parts.push(extractFromText(data.text));
  const extracted = mergeExtracted(...parts);
  if (data.externalRefs && !extracted.external_reference?.value) { const v = Object.values(data.externalRefs)[0]; if (v) extracted.external_reference = { value: v, confidence: "found", source: "reference field" }; }
  // URLs are stored as a source reference only – never fetched or scraped.
  const method = data.csv ? "csv" : data.text ? "text" : data.files.length ? "files" : "reference";
  const { data: row, error } = await admin.from("job_imports").insert({
    business_id: data.businessId, created_by: context.userId, source_system: data.csv ? (data.sourceSystem === "manual_import" ? "csv" : data.sourceSystem) : data.sourceSystem, method,
    raw_text: [data.text, data.csv].filter(Boolean).join("\n---\n") || null, source_url: data.sourceUrl ?? null, external_refs: (data.externalRefs ?? {}) as Json,
    files: data.files as unknown as Json, extracted: extracted as unknown as Json,
  }).select("id").single();
  if (error) throw new WorkflowError(error.message);
  return { id: row.id, extracted };
}

export async function confirmImportFor(userId: string, data: ConfirmImportInput) {
  const context = { userId, supabase: admin };
  const { data: imp } = await admin.from("job_imports").select("*").eq("id", data.importId).single();
  if (!imp || imp.status !== "draft") throw new WorkflowError("This import was already confirmed or discarded.");
  await requireMember(context.userId, imp.business_id, true); // business owner only (staff are refused, like createImport)
  const biz = await requireApprovedPartner(imp.business_id);
  const { data: isInstaller } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "installer" });
  if (!isInstaller) throw new WorkflowError("Only installer team members can confirm imported jobs.");
  const c = data.facts as ConfirmedFacts;
  const blockers = confirmBlockers(c);
  if (data.installer?.contact_permission !== true) blockers.push("Tick to confirm the owner agreed to Home Insulation Victoria contacting them");
  if (blockers.length) throw new WorkflowError(blockers.join(" • "));
  const area = Number(c.measured_area_m2);
  if (!Number.isFinite(area) || area <= 0 || area > 5000) throw new WorkflowError("Enter the ceiling area (m²) before confirming — every job needs an area estimate.");
  const { upsertEnquiry } = await import("./enquiry.server");
  const s = (k: keyof ConfirmedFacts) => (c[k] == null || c[k] === "" ? null : String(c[k]));
  const res = await upsertEnquiry({
    full_name: s("full_name")!, email: s("email")!, phone: s("phone"), address_line: s("address_line")!, suburb: s("suburb"), postcode: s("postcode"),
    estimated_area_m2: area, ...(data.occupancy ? { occupancy: data.occupancy } : {}),
  }, await (await import("./pilot.server")).intakeSourceFor(context.userId, imp.business_id, "installer_import"), context.userId, { channel: "installer_sourced", businessId: imp.business_id, userId: context.userId });
  const refs = { ...(imp.external_refs as Record<string, unknown>), ...(s("external_reference") ? { reference: s("external_reference") } : {}), ...(imp.source_url ? { source_url: imp.source_url } : {}), import_id: imp.id };
  const rel = relationshipOwnerFor("installer_sourced", biz.default_comms_owner);
  const pilotInvoice = biz.commercial_route === "hivic_full_invoice";
  // Jo (7 Oct): record whether the installer already did the site check, and his own quoted price + what it includes.
  const det = (data.details ?? {}) as { total_inc_gst?: unknown; price_lines?: { description?: string | null; qty?: number }[] };
  const quotedTotal = data.progress === "quoted" && Number(det.total_inc_gst) > 0 ? Math.round(Number(det.total_inc_gst) * 100) / 100 : null;
  const includes = quotedTotal ? (det.price_lines ?? []).map((l) => [l.description, l.qty ? `× ${l.qty}` : null].filter(Boolean).join(" ")).filter(Boolean).join("; ").slice(0, 1000) || null : null;
  const onDate = typeof c.measured_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.measured_on) ? c.measured_on : null;
  const inst = data.installer;
  await admin.from("jobs").update(inst ? {
    installer_site_check: inst.site_check,
    installer_site_check_date: inst.site_check === "yes" ? inst.site_check_date ?? null : null,
    installer_quoted_price_inc_gst: inst.quoted_price_inc_gst ?? null, installer_price_includes: inst.quoted_price_inc_gst ? inst.price_includes || null : null,
  } : {
    installer_site_check: data.progress ? (data.progress === "not_visited" ? "no" : "yes") : null,
    installer_site_check_date: data.progress && data.progress !== "not_visited" ? onDate : null,
    installer_quoted_price_inc_gst: quotedTotal, installer_price_includes: includes,
  }).eq("id", res.job_id);
  await admin.from("jobs").update({ customer_relationship_owner: rel, source_system: imp.source_system, external_refs: refs as Json,
    ...(pilotInvoice ? { commercial_model: "hivic_invoices_owner" as const, commercial_model_set_by: context.userId, commercial_model_set_at: new Date().toISOString() } : {}) }).eq("id", res.job_id);
  await admin.from("job_assignments").insert({ job_id: res.job_id, user_id: context.userId, role: "installer", business_id: imp.business_id, assigned_by: context.userId, first_response_at: new Date().toISOString() });
  const { data: ws } = await admin.from("workflow_settings").select("measurement_standard_approved").limit(1).maybeSingle();
  const { data: pm } = await admin.from("partner_measurement_methods").select("id").eq("business_id", imp.business_id).eq("status", "approved").order("approved_at", { ascending: false }).limit(1).maybeSingle();
  // "Not visited yet": the rough size is only the estimate; no measure-up is recorded and the Ready Check is next.
  const m = data.progress === "not_visited" || data.installer?.site_check === "no" ? null : planImportedMeasurement(c, imp.id, { businessId: imp.business_id, standardApproved: !!ws?.measurement_standard_approved && !!pm });
  if (m) {
    await admin.from("ceiling_measurements").update({ is_current: false }).eq("job_id", res.job_id).eq("is_current", true);
    await admin.from("ceiling_measurements").insert({ ...m, supplied_snapshot: m.supplied_snapshot as unknown as Json, partner_method_id: pm?.id ?? null, review_flags: m.review_flags as unknown as Json, job_id: res.job_id, is_current: true, created_by: context.userId, raw_snapshot: { import_id: imp.id, confirmed: c, extracted: imp.extracted, progress: data.progress ?? null, ready_check_a1: data.details ?? null } as unknown as Json });
    await admin.from("jobs").update({ measure_up_responsibility: "installer" }).eq("id", res.job_id);
  }
  await admin.from("job_imports").update({ status: "confirmed", confirmed_facts: c as Json, confirmed_by: context.userId, confirmed_at: new Date().toISOString(), job_id: res.job_id, updated_at: new Date().toISOString() }).eq("id", imp.id);
  await logEvent(res.job_id, context.userId, "job_imported", `Imported from ${imp.source_system} by originating installer (confirmed by user)`, { import_id: imp.id, source_system: imp.source_system, external_refs: refs, relationship_owner: rel, measurement_imported: !!m, files: imp.files, progress: data.progress ?? null, ready_check_a1: data.details ?? null });
  if (pilotInvoice) await logEvent(res.job_id, context.userId, "commercial_model_set", "Pilot commercial route: full job invoiced by Home Insulation Victoria (split invoicing disabled)", { route: "hivic_full_invoice" });
  await logEvent(res.job_id, userId, "installer_contact_permission", "Installer confirmed the owner agreed to Home Insulation Victoria contacting them", { import_id: data.importId, wording: (await import("./pilot.core")).ONE_JOB_PERMISSION_WORDING }, { internal: true });
  return { jobId: res.job_id, jobNumber: res.job_number };
}
