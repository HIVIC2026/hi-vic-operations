// Decision 293 (Jo 25 Oct 2026): the electrician's "A4 – Electrical fixes" Mitti form. Rules: fixes-day.core.ts (pure).
// Creation: when the rectification (electrical fixes) visit is booked (booking.server confirmBooking → onRectificationBooked)
// for a job whose PIESA said repair work is needed and q30 (fixed on the same visit) is not Yes, ONE form per visit is
// created through the same Mitti boundary as the PIESA/PIISA forms (mittiApi over realMittiCall, template identity
// check, prefill by exact wording, share + set owner, atomic create claim), assigned to the electrician's Mitti user
// (TEST jobs / TEST partners → TEST_MITTI_ASSIGNEE). A missing template id, a missing Mitti user or a Mitti error is ONE
// job-level office item (`fixes_form_held`, needs_office) — never a crash and never a second form.
// Completion: the 15-minute tick (sweepFixesForms) and the job page "Refresh" read the audit; on Complete with Q9 = Yes and
// Q11–Q14 present the PIESA Part C facts go into the stored PIESA short answers (assessments.mitti_raw_snapshot, where the
// same-visit q30–q37/q45 answers would sit), the CoES file + finished-work photo(s) + Mitti report are filed on the job
// (documents kinds piesa_evidence / mitti_report), the PIESA record is written through the ONE post_rectification path
// (piesa-record.server applyPiesaRecord: items completed, piesa_records, compliance checks, booking completed, stage →
// installation scheduling, installer clearance notice), the official PIESA copy/Word form is regenerated through the
// existing guarded official-forms path (held with its reason while the PIESA mapping is unapproved) and the O28 copies go
// through deliverPiesaCopies (its own holds). Q9 = No → one office item with the Q10 text, nothing else. Idempotent per audit.
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, getStage, logEvent } from "./workflow.server";
import { MittiError, mittiApi, parseAudit, type MittiCall } from "./mitti.core";
import { mittiTemplateIdentity, sameMittiTemplateId } from "./mitti-identity.core";
import { shortAnswersFromEntries } from "./official-short.core";
import {
  FIXES_COES_DOC_TITLE, FIXES_DAY_RULE, FIXES_DAY_TEMPLATE_NAME, FIXES_FORM_COMPLETED_EVENT, FIXES_FORM_CREATED_EVENT, FIXES_FORM_HELD_EVENT, FIXES_FORM_NOT_DONE_EVENT, FIXES_FORM_NOT_SET_UP,
  FIXES_TEMPLATE_COLUMN, FIXES_TEMPLATE_MISSING, FIXES_TEMPLATE_PENDING_DB,
  fixesCompletionPlan, fixesDayMissingQuestions, fixesFormOutcome, type FixesFormEvent, fixesDayPrefillItems, fixesFormNeeded, isFixesDayDoc, mergeFixesIntoPiesaSnapshot, readFixesDay, repairWorkList, type SnapshotEntry,
} from "./fixes-day.core";

export const FIXES_SWEEP_MAX = 20;

/** The connected template id. `pending` = the settings row has no such column yet (migration not applied): fail closed. */
export async function readFixesTemplate(): Promise<{ templateId: string | null; pending: boolean }> {
  const { data, error } = await admin.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return { templateId: null, pending: true };
  const row = data as unknown as Record<string, unknown>;
  if (!(FIXES_TEMPLATE_COLUMN in row)) return { templateId: null, pending: true };
  const v = row[FIXES_TEMPLATE_COLUMN];
  return { templateId: typeof v === "string" && v.trim() ? v.trim() : null, pending: false };
}

type Snapshot = SnapshotEntry[];
const snapshotOf = (raw: unknown): Snapshot => (Array.isArray(raw) ? (raw as Snapshot).filter((e) => e && typeof e.label === "string") : []);

