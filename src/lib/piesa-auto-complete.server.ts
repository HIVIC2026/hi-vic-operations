// Fix wave J4 G1 (join ruling, 4 Nov 2026): on an IN-HOUSE job nobody presses "Complete PIESA" any more (Part 6 removed the
// electrician's job page; the office page never had the button) — so a synced A3 that is complete (with its evidence) AND
// carries the electrician's signature completes the PIESA by itself, through the SAME checks `completePiesaAssessment`
// runs (official rules, evidence, date, stage gate). A check that fails is ONE office "Needs me" row saying what is
// missing (event pair `piesa_auto_complete_held` / `piesa_auto_complete_recovered`, the same mechanism as the in-house
// form-sync and deposit-request rows); the next sync tries again. Home Insulation Victoria-lead (non-in-house) jobs are
// untouched — Part 8's "the sync completes nothing" still holds for them. No sender is imported here: the owner / installer
// copies go through the PIESA result route exactly as a pressed Complete did.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";

export const PIESA_AUTO_COMPLETE_HELD = "piesa_auto_complete_held";
export const PIESA_AUTO_COMPLETE_RECOVERED = "piesa_auto_complete_recovered";
/** Office-only wording (Needs me row): why the synced A3 did not complete the PIESA by itself. */
export const PIESA_AUTO_SIGNATURE_MISSING = "The electrician hasn't signed the safety check form (A3) yet";

export type AutoCompleteResult = { outcome: "completed" | "already_complete" | "held" | "not_in_house" | "not_ready"; reason?: string };

/**
 * Called by the A3 sync after a completed form's evidence, report and signature are stored. `signed` = the A3 carries the
 * electrician's signature (read from the audit); `auditId` keys the hold so the same form version is not re-recorded.
 */
export async function autoCompleteInHousePiesa(jobId: string, actorId: string | null, facts: { completed: boolean; signed: boolean; auditId: string | null }): Promise<AutoCompleteResult> {
  if (!facts.completed) return { outcome: "not_ready" };
  const state = await (await import("./in-house-suppression.server")).readInHouseDispatchState([jobId]);
  if (state.failed || !state.held.has(jobId)) return { outcome: "not_in_house" };
  if (!facts.signed) return hold(jobId, actorId, facts.auditId, PIESA_AUTO_SIGNATURE_MISSING);
  try {
    await (await import("./piesa-complete.server")).completePiesaAssessment({ jobId }, actorId);
  } catch (e) {
    if (e instanceof WorkflowError && /already complete/i.test(e.message)) return { outcome: "already_complete" };
    const reason = e instanceof Error ? e.message : "Completion failed";
    return hold(jobId, actorId, facts.auditId, reason);
  }
  return { outcome: "completed" };
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
