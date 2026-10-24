// Jo 24 Oct 2026: pure rules for "installer marked the Mitti Ready Check Complete" (mitti-complete.server.ts).
import { formEligibilityReasons, websiteStopReasons } from "./ready-check-answers.core";
import { missingMeasureFields, MEASURE_FIELD_LABEL } from "./scope.core";

type M = { id: string; status: string | null; external_source: string | null; external_id: string | null; provenance?: string | null; review_flags?: unknown; measured_area_m2: unknown; insulation_present: boolean | null; existing_r_value: unknown; removal_required: boolean | null; removal_m2: unknown; access_difficulty: string | null; source_role?: string | null };
export type CompletionInput = { auditId: string; completed: boolean; modifiedAt: string | null; entries: { label: string; value: unknown }[]; ourLead: boolean };
export type CompletionPlan =
  | { kind: "skip" }                                   // nothing to do (not this form / already handled)
  | { kind: "hold"; reasons: string[] }                 // office must act; nothing recorded
  | { kind: "complete"; fill: { removal_required?: boolean } }
  | { kind: "already" };                                // measurements already complete for this form

export function completionPlan(i: CompletionInput & { measurement: M | null; websiteFacts: { lifeSupportStatus: string | null; overFiveYears: string | null } | null }): CompletionPlan {
  const m = i.measurement;
  if (!i.completed || !m || m.external_source !== "mitti" || m.external_id !== i.auditId) return { kind: "skip" };
  if (m.status === "complete") return { kind: "already" };
  const reasons = formEligibilityReasons(i.entries, { ownerAnsweredOnWebsite: i.ourLead });
  if (i.websiteFacts) reasons.push(...websiteStopReasons(i.websiteFacts));
  if (Array.isArray(m.review_flags) && m.review_flags.length) reasons.push("Ready Check answers are flagged for office review");
  // "No existing insulation" means no removal; a removal amount means removal. A blank removal answer on a home
  // WITH insulation is only assumed "none" on the installer's own quote (his total covers it); our leads are priced
  // per m² from it, so it holds.
  const fill: { removal_required?: boolean } = {};
  if (m.removal_required == null) {
    if (m.insulation_present === false) fill.removal_required = false;
    else if (Number(m.removal_m2) > 0) fill.removal_required = true;
    else if (!i.ourLead && m.insulation_present === true) fill.removal_required = false;
  }
  const missing = missingMeasureFields({ ...m, ...fill } as never);
  if (missing.length) reasons.push(`Ready Check is missing: ${missing.map((f) => MEASURE_FIELD_LABEL[f]).join(", ")}`);
  return reasons.length ? { kind: "hold", reasons: [...new Set(reasons)] } : { kind: "complete", fill };
}
