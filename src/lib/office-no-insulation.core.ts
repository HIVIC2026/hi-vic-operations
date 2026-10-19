// Office decision (Jo, 19 Oct 2026): "Photos show no insulation". Pure rules only.
// The homeowner's original Base44 answer is never rewritten; this decision is a separate, permanent office event
// that the estimate reads as the current insulation fact. A later photo review (below/over R2, unclear) supersedes it.

export const NO_INSULATION_EVENT = "intake_media_no_insulation_confirmed";
export const MEDIA_REVIEW_EVENT = "intake_media_reviewed";
/** Stages where a first Save My Spot response is still appropriate. */
export const NO_INSULATION_STAGES = ["new_enquiry", "eligibility_review", "preliminary_estimate_ready"] as const;

export type OfficeInsulationEvent = { event_type: string; occurred_at: string };

/** "none" only when the latest office photo decision is the no-insulation confirmation. */
export function officeInsulationOverride(events: OfficeInsulationEvent[]): "none" | null {
  const relevant = events.filter((e) => e.event_type === NO_INSULATION_EVENT || e.event_type === MEDIA_REVIEW_EVENT);
  if (!relevant.length) return null;
  const latest = [...relevant].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0];
  return latest?.event_type === NO_INSULATION_EVENT ? "none" : null;
}

export function noInsulationDecisionBlocker(x: { source: string | null; stage: string | null; eligibilityOutcome: string | null; mediaCount: number; reason: string }): string | null {
  if (x.source === "qa_test") return "Test jobs cannot use this decision.";
  if (!x.stage || !(NO_INSULATION_STAGES as readonly string[]).includes(x.stage)) return "Only enquiries waiting for a first response can use this decision.";
  if (x.eligibilityOutcome === "does_not_appear_eligible") return "This enquiry is recorded as not eligible.";
  if (x.mediaCount < 1) return "No homeowner photos or video are on file.";
  if (x.reason.trim().length < 5) return "Give a short reason.";
  return null;
}
