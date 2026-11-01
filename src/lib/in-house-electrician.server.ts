// Explicit own-Team selection. Office verification and atomic assignment RPCs own writes;
// existing Mitti handover preflights own A3/A4 forms. No creation or delivery here.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
  const [workers, assignment] = await Promise.all([
    teamWorkers(businessId),
    read<{ user_id: string | null } | null>(db.from("job_assignments").select("user_id").eq("job_id", jobId).eq("business_id", businessId).eq("role", "electrician").eq("active", true).maybeSingle()),
  ]);
  return { workers: workers.map(w => { const result = electricianVerified(w); return { id: w.id, name: w.full_legal_name, allowed: result.ok && w.approval_status === "approved" && !!w.profile_id, reason: result.reason ?? (w.approval_status !== "approved" ? "Waiting for office approval" : !w.profile_id ? "Electrician needs active Team access" : null), selected: assignment?.user_id === w.profile_id }; }) };
}
export async function inHousePiesaBookingBlockerFor(jobId: string): Promise<string | null> {
  const businessId = await heldBusiness(jobId);
  if (!businessId) return null; // non-in-house behaviour unchanged
  const workers = (await teamWorkers(businessId)).filter(w => w.approval_status === "approved" && !!w.profile_id);
  const missing = inHouseElectricianBookingBlocker(workers, melbourneToday());
  if (missing) return missing;
  const assignment = await read<{ user_id: string | null } | null>(db.from("job_assignments").select("user_id").eq("job_id", jobId).eq("business_id", businessId).eq("role", "electrician").eq("active", true).maybeSingle());
  if (!assignment || !workers.some(w => w.profile_id === assignment.user_id && electricianVerified(w).ok)) return "Choose a verified electrician from your Team before booking the safety check.";
  return null;
}
export async function allocateElectrician(jobId: string, userId: string, workerId: string, call?: MittiCall) {
  const businessId = await requireTeam(jobId, userId);
  const worker = await read<Worker | null>(db.from("partner_workers").select(COLS).eq("id", workerId).eq("business_id", businessId).eq("trade_role", "electrician").is("removed_at", null).maybeSingle());
  if (!worker || worker.business_id !== businessId) throw new Error("That electrician is not on your Team");
  if (!electricianVerified(worker).ok || worker.approval_status !== "approved") throw new Error("Electrician not verified");
  if (!worker.profile_id || !worker.email?.trim()) throw new Error("Electrician needs active Team access and a Mitti email");
  const job = await read<{ source: string } | null>(db.from("jobs").select("source").eq("id", jobId).is("deleted_at", null).maybeSingle());
  if (!job) throw new Error("Job unavailable");
  const mitti = await import("./mitti.server");
  const email = job.source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : worker.email.trim();
  const mittiUserId = await mitti.findMittiUserByEmail(email, call ?? mitti.realMittiCall);
  if (!mittiUserId) throw new Error("Add this electrician in Mitti first.");
  const [assessment, rectification] = await Promise.all([
    read<{ external_mitti_id: string | null } | null>(db.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle()),
    (await import("./fixes-day.server")).existingRectificationForm(jobId, true),
  ]);
  const r = await db.rpc("allocate_team_electrician", { _job: jobId, _actor: userId, _worker: workerId });
  if (r.error) throw new Error(r.error.message);
  // Same-person retries repair outstanding handovers using the existing audit identities.
  if (assessment?.external_mitti_id) await mitti.reassignMittiFormTo({ jobId, auditId: assessment.external_mitti_id, kind: "piesa", mittiUserId, email, actorId: userId }, call ?? mitti.realMittiCall);
  if (rectification && !rectification.closed) await mitti.reassignMittiFormTo({ jobId, auditId: rectification.auditId, kind: "rectification", mittiUserId, email, actorId: userId }, call ?? mitti.realMittiCall);
  return { ok: true as const, name: worker.full_legal_name };
}