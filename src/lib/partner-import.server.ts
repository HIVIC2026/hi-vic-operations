// Add one job (installer import) persistence, shared by the RPC in pilot.functions.ts and the installer test.
// Moved verbatim from the server function handlers; the caller passes the verified user id.
import { readRemoval, removalProblems, removalSummary, type RemovalQuote } from "./intake-quote-details.core";
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { confirmBlockers, extractFromCsvRow, extractFromText, mergeExtracted, parseCsv, planImportedMeasurement, relationshipOwnerFor, type ConfirmedFacts, type Extracted } from "./pilot.core";
import { requireApprovedPartner, requireMember } from "./pilot.server";

export type CreateImportInput = { businessId: string; sourceSystem: "easymate" | "manual_import" | "csv" | "email"; text?: undefined | string; csv?: undefined | string; csvRow: number; sourceUrl?: undefined | string; externalRefs?: undefined | Record<string, string>; files: { path: string; name: string; type: string }[] };
export type ConfirmImportInput = { importId: string; facts: Record<string, string | number | boolean | null>; progress?: undefined | "not_visited" | "measured" | "quoted"; occupancy?: undefined | "owner_occupied" | "rental"; details?: undefined | Record<string, unknown>;
  installer?: undefined | { quoted?: undefined | "yes" | "no" | null; site_check: "yes" | "no"; site_check_date?: undefined | string | null; quoted_price_inc_gst?: undefined | number | null; price_includes?: undefined | string | null; contact_permission?: undefined | boolean; fee_awareness?: undefined | boolean; existing_below_r2?: undefined | boolean; owner_agreed?: undefined | boolean;
    intake?: undefined | { existing_insulation: "none" | "below_r2" | "unknown"; removal_quote?: RemovalQuote; evidence_ack: boolean; proposed_r_value?: undefined | number | null; version: string; coordination: "hivic_managed" | "self_managed"; self_managed_ack: boolean; quote_status?: undefined | "not_quoted" | "have_quote"; measured_required?: undefined | boolean; electrician_payer?: undefined | "hivic" | "own" | "undecided"; fee_awareness?: undefined | { declared: boolean; payer: "hivic" | "own" | "undecided"; text: string; version: string } } };
  electrician?: undefined | { mode: "mine" | "hivic" | "later"; business_id?: undefined | string | null; nomination_id?: undefined | string | null } };

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

async function loadImport(id: string) { const { data } = await admin.from("job_imports").select("*").eq("id", id).single(); return data; }

/** Exact-claim fence: only the handler holding THIS claim (user + exact claim timestamp read back from the row) may write. */
export type ImportClaim = { id: string; userId: string; at: string };
const fenced = <Q extends { eq: (c: string, v: string) => Q }>(q: Q, cl: ImportClaim) => q.eq("id", cl.id).eq("status", "draft").eq("confirmed_by", cl.userId).eq("confirmed_at", cl.at);

