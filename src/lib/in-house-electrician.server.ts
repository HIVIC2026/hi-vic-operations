// Explicit own-Team selection. Office verification and atomic assignment RPCs own writes;
// existing Mitti handover preflights own A3/A4 forms. No creation or delivery here.
import { jobAdmin as supabaseAdmin } from "./job-facts.server"; // speed (Task 11): the admin client; inside the job page bundle it answers from the job's rows
import { electricianVerified, inHouseElectricianBookingBlocker, melbourneToday, type ElectricianVerification } from "./worker-compliance.core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MittiCall } from "./mitti.core";
import { teamElectricianRow, type ChangeResult, type TeamElectricianRow } from "./installer-electricians.core";

const db = supabaseAdmin as unknown as SupabaseClient;
type Worker = ElectricianVerification & { id: string; business_id: string; profile_id: string | null; full_legal_name: string; email: string | null; approval_status: string; trade_role: string; removed_at: string | null };
const COLS = "id,business_id,profile_id,full_legal_name,email,trade_role,approval_status,removed_at,licence_number,rec_number,licence_expires_on,licence_verified_at";
async function read<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
async function heldBusiness(jobId: string): Promise<string | null> {
  const state = await (await import("./in-house-suppression.server")).readInHouseDispatchState([jobId]);
  if (state.failed) throw new Error("Couldn't check the job's partner — please try again.");
  if (!state.held.has(jobId)) return null;
  const assignment = await read<{ business_id: string | null } | null>(db.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle());
  if (!assignment?.business_id) throw new Error("This job is not assigned to your business");
  return assignment.business_id;
}
async function requireTeam(jobId: string, userId: string): Promise<string> {
  const businessId = await heldBusiness(jobId);
  if (!businessId) throw new Error("This job is not assigned to your business");
  const member = await read<unknown>(db.from("business_members").select("user_id").eq("business_id", businessId).eq("user_id", userId).eq("active", true).maybeSingle());
  if (!member) throw new Error("This job is not assigned to your business");
  return businessId;
}
/** Electricians never log in (Part 6): the assignment's user_id is NULL for them, so the person is the worker named by the
 *  latest `in_house_electrician_allocated` event (null = no allocation event, e.g. a legacy assignment made by profile). */
export async function allocatedWorkerId(jobId: string): Promise<string | null> {
  const ev = await read<{ details: { worker_id?: string } | null } | null>(db.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "in_house_electrician_allocated").order("created_at", { ascending: false }).limit(1).maybeSingle());
  const id = ev?.details?.worker_id;
  return typeof id === "string" && id ? id : null;
}
/** G7 (Jo 4 Nov 2026, pack 2 batches 4 and 6): the Team electrician ON the job, by name — the one put on it (latest
 *  `in_house_electrician_allocated`, the job page's "choose again" included), else the one picked at Add a job
 *  (`electrician_choice_set` worker_id) — read from their partner_workers row. `gone` = the row was removed from the Team
 *  (the name is still returned so a screen can say who). Null = no Team electrician is named on the job (HIV leads, legacy
 *  REC-business jobs). Read-only; the price card and the owner's confirm page show this name. */
export async function teamElectricianOnJob(jobId: string): Promise<{ id: string; name: string; businessId: string; gone: boolean } | null> {
  const workerId = (await allocatedWorkerId(jobId)) ?? (await (await import("./electrician-choice.server")).readElectricianChoiceRecord(jobId)).workerId;
  if (!workerId) return null;
  const w = await read<{ id: string; business_id: string; full_legal_name: string; removed_at: string | null } | null>(db.from("partner_workers").select("id, business_id, full_legal_name, removed_at").eq("id", workerId).maybeSingle());
  if (!w) return null;
  return { id: w.id, name: w.full_legal_name, businessId: w.business_id, gone: !!w.removed_at };
}
/** Join (4 Nov 2026): who signs as the job's electrician on the official PIESA / Section C — the assignment's profile when the
 *  person has a login (legacy REC electricians), else the no-login Team worker named by the allocation event (their worker
 *  id is the attribution; nothing reads `signer_user_id` as a profile). Null when nobody is assigned. */
