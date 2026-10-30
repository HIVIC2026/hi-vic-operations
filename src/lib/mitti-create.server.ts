// T3: Mitti form creation off the request path, started by a confirmed Ready Check booking, guarded by an
// atomic per-job/per-form claim (mitti-create-claim.core.ts). Reuses existing structures only:
// workflow_events (claim rows, primary key = deterministic claim id) and runAfterResponse (background.server.ts).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import {
  CLAIM_EVENT, CLAIM_HELD, OFFICE_OVERRIDE_AFTER_MS, OFFICE_OVERRIDE_EVENT, OUTCOME_UNCERTAIN, RELEASE_EVENT, UNCERTAIN_EVENT,
  claimEventId, claimGeneration, isUniqueViolation, releaseEventId, type MittiFormKind,
} from "./mitti-create-claim.core";
import { REPEAT_PIESA_FORM_RESET_EVENT } from "./repeat-piesa-form.core";

export class MittiClaimHeld extends WorkflowError { constructor() { super(CLAIM_HELD); this.name = "MittiClaimHeld"; } }
export class MittiOutcomeUncertain extends WorkflowError { constructor() { super(OUTCOME_UNCERTAIN); this.name = "MittiOutcomeUncertain"; } }

async function generationOf(jobId: string, kind: MittiFormKind): Promise<number> {
  const { data, error } = await admin.from("workflow_events").select("event_type, details").eq("job_id", jobId).in("event_type", [RELEASE_EVENT, REPEAT_PIESA_FORM_RESET_EVENT]);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return claimGeneration({
    releasedKinds: rows.filter((r) => r.event_type === RELEASE_EVENT).map((r) => (r.details as { kind?: string } | null)?.kind),
    repeatResets: rows.filter((r) => r.event_type === REPEAT_PIESA_FORM_RESET_EVENT).length,
    kind,
  });
}

async function insertClaim(jobId: string, kind: MittiFormKind, gen: number, actorId: string | null, summary: string, details: Record<string, unknown>) {
  // Rectification audits are idempotent per PIESA round (in-house) or per booked visit (legacy).
  const rectificationScope = kind === "fixes" ? details["rectification_round"] ?? details["booking_id"] : null;
  const id = await claimEventId(rectificationScope ? `${jobId}:${rectificationScope}` : jobId, kind, gen);
  const { error } = await admin.from("workflow_events").insert({ id, job_id: jobId, actor_id: actorId, event_type: CLAIM_EVENT, summary, details: { ...details, kind, generation: gen } as never, internal: true });
  if (!error) return { ok: true as const, id };
  if (isUniqueViolation(error)) return { ok: false as const, id };
  throw new Error(error.message);
}

/**
 * Atomically claim the right to create this job's form of this kind. Exactly one concurrent caller wins.
 * Held claims are never taken over automatically. `officeOverride` (the admin "Create & assign" action only)
 * may supersede a held claim that is at least 10 minutes old; that override is recorded.
 */
export async function claimMittiCreate(jobId: string, kind: MittiFormKind, actorId: string | null, summary: string, details: Record<string, unknown>, opts: { officeOverride?: boolean; now?: Date } = {}): Promise<string> {
  const gen = await generationOf(jobId, kind);
  const first = await insertClaim(jobId, kind, gen, actorId, summary, details);
  if (first.ok) return first.id;
  if (!opts.officeOverride) throw new MittiClaimHeld();
  const { data: held } = await admin.from("workflow_events").select("created_at").eq("id", first.id).maybeSingle();
  const age = (opts.now ?? new Date()).getTime() - Date.parse(String(held?.created_at ?? ""));
  if (!(age >= OFFICE_OVERRIDE_AFTER_MS)) throw new MittiClaimHeld();
  await logEvent(jobId, actorId, OFFICE_OVERRIDE_EVENT, "Office started a new Mitti form after an earlier attempt with an unknown result. Check Mitti for a duplicate form for this job.", { kind, superseded_claim: first.id }, { internal: true });
  await releaseMittiCreate(jobId, kind, first.id, actorId, "office_override");
  const next = await insertClaim(jobId, kind, gen + 1, actorId, summary, { ...details, office_override: true });
  if (next.ok) return next.id;
  throw new MittiClaimHeld();
}

