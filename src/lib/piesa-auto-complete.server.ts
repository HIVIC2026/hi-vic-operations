// The ONE automatic PIESA completion (join ruling 3, 4 Nov 2026). It merges main's Part 3 Task 4b (installers' own jobs:
// a Complete A3 at PIESA booked completes the PIESA itself, once per version of the Mitti form, retried when the form is
// edited) with fix wave J4 G1 (in-house jobs: the A3 must also carry the electrician's signature; the same checks
// `completePiesaAssessment` runs; one office "Needs me" row when a check fails).
//
// Scope: an IN-HOUSE job (Part 6 removed the electrician's job page; the office page never had the button) or an installer's
// OWN job (channel installer_sourced, call-and-book: their electrician has no login). Home Insulation Victoria-lead jobs that
// are not in-house are untouched — the office / electrician presses Complete PIESA as before.
//
// Once per form version: the claim is ONE `piesa_auto_completed` event with a stable id on job + form + the form's modified
// time (main's rule). An unchanged re-sync never runs again; an edited form (new modified time) is tried again. A refusal
// (no signature, or any check `completePiesaAssessment` refuses) is ONE office row — event pair `piesa_auto_complete_held` /
// `piesa_auto_complete_recovered` (the same mechanism as the in-house form-sync and deposit-request rows) — with the reason;
// the row clears when the PIESA completes by any path. main's `own_job_piesa_complete_held` kind is retired (never written).
// No sender is imported here: the owner / installer copies go through the PIESA result route exactly as a pressed Complete did.
// Never throws to the sync.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isUniqueViolation, stableUuid } from "./mitti-create-claim.core";
import { PIESA_AUTO_COMPLETED_EVENT } from "./own-job-piesa.core";
import { WorkflowError, logEvent } from "./workflow.server";

export const PIESA_AUTO_COMPLETE_HELD = "piesa_auto_complete_held";
export const PIESA_AUTO_COMPLETE_RECOVERED = "piesa_auto_complete_recovered";
/** Office-only wording (Needs me row): why the synced A3 did not complete the PIESA by itself. */
export const PIESA_AUTO_SIGNATURE_MISSING = "The electrician hasn't signed the safety check form (A3) yet";

export type AutoCompleteResult = {
  outcome: "completed" | "already_complete" | "already" | "held" | "not_applicable" | "not_due" | "not_ready" | "unreadable";
  reason?: string;
};

/** Which jobs complete by themselves: in-house (the installer's Team electrician), or the installer's own call-and-book job.
 *  Null = could not be read (fail closed: nothing is claimed, the next sync tries again). */
export async function autoCompleteScope(jobId: string): Promise<"in_house" | "own_job" | null | false> {
  const state = await (await import("./in-house-suppression.server")).readInHouseDispatchState([jobId]);
  if (state.failed) return null;
  if (state.held.has(jobId)) return "in_house";
  const own = await (await import("./own-job-piesa.server")).ownJobCallAndBook(jobId);
  if (own === null) return null;
  return own ? "own_job" : false;
}

/**
 * Called by the A3 sync after a completed form's evidence, report and signature are stored. `signed` = the A3 carries the
 * electrician's signature (read from the audit); `auditId` + `modifiedAt` key the once-per-form-version claim and the hold.
 */
export async function autoCompletePiesa(jobId: string, actorId: string | null, facts: { completed: boolean; signed: boolean; auditId: string | null; modifiedAt: string | null }): Promise<AutoCompleteResult> {
  try {
    if (!facts.completed) return { outcome: "not_ready" };
    const scope = await autoCompleteScope(jobId);
    if (scope === null) return { outcome: "unreadable" };
    if (!scope) return { outcome: "not_applicable" };
    const { getStage } = await import("./workflow.server");
    if ((await getStage(jobId)) !== "piesa_scheduled") return { outcome: "not_due" };
    // Once per form version (main's rule): the claim is written BEFORE the completion runs; a repeat sync of the same version
    // returns "already" and does nothing — an edited form has a new modified time and a new claim.
    const key = `${jobId}:${facts.auditId ?? "unlinked"}:${facts.modifiedAt ?? "unknown"}`;
    const claimId = await stableUuid(`piesa-auto-complete:${key}`);
    const { data: prior, error: priorErr } = await admin.from("workflow_events").select("id").eq("id", claimId).maybeSingle();
    if (priorErr) return { outcome: "unreadable" };
    if (prior) return { outcome: "already" };
    const claim = await admin.from("workflow_events").insert({
      id: claimId, job_id: jobId, actor_id: actorId, event_type: PIESA_AUTO_COMPLETED_EVENT,
      summary: "Safety check (PIESA) done in Mitti — completing it automatically", details: { audit_id: facts.auditId, modified_at: facts.modifiedAt, scope, signed: facts.signed }, internal: true,
    });
    if (claim.error) return isUniqueViolation(claim.error) ? { outcome: "already" } : { outcome: "unreadable" };
    if (!facts.signed) return hold(jobId, actorId, facts.auditId, PIESA_AUTO_SIGNATURE_MISSING);
    try {
      // A null actor: completePiesaAssessment records the sign-off against the electrician's login, else the installer account.
      await (await import("./piesa-complete.server")).completePiesaAssessment({ jobId }, actorId);
    } catch (e) {
      if (e instanceof WorkflowError && /already complete/i.test(e.message)) return { outcome: "already_complete" };
      const reason = e instanceof Error ? e.message : "Completion failed";
      return hold(jobId, actorId, facts.auditId, reason);
    }
    return { outcome: "completed" };
  } catch (e) {
    console.error("PIESA auto-complete skipped", jobId, e instanceof Error ? e.message : "error");
    return { outcome: "unreadable" };
  }
}

/** One held event per (job, form, reason): an unchanged reason on the next sync adds nothing. */
async function hold(jobId: string, actorId: string | null, auditId: string | null, reason: string): Promise<AutoCompleteResult> {
  const { data: last } = await admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).in("event_type", [PIESA_AUTO_COMPLETE_HELD, PIESA_AUTO_COMPLETE_RECOVERED]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prev = last?.event_type === PIESA_AUTO_COMPLETE_HELD ? (last.details as { reason?: string; audit_id?: string | null } | null) : null;
  if (!(prev && prev.reason === reason && (prev.audit_id ?? null) === (auditId ?? null)))
    await logEvent(jobId, actorId, PIESA_AUTO_COMPLETE_HELD, `Safety check (PIESA) not completed by itself: ${reason}`, { reason, audit_id: auditId, needs_office: true }, { internal: true });
  return { outcome: "held", reason };
}

/** Called by `completePiesaAssessment` on success (pressed or automatic): the held row, if any, is cleared. */
export async function clearPiesaAutoCompleteHold(jobId: string, actorId: string | null) {
  const { data: last } = await admin.from("workflow_events").select("event_type").eq("job_id", jobId).in("event_type", [PIESA_AUTO_COMPLETE_HELD, PIESA_AUTO_COMPLETE_RECOVERED]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.event_type === PIESA_AUTO_COMPLETE_HELD) await logEvent(jobId, actorId, PIESA_AUTO_COMPLETE_RECOVERED, "Safety check (PIESA) completed from the synced form", {}, { internal: true });
}
