// Part 2 (Jo 3 Nov 2026): an installer's own job (channel installer_sourced, not held by an in-house partner) skips the
// safety check offer. Once the owner's safety check (PIESA) fee is paid the job goes straight to the installer's chosen
// electrician: one active electrician assignment, the PIESA stage, one `own_job_piesa_handed` event (keyed per job and
// round, so a double payment or two sweeps hand it over once), then the notices. A missing electrician or portal
// profile becomes one office item instead. HIV leads and in-house partner jobs never come here.
// Static imports stay light (no workflow import graph); the rest is loaded when used.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { inHouseDispatchSkip, readInHouseDispatchState, type InHouseDispatchState } from "./in-house-suppression.server";
import { OWN_JOB_PIESA_HANDED_EVENT, OWN_JOB_PIESA_HELD_EVENT, isOwnJobCallAndBook, ownJobHandoffKey, ownJobHandoffPlan } from "./own-job-piesa.core";

export type OwnJobHandoffOutcome = "handed" | "waiting" | "held" | "already";

/** True when this job is an installer's own call-and-book job. Read failures return null (callers fail closed). */
export async function ownJobCallAndBook(jobId: string, inHouseState?: InHouseDispatchState): Promise<boolean | null> {
  try {
    const skip = await inHouseDispatchSkip(jobId, inHouseState);
    if (skip === "in_house_read_failed") return null;
    const { data, error } = await admin.from("jobs").select("channel").eq("id", jobId).maybeSingle();
    if (error) return null;
    return isOwnJobCallAndBook({ channel: (data?.channel as string | null | undefined) ?? null, heldInHouse: skip === "in_house" });
  } catch {
    return null;
  }
}

/** The same "paid" fact afterPaymentsChanged uses before onSafetyCheckPaid / the installer "Owner accepted" email. */
async function safetyCheckFeePaid(jobId: string, now: Date): Promise<boolean> {
  try {
    const [{ jobPaymentView }, { isStepPaid }] = await Promise.all([import("./payments.server"), import("./payments.core")]);
    const v = await jobPaymentView(jobId, now);
    return !!v && isStepPaid(v.steps, "safety_check");
  } catch {
    return false;
  }
}

/** The chosen electrician business's approved electrician worker with a portal profile (oldest first), or null. */
async function electricianProfile(businessId: string): Promise<string | null> {
  const { data, error } = await admin.from("partner_workers").select("profile_id")
    .eq("business_id", businessId).eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null).not("profile_id", "is", null)
    .order("created_at").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.profile_id as string | null | undefined) ?? null;
}

async function eventWithKey(jobId: string, eventType: string, key: string): Promise<boolean> {
  const { count, error } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", eventType).contains("details", { key });
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/** One office item per job, round and reason. */
async function holdOnce(jobId: string, handKey: string, reason: string, electricianBusinessId: string | null) {
  const key = `${handKey}:${reason}`;
  if (await eventWithKey(jobId, OWN_JOB_PIESA_HELD_EVENT, key)) return;
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, null, OWN_JOB_PIESA_HELD_EVENT, `Safety check (PIESA) not handed to the installer's electrician: ${reason}. Needs Home Insulation Victoria`,
    { key, reason, electrician_business_id: electricianBusinessId, needs_office: true }, { internal: true });
}

