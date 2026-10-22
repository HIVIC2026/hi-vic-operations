// Stage 6 (Jo 22 Oct 2026): the automatic checks a finished Ready Check must pass before the portal
// prepares the owner quote. Pure: no database, no network. Every failure is an "Office needs to…" reason
// that goes on the job for the office — the portal never guesses its way past one.
import { contactAnswersFromEntries } from "./mitti.core";

/** A Mitti answer is "given" when it carries anything at all — a blank, "null" or <nil> never counts. */
const answered = (v: unknown): boolean => {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s || s === "null" || s === "<nil>") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
};
const find = (entries: { label: string; value: unknown }[], labels: string[]) =>
  entries.find((e) => labels.some((l) => String(e.label ?? "").trim().toLowerCase() === l.toLowerCase()))?.value ?? null;

/**
 * Ready Check facts straight off the form snapshot. Absent-safe: a question the form never asked is
 * "not established", never a made-up answer. The form cannot prove an R-value, so insulation is only ever
 * true (none / installer confirmed below R2) or null (must be established) — "R2 or above" comes from the office.
 */
export function readyCheckFactsFromEntries(
  entries: { label: string; value: unknown }[],
  opts: { formComplete: boolean; electricianDecided: boolean; priceKnown: boolean },
): ReadyCheckFacts {
  const present = find(entries, ["Is there existing insulation?", "Is there existing insulation in this ceiling area?"]);
  const depthPhoto = answered(find(entries, ["Photo with tape measure showing depth", "Upload a photo clearly showing the measured insulation depth"]));
  const belowR2Tick = answered(find(entries, ["No photo? I confirm the existing insulation is below R2.0 and the home is eligible for the rebate"]));
  const overviewPhoto = answered(find(entries, ["Photo of the empty ceiling space", "Upload an overview photo of this ceiling area"]));
  const insulationYes = /^y/i.test(String(present ?? ""));
  const insulationNo = /^n/i.test(String(present ?? ""));
  return {
    formComplete: opts.formComplete,
    belowR2: insulationNo ? true : belowR2Tick ? true : insulationYes ? null : null,
    lifeSupportReviewed: !/^y/i.test(String(find(entries, ["Life support equipment at property?", "Office life support result"]) ?? "")),
    depthPhoto: depthPhoto || belowR2Tick || insulationNo,
    overviewPhoto: overviewPhoto || insulationYes,
    contactPermission: contactAnswersFromEntries(entries as { label: string; value: string | null }[]).contactPermission,
    electricianDecided: opts.electricianDecided,
    priceKnown: opts.priceKnown,
  };
}

export type ReadyCheckFacts = {
  /** Every required answer on the Mitti form is present (Mitti reports the form finished). */
  formComplete: boolean;
  /** Existing insulation is absent or below R2 (true), R2 or above (false), or not established (null). */
  belowR2: boolean | null;
  /** No life support equipment declared, OR the office has reviewed the declared equipment. */
  lifeSupportReviewed: boolean;
  /** A depth photo (or the installer's below-R2 confirmation tick) is on file. */
  depthPhoto: boolean;
  /** An overview photo of the ceiling space is on file. */
  overviewPhoto: boolean;
  /** Owner's contact permission from the form: yes / no / not asked. Never marketing consent. */
  contactPermission: boolean | null;
  /** The electrician arrangement is decided (Home Insulation Victoria's or the owner's own). */
  electricianDecided: boolean;
  /** The installer's quoted price is recorded. */
  priceKnown: boolean;
};

export type ReadyCheckCompletion = { ready: boolean; reasons: string[] };

/** All failures at once (never just the first), so the office sees the whole picture in one list. */
export function readyCheckCompletionChecks(f: ReadyCheckFacts): ReadyCheckCompletion {
  const reasons: string[] = [];
  if (!f.formComplete) reasons.push("Office needs to: the Ready Check is not finished in Mitti — ask the installer to complete it");
  if (!f.priceKnown) reasons.push("Office needs to: no quoted price on the Ready Check — the installer's total is needed before a quote can be prepared");
  if (!f.electricianDecided) reasons.push("Office needs to: the electrician arrangement isn't decided — confirm whether Home Insulation Victoria or the owner's own electrician does the PIESA");
  if (f.belowR2 === false) reasons.push("Office needs to: existing insulation is R2 or above — this home does not appear eligible; tell the owner");
  if (f.belowR2 === null) reasons.push("Office needs to: the existing insulation level isn't established — get a depth photo or the installer's below-R2 confirmation");
  if (!f.depthPhoto) reasons.push("Office needs to: a photo showing the existing insulation depth (or the below-R2 tick) is missing");
  if (!f.overviewPhoto) reasons.push("Office needs to: an overview photo of the ceiling space is missing");
  if (!f.lifeSupportReviewed) reasons.push("Office needs to: life support equipment is declared and has not been reviewed — review before any quote goes out");
  if (f.contactPermission === false) reasons.push("Office needs to: the owner did not agree to be contacted by Home Insulation Victoria — no quote email or text can be sent");
  if (f.contactPermission === null) reasons.push("Office needs to: the owner's contact permission is not on the form — record it before anything is sent");
  return { ready: reasons.length === 0, reasons };
}