export async function confirmImportFor(userId: string, data: ConfirmImportInput, run: typeof confirmClaimed = confirmClaimed) {
  const { data: imp0 } = await admin.from("job_imports").select("*").eq("id", data.importId).single();
  if (!imp0) throw new WorkflowError("This import was not found.");
  await requireMember(userId, imp0.business_id, true);
  // Every attempt (first, retry after release, or stale takeover) must atomically WIN the claim by compare-and-swap on
  // the exact claim it observed. A fresh claim stays busy even when a partial job exists (no second-tab resume).
  const { importClaimDecision, intakeAttemptKey } = await import("./installer-intake.core");
  const decision = importClaimDecision({ status: imp0.status, confirmedBy: imp0.confirmed_by, confirmedAt: imp0.confirmed_at, jobId: imp0.job_id }, userId, Date.now());
  if (decision === "done") {
    const { data: j } = await admin.from("jobs").select("job_number").eq("id", imp0.job_id!).maybeSingle();
    return { jobId: imp0.job_id as string, jobNumber: (j?.job_number as string | null) ?? null, reused: true };
  }
  if (decision === "refuse") throw new WorkflowError("This import was already confirmed or discarded.");
  if (decision === "busy") throw new WorkflowError("This job is already being saved — wait a moment and try again.");
  let q = admin.from("job_imports").update({ confirmed_by: userId, confirmed_at: new Date().toISOString() }).eq("id", imp0.id).eq("status", "draft");
  q = imp0.confirmed_by ? q.eq("confirmed_by", imp0.confirmed_by).eq("confirmed_at", imp0.confirmed_at as string) : q.is("confirmed_by", null);
  const { data: won, error: ce } = await q.select("id, confirmed_at, job_id, confirmed_facts").maybeSingle();
  if (ce) throw new WorkflowError(ce.message);
  if (!won?.confirmed_at) throw new WorkflowError("This job is already being saved — wait a moment and try again.");
  const claim: ImportClaim = { id: imp0.id, userId, at: won.confirmed_at as string };
  const release = async () => { await fenced(admin.from("job_imports").update({ confirmed_by: null, confirmed_at: null }), claim); }; // keeps job_id
  const attempt = intakeAttemptKey(data);
  const resumeJobId = (won.job_id as string | null) ?? null;
  if (resumeJobId) {
    const prev = (won.confirmed_facts as { pending_attempt?: string } | null)?.pending_attempt;
    if (prev && prev !== attempt) { await release(); throw new WorkflowError("This job was already partly saved with different details. Go back, keep the details you first submitted, and submit again — or ask Home Insulation Victoria to correct it."); }
  }
  try {
    return await run(userId, data, imp0, resumeJobId, claim, attempt);
  } catch (e) { await release(); throw e; }
}

/** Attach the new job to the claimed import (fenced) and remember exactly what was attempted. */
export async function linkImportJob(claim: ImportClaim, jobId: string, attempt: string) {
  const { data, error } = await fenced(admin.from("job_imports").update({ job_id: jobId, confirmed_facts: { pending_attempt: attempt } as unknown as Json }), claim).is("job_id", null).select("id").maybeSingle();
  if (error) throw new WorkflowError(error.message);
  if (!data) throw new WorkflowError("This save was taken over by a newer attempt — refresh to see the job.");
}
/** Only the claim holder may confirm; a superseded handler cannot. */
export async function finalizeImport(claim: ImportClaim, jobId: string, facts: Json) {
  const { data, error } = await fenced(admin.from("job_imports").update({ status: "confirmed", confirmed_facts: facts, job_id: jobId, updated_at: new Date().toISOString() }), claim).eq("job_id", jobId).select("id").maybeSingle();
  if (error) throw new WorkflowError(`Confirming the job: ${error.message}`);
  if (!data) throw new WorkflowError("This save was taken over by a newer attempt — refresh to see the job.");
}