/** Only when it is certain Mitti created nothing. Idempotent per claim (deterministic id). */
export async function releaseMittiCreate(jobId: string, kind: MittiFormKind, claimId: string, actorId: string | null, reason: string) {
  const id = await releaseEventId(claimId);
  const { error } = await admin.from("workflow_events").insert({ id, job_id: jobId, actor_id: actorId, event_type: RELEASE_EVENT, summary: `Mitti form creation attempt closed: nothing was created (${reason.slice(0, 200)})`, details: { kind, claim_id: claimId } as never, internal: true });
  if (error && !isUniqueViolation(error)) throw new Error(error.message);
}

export async function recordMittiCreateUncertain(jobId: string, kind: MittiFormKind, claimId: string, actorId: string | null, detail: string) {
  await logEvent(jobId, actorId, UNCERTAIN_EVENT, `Needs Home Insulation Victoria: ${OUTCOME_UNCERTAIN}`, { kind, claim_id: claimId, detail: detail.slice(0, 300), needs_office: true }, { internal: true });
}

// ---------- background Ready Check form creation ----------
export type ReadyCheckAssignee = { userId: string; fullName: string | null; email: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Create (or re-share) the Ready Check form. Never throws. Network-type failures that happened before Mitti
 * could have created anything are retried a bounded number of times; a held claim means someone else is on it.
 */
export async function runReadyCheckFormCreation(jobId: string, actorId: string | null, assignee: ReadyCheckAssignee | null, call?: MittiCall, opts: { delaysMs?: number[] } = {}): Promise<"created" | "held" | "uncertain" | "failed"> {
  const delays = opts.delaysMs ?? [5_000, 20_000];
  const { retryable } = await import("./onsite-ready-check.core");
  for (let attempt = 0; ; attempt++) {
    try {
      const { createAssignMittiAudit, realMittiCall } = await import("./mitti.server");
      await createAssignMittiAudit(jobId, actorId, call ?? realMittiCall, { readyCheck: true, ...(assignee ? { assignee } : {}) });
      return "created";
    } catch (e) {
      if (e instanceof MittiClaimHeld) return "held";
      const msg = e instanceof Error ? e.message : "Mitti error";
      if (e instanceof MittiOutcomeUncertain) {
        await logEvent(jobId, actorId, "mitti_access_needed", `Ready Check form: ${OUTCOME_UNCERTAIN}`, {}, { internal: true }).catch(() => undefined);
        return "uncertain";
      }
      if (retryable(msg) && attempt < delays.length) { await sleep(delays[attempt]!); continue; }
      await logEvent(jobId, actorId, "mitti_access_needed", `On-site Ready Check form could not be created: ${msg}`, {}, { internal: true }).catch(() => undefined);
      return "failed";
    }
  }
}

/** Fire-and-forget on the existing request-lifecycle helper; the caller's request never waits for Mitti. */
export async function scheduleReadyCheckFormCreation(jobId: string, actorId: string | null, assignee: ReadyCheckAssignee | null, call?: MittiCall) {
  const { runAfterResponse } = await import("./background.server");
  return runAfterResponse(() => runReadyCheckFormCreation(jobId, actorId, assignee, call));
}

/**
 * Facts deciding whether a Ready Check form may be created automatically for this job (same switches as the
 * on-site flow: business invited to Mitti, template set, auto_send_mitti ON, owner paperwork A; a confirmed booking
 * only on the booking paths — Add a job creates the form without one, decision 115).
 */
export async function readyCheckFormFacts(jobId: string) {
  const { data: j } = await admin.from("jobs").select("channel, source, stage, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (!j) return null;
  const { data: asg } = await admin.from("job_assignments").select("user_id, business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const businessId = j.channel === "installer_sourced" ? j.originating_installer_business_id : asg?.business_id ?? null;
  const { readyCheckVariant } = await import("./mitti-forms.core");
  const [{ data: b }, { data: ws }, { data: m }, { count: booked }, { gateAComplete }] = await Promise.all([
    businessId ? admin.from("businesses").select("mitti_account_invited").eq("id", businessId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("workflow_settings").select("mitti_ready_check_template_id, mitti_ready_check_priced_template_id, auto_send_mitti").eq("id", 1).maybeSingle(),
    admin.from("ceiling_measurements").select("external_source, external_id, status").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed"),
    import("./owner-gates.server"),
  ]);
  const template = readyCheckVariant(j.channel) === "ready_check_priced" ? ws?.mitti_ready_check_priced_template_id : ws?.mitti_ready_check_template_id;
  return {
    job: j, installerUserId: asg?.user_id ?? null,
    mittiInvited: (b as { mitti_account_invited?: boolean } | null)?.mitti_account_invited === true,
    templateSet: !!template?.trim(), autoSend: ws?.auto_send_mitti === true,
    gateADone: true, booked: !!booked,
    auditId: m?.external_source === "mitti" ? m.external_id ?? null : null,
    measurementComplete: m?.status === "complete",
  };
}

/** Called after a Ready Check booking is confirmed. HV-3542 (Jo 30 Oct): makes the form in the request itself (one
 *  quick attempt, kept alive with waitUntil) instead of a fire-and-forget step that could be lost. Never throws. */
export async function onReadyCheckBooked(jobId: string, actorId: string | null, call?: MittiCall): Promise<"scheduled" | "skipped"> {
  const { bookedSkipReason, bookedNoteSummary, BOOKED_SKIP_EVENT } = await import("./mitti-immediate.core");
  const note = (reason: string) => logEvent(jobId, actorId, BOOKED_SKIP_EVENT, bookedNoteSummary(reason), { reason }, { internal: true }).catch(() => undefined);
  const work = (async (): Promise<"scheduled" | "skipped"> => {
    try {
      const f = await readyCheckFormFacts(jobId);
      const skip = bookedSkipReason(f);
      if (skip || !f) { await note(skip ?? "job not found"); return "skipped"; }
      const assignee = await testAssignee(f.job.source, f.installerUserId!);
      await runReadyCheckFormCreation(jobId, actorId, assignee, call, { delaysMs: [] });
      return "scheduled";
    } catch (e) {
      await note(`stopped unexpectedly: ${(e instanceof Error ? e.message : "error").slice(0, 200)}`);
      return "skipped";
    }
  })();
  // Keep going if the phone drops the connection: the platform keeps this promise alive past the request.
  const { requestContext } = await import("./background.server");
  requestContext.getStore()?.waitUntil?.(work);
  return work;
}

/** Decisions 34/115 (Jo 24 Oct): Add a job creates the installer's Mitti Ready Check form straight away — no booking
 *  needed. Same switches, same atomic claim; a booking entered later (decision 116) finds the form and skips. */
export async function onReadyCheckJobAdded(jobId: string, actorId: string | null, call?: MittiCall): Promise<"scheduled" | "skipped"> {
  const { immediateSkipReason, immediateOutcomeNote, immediateNoteSummary, IMMEDIATE_SKIP_EVENT } = await import("./mitti-immediate.core");
  const note = (reason: string) => logEvent(jobId, actorId, IMMEDIATE_SKIP_EVENT, immediateNoteSummary(reason), { reason }, { internal: true }).catch(() => undefined);
  const work = (async (): Promise<"scheduled" | "skipped"> => {
    try {
      const f = await readyCheckFormFacts(jobId);
      const skip = immediateSkipReason(f);
      if (skip || !f) { await note(skip ?? "job not found"); return "skipped"; }
      const assignee = await testAssignee(f.job.source, f.installerUserId!);
      const outcome = await runReadyCheckFormCreation(jobId, actorId, assignee, call, { delaysMs: [] });
      const stop = immediateOutcomeNote(outcome);
      if (stop) await note(stop);
      return "scheduled";
    } catch (e) {
      await note(`stopped unexpectedly: ${(e instanceof Error ? e.message : "error").slice(0, 200)}`);
      return "skipped";
    }
  })();
  // Keep going if the phone drops the connection: the platform keeps this promise alive past the request.
  const { requestContext } = await import("./background.server");
  requestContext.getStore()?.waitUntil?.(work);
  return work;
}

export async function testAssignee(source: string | null, installerUserId: string): Promise<ReadyCheckAssignee | null> {
  if (source !== "qa_test") return null;
  const { TEST_MITTI_ASSIGNEE } = await import("./onsite-ready-check.core");
  const { data: p } = await admin.from("profiles").select("full_name").eq("id", installerUserId).maybeSingle();
  return { userId: installerUserId, fullName: p?.full_name ?? null, email: TEST_MITTI_ASSIGNEE };
}
