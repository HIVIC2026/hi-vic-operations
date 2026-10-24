// Jo 23 Oct 2026: new Mitti Ready Check answers (A1 + A2). Pure — no database, no network.
// Reads the flat form snapshot ({label, value}); repeated per-area labels are all scanned.
import { norm, num, yesNo } from "./mitti.core";
import { isNoSafeAccess, isR2OrAbove, LEAN_Q, premisesTypeCode, type PremisesTypeCode } from "./ready-check-lean.core";

type E = { label: string; value: unknown };
const vals = (entries: E[], labels: string[], prefix = false) => {
  const ns = labels.map(norm);
  return entries
    .filter((e) => { const n = norm(e.label); return ns.some((l) => (prefix ? n.startsWith(l) : n === l)); })
    .map((e) => (e.value == null ? null : String(e.value).trim()))
    .filter((v): v is string => !!v && v !== "null" && v !== "<nil>");
};

export const STOP_NO_CONTACT = "Owner hasn't agreed to be contacted – can't proceed";
export const STOP_R2 = "Fails: existing insulation is R2 or above";
export const STOP_LIFE_SUPPORT = "Life support at property – office to check";
export const STOP_BUILT_5 = "Ceiling/roof built or replaced in last 5 years – office to check";
/** Decision 222: "No safe access" on "How would you rate the ceiling access?" ends the Ready Check (no quote). */
export const STOP_NO_SAFE_ACCESS = "No safe access to the ceiling";
/** Hard stops: any one means no quote, and the office list gets the exact reason. */
/** A2 (our leads, Jo 23 Oct): life support and 5-year come from the owner's website answers, never the form. */
export function websiteStopReasons(w: { lifeSupportStatus: string | null; overFiveYears: string | null }): string[] {
  const out: string[] = [];
  if (w.lifeSupportStatus === "yes") out.push(STOP_LIFE_SUPPORT);
  if (w.overFiveYears === "no") out.push(STOP_BUILT_5);
  return out;
}

export function readyCheckStopReasons(entries: E[], opts: { ownerAnsweredOnWebsite?: boolean } = {}): string[] {
  const out: string[] = [];
  if (vals(entries, ["Homeowner agrees to be contacted by Home Insulation Victoria"]).some((v) => yesNo(v) === false)) out.push(STOP_NO_CONTACT);
  // Decision 222: lean option "R2.0 or above" (R2.0 exactly = ineligible); "Above R2.0" on 22–24 Oct forms reads the same.
  if (vals(entries, [LEAN_Q.rValue]).some((v) => isR2OrAbove(v))) out.push(STOP_R2);
  if (vals(entries, [LEAN_Q.access]).some((v) => isNoSafeAccess(v))) out.push(STOP_NO_SAFE_ACCESS);
  if (opts.ownerAnsweredOnWebsite) return out;
  if (vals(entries, ["Life support equipment at property?"]).some((v) => yesNo(v) === true)) out.push(STOP_LIFE_SUPPORT);
  if (vals(entries, ["Was the ceiling or roof built or replaced in the last 5 years?"]).some((v) => yesNo(v) === true)) out.push(STOP_BUILT_5);
  return out;
}

/** Decision 222 question 10 "Who lives at the property?" (Activity Guide Appendix C premises type). Absent → nulls. */
export function premisesTypeFromEntries(entries: E[]): { answer: string | null; code: PremisesTypeCode | null } {
  const answer = vals(entries, [LEAN_Q.premisesType])[0] ?? null;
  return { answer, code: premisesTypeCode(answer) };
}

/** Total of every area's removal answer (m²). Null when no area gave one. */
export function removalTotalM2(entries: E[]): number | null {
  const ns = vals(entries, ["How much existing insulation needs to be removed? (m²)"]).map((v) => num(v)).filter((n): n is number => n != null && n > 0);
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

/** A2 difficult access charge (Ready Check Outcome, Jo 23 Oct): "Is there a difficult access charge?" Yes → amount. */
export function difficultAccessFee(entries: E[]): { amountIncGst: number | null; reason: string | null } {
  const charged = vals(entries, ["Is there a difficult access charge?"]).some((v) => yesNo(v) === true);
  if (!charged) return { amountIncGst: null, reason: null };
  const fees = vals(entries, ["Difficult access fee ($ inc GST)"]).map((v) => num(v));
  if (!fees.length || fees.some((n) => n == null || n <= 0)) return { amountIncGst: null, reason: "Office needs to: confirm the difficult access fee – the amount is missing or not a number" };
  return { amountIncGst: Math.round((fees as number[]).reduce((a, b) => a + b, 0) * 100) / 100, reason: null };
}

/** A1: the installer ticked "Difficult access charge" in "What's included in your quote?" (already inside their total). */
export function a1DifficultAccessIncluded(entries: E[]): boolean {
  return vals(entries, ["What's included in your quote?", "What's included in your price (tick all that apply)"]).some((v) => v.split(/\s*,\s*/).some((x) => /^difficult access( charge)?$/i.test(x.trim())));
}

/** Jo 24 Oct: eligibility is decided from the Mitti form answers (no manual office record). Any reason holds the
 *  quote for the office; an empty list means the form says eligible. Never decides "not eligible" on its own.
 *  (No previous-VEU question: Jo 24 Oct — the rebate is brand new, so not asked yet.) */
export function formEligibilityReasons(entries: E[], opts: { ownerAnsweredOnWebsite?: boolean } = {}): string[] {
  return readyCheckStopReasons(entries, opts);
}
