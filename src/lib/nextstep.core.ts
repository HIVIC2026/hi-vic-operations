// ONE rule for what every screen shows as a job's stage tag, next step and who it waits on.
// Derived from the stage + Gate 1 state only; stored free-text next_action is never displayed as the step.
import { waitingOn, type Stage, type WaitingOn } from "./workflow";
import { stageWording, ELIGIBILITY_WORDS } from "./job-wording";

export type NextStepInput = {
  stage: string | null | undefined;
  eligibility_outcome?: string | null;
  eligibility_review_required?: boolean | null;
  next_action?: string | null; // only used for REVIEW REQUIRED reasons and hold reasons
  hold_reason?: string | null;
  /** Office-only display: a saved spot keeps its stored stage but is labelled plainly. */
  office_status?: string | null;
};
export type NextStep = { label: string; next: string; waitingOn: WaitingOn; tone: "brand" | "warn" | "bad" | "good" };

const EARLY = ["new_enquiry", "eligibility_review"];

export function nextStep(j: NextStepInput): NextStep {
  const stage = (j.stage ?? "new_enquiry") as Stage;
  const w = stageWording(stage, { spotSaved: stage === "preliminary_estimate_ready" && j.office_status === "spot_saved" });
  if (stage === "complete") return { label: w.tag, next: w.next, waitingOn: null, tone: "good" };
  if (stage === "cancelled") return { label: w.tag, next: w.next, waitingOn: null, tone: "bad" };
  if (stage === "on_hold") return { label: w.tag, next: j.hold_reason ? `${w.next}: ${j.hold_reason}` : w.next, waitingOn: "Home Insulation Victoria", tone: "bad" };
  if (j.eligibility_review_required) return { label: ELIGIBILITY_WORDS.review, next: "Review eligibility", waitingOn: "Home Insulation Victoria", tone: "warn" };
  if (j.eligibility_outcome === "does_not_appear_eligible") return { label: ELIGIBILITY_WORDS.does_not_appear_eligible, next: "Send not eligible email", waitingOn: "Home Insulation Victoria", tone: "bad" };
  if (EARLY.includes(stage)) return { label: w.tag, next: w.next, waitingOn: "Home Insulation Victoria", tone: "brand" };
  if (w.tag === "Spot saved" && stage === "preliminary_estimate_ready") return { label: w.tag, next: w.next, waitingOn: "Home Insulation Victoria", tone: "good" };
  return { label: w.tag, next: w.next, waitingOn: waitingOn(stage, null), tone: stage === "awaiting_deposit_payment" ? "warn" : "brand" };
}

/** Stage vs records mismatches. Anything returned is shown on To action as "Stage doesn't match records". */
export type ConsistencyFacts = { stage: string; eligibility_outcome: string | null; eligibility_review_required: boolean | null; electricianAssigned: boolean; installQuoteAccepted: boolean };
export function stageMismatches(f: ConsistencyFacts): string[] {
  const out: string[] = [];
  const s = f.stage;
  const past = !["new_enquiry", "eligibility_review", "on_hold", "cancelled", "complete"].includes(s);
  if (past && f.eligibility_outcome === "does_not_appear_eligible") out.push("Job has moved on but Gate 1 says Does Not Appear Eligible.");
  if (past && f.eligibility_review_required) out.push("Job has moved on while Gate 1 is still REVIEW REQUIRED.");
  if (past && !f.eligibility_outcome) out.push("Job has moved on without a Gate 1 outcome.");
  if (s === "awaiting_electrician" && !f.electricianAssigned) out.push("Job is at the old 'Awaiting Electrician' step – it should be at the Ready Check (or approved measure-up) first.");
  if (["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec"].includes(s) && !f.installQuoteAccepted) out.push("Job is past quote acceptance but has no accepted installation quote.");
  return out;
}
