// Jo 23 Oct 2026: new Mitti Ready Check answers (A1 + A2). Pure — no database, no network.
// Reads the flat form snapshot ({label, value}); repeated per-area labels are all scanned.
import { norm, num, yesNo } from "./mitti.core";

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
  if (vals(entries, ["What is the determined R value of the existing ceiling insulation?"]).some((v) => /^above\s*r?\s*2/i.test(v))) out.push(STOP_R2);
  if (opts.ownerAnsweredOnWebsite) return out;
  if (vals(entries, ["Life support equipment at property?"]).some((v) => yesNo(v) === true)) out.push(STOP_LIFE_SUPPORT);
  if (vals(entries, ["Was the ceiling or roof built or replaced in the last 5 years?"]).some((v) => yesNo(v) === true)) out.push(STOP_BUILT_5);
  return out;
}

/** Total of every area's removal answer (m²). Null when no area gave one. */
export function removalTotalM2(entries: E[]): number | null {
  const ns = vals(entries, ["How much existing insulation needs to be removed? (m²)"]).map((v) => num(v)).filter((n): n is number => n != null && n > 0);
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

/** Difficult access fee: only when access = Difficult AND the extra-fee question = Yes. */
export function difficultAccessFee(entries: E[]): { amountIncGst: number | null; reason: string | null } {
  const difficult = vals(entries, ["How would you rate the ceiling access?", "How easy is the ceiling access?"]).some((v) => /difficult/i.test(v));
  const charged = vals(entries, ["Is an extra fee being charged for difficult access?"]).some((v) => yesNo(v) === true);
  if (!difficult || !charged) return { amountIncGst: null, reason: null };
  const fees = vals(entries, ["Difficult access fee ($ inc GST)"]).map((v) => num(v));
  if (!fees.length || fees.some((n) => n == null || n <= 0)) return { amountIncGst: null, reason: "Office needs to: confirm the difficult access fee – the amount is missing or not a number" };
  return { amountIncGst: Math.round((fees as number[]).reduce((a, b) => a + b, 0) * 100) / 100, reason: null };
}