export async function confirmClaimed(userId: string, data: ConfirmImportInput, imp: NonNullable<Awaited<ReturnType<typeof loadImport>>>, resumeJobId: string | null, claim: ImportClaim, attempt: string) {
  const context = { userId, supabase: admin };
  await requireMember(context.userId, imp.business_id, true); // business owner only (staff are refused, like createImport)
  const biz = await requireApprovedPartner(imp.business_id);
  const { data: isInstaller } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "installer" });
  if (!isInstaller) throw new WorkflowError("Only installer team members can confirm imported jobs.");
  const c = (data.installer?.intake ? (await import("./installer-intake.core")).stripIntakeRValues(data.facts) : data.facts) as ConfirmedFacts;
  const blockers = confirmBlockers(c);
  const intake = data.installer?.intake;
  const files0 = (imp.files as unknown[] | null) ?? [];
  if (intake) {
    // Approved single intake (Jo, 8 Oct): a job may be registered BEFORE a visit and BEFORE a quote. Area and quote are
    // optional; anything supplied must be valid. "Not quoted yet" stores null quote facts (never zero/fake).
    const qs = intake.quote_status ?? "have_quote";
    if (c.measured_area_m2 != null && c.measured_area_m2 !== "") { const a0 = Number(c.measured_area_m2); if (!Number.isFinite(a0) || a0 <= 0 || a0 > 5000) blockers.push("Check the ceiling area (m²)"); }
    else c.measured_area_m2 = null;
    if (qs === "not_quoted") {
      if (data.installer) { data.installer.quoted = "no"; data.installer.quoted_price_inc_gst = null; data.installer.price_includes = null; }
      intake.proposed_r_value = null;
    } else {
      const amt = data.installer?.quoted_price_inc_gst;
      if (!(amt && amt > 0) && files0.length === 0) blockers.push("Upload your quote or enter the quote amount inc GST");
      if (amt && amt > 0 && !data.installer?.price_includes?.trim()) blockers.push("Tell us what the quote includes");
      // Upload-only quote: amount comes later; quoted stays unknown (never a false "yes").
      if (data.installer && !(amt && amt > 0)) { data.installer.quoted = null; data.installer.quoted_price_inc_gst = null; data.installer.price_includes = null; }
      else if (data.installer) data.installer.quoted = "yes";
    }
    const removal = readRemoval(intake.removal_quote);
    if (removal) { if (qs === "not_quoted") intake.removal_quote = { answer: "unknown", areaM2: null, chargeIncGst: null }; else blockers.push(...removalProblems(removal, intake.existing_insulation, c.measured_area_m2 == null ? null : Number(c.measured_area_m2), data.installer?.quoted_price_inc_gst ?? null)); }
    { const { coordinationProblems } = await import("./installer-intake.core"); blockers.push(...coordinationProblems(intake.coordination, intake.self_managed_ack)); }
    // Jo, 9 Oct: "Yes, measured and quoted" requires the measured area and existing insulation; "No" saves nulls.
    if (intake.measured_required && qs === "have_quote") {
      if (c.measured_area_m2 == null) blockers.push("Enter the measured ceiling area (m²)");
      if (!intake.existing_insulation || intake.existing_insulation === "unknown") { /* "Not yet confirmed" is a valid answer */ }
    }
    // Electrician payer must agree with the electrician plan; a fee declaration must use the exact wording for that payer.
    if (intake.electrician_payer) {
      const mode = (data.electrician as { mode?: string } | undefined)?.mode ?? "hivic";
      const expect = intake.electrician_payer === "hivic" ? "hivic" : intake.electrician_payer === "own" ? "mine" : "later";
      if (mode !== expect) blockers.push("The electrician choice doesn't match — choose it again");
    }
    if (intake.fee_awareness?.declared) {
      const { feeAwarenessText } = await import("./installer-intake.core");
      const want = feeAwarenessText(intake.fee_awareness.payer);
      if (!want || intake.fee_awareness.text !== want || intake.fee_awareness.payer !== intake.electrician_payer) blockers.push("The owner fee confirmation doesn't match the electrician choice — tick it again");
    }
    if (intake.evidence_ack !== true) blockers.push("Tick that all required evidence must be supplied and accepted before the rebate");
    if (typeof imp.raw_text === "string") { const { multiCustomerAmbiguity } = await import("./installer-intake.core"); if (multiCustomerAmbiguity(imp.raw_text)) blockers.push("The uploaded file names more than one customer — upload one customer's quote per job"); }
  } else {
    const { quotedIntakeProblems } = await import("./installer-quote-intake.core");
    blockers.push(...quotedIntakeProblems({ quoted: data.installer?.quoted, area: c.measured_area_m2, method: c.measurement_method, amount: data.installer?.quoted_price_inc_gst, includes: data.installer?.price_includes }));
    const { quotedGap } = await import("./bulk-import.core");
    const qg = data.installer?.quoted === "yes" ? quotedGap("yes", data.installer.quoted_price_inc_gst) : null; // blank never blocks (Jo, 5:46pm)
    if (qg) blockers.push(qg);
  }
  if (data.installer && data.installer.quoted === "no") data.installer.quoted_price_inc_gst = null; // "Quote needed from installer"
  { const { ownerAgreedBlocker } = await import("./owner-confirm.core"); const ab = ownerAgreedBlocker({ ownerAgreed: data.installer?.owner_agreed, quoted: data.installer?.quoted, price: data.installer?.quoted_price_inc_gst }); if (ab) blockers.push(ab); }
  if (data.installer?.contact_permission !== true) blockers.push("Tick to confirm the owner has given Home Insulation Victoria permission to contact them");
  if (!intake) {
    // Older paths keep their checks; the single intake moves fee awareness to the office quote-send step.
    const { feeAwarenessBlocker } = await import("./owner-confirm.core"); const fb = feeAwarenessBlocker(data.installer?.fee_awareness); if (fb) blockers.push(fb);
    if (data.installer?.existing_below_r2 !== true) blockers.push("Confirm any existing insulation is below R2.0");
  }
  { const { electricianPlanBlocker } = await import("./job-electrician.core"); const eb = electricianPlanBlocker(data.electrician as never); if (eb) blockers.push(eb); }
  if (blockers.length) throw new WorkflowError(blockers.join(" • "));
  const area = c.measured_area_m2 == null || c.measured_area_m2 === "" ? null : Number(c.measured_area_m2);
  if (!intake && (area == null || !Number.isFinite(area) || area <= 0 || area > 5000)) throw new WorkflowError("Enter the ceiling area (m²) before confirming — every job needs an area estimate.");
  const { upsertEnquiry } = await import("./enquiry.server");
  const s = (k: keyof ConfirmedFacts) => (c[k] == null || c[k] === "" ? null : String(c[k]));
  const res = resumeJobId ? await (async () => { const { data: j } = await admin.from("jobs").select("job_number").eq("id", resumeJobId).single(); return { job_id: resumeJobId, job_number: j?.job_number as string }; })() : await upsertEnquiry({
    full_name: s("full_name")!, email: s("email")!, phone: s("phone"), address_line: s("address_line")!, suburb: s("suburb"), postcode: s("postcode"),
    estimated_area_m2: area != null && Number.isFinite(area) && area > 0 ? area : null, ...(data.occupancy ? { occupancy: data.occupancy } : {}),
  }, await (await import("./pilot.server")).intakeSourceFor(context.userId, imp.business_id, "installer_import"), context.userId, { channel: "installer_sourced", businessId: imp.business_id, userId: context.userId });
  if (!resumeJobId) await linkImportJob(claim, res.job_id, attempt);
  const chk = (r: { error: { message: string } | null }, what: string) => { if (r.error) throw new WorkflowError(`${what}: ${r.error.message}`); };
  const once = async (type: string, fn: () => Promise<unknown>) => { const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", res.job_id).eq("event_type", type).contains("details", { import_id: imp.id }); if (!count) await fn(); };
  const refs = { ...(imp.external_refs as Record<string, unknown>), ...(s("external_reference") ? { reference: s("external_reference") } : {}), ...(imp.source_url ? { source_url: imp.source_url } : {}), import_id: imp.id, ...(data.installer?.owner_agreed && data.installer.quoted === "yes" ? { owner_agreed_price: true } : {}) };
  const rel = relationshipOwnerFor("installer_sourced", biz.default_comms_owner);
  const pilotInvoice = biz.commercial_route === "hivic_full_invoice";
  // Jo (7 Oct): record whether the installer already did the site check, and his own quoted price + what it includes.
  const det = (data.details ?? {}) as { total_inc_gst?: unknown; price_lines?: { description?: string | null; qty?: number }[] };
  const quotedTotal = data.progress === "quoted" && Number(det.total_inc_gst) > 0 ? Math.round(Number(det.total_inc_gst) * 100) / 100 : null;
  const includes = quotedTotal ? (det.price_lines ?? []).map((l) => [l.description, l.qty ? `× ${l.qty}` : null].filter(Boolean).join(" ")).filter(Boolean).join("; ").slice(0, 1000) || null : null;
  const onDate = typeof c.measured_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.measured_on) ? c.measured_on : null;
  const inst = data.installer;
  chk(await admin.from("jobs").update(inst ? {
    // Single intake never asks whether the installer visited: record unknown (null), never an assumed visit.
    installer_site_check: intake ? null : inst.site_check,
    installer_site_check_date: !intake && inst.site_check === "yes" ? inst.site_check_date ?? null : null,
    installer_quoted: inst.quoted ?? null,
    installer_quoted_price_inc_gst: inst.quoted === "yes" ? inst.quoted_price_inc_gst ?? null : null, installer_price_includes: inst.quoted === "yes" && inst.quoted_price_inc_gst ? inst.price_includes || null : null,
  } : {
    installer_site_check: data.progress ? (data.progress === "not_visited" ? "no" : "yes") : null,
    installer_site_check_date: data.progress && data.progress !== "not_visited" ? onDate : null,
    installer_quoted_price_inc_gst: quotedTotal, installer_price_includes: includes,
  }).eq("id", res.job_id), "Job details");
  chk(await admin.from("jobs").update({ customer_relationship_owner: rel, source_system: imp.source_system, external_refs: refs as Json,
    ...(pilotInvoice ? { commercial_model: "hivic_invoices_owner" as const, commercial_model_set_by: context.userId, commercial_model_set_at: new Date().toISOString() } : {}) }).eq("id", res.job_id), "Job source");
  { const { data: ha } = await admin.from("job_assignments").select("id").eq("job_id", res.job_id).eq("role", "installer").eq("business_id", imp.business_id).limit(1).maybeSingle();
    if (!ha) chk(await admin.from("job_assignments").insert({ job_id: res.job_id, user_id: context.userId, role: "installer", business_id: imp.business_id, assigned_by: context.userId, first_response_at: new Date().toISOString() }), "Installer assignment");
    else if (!resumeJobId) throw new WorkflowError("This job already has an installer assignment."); }
  if (!resumeJobId || !(await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", res.job_id).ilike("event_type", "%electrician%")).count)
    await (await import("./job-electrician.server")).recordJobElectricianChoice(res.job_id, imp.business_id, (data.electrician ?? { mode: "hivic" }) as never, context.userId);
  const { data: ws } = await admin.from("workflow_settings").select("measurement_standard_approved").limit(1).maybeSingle();
  const { data: pm } = await admin.from("partner_measurement_methods").select("id").eq("business_id", imp.business_id).eq("status", "approved").order("approved_at", { ascending: false }).limit(1).maybeSingle();
  // "Not visited yet": the rough size is only the estimate; no measure-up is recorded and the Ready Check is next.
  const m = !intake && (data.progress === "not_visited" || data.installer?.site_check === "no") ? null : planImportedMeasurement(c, imp.id, { businessId: imp.business_id, standardApproved: !!ws?.measurement_standard_approved && !!pm });
  const { count: haveM } = m ? await admin.from("ceiling_measurements").select("id", { count: "exact", head: true }).eq("job_id", res.job_id).eq("external_id", imp.id) : { count: 0 };
  if (m && !haveM) {
    chk(await admin.from("ceiling_measurements").update({ is_current: false }).eq("job_id", res.job_id).eq("is_current", true), "Measurement");
    chk(await admin.from("ceiling_measurements").insert({ ...m, supplied_snapshot: m.supplied_snapshot as unknown as Json, partner_method_id: pm?.id ?? null, review_flags: m.review_flags as unknown as Json, job_id: res.job_id, is_current: true, created_by: context.userId, raw_snapshot: { import_id: imp.id, confirmed: c, extracted: imp.extracted, progress: data.progress ?? null, ready_check_a1: data.details ?? null } as unknown as Json }), "Measurement");
    chk(await admin.from("jobs").update({ measure_up_responsibility: "installer" }).eq("id", res.job_id), "Measurement");
  }
  await once("job_imported", async () => logEvent(res.job_id, context.userId, "job_imported", `Imported from ${imp.source_system} by originating installer (confirmed by user)`, { import_id: imp.id, source_system: imp.source_system, external_refs: refs, relationship_owner: rel, measurement_imported: !!m, files: imp.files, progress: data.progress ?? null, ready_check_a1: data.details ?? null }));
  if (data.installer?.owner_agreed && data.installer.quoted === "yes") await logEvent(res.job_id, context.userId, "installer_owner_agreed_price", `Installer says the owner agreed to their price ($${data.installer.quoted_price_inc_gst} inc GST); goes through office review as normal`, { import_id: imp.id, price_inc_gst: data.installer.quoted_price_inc_gst }, { internal: true });
  if (pilotInvoice && !resumeJobId) await logEvent(res.job_id, context.userId, "commercial_model_set", "Pilot commercial route: full job invoiced by Home Insulation Victoria (split invoicing disabled)", { route: "hivic_full_invoice" });
  await once("installer_contact_permission", async () => logEvent(res.job_id, userId, "installer_contact_permission", "Installer confirmed the owner agreed to Home Insulation Victoria contacting them", { import_id: data.importId, wording: (await import("./job-electrician.core")).OWNER_CONTACT_PERMISSION }, { internal: true }));
  if (intake) {
    // A real owner_contact_consents row (the event alone is not consent). Idempotent per import.
    const { READY_CHECK_CONTACT_PERMISSION } = await import("./job-electrician.core");
    const { INSTALLER_CONTACT_PERMISSION } = await import("./installer-intake.core");
    const { data: job } = await admin.from("jobs").select("owner_id").eq("id", res.job_id).single();
    const key = `installer_import:${imp.id}`;
    const { data: have } = await admin.from("owner_contact_consents").select("id").eq("job_id", res.job_id).eq("consent_key", key).maybeSingle();
    if (!have && job?.owner_id) {
      const text = intake.electrician_payer ? INSTALLER_CONTACT_PERMISSION : READY_CHECK_CONTACT_PERMISSION; // exact label the installer ticked
      const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((x) => x.toString(16).padStart(2, "0")).join("");
      // Dedicated truthful source: remote permission-to-contact only. Never "onsite_ready_check", which owner-gates
      // treats as signed onsite paperwork (Gate A); owner approvals/tenancy/life-support/authority stay required.
      const { INSTALLER_INTAKE_CONSENT_SOURCE } = await import("./installer-intake.core");
      const { error: ce } = await admin.from("owner_contact_consents").insert({ job_id: res.job_id, owner_id: job.owner_id, source: INSTALLER_INTAKE_CONSENT_SOURCE, consent_key: key, consent_status: "granted", contact_consent: true, consented_at: new Date().toISOString(), snapshot: { by: "installer", text, recorded_by: userId, intake_version: intake.version } as unknown as Json, sha256 });
      if (ce) throw new WorkflowError(`Consent could not be saved: ${ce.message}`);
    }
    await once("installer_existing_insulation_declared", async () => logEvent(res.job_id, userId, "installer_existing_insulation_declared", `Installer declared existing insulation: ${intake.existing_insulation === "none" ? "none" : intake.existing_insulation === "below_r2" ? "confirmed below R2.0" : "not yet confirmed"}`, { import_id: data.importId, value: intake.existing_insulation, version: intake.version, declared_at: new Date().toISOString(), verified: false }, { internal: true }));
    if (intake.existing_insulation === "below_r2") await once("installer_existing_insulation_below_r2", async () => logEvent(res.job_id, userId, "installer_existing_insulation_below_r2", "Installer confirmed any existing insulation is below R2.0", { import_id: data.importId, confirmed_at: new Date().toISOString(), version: intake.version }, { internal: true }));
    { const ic = await import("./installer-intake.core");
      await once("installer_coordination_chosen", async () => logEvent(res.job_id, userId, "installer_coordination_chosen", intake.coordination === "self_managed" ? "Installer will organise the job themselves (AP checks, notices, evidence review and final approval still apply)" : "Home Insulation Victoria manages the process through the normal workflow", { import_id: data.importId, coordination: intake.coordination, version: ic.COORDINATION_VERSION, chosen_at: new Date().toISOString(), self_managed_ack: intake.coordination === "self_managed" ? { wording: ic.SELF_MANAGED_ACK, acknowledged: true } : null }, { internal: true })); }
    if (intake.fee_awareness?.declared) await once("installer_owner_fee_awareness", async () => logEvent(res.job_id, userId, "installer_owner_fee_awareness", intake.fee_awareness!.payer === "own" ? "Installer declared the owner was advised of the $349 AP management fee and that their own electrician invoices them separately" : "Installer declared the owner was advised of the $349 PIESA fee and $349 AP management fee", { import_id: data.importId, by: "installer", source: "installer_add_job", payer: intake.fee_awareness!.payer, wording: intake.fee_awareness!.text, version: intake.fee_awareness!.version, confirmed_at: new Date().toISOString(), not_owner_paperwork: true }, { internal: true }));
    if (intake.electrician_payer) await once("installer_electrician_payer", async () => logEvent(res.job_id, userId, "installer_electrician_payer", intake.electrician_payer === "own" ? "Installer will use their own electrician — electrician invoices the owner directly; Home Insulation Victoria's $349 PIESA fee excluded (provisional arrangement; office verifies electrician, PIESA, conditions, evidence and notices)" : intake.electrician_payer === "hivic" ? "Home Insulation Victoria arranges the electrician ($349 PIESA fee on the owner quote)" : "Electrician to be arranged — owner quote held until the electrician cost is known", { import_id: data.importId, payer: intake.electrician_payer }, { internal: true }));
    await once("installer_quote_answer", async () => logEvent(res.job_id, userId, "installer_quote_answer", (intake.quote_status ?? "have_quote") === "have_quote" ? "Installer answered: measured and quoted" : "Installer answered: not measured or quoted yet", { answer: intake.quote_status ?? "have_quote", import_id: data.importId, source: "intake" }, { internal: true }));
    if (intake.removal_quote) await once("installer_quote_removal_declared", async () => logEvent(res.job_id, userId, "installer_quote_removal_declared", removalSummary(intake.removal_quote as RemovalQuote), { import_id: data.importId, removal_quote: intake.removal_quote, source: "installer_add_job", verified: false, included_in_total: true }, { internal: true }));
    await once("installer_evidence_acknowledged", async () => logEvent(res.job_id, userId, "installer_evidence_acknowledged", "Installer acknowledged all required Ready Check and installation evidence must be supplied and accepted before the rebate", { import_id: data.importId, wording: (await import("./installer-intake.core")).EVIDENCE_ACK, version: intake.version, proposed_r_value: intake.proposed_r_value ?? null, acknowledged_at: new Date().toISOString() }, { internal: true }));
  } else {
    await logEvent(res.job_id, userId, "installer_owner_fee_awareness", "Installer confirmed the owner is aware that the full quote will include the rebate, Home Insulation Victoria AP management fee and electrician PIESA fee", { import_id: data.importId, wording: (await import("./owner-confirm.core")).OWNER_FEE_AWARENESS_TICK, confirmed_at: new Date().toISOString() }, { internal: true });
    await logEvent(res.job_id, userId, "installer_existing_insulation_below_r2", "Installer confirmed any existing insulation is below R2.0", { import_id: data.importId, confirmed_at: new Date().toISOString() }, { internal: true });
  }
  const importFiles = (imp.files as { path: string; name: string; type: string }[] | null) ?? [];
  const { data: haveDocs } = await admin.from("documents").select("storage_path").eq("job_id", res.job_id).eq("kind", "installer_import");
  const docPaths = new Set((haveDocs ?? []).map((d) => d.storage_path));
  const newFiles = importFiles.filter((f) => !docPaths.has(f.path));
  if (newFiles.length) {
    const { error: de } = await admin.from("documents").insert(newFiles.map((f) => ({ job_id: res.job_id, kind: "installer_import", title: f.name, original_name: f.name, mime_type: f.type || null, storage_path: f.path, source_system: imp.source_system, uploaded_by: context.userId })));
    if (de) throw new WorkflowError(`Uploaded files could not be attached to the job: ${de.message}`);
  }
  // Every step succeeded: only now is the import confirmed.
  await finalizeImport(claim, res.job_id, c as Json);
  return { jobId: res.job_id, jobNumber: res.job_number };
}

/** Add photos/files to a draft import (business owner only). Paths must be this business's own uploads. */
export async function addImportFilesFor(userId: string, importId: string, files: { path: string; name: string; type: string }[]) {
  const { data: imp } = await admin.from("job_imports").select("business_id, status, files, confirmed_by").eq("id", importId).single();
  if (!imp || imp.status !== "draft") throw new WorkflowError("This job was already added or discarded.");
  if ((imp as { confirmed_by?: string | null }).confirmed_by) throw new WorkflowError("This job is being saved — files can't change now.");
  await requireMember(userId, imp.business_id, true);
  const { allowedUpload } = await import("./upload-safety.core"); const { verifyStoredUpload } = await import("./upload-safety.server");
  for (const f of files) {
    if (!f.path.startsWith(`partners/${imp.business_id}/imports/`)) throw new WorkflowError("Invalid file path");
    const m = allowedUpload(f.name, f.type, { imports: true }); if (!m) throw new WorkflowError(`${f.name}: that file type isn't accepted.`);
    await verifyStoredUpload("job-files", f.path, m);
  }
  const have = (imp.files as { path: string }[] | null) ?? [];
  const next = [...have, ...files.filter((f) => !have.some((h) => h.path === f.path))];
  await admin.from("job_imports").update({ files: next as unknown as Json, updated_at: new Date().toISOString() }).eq("id", importId);
  return { files: next as { path: string; name: string; type: string }[] };
}
export async function removeImportFileFor(userId: string, importId: string, path: string) {
  const { data: imp } = await admin.from("job_imports").select("business_id, status, files, confirmed_by").eq("id", importId).single();
  if (!imp || imp.status !== "draft") throw new WorkflowError("This job was already added or discarded.");
  if ((imp as { confirmed_by?: string | null }).confirmed_by) throw new WorkflowError("This job is being saved — files can't change now.");
  await requireMember(userId, imp.business_id, true);
  const next = ((imp.files as { path: string }[] | null) ?? []).filter((f) => f.path !== path);
  await admin.from("job_imports").update({ files: next as unknown as Json, updated_at: new Date().toISOString() }).eq("id", importId);
  return { files: next as { path: string; name: string; type: string }[] };
}

/** Resume an Add job draft after refresh. Only the user who created it, still a member of its business, may read it. */
export async function getImportDraftFor(userId: string, importId: string, businessId: string) {
  const { data: imp } = await admin.from("job_imports").select("id, business_id, created_by, status, files, job_id").eq("id", importId).maybeSingle();
  if (!imp || imp.created_by !== userId || imp.business_id !== businessId) return { status: "gone" as const, files: [], jobId: null, jobNumber: null };
  await requireMember(userId, imp.business_id);
  if (imp.status === "discarded") return { status: "gone" as const, files: [], jobId: null, jobNumber: null };
  let jobNumber: string | null = null;
  if (imp.job_id) { const { data: j } = await admin.from("jobs").select("job_number").eq("id", imp.job_id).maybeSingle(); jobNumber = (j?.job_number as string | null) ?? null; }
  return { status: (imp.status === "confirmed" ? "confirmed" : "draft") as "draft" | "confirmed", files: (imp.files as { path: string; name: string; type: string }[] | null) ?? [], jobId: (imp.status === "confirmed" ? imp.job_id : null) as string | null, jobNumber };
}
