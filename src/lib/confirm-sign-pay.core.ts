// Part 4 Task 5 (Jo 2 Nov 2026, answers 10 and 21): ONE page (?screen=clear) — confirm the electrical safety check (PIESA owner
// declarations), sign the ESC consent (official Section 2 ticks) and pay the 10% deposit. PURE rules and wording, no I/O.
// Wording below is Jo's, verbatim from the task brief; the PIESA/consent tick lines are the official form text.
import { installDepositDueNow } from "./payments.core";
import { depositOpenAfterPiesa, type PiesaOutcome } from "./piesa-result-route.core";
import type { PiesaOutcomeKind } from "./piesa-owner-confirm.core";

export const CONFIRM_SIGN_PAY = {
  kicker: "ONE LAST STEP",
  title: "Confirm, sign and pay your deposit",
  step1: "Confirm your safety check",
  step2: "Sign the government consent form",
  step2Sub: "The law says we must tell the Essential Services Commission about every install before it happens. This is the Commission's own form.",
  step3: "Pay your 10% deposit",
  nameLabel: "Type your full name to sign steps 1 and 2",
  card: "Sign and pay by card",
  bank: "Sign and pay by bank transfer",
  /** DRAFT (fix round 1, Jo to approve): the consent-only page's one button. */
  signOnly: "Sign",
  viewForm: "View the full form ›",
} as const;

/** The single PIESA tick. `checkedOnLong` is e.g. "7 November". */
export const piesaConfirmTick = (checkedOnLong: string) =>
  `I confirm the electrical safety check was done on ${checkedOnLong}. I understand that anyone going into the ceiling before the install may void it, and that this form goes to my installer and may go to the Essential Services Commission.`;

export const confirmSignPayFooter = (installer: string, installBy: string) =>
  `Then ${installer} will call you to book your install day. Install by ${installBy}.`;

/** DRAFT (Jo approves): the Result row. "Safe to insulate" for all clear; the upgrades wording when upgrades are still to come. */
export const RESULT_SAFE = "Safe to insulate";
export const RESULT_UPGRADES = "Electrical upgrades needed";
export const piesaResultLabel = (kind: PiesaOutcomeKind): typeof RESULT_SAFE | typeof RESULT_UPGRADES => (kind === "all_clear" ? RESULT_SAFE : RESULT_UPGRADES);

export type ConfirmSignPayState = {
  piesa: { checkedOn: string; electrician: string; result: typeof RESULT_SAFE | typeof RESULT_UPGRADES; done: boolean };
  consent: { name: string; address: string; phone: string; email: string; done: boolean; signedOn: string | null };
  deposit: { amountCents: number; paid: boolean };
};

export type ConfirmSignPayBlockerInput = { piesaTick: boolean; consentTicks: [boolean, boolean, boolean, boolean]; typedName: string; state: ConfirmSignPayState };

/** What still stops the button. Ticks are only needed for steps not already done (in-flight owners signed one at acceptance / on the old PIESA page). */
export function confirmSignPayBlockers(i: ConfirmSignPayBlockerInput): string[] {
  const out: string[] = [];
  const needPiesa = !i.state.piesa.done, needConsent = !i.state.consent.done;
  if (needPiesa && !i.piesaTick) out.push("Tick to confirm your safety check.");
  if (needConsent && i.consentTicks.some((t) => t !== true)) out.push("Tick all four boxes on the consent form.");
  // Same rule as validateOwnerPiesaConfirmation: first and last name.
  const typed = i.typedName.trim().replace(/\s+/g, " ");
  if ((needPiesa || needConsent) && (typed.length < 2 || !/\s/.test(typed))) out.push("Type your full name (first and last) to sign.");
  return out;
}

/** Jo 2 Nov, answer 21: the page opens straight after the PIESA result (whatever it found) while the deposit is unpaid, and
 *  stays open while the owner's ESC consent or PIESA confirmation is unsigned, even if the deposit is already paid. */
export function clearScreenOpen(f: { stage: string; outcome: PiesaOutcome | null; safetyCleared: boolean; depositCleared: boolean; depositCents: number; unsigned?: boolean }): boolean {
  return installDepositDueNow(f.stage) && depositOpenAfterPiesa({ outcome: f.outcome }) && f.safetyCleared && f.depositCents > 0 && (!f.depositCleared || f.unsigned === true);
}

/** "clear" only when the page's own state actually loaded. No state (no consent row, missing facts) = the old pay / piesa screens, never a dead end. */
export const clearAction = (open: boolean, state: ConfirmSignPayState | null): "clear" | null => (open && state ? "clear" : null);
export const stepsUnsigned = (s: ConfirmSignPayState) => !s.piesa.done || !s.consent.done;

// ---- Part 4 Task 14 fix round 1: no ESC consent dead end ----
/** When the pay page would not open (or its state failed to load) but an ESC consent row is still awaiting the owner, the same
 *  page opens as a consent-only page so the owner can still sign the Reg 23A consent: no deposit step, no PIESA step without a PIESA. */
export const consentOnlyOpen = (f: { clearOpen: boolean; consentAwaitingOwner: boolean }) => !f.clearOpen && f.consentAwaitingOwner;
/** The same state with the deposit step taken out (shown as none; the pay buttons give way to one Sign button). */
export const withNoDeposit = (s: ConfirmSignPayState): ConfirmSignPayState => ({ ...s, deposit: { amountCents: 0, paid: false } });
export const hasDepositStep = (s: ConfirmSignPayState) => s.deposit.amountCents > 0;
/** No PIESA on the job yet: nothing to confirm, the step is not shown. */
export const consentOnlyPiesa = (): ConfirmSignPayState["piesa"] => ({ checkedOn: "", electrician: "", result: RESULT_SAFE, done: true });
export const hasPiesaStep = (p: ConfirmSignPayState["piesa"]) => p.checkedOn !== "";

/** The official Section 2 lines are shown as the form words them: a full stop is added only where the form has none, except the third line, which the form ends without one. */
export const consentTickLine = (key: string, text: string) => (key === "consent_ap_sends" || /[.]$/.test(text.trim()) ? text : `${text}.`);
