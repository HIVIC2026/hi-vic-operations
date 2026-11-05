// Explicit own-Team selection. Office verification and atomic assignment RPCs own writes;
// existing Mitti handover preflights own A3/A4 forms. No creation or delivery here.
import { jobAdmin as supabaseAdmin } from "./job-facts.server"; // speed (Task 11): the admin client; inside the job page bundle it answers from the job's rows
import { electricianVerified, inHouseElectricianBookingBlocker, melbourneToday, type ElectricianVerification } from "./worker-compliance.core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MittiCall } from "./mitti.core";

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
/** Allowed = verified + office-approved. No profile or Team login is needed: electricians never log in (their forms are handed to them in Mitti). */
const choiceOf = (w: Worker) => { const result = electricianVerified(w); return { id: w.id, name: w.full_legal_name, licence: w.licence_number?.trim() || null, allowed: result.ok && w.approval_status === "approved", reason: result.reason ?? (w.approval_status !== "approved" ? "Waiting for office approval" : null) }; };
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
  return { workers: workers.map(w => ({ ...choiceOf(w), selected: isAllocated(w, assignment, allocatedId) })) };
}
/** Installer screens Task 7: the business's Team electricians for Add a job (no job yet, so business-scoped; the caller has
 *  already checked the person may add jobs for this business). Same allowed/reason rule as `electricianPicker`. */
export async function teamElectricianChoices(businessId: string): Promise<{ id: string; name: string; licence: string | null; allowed: boolean; reason: string | null }[]> {
  const workers = await teamWorkers(businessId);
  return workers.map(choiceOf);
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
export async function allocateElectrician(jobId: string, userId: string, workerId: string, call?: MittiCall) {
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
  const [assessment, rectification] = await Promise.all([
    read<{ external_mitti_id: string | null } | null>(db.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle()),
    (await import("./fixes-day.server")).existingRectificationForm(jobId, true),
  ]);
  const r = await db.rpc("allocate_team_electrician", { _job: jobId, _actor: userId, _worker: workerId });
  if (r.error) throw new Error(r.error.message);
  // The electrician's no-login job link (Part 6): made and texted only after the atomic assignment held. Never fails the allocation.
  // The committed allocation/event is recovered by sweepElectricianLinks; never wait on its text provider.
  const {runAfterResponse}=await import('./background.server');
  runAfterResponse(async()=> (await import("./electrician-link.server")).linkAfterAllocation(jobId, workerId, userId));
  // Same-person retries repair outstanding handovers using the existing audit identities.
  if (assessment?.external_mitti_id) await mitti.reassignMittiFormTo({ jobId, auditId: assessment.external_mitti_id, kind: "piesa", mittiUserId, email, actorId: userId }, call ?? mitti.realMittiCall);
  if (rectification && !rectification.closed) await mitti.reassignMittiFormTo({ jobId, auditId: rectification.auditId, kind: "rectification", mittiUserId, email, actorId: userId }, call ?? mitti.realMittiCall);
  return { ok: true as const, name: worker.full_legal_name };
}