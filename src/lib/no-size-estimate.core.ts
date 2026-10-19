// Missing-size estimate guard. Pure; tested in tests/no-size-estimate.test.ts.
import { DEFAULT_ESTIMATED_AREA_M2 } from "./estimate.core";

/** A typical-area estimate may only go as the owner's own automatic first reply, priced on exactly the
 *  labelled typical area, for a home with no insulation and no owner-entered size. Null = allowed. */
export function noSizeEstimateBlocker(x: { areaSource: string | null; areaM2: number | null; ownerArea: number | null; insulation: string | null; followup: boolean; automaticInitial: boolean }): string | null {
  if (x.areaSource !== "typical_default") return null;
  if (x.followup || x.insulation !== "none") return "Typical-size estimates are only for homes with no existing insulation.";
  if (x.ownerArea && x.ownerArea > 0) return "Owner has entered a ceiling size; the estimate must be recalculated first.";
  if (x.areaM2 !== DEFAULT_ESTIMATED_AREA_M2) return "Estimate area does not match the typical-size assumption.";
  if (!x.automaticInitial) return "Missing-size estimates go only as the automatic first reply to a new enquiry, never from a list.";
  return null;
}

/** Real typical-150 m² first replies are HELD: no durable, once-only "original initial enquiry" claim exists yet,
 *  and the website enquiry contract does not currently send a missing size. Age windows were never approved and
 *  cannot tell a new enquiry from a re-run backlog job, so nothing real qualifies until that claim is built. */
export const NO_SIZE_REAL_SEND_HELD = "Typical-size first reply is on hold until the original enquiry can be proven new; nothing sent.";
export function initialReplyQualifies(_x: { originalInitialClaim: null }): boolean { return false; }

/** May a labelled 150 m² first reply be treated as the owner's automatic initial reply? Previews/TEST render; a real
 *  send qualifies only for the manually-approved ENQ_01 backlog run (still priced on exactly the labelled 150 m²). */
export function noSizeInitialAllowed(x: { isTest: boolean; mode: string; manualBacklog: boolean }): boolean {
  if (x.isTest || x.mode !== "send") return true;
  return x.manualBacklog || initialReplyQualifies({ originalInitialClaim: null });
}

/** Jo 19 Oct: a reviewed below-R2 existing-insulation follow-up with no owner size may use the clearly
 *  labelled typical 150 m² estimate (the T3/T4 email states the size was assumed). Every other follow-up
 *  guard (approved review, consent, link, idempotency) still applies separately. Null = allowed. */
export function reviewedFollowupNoSizeBlocker(x: { areaSource: string | null; areaM2: number | null; ownerArea: number | null; insulation: string | null }): string | null {
  if (x.areaSource !== "typical_default") return null;
  if (x.insulation !== "present") return "Typical-size follow-up needs a current existing-insulation estimate.";
  if (x.ownerArea && x.ownerArea > 0) return "Owner has entered a ceiling size; the estimate must be recalculated first.";
  if (x.areaM2 !== DEFAULT_ESTIMATED_AREA_M2) return "Estimate area does not match the typical-size assumption.";
  return null;
}