/** Does this job need the fixes form? Mitti PIESA: q20 = repair needed and q30 not Yes. Manual PIESA (no snapshot): open rectification items. */
export async function fixesFormNeededFor(jobId: string): Promise<{ needed: boolean; repairList: string[]; snapshot: Snapshot; assessmentId: string | null; assigneeEmail: string | null }> {
  const [{ data: a }, { data: items }] = await Promise.all([
    admin.from("assessments").select("id, mitti_raw_snapshot, mitti_assignee_email").eq("job_id", jobId).maybeSingle(),
    admin.from("rectification_items").select("description, status").eq("job_id", jobId).in("status", ["required", "completed"]),
  ]);
  const snapshot = snapshotOf(a?.mitti_raw_snapshot);
  const short = shortAnswersFromEntries("piesa", snapshot);
  const open = (items ?? []).filter((i) => i.status === "required");
  if (snapshot.length && short["rectificationOutcome"]) {
    const fromForm = repairWorkList(short);
    return { needed: fixesFormNeeded(short), repairList: fromForm.length ? fromForm : open.map((i) => i.description), snapshot, assessmentId: a?.id ?? null, assigneeEmail: a?.mitti_assignee_email ?? null };
  }
  return { needed: open.length > 0, repairList: open.map((i) => i.description), snapshot, assessmentId: a?.id ?? null, assigneeEmail: a?.mitti_assignee_email ?? null };
}

async function heldOnce(jobId: string, key: string, reason: string, extra: Record<string, unknown> = {}) {
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", FIXES_FORM_HELD_EVENT).contains("details", { key });
  if (count) return false;
  await logEvent(jobId, null, FIXES_FORM_HELD_EVENT, `${FIXES_FORM_NOT_SET_UP}: ${reason}`.slice(0, 500), { key, reason: reason.slice(0, 300), needs_office: true, rule: FIXES_DAY_RULE, ...extra }, { internal: true });
  return true;
}

export type FixesCreateResult = { status: "created" | "reused" | "held" | "not_needed"; auditId?: string; reason?: string };

/**
 * Create the fixes form for the booked rectification visit (one per booking). Never throws on Mitti or setup problems:
 * each becomes the one office item. `bookingId` is the confirmed rectification booking (idempotency key).
 */
export async function createFixesForm(jobId: string, actorId: string | null, bookingId: string, call?: MittiCall): Promise<FixesCreateResult> {
  const { data: job } = await admin.from("jobs").select("id, job_number, business_unit, source, stage, deleted_at, qa_archived_at").eq("id", jobId).maybeSingle();
  if (!job || job.business_unit !== "hivic" || job.deleted_at || job.qa_archived_at) return { status: "not_needed", reason: "job not live" };
  const { count: already } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", FIXES_FORM_CREATED_EVENT).contains("details", { booking_id: bookingId });
  if (already) return { status: "reused", reason: "form already created for this visit" };
  const need = await fixesFormNeededFor(jobId);
  if (!need.needed) return { status: "not_needed", reason: "the PIESA lists no repair work left for a later visit" };

  const tpl = await readFixesTemplate();
  if (tpl.pending) { await heldOnce(jobId, `booking:${bookingId}:pending_db`, FIXES_TEMPLATE_PENDING_DB, { booking_id: bookingId }); return { status: "held", reason: FIXES_TEMPLATE_PENDING_DB }; }
  if (!tpl.templateId) { await heldOnce(jobId, `booking:${bookingId}:no_template`, FIXES_TEMPLATE_MISSING, { booking_id: bookingId }); return { status: "held", reason: FIXES_TEMPLATE_MISSING }; }

  const { data: asg } = await admin.from("job_assignments").select("user_id, business_id, profiles:user_id(full_name, email), businesses(name, onboarding_notes)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  if (!asg) { await heldOnce(jobId, `booking:${bookingId}:no_electrician`, "No electrician is assigned to this job.", { booking_id: bookingId }); return { status: "held", reason: "no electrician assigned" }; }
  const prof = (asg.profiles ?? null) as { full_name: string | null; email: string | null } | null;
  const biz = (asg.businesses ?? null) as { name: string | null; onboarding_notes: string | null } | null;
  const { isTestPartner } = await import("./test-send.core");
  const test = job.source === "qa_test" || isTestPartner(biz as never);
  const { TEST_MITTI_ASSIGNEE } = await import("./onsite-ready-check.core");
  // The PIESA form's assignee is the same electrician: reuse that Mitti login first, then the profile email.
  const email = test ? TEST_MITTI_ASSIGNEE : (need.assigneeEmail?.trim() || prof?.email?.trim() || "");
  if (!email) { await heldOnce(jobId, `booking:${bookingId}:no_email`, "The assigned electrician has no email address, so no Mitti user could be found.", { booking_id: bookingId }); return { status: "held", reason: "no electrician email" }; }

  // TEST flows (TEST job/partner → TEST Mitti user): the whole flow, template read included, uses the simulator.
  const { mittiCallFor, realMittiCall } = await import("./mitti.server");
  const mitti = call ?? await mittiCallFor(realMittiCall, email);
  const api = mittiApi(mitti);
  const claims = await import("./mitti-create.server");
  let claimId: string | null = null;
  try {
    claimId = await claims.claimMittiCreate(jobId, "fixes", actorId, `Mitti electrical fixes form creation started for ${email}`, { template_id: tpl.templateId, booking_id: bookingId, assignee_email: email });
  } catch (e) {
    if (e instanceof claims.MittiClaimHeld) return { status: "held", reason: e.message };
    throw e;
  }
  const seen = { createAttempted: false, createdId: null as string | null };
  try {
    const { findMittiUserByEmail } = await import("./mitti.server");
    const userId = await findMittiUserByEmail(email, mitti);
    if (!userId) throw new MittiError(`The electrician (${email}) was not found in Mitti. Invite them with that exact email, then book the visit again or create the form from the office.`);
    const template = await api.getTemplateDefinition(tpl.templateId);
    if (!sameMittiTemplateId(mittiTemplateIdentity(template).id, tpl.templateId)) throw new MittiError("Mitti returned an unexpected or unidentifiable electrical fixes template.");
    const missingQs = fixesDayMissingQuestions(template);
    if (missingQs.length) throw new MittiError(`The "${FIXES_DAY_TEMPLATE_NAME}" form is missing questions (exact wording): ${missingQs.join("; ")}`);
    const { officialPrefillContext } = await import("./official-forms.server");
    const { todayMelbourne } = await import("./eligibility.server");
    const ctx = await officialPrefillContext(jobId, todayMelbourne(), null);
    const e = ctx.electrician;
    const prefill = fixesDayPrefillItems(template, {
      jobNumber: job.job_number, address: ctx.address, electricianName: e?.name ?? prof?.full_name ?? null, licence: e?.licence ?? null, recName: e?.recName ?? biz?.name ?? null, recNo: e?.recNo ?? null, phone: e?.phone ?? null,
      repairList: need.repairList,
    });
    const { flatten } = await import("./mitti.core");
    const headerIds = new Set(flatten(template as never).filter((x) => x.header).map((x) => String(x.id)));
    seen.createAttempted = true;
    const created = (await api.createAudit({ template_id: tpl.templateId, header_items: prefill.filter((x) => headerIds.has(x.item_id)), items: prefill.filter((x) => !headerIds.has(x.item_id)) } as never)) as { audit_id?: string; id?: string };
    const auditId = created?.audit_id ?? created?.id;
    if (!auditId) throw new MittiError("Mitti did not return an audit ID.");
    seen.createdId = String(auditId);
    // Identity first, so a failed share never leads to a second form on retry.
    await logEvent(jobId, actorId, FIXES_FORM_CREATED_EVENT, `Electrical fixes form created in Mitti for ${email} with ${prefill.length} pre-filled answers (${FIXES_DAY_TEMPLATE_NAME})`,
      { audit_id: String(auditId), booking_id: bookingId, template_id: tpl.templateId, prefill_count: prefill.length, assignee_email: email, mitti_user_id: userId, test, rule: FIXES_DAY_RULE });
    await api.shareAudit(String(auditId), userId);
    await api.setAuditOwner(String(auditId), userId);
    return { status: "created", auditId: String(auditId) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mitti error";
    if (seen.createdId) {
      // Mitti made the form but sharing failed: it is recorded above; the office hands it over from the job page.
      await heldOnce(jobId, `booking:${bookingId}:share:${seen.createdId}`, `The form was created in Mitti but could not be handed to ${email}: ${msg}`, { booking_id: bookingId, audit_id: seen.createdId });
      return { status: "created", auditId: seen.createdId, reason: msg };
    }
    const { createOutcome } = await import("./mitti-create-claim.core");
    if (claimId && createOutcome(seen) === "not_created") await claims.releaseMittiCreate(jobId, "fixes", claimId, actorId, msg);
    else if (claimId) await claims.recordMittiCreateUncertain(jobId, "fixes", claimId, actorId, msg);
    await heldOnce(jobId, `booking:${bookingId}:${createOutcome(seen)}`, msg, { booking_id: bookingId });
    return { status: "held", reason: msg };
  }
}

/** Called by confirmBooking for every rectification booking. Best effort: a problem is an office item, never a booking failure. */
export async function onRectificationBooked(jobId: string, bookingId: string, actorId: string | null, call?: MittiCall): Promise<FixesCreateResult> {
  try { return await createFixesForm(jobId, actorId, bookingId, call); }
  catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    await heldOnce(jobId, `booking:${bookingId}:error`, msg, { booking_id: bookingId }).catch(() => false);
    return { status: "held", reason: msg };
  }
}

/** The job's latest fixes form (from the append-only history) and what happened to it. */
export async function fixesFormState(jobId: string): Promise<{ auditId: string | null; createdAt: string | null; outcome: "open" | "done" | "not_done" | "held" | null; detail: string | null; templateSetUp: boolean; pendingDb: boolean }> {
  const { data: evs } = await admin.from("workflow_events").select("event_type, created_at, summary, details").eq("job_id", jobId)
    .in("event_type", [FIXES_FORM_CREATED_EVENT, FIXES_FORM_COMPLETED_EVENT, FIXES_FORM_NOT_DONE_EVENT, FIXES_FORM_HELD_EVENT]).order("created_at", { ascending: false }).limit(50);
  const tpl = await readFixesTemplate();
  const r = fixesFormOutcome((evs ?? []) as FixesFormEvent[]);
  return { ...r, templateSetUp: !!tpl.templateId, pendingDb: tpl.pending };
}

export type FixesCompleteResult = { status: "waiting" | "already" | "not_done" | "missing" | "done" | "held"; detail: string | null };

/**
 * Decision 178 style: keep the CoES file(s) and finished-work photo(s) with the job (6 years). One copy per Mitti media id.
 * Never throws: `saved` = the files on the job (already-filed documents count), `failed` = what could not be read or stored
 * (the caller holds the form so the 15-minute sweep retries — evidence is never marked uploaded without its files).
 */
export async function saveFixesFiles(jobId: string, auditId: string, files: { label: string; title: string; media: { mediaId: string | null }[] }[], fetchMedia: import("./mitti.server").MittiMediaFetch): Promise<{ saved: string[]; failed: { label: string; mediaId: string; reason: string }[] }> {
  const saved: string[] = [], failed: { label: string; mediaId: string; reason: string }[] = [];
  for (const f of files) for (const m of f.media) {
    if (!m.mediaId) continue;
    const key = `${auditId}:${m.mediaId}`;
    try {
      const { data: ex, error: exErr } = await admin.from("documents").select("id, storage_path").eq("job_id", jobId).eq("source_system", "mitti").eq("external_id", key).maybeSingle();
      if (exErr) throw new Error(`documents could not be read: ${exErr.message}`);
      if (ex) { saved.push(String((ex as { storage_path?: string | null }).storage_path ?? key)); continue; }
      const { bytes, contentType } = await fetchMedia(auditId, m.mediaId);
      if (!bytes.length) throw new Error("empty media");
      const ext = contentType.includes("pdf") ? "pdf" : contentType.includes("png") ? "png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "bin";
      const path = `${jobId}/mitti/fixes/${auditId}-${m.mediaId}.${ext}`;
      const up = await admin.storage.from("job-files").upload(path, bytes, { contentType, upsert: false });
      if (up.error && !/exists/i.test(up.error.message)) throw new Error("storage upload failed");
      const ins = await admin.from("documents").insert({ job_id: jobId, kind: "piesa_evidence", title: f.title, storage_path: path, mime_type: contentType, uploaded_by: null, source_system: "mitti", external_id: key, original_name: `${m.mediaId}.${ext}`, size_bytes: bytes.length });
      if (ins.error) throw new Error(`document record failed: ${ins.error.message}`);
      saved.push(path);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "error";
      failed.push({ label: f.label, mediaId: m.mediaId, reason });
      await logEvent(jobId, null, "piesa_evidence_file_failed", `Electrical fixes evidence (${f.label}) could not be saved – it will be retried`, { audit_id: auditId, media_id: m.mediaId, reason }, { internal: true }).catch(() => undefined);
    }
  }
  return { saved, failed };
}

/** Regenerate the official PIESA (signed copy + Word form) from the merged short answers through the existing guarded path.
 *  Held (with the reason) while the PIESA mapping is unapproved or no current signed PIESA copy exists — nothing is invented. */
async function regenerateOfficialPiesa(jobId: string, actorId: string | null, snapshot: Snapshot, signer: { userId: string | null; name: string | null }, certDate: string): Promise<string> {
  const { officialFormUseBlocker } = await import("./official-forms.core");
  const block = officialFormUseBlocker("piesa");
  if (block) return `official PIESA not regenerated: ${block}`;
  const { currentCopy, storeSignedCopy, materialFacts } = await import("./official-forms.server");
  const prev = await currentCopy(jobId, "piesa");
  if (prev.unavailable) return "official PIESA not regenerated: signed-copy storage not set up";
  if (!prev.copy) return "official PIESA not regenerated: no current signed PIESA copy on this job";
  if (!signer.userId) return "official PIESA not regenerated: no assigned electrician to attribute Section C to";
  const { expandPiesa } = await import("./official-expand.core");
  const { officialPrefillContext } = await import("./official-forms.server");
  const { todayMelbourne } = await import("./eligibility.server");
  const ctx = await officialPrefillContext(jobId, todayMelbourne(), null);
  // Decision 296: the owner block (o.*) comes from the owner's secure-link confirmation record, never from a Mitti form.
  const ownerConfirmation = await (await import("./piesa-owner-confirm.server")).ownerConfirmationForExpand(jobId).catch(() => null);
  // Decision 330: the owner's post-fix confirmation (normally not given yet at this point — the request goes out below).
  const ownerFixesConfirmation = await (await import("./piesa-fixes-confirm.server")).ownerFixesConfirmationForExpand(jobId).catch(() => null);
  const expanded = expandPiesa(shortAnswersFromEntries("piesa", snapshot), { lifeSupportDeclared: ctx.lifeSupportDeclared, today: certDate, ownerConfirmation, ownerFixesConfirmation });
  const { facts } = await materialFacts(jobId, prev.copy);
  const id = await storeSignedCopy({ jobId, key: "piesa", answers: expanded.answers, signer: { userId: signer.userId, name: signer.name ?? "", role: "electrician" }, enteredDate: certDate, jobFacts: facts as unknown as Record<string, string>, acknowledgementIds: [], signature: `mitti-fixes:${jobId}` });
  const { storeOfficialDocx } = await import("./official-docx.server");
  const r = await storeOfficialDocx(jobId, "piesa");
  await logEvent(jobId, actorId, "official_piesa_regenerated", `Official PIESA regenerated with Section C from the electrical fixes form (${r.filled} items filled${r.missed.length ? `, ${r.missed.length} not placed` : ""})`, { signed_copy_id: id, path: r.path, missed: r.missed, signatures_embedded: r.signaturesEmbedded, signature_flags: r.signatureFlags }, { internal: true });
  return `official PIESA regenerated (signed copy ${id})`;
}

/**
 * Read the fixes form once more and act on a Complete press. Idempotent per audit: a completed audit is applied once;
 * Q9 = No or missing items raise one office item per form version (audit + modified time).
 */
export async function completeFixesForm(jobId: string, auditId: string, opts: { call?: MittiCall; fetchMedia?: import("./mitti.server").MittiMediaFetch; today?: string; actorId?: string | null } = {}): Promise<FixesCompleteResult> {
  const actorId = opts.actorId ?? null;
  const { count: done } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", FIXES_FORM_COMPLETED_EVENT).contains("details", { audit_id: auditId });
  if (done) return { status: "already", detail: null };
  const [{ data: job }, { data: a }, tpl] = await Promise.all([
    admin.from("jobs").select("id, job_number, stage, source, deleted_at, qa_archived_at").eq("id", jobId).maybeSingle(),
    admin.from("assessments").select("id, mitti_raw_snapshot").eq("job_id", jobId).maybeSingle(),
    readFixesTemplate(),
  ]);
  if (!job) throw new WorkflowError("Job not found.");
  const { isClosedOrArchivedJob } = await import("./mitti.core");
  if (isClosedOrArchivedJob(job)) return { status: "waiting", detail: "job closed or archived" };
  const mitti = opts.call ?? (await import("./mitti.server")).realMittiCall;
  const fetchMedia = opts.fetchMedia ?? (await import("./mitti.server")).realMittiMedia;
  const audit = await mittiApi(mitti).getAudit(auditId);
  const parsed = parseAudit(audit as never);
  if (parsed.auditId !== auditId) throw new WorkflowError("Mitti returned a different audit for this job's fixes form.");
  if (tpl.templateId && !sameMittiTemplateId(parsed.templateId, tpl.templateId)) throw new WorkflowError("This Mitti form is not the connected electrical fixes template.");
  if (!isFixesDayDoc(audit)) throw new WorkflowError(`This Mitti form is not the "${FIXES_DAY_TEMPLATE_NAME}" form.`);
  if (parsed.jobNumberField && parsed.jobNumber && parsed.jobNumber.trim().toUpperCase() !== job.job_number.trim().toUpperCase()) throw new WorkflowError(`Mitti Job number (${parsed.jobNumber}) does not match ${job.job_number}.`);
  const read = readFixesDay(audit);
  const today = opts.today ?? (await import("./eligibility.server")).todayMelbourne();
  const plan = fixesCompletionPlan(read, { completed: parsed.completed, today });
  const version = `${auditId}:${parsed.modifiedAt ?? "completed"}`;
  if (plan.kind === "waiting") return { status: "waiting", detail: plan.reason };
  if (plan.kind === "not_done") {
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", FIXES_FORM_NOT_DONE_EVENT).contains("details", { version });
    if (!count) await logEvent(jobId, actorId, FIXES_FORM_NOT_DONE_EVENT, `Electrician says the repair work is NOT all done: ${plan.text}`.slice(0, 500), { audit_id: auditId, version, text: plan.text.slice(0, 1000), needs_office: true, rule: FIXES_DAY_RULE }, { internal: true });
    return { status: "not_done", detail: plan.text };
  }
  if (plan.kind === "missing") {
    await heldOnce(jobId, `complete:${version}`, `The fixes form was marked Complete but is missing: ${plan.missing.join("; ")}`, { audit_id: auditId, version, missing: plan.missing });
    return { status: "missing", detail: plan.missing.join("; ") };
  }
  // Q9 = Yes with everything present. The job must be at Electrical fixes booked, exactly like the portal page.
  const stage = await getStage(jobId);
  if (stage !== "rectification_booked") {
    await heldOnce(jobId, `complete:${version}:stage`, `The fixes form is complete but the job is at "${stage}", not Electrical fixes booked, so the PIESA record was not written automatically.`, { audit_id: auditId, version, stage });
    return { status: "held", detail: `job at ${stage}` };
  }
  const { data: asg } = await admin.from("job_assignments").select("user_id, profiles:user_id(full_name)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  const signerName = plan.signerName ?? ((asg?.profiles ?? null) as { full_name: string | null } | null)?.full_name ?? read.electricianName;
  // 1. Files with the job FIRST: CoES + finished-work photo(s). Any file not kept → one office item and stop here (no
  //    Section C merge, no evidence marked uploaded, no PIESA record, no completion event), so the 15-minute sweep retries.
  const files = await saveFixesFiles(jobId, auditId, [
    { label: "Certificate of Electrical Safety", title: FIXES_COES_DOC_TITLE, media: plan.coesFiles },
    { label: "Finished work photo", title: "Electrical fixes – photo of the finished work", media: plan.workPhotos },
  ], fetchMedia);
  if (files.failed.length) {
    const what = [...new Set(files.failed.map((f) => f.label))].join(", ");
    await heldOnce(jobId, `complete:${version}:files`, `The fixes form is complete but these files could not be kept with the job yet: ${what}. The portal keeps retrying every 15 minutes.`, { audit_id: auditId, version, failed: files.failed });
    return { status: "held", detail: `files not saved: ${what}` };
  }
  const saved = files.saved;
  // 2. The PIESA short answers carry Part C exactly where the same-visit answers would be.
  const merged = mergeFixesIntoPiesaSnapshot(snapshotOf(a?.mitti_raw_snapshot), read, plan);
  if (a) {
    const { error } = await admin.from("assessments").update({ mitti_raw_snapshot: merged as unknown as Json }).eq("id", a.id);
    if (error) throw new WorkflowError(`PIESA Section C could not be written to the stored answers: ${error.message}`);
  }
  // A48 batch 1: a signed Section C covers the repair rules — clear an open "breaks the official rules" item. Never throws.
  await (await import("./piesa-rules-notice.server")).recheckPiesaRules(jobId, actorId);
  // Mitti's own report.
  // Decision 336: the A4 signature IMAGE goes in the official Section C box (kept privately with the job first).
  await (await import("./official-signature.server")).savePiesaSignatureImage(jobId, actorId, "a5", auditId, read.signature, fetchMedia);
  const { saveMittiReport } = await import("./mitti.server");
  await saveMittiReport(jobId, actorId, auditId, parsed.modifiedAt ? String(parsed.modifiedAt) : null, "Electrical fixes", mitti);
  // The portal page's evidence requirements are satisfied by the form's files (same categories, no second upload asked).
  await admin.from("evidence_requirements").update({ status: "uploaded", notes: `From the Mitti electrical fixes form ${auditId}` }).eq("job_id", jobId).in("category", ["rectification_completion", "piesa_signoff"]).in("status", ["outstanding", "rejected"]);
  // 3. The ONE post-rectification record path (items completed, piesa_records, compliance, booking completed, stage, installer notice).
  const { applyPiesaRecord } = await import("./piesa-record.server");
  await applyPiesaRecord({ jobId, actorId: asg?.user_id ?? null, kind: "post_rectification", outcome: "pass", completedDate: plan.certDate, sectionCSignedDate: plan.certDate, notes: `Recorded from the Mitti electrical fixes form ${auditId}. CoES ${plan.coesNumber}.`, source: { kind: "mitti_fixes_form", auditId } });
  // 4. Official PIESA + O28 copies through their existing guarded paths (each reports its own hold).
  let official: string;
  try { official = await regenerateOfficialPiesa(jobId, actorId, merged, { userId: asg?.user_id ?? null, name: signerName }, plan.certDate); }
  catch (e) { official = `official PIESA not regenerated: ${e instanceof Error ? e.message : "error"}`; }
  let copies: string;
  try { const d = await (await import("./piesa-delivery.server")).deliverPiesaCopies(jobId); copies = d.hold ? `PIESA copies held: ${d.hold}` : `PIESA copies sent to ${d.sent.join(", ") || "nobody"}${Object.keys(d.held).length ? `; held: ${Object.entries(d.held).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}`; }
  catch (e) { copies = `PIESA copies not sent: ${e instanceof Error ? e.message : "error"}`; }
  // Decision 317: the electrician gets the regenerated official PIESA once (keyed to the post-fixes PIESA record; never throws).
  const elecCopy = await (await import("./electrician-piesa-copy.server")).sendElectricianPiesaCopy(jobId);
  // Decision 330: the owner is asked ONCE (email O72 + text) to confirm the fixes on the secure link; reminders from the tick.
  let ownerAsk: string;
  try { ownerAsk = await (await import("./piesa-fixes-confirm-send.server")).sendFixesConfirmStep(jobId, "request"); }
  catch (e) { ownerAsk = `owner fixes confirmation not sent: ${e instanceof Error ? e.message : "error"}`; }
  await logEvent(jobId, actorId, FIXES_FORM_COMPLETED_EVENT, `Electrical fixes form complete: CoES ${plan.coesNumber} certified ${plan.certDate}; Section C recorded, ${saved.length} file(s) kept; ${official}; ${copies}`.slice(0, 500),
    { audit_id: auditId, version, coes_number: plan.coesNumber, cert_date: plan.certDate, files: saved, official, copies, electrician_copy: elecCopy, owner_fixes_confirm: ownerAsk, signer: signerName, signed_at: plan.signedAt, rule: FIXES_DAY_RULE });
  // A48 batch 1 task 5: last, once every record above is written — the certificate kept with the job is read by the AI
  // (time-limited; ticked, or one office row). Never throws, so it can't leave this completion half-done.
  await (await import("./coes-check.server")).checkCurrentCoes(jobId, actorId);
  return { status: "done", detail: `${official}; ${copies}` };
}

/** 15-minute tick: every open fixes form (created, not yet completed) on a live job. Mitti errors are logged per job, never thrown. */
export async function sweepFixesForms(opts: { call?: MittiCall; fetchMedia?: import("./mitti.server").MittiMediaFetch; limit?: number } = {}): Promise<{ checked: number; done: number; notDone: number; waiting: number; failed: number }> {
  const out = { checked: 0, done: 0, notDone: 0, waiting: 0, failed: 0 };
  const { data: created, error } = await admin.from("workflow_events").select("job_id, details, created_at, jobs!inner(stage, deleted_at, qa_archived_at, business_unit)").eq("event_type", FIXES_FORM_CREATED_EVENT)
    .eq("jobs.business_unit", "hivic").is("jobs.deleted_at", null).is("jobs.qa_archived_at", null).eq("jobs.stage", "rectification_booked").order("created_at", { ascending: false }).limit((opts.limit ?? FIXES_SWEEP_MAX) * 2);
  if (error) throw new Error(`Fixes forms could not be read: ${error.message}`);
  const seen = new Set<string>();
  for (const r of created ?? []) {
    const auditId = (r.details as { audit_id?: string } | null)?.audit_id;
    if (!auditId || seen.has(auditId)) continue;
    seen.add(auditId);
    if (out.checked >= (opts.limit ?? FIXES_SWEEP_MAX)) break;
    out.checked++;
    try {
      const res = await completeFixesForm(String(r.job_id), auditId, { ...(opts.call ? { call: opts.call } : {}), ...(opts.fetchMedia ? { fetchMedia: opts.fetchMedia } : {}) });
      if (res.status === "done") out.done++; else if (res.status === "not_done") out.notDone++; else out.waiting++;
    } catch (e) { out.failed++; console.error("fixes form sweep failed", r.job_id, (e as Error).message); }
  }
  return out;
}
