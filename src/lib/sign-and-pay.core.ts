// Part 4 Task 11 (Jo 2 Nov 2026): ?screen=finish — "TWO LAST THINGS": sign the rebate form (the official ESC VEEC assignment form,
// Section 4 Part B) and pay the balance, on one page. PURE rules and wording, no I/O. Wording is Jo's, verbatim from the task brief;
// the full official form wording is behind "View the full form".
import { signingOrderBlocker, type FinalState } from "./assignment.core";
import { shortAud } from "./owner-pages.core";

export const SIGN_AND_PAY = {
  kicker: "TWO LAST THINGS",
  title: "Sign your rebate form and pay your balance",
  step1: "Sign your rebate form",
  step1Sub: "The government's official form (VEEC assignment). It confirms what was installed and lets us claim the rebate you've already had off your price.",
  viewForm: "View the full form (PDF) ›",
  tick: "I've read the form. The details are correct, and I assign the right to create the rebate certificates for this install to Home Insulation Victoria.",
  nameLabel: "Type your full name to sign",
  step2: "Pay your balance",
  dueToday: "due today",
  card: "Sign and pay by card",
  bank: "Sign and pay by bank transfer",
  footer: "Your tax invoice is attached to your email. Once both are done, we'll send your completion pack.",
} as const;

/** Button labels shown to Jo in the sign-off pictures: the approved pair while both steps are open, shorter when one is done. */
export const SIGN_AND_PAY_ONE_STEP = { card: "Pay by card", bank: "Pay by bank transfer", sign: "Sign my rebate form" } as const;

export type SignAndPayState = {
  installedOn: string; product: string; areaM2: number | null; address: string; rebateCents: number;
  /** `blocker` = why the owner can't sign yet (the existing VEEC signing-order guard), null when they can. */
  sign: { done: boolean; signedOn: string | null; blocker: string | null };
  /** `payable` = the balance is the step due now (so the existing invoice/payment guards allow card or bank for it). */
  balance: { amountCents: number; paid: boolean; payable: boolean };
};

export function signAndPayRows(s: SignAndPayState): { label: string; value: string }[] {
  return [
    { label: "Installed", value: s.installedOn },
    { label: "Product", value: s.areaM2 != null && s.areaM2 > 0 ? `${s.product}, ${s.areaM2} m²` : s.product },
    { label: "Address", value: s.address },
    { label: "Rebate (already off your price)", value: shortAud(s.rebateCents / 100) },
  ];
}

export function signAndPayButtons(s: SignAndPayState): { card?: string; bank?: string; sign?: string } {
  const needSign = !s.sign.done, needPay = !s.balance.paid && s.balance.payable;
  if (needSign && needPay) return { card: SIGN_AND_PAY.card, bank: SIGN_AND_PAY.bank };
  if (needPay) return { card: SIGN_AND_PAY_ONE_STEP.card, bank: SIGN_AND_PAY_ONE_STEP.bank };
  if (needSign) return { sign: SIGN_AND_PAY_ONE_STEP.sign };
  return {};
}

/** What still stops the button. Tick and name are only needed while the form is unsigned. First and last name, like the other owner signings. */
export function signAndPayBlockers(i: { tick: boolean; over18: boolean; typedName: string; state: SignAndPayState }): string[] {
  if (i.state.sign.done) return [];
  const out: string[] = [];
  if (!i.tick) out.push("Tick to confirm the form.");
  if (!i.over18) out.push("Tick to confirm you can sign for this home.");
  const typed = i.typedName.trim().replace(/\s+/g, " ");
  if (typed.length < 2 || !/\s/.test(typed)) out.push("Type your full name (first and last) to sign.");
  return out;
}

/** The existing VEEC signing order (assignment.core `signingOrderBlocker`, party "consumer"): the owner signs last, after the Lead
 *  Installer's Part B and the AP's Part A. No form prepared yet = still waiting for the Lead Installer. */
export function consumerSignBlocker(a: Pick<FinalState, "status" | "installerSigned" | "apSigned" | "consumerSigned" | "openVariation"> | null): string | null {
  if (!a) return "Waiting for the lead installer to sign first.";
  return signingOrderBlocker({ ...a, consumerFinalRequired: false, consumerFinalSigned: false }, "consumer");
}