/** Hand one own job's safety check to the installer's chosen electrician. Idempotent per job and round. */
export async function handOwnJobPiesa(jobId: string, now: Date = new Date(), inHouseState?: InHouseDispatchState): Promise<OwnJobHandoffOutcome> {
  const { data: job, error: je } = await admin.from("jobs").select("id, stage, deleted_at").eq("id", jobId).maybeSingle();
  if (je || !job || job.deleted_at) return "waiting";
  if ((await ownJobCallAndBook(jobId, inHouseState)) !== true) return "waiting";
  const { latestReopenAt } = await import("./repeat-piesa.server");
  const key = ownJobHandoffKey(jobId, await latestReopenAt(jobId));
  if (await eventWithKey(jobId, OWN_JOB_PIESA_HANDED_EVENT, key)) return "already";
  const paid = await safetyCheckFeePaid(jobId, now);
  // Cheap checks first: only look up the electrician for a paid job still waiting for its safety check.
  const ready = paid && job.stage === "measured_quote_accepted";
  const electricianBusinessId = ready ? await (await import("./job-electrician.server")).jobChosenElectrician(jobId) : null;
  const electricianUserId = electricianBusinessId ? await electricianProfile(electricianBusinessId) : null;
  const plan = ownJobHandoffPlan({ paid, stage: job.stage as string, electricianBusinessId, electricianUserId, alreadyHanded: false });
  if (plan.kind === "wait") return "waiting";
  if (plan.kind === "hold") { await holdOnce(jobId, key, plan.reason, electricianBusinessId); return "held"; }
  const wf = await import("./workflow.server");
  // The job must be able to enter the PIESA stage (quote accepted, gates clear); otherwise wait like the offer path does.
  if ((await wf.stageEntryBlockers(jobId, "piesa_and_install_window_pending", null).catch(() => ["unreadable"])).length) return "waiting";
  const { data: existing, error: ee } = await admin.from("job_assignments").select("id, business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true);
  if (ee) return "waiting";
  if ((existing ?? []).some((a) => a.business_id !== electricianBusinessId)) return "waiting"; // someone else is already on it: the office decides
  let insertedId: string | null = null;
  if (!(existing ?? []).length) {
    const { data: ins, error: ie } = await admin.from("job_assignments")
      .insert({ job_id: jobId, role: "electrician", business_id: electricianBusinessId, user_id: electricianUserId as string, active: true })
      .select("id").single();
    if (ie || !ins) throw new Error(ie?.message ?? "Could not assign the electrician");
    insertedId = ins.id as string;
  }
  try {
    // The guarded stage move is the claim: of two hand-overs racing, only one moves the job.
    await wf.transition(jobId, "piesa_and_install_window_pending", null, "Safety check (PIESA) handed to the installer's electrician to book", { own_job: true, electrician_business_id: electricianBusinessId });
  } catch (e) {
    if (insertedId) await admin.from("job_assignments").delete().eq("id", insertedId);
    if (await eventWithKey(jobId, OWN_JOB_PIESA_HANDED_EVENT, key).catch(() => false)) return "already";
    console.warn("own job safety check not handed yet", jobId, (e as Error).message);
    return "waiting";
  }
  const { addMelbourneBusinessDays } = await import("./melbourne-time.core");
  await wf.logEvent(jobId, null, OWN_JOB_PIESA_HANDED_EVENT, "Safety check (PIESA) handed to the installer's electrician to book within 2 business days",
    { key, electrician_business_id: electricianBusinessId, electrician_user_id: electricianUserId, due_at: addMelbourneBusinessDays(now.toISOString(), 2) }, { internal: true });
  const { sendOwnJobPiesaNotices } = await import("./own-job-piesa-notices.server");
  await sendOwnJobPiesaNotices(jobId).catch((e) => console.error("own job safety check notices skipped", jobId, (e as Error).message));
  return "handed";
}

/** 15-minute tick: own jobs in measured_quote_accepted whose safety check fee has cleared go to their electrician. */
export async function sweepOwnJobPiesaHandoffs(now: Date = new Date()): Promise<Record<OwnJobHandoffOutcome | "failed", number>> {
  const out = { handed: 0, waiting: 0, held: 0, already: 0, failed: 0 };
  const inHouseState = await readInHouseDispatchState();
  if (inHouseState.failed) return out;
  const { data: jobs, error } = await admin.from("jobs").select("id").eq("channel", "installer_sourced").eq("stage", "measured_quote_accepted").is("deleted_at", null).order("created_at").limit(200);
  if (error) throw new Error(error.message);
  for (const j of jobs ?? []) {
    if (inHouseState.held.has(j.id)) continue;
    try { out[await handOwnJobPiesa(j.id, now, inHouseState)]++; } catch (e) { out.failed++; console.error("own job safety check hand-over failed", j.id, (e as Error).message); }
  }
  return out;
}