export async function electricianSignerFor(jobId: string): Promise<{ userId: string; name: string } | null> {
  const asg = await read<{ user_id: string | null } | null>(db.from("job_assignments").select("user_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle());
  if (!asg) return null;
  if (asg.user_id) {
    const prof = await read<{ full_name: string | null } | null>(db.from("profiles").select("full_name").eq("id", asg.user_id).maybeSingle());
    return { userId: asg.user_id, name: prof?.full_name ?? "" };
  }
  const workerId = await allocatedWorkerId(jobId);
  const w = workerId ? await read<{ id: string; full_legal_name: string } | null>(db.from("partner_workers").select("id, full_legal_name").eq("id", workerId).is("removed_at", null).maybeSingle()) : null;
  return w ? { userId: w.id, name: w.full_legal_name } : null;
}
/** The assignment names this worker: by the allocation event, else (legacy) by the profile on the assignment. */
export const isAllocated = (w: { id: string; profile_id: string | null }, assignment: { user_id: string | null } | null, allocatedId: string | null): boolean =>
  !!assignment && (allocatedId ? allocatedId === w.id : !!assignment.user_id && assignment.user_id === w.profile_id);
/** Allowed = verified + office-approved + an email (`teamElectricianRow`, the one rule). No profile or Team login is needed: electricians never log in (their forms are handed to them in Mitti). */
const choiceOf = (r: TeamElectricianRow) => ({ id: r.workerId, name: r.name, licence: r.licence, allowed: r.allowed, reason: r.reason });
/** Jo 5 Nov 2026: the installer's Main electrician (installer-electricians.server, the one list) is marked so the Team
 *  pickers default to it. Built from the Team rows already read (no second Team read). Only a Team person can be put on
 *  the job from these pickers (as before); a Main that is a linked business marks nobody here. A failed read marks
 *  nobody — the picker still works, it just has no default. */
async function teamChoices(businessId: string, workers: Worker[]) {
  const rows = workers.map(teamElectricianRow);
  let mainWorker: string | null = null;
  try { mainWorker = (await (await import("./installer-electricians.server")).electriciansForInstaller(businessId, { team: rows })).find((e) => e.main)?.workerId ?? null; }
  catch (e) { console.error("electrician picker: Main electrician not read", (e as Error).message); }
  return rows.map((r) => ({ ...choiceOf(r), main: r.workerId === mainWorker }));
}
async function teamWorkers(businessId: string): Promise<Worker[]> {
  const workers: Worker[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await read<Worker[]>(db.from("partner_workers").select(COLS).eq("business_id", businessId).eq("trade_role", "electrician").is("removed_at", null).order("id").range(offset, offset + 199));
    workers.push(...page);
    if (page.length < 200) return workers;
  }
}
export async function electricianPicker(jobId: string, userId: string) {
  const businessId = await requireTeam(jobId, userId);
  const [workers, assignment, allocatedId] = await Promise.all([
    teamWorkers(businessId),
    read<{ user_id: string | null } | null>(db.from("job_assignments").select("user_id").eq("job_id", jobId).eq("business_id", businessId).eq("role", "electrician").eq("active", true).maybeSingle()),
    allocatedWorkerId(jobId),
  ]);
  const pendingWorkerId = assignment || allocatedId ? null : (await (await import('./electrician-choice.server')).readElectricianChoiceRecord(jobId)).workerId;
  const choices = await teamChoices(businessId, workers);
  return { pendingWorkerId, workers: workers.map((w, i) => ({ ...choices[i]!, selected: isAllocated(w, assignment, allocatedId) })) };
}
/** Installer screens Task 7: the business's Team electricians for Add a job (no job yet, so business-scoped; the caller has
 *  already checked the person may add jobs for this business). Same allowed/reason rule and Main mark as `electricianPicker`. */
export async function teamElectricianChoices(businessId: string): Promise<{ id: string; name: string; licence: string | null; allowed: boolean; reason: string | null; main: boolean }[]> {
  return teamChoices(businessId, await teamWorkers(businessId));
}
export async function inHousePiesaBookingBlockerFor(jobId: string): Promise<string | null> {
  const businessId = await heldBusiness(jobId);
  if (!businessId) return null; // non-in-house behaviour unchanged
  const workers = (await teamWorkers(businessId)).filter(w => w.approval_status === "approved");
  const missing = inHouseElectricianBookingBlocker(workers, melbourneToday());
  if (missing) return missing;
  const [assignment, allocatedId] = await Promise.all([
    read<{ user_id: string | null } | null>(db.from("job_assignments").select("user_id").eq("job_id", jobId).eq("business_id", businessId).eq("role", "electrician").eq("active", true).maybeSingle()),
    allocatedWorkerId(jobId),
  ]);
  if (!assignment || !workers.some(w => isAllocated(w, assignment, allocatedId) && electricianVerified(w).ok)) return "Choose a verified electrician from your Team before booking the safety check.";
  return null;
}
/** Every check before the person is put on the job (read-only): Team, verification, Mitti account. */
async function prepareAllocation(jobId: string, userId: string, workerId: string, call?: MittiCall) {
  const businessId = await requireTeam(jobId, userId);
  const worker = await read<Worker | null>(db.from("partner_workers").select(COLS).eq("id", workerId).eq("business_id", businessId).eq("trade_role", "electrician").is("removed_at", null).maybeSingle());
  if (!worker || worker.business_id !== businessId) throw new Error("That electrician is not on your Team");
  if (!electricianVerified(worker).ok || worker.approval_status !== "approved") throw new Error("Electrician not verified");
  const job = await read<{ source: string } | null>(db.from("jobs").select("source").eq("id", jobId).is("deleted_at", null).maybeSingle());
  if (!job) throw new Error("Job unavailable");
  // Electricians never log in (Part 6): no profile or Team login is needed; the Mitti email is (the forms are handed to them in Mitti).
  // Go-live 5 Nov 2026: a TEST job's forms go to the TEST Mitti account, so a TEST job never needs the person's email.
  if (job.source !== "qa_test" && !worker.email?.trim()) throw new Error("Electrician needs a Mitti email");
  const mitti = await import("./mitti.server");
  const email = job.source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : (worker.email ?? "").trim();
  const mittiUserId = await mitti.findMittiUserByEmail(email, call ?? mitti.realMittiCall);
  if (!mittiUserId) throw new Error("Add this electrician in Mitti first.");
  return { worker, email, mittiUserId };
}
type Prepared = Awaited<ReturnType<typeof prepareAllocation>>;
/** The open PIESA / fixes forms to hand over, read before the save (as before). */
async function openForms(jobId: string) {
  const [assessment, rectification] = await Promise.all([
    read<{ external_mitti_id: string | null } | null>(db.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle()),
    (await import("./fixes-day.server")).existingRectificationForm(jobId, true),
  ]);
  return { assessment, rectification };
}
export async function allocateElectrician(jobId: string, userId: string, workerId: string, call?: MittiCall) {
  const p = await prepareAllocation(jobId, userId, workerId, call);
  const forms = await openForms(jobId);
  const r = await db.rpc("allocate_team_electrician", { _job: jobId, _actor: userId, _worker: workerId });
  if (r.error) throw new Error(r.error.message);
  await afterAllocation(jobId, userId, workerId, p, forms, call);
  return { ok: true as const, name: p.worker.full_legal_name };
}
/** After the person is SAVED on the job (never before): their no-login job-link text (in the background), then the Mitti
 *  PIESA / fixes forms. */
async function afterAllocation(jobId: string, userId: string, workerId: string, p: Prepared, forms: Awaited<ReturnType<typeof openForms>>, call?: MittiCall) {
  const mitti = await import("./mitti.server");
  // The electrician's no-login job link (Part 6): made and texted only after the atomic assignment held. Never fails the allocation.
  // The committed allocation/event is recovered by sweepElectricianLinks; never wait on its text provider.
  const {runAfterResponse}=await import('./background.server');
  runAfterResponse(async()=> (await import("./electrician-link.server")).linkAfterAllocation(jobId, workerId, userId));
  // Same-person retries repair outstanding handovers using the existing audit identities.
  if (forms.assessment?.external_mitti_id) await mitti.reassignMittiFormTo({ jobId, auditId: forms.assessment.external_mitti_id, kind: "piesa", mittiUserId: p.mittiUserId, email: p.email, actorId: userId }, call ?? mitti.realMittiCall);
  if (forms.rectification && !forms.rectification.closed) await mitti.reassignMittiFormTo({ jobId, auditId: forms.rectification.auditId, kind: "rectification", mittiUserId: p.mittiUserId, email: p.email, actorId: userId }, call ?? mitti.realMittiCall);
}

/** The Needs me record for a hand-over that failed after the person was saved (the existing in-house form-sync failure
 *  row; its own work id so only a later good hand-over for this job clears it). */
export const handoverWorkId = (jobId: string) => `electrician-handover:${jobId}`;
async function recordHandoverFailed(jobId: string, userId: string, workerId: string, message: string) {
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, userId, "in_house_form_sync_failed", "The new electrician's safety check form wasn't moved to them in Mitti", { reason: `Electrician changed, but the Mitti form wasn't moved to them: ${message.slice(0, 300)}`, needs_office: true, work_id: handoverWorkId(jobId), worker_id: workerId }, { internal: true });
}
/** A good hand-over after an earlier failed one clears that Needs me row. A read failure leaves the row (never hides it). */
async function recordHandoverRecovered(jobId: string, userId: string) {
  const work = handoverWorkId(jobId);
  const { data, error } = await db.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", ["in_house_form_sync_failed", "in_house_form_sync_recovered"]).order("created_at", { ascending: false }).limit(50);
  if (error) return;
  const latest = ((data ?? []) as { event_type: string; details: { work_id?: string } | null }[]).find((e) => e.details?.work_id === work);
  if (latest?.event_type !== "in_house_form_sync_failed") return;
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, userId, "in_house_form_sync_recovered", "The electrician's safety check form was moved to them in Mitti", { reason: "Form moved", work_id: work }, { internal: true });
}

export type ChangeDeps = {
  piesaDone: (jobId: string) => Promise<boolean>;
  prepare: (jobId: string, userId: string, workerId: string) => Promise<Prepared>;
  forms: typeof openForms;
  bookWithPerson: (userId: string, input: { jobId: string; kind: "assessment"; start: string; workerId: string }) => Promise<ChangeResult>;
  allocateOnly: (jobId: string, userId: string, workerId: string) => Promise<void>;
  after: (jobId: string, userId: string, workerId: string, p: Prepared, forms: Awaited<ReturnType<typeof openForms>>) => Promise<void>;
  afterFailed: (jobId: string, userId: string, workerId: string, message: string) => Promise<void>;
  afterOk: (jobId: string, userId: string) => Promise<void>;
};
const changeDeps = (): ChangeDeps => ({
  piesaDone: async (jobId) => {
    const { data: job, error } = await db.from("jobs").select("stage").eq("id", jobId).maybeSingle();
    if (error || !job) throw new Error("Couldn't check the safety check. Please try again.");
    return (await import("./electrician-swap.server")).piesaDone(jobId, (job as { stage: string }).stage);
  },
  prepare: (jobId, userId, workerId) => prepareAllocation(jobId, userId, workerId),
  forms: openForms,
  bookWithPerson: async (userId, input) => { const r = await (await import("./trade-view.server")).inHouseBookVisit(userId, input); return r.ok ? { ok: true, warnings: r.warnings } : { ok: false, blockers: r.blockers }; },
  allocateOnly: async (jobId, userId, workerId) => { const r = await db.rpc("allocate_team_electrician", { _job: jobId, _actor: userId, _worker: workerId }); if (r.error) throw new Error(r.error.message); },
  after: (jobId, userId, workerId, p, forms) => afterAllocation(jobId, userId, workerId, p, forms),
  afterFailed: recordHandoverFailed,
  afterOk: recordHandoverRecovered,
});
/**
 * Jo 5 Nov 2026: choose or change the job's safety-check electrician, with the time when there is one. Allowed until the
 * safety check is done. The person and the time are saved TOGETHER (the in-house booking writer allocates the person in
 * the same save as the time); only after that saved is the electrician texted their job link and handed the Mitti PIESA
 * form. A failed save leaves the old electrician and sends nothing. A failed hand-over after the save goes on Needs me
 * (in_house_form_sync_failed) and comes back as a warning with the success — never silent.
 */
export async function changeJobElectrician(userId: string, input: { jobId: string; workerId: string; start?: string | null }, over: Partial<ChangeDeps> = {}) {
  const d = { ...changeDeps(), ...over };
  const { changeElectricianSaveFirst } = await import("./installer-electricians.core");
  let prepared: Prepared | null = null;
  let forms: Awaited<ReturnType<typeof openForms>> | null = null;
  return changeElectricianSaveFirst({
    piesaDone: () => d.piesaDone(input.jobId),
    save: async () => {
      prepared = await d.prepare(input.jobId, userId, input.workerId);
      forms = await d.forms(input.jobId);
      if (input.start) return d.bookWithPerson(userId, { jobId: input.jobId, kind: "assessment", start: input.start, workerId: input.workerId });
      await d.allocateOnly(input.jobId, userId, input.workerId);
      return { ok: true };
    },
    after: async () => { await d.after(input.jobId, userId, input.workerId, prepared!, forms!); await d.afterOk(input.jobId, userId).catch(() => undefined); },
    afterFailed: (message) => d.afterFailed(input.jobId, userId, input.workerId, message),
  });
}
