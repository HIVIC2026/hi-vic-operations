// Part 5b (Jo 1–5 Nov 2026, spec Part 5): ONE "You're clear to install" owner email (plus the existing deposit-request text)
// opening ONE page (?screen=clear) where the owner 1) confirms the safety check happened, 2) signs the rebate consent and
// 3) pays the 10% deposit. The three records/writers already exist (piesa_owner_confirmed, the ESC consent row, the deposit
// invoice/payment path); this file only unifies the ENTRY: Jo's wording, the step states and ONE reminder series (days 1,
// 3, 7 after the request; the day-5 office flag for an unconfirmed safety check stays in piesa-owner-confirm.core).
// PURE: no network, no database. Every email here is a DRAFT behind CLEAR_TO_INSTALL_V2_APPROVED (false): the current
// separate emails keep going until Jo approves this one.
import { cents } from "./email-kit.core";
import { genericMail } from "./mail-mjml.core";
import type { ConfirmSignPayState } from "./confirm-sign-pay.core";

/** OFF until Jo approves the wording one message at a time. */
export const CLEAR_TO_INSTALL_V2_APPROVED = false as boolean;

export type ClearToInstallV2Facts = { firstName: string; address: string; installer: string; amountCents: number; link: string };

export const clearToInstallSubject = (address: string) => `You're clear to install – ${address.trim() || "your home"}`;

/** Jo's body, verbatim (line breaks ours). */
export function clearToInstallLines(f: ClearToInstallV2Facts): string[] {
  const first = f.firstName.trim() || "there";
  return [
    `Hi ${first}, the electrical safety check is done and your ceiling is clear for insulation. Three quick things on one page, then ${f.installer} will call you to book the install day:`,
    "1. Confirm the safety check happened.",
    "2. Sign the rebate consent.",
    `3. Pay your 10% deposit (${cents(f.amountCents / 100)}).`,
  ];
}
const SIGN_OFF = ["Jo", "Home Insulation Victoria"];

export function renderClearToInstallV2(f: ClearToInstallV2Facts): { subject: string; text: string; html: string } {
  const subject = clearToInstallSubject(f.address);
  const lines = clearToInstallLines(f);
  const text = [...lines, f.link, ...SIGN_OFF].join("\n\n");
  const html = genericMail({ subject, heading: subject, lines, button: { url: f.link, label: "Open my page" }, afterButtonHtml: SIGN_OFF.join("<br />"), unsubscribe: "slot" });
  return { subject, text, html };
}

// ---- the page's three steps ----
export type ClearStepKey = "confirm" | "sign" | "pay";
export type ClearStep = { n: 1 | 2 | 3; key: ClearStepKey; label: string; done: boolean };
export const CLEAR_STEP_LABEL: Record<ClearStepKey, string> = { confirm: "Confirm the safety check happened", sign: "Sign the rebate consent", pay: "Pay your 10% deposit" };

/** Each step marks done on its own record: PIESA owner confirmation, ESC consent signature, deposit paid on its invoice. */
export function clearToInstallSteps(s: Pick<ConfirmSignPayState, "piesa" | "consent" | "deposit">): ClearStep[] {
  return [
    { n: 1, key: "confirm", label: CLEAR_STEP_LABEL.confirm, done: s.piesa.done },
    { n: 2, key: "sign", label: CLEAR_STEP_LABEL.sign, done: s.consent.done },
    { n: 3, key: "pay", label: CLEAR_STEP_LABEL.pay, done: s.deposit.paid },
  ];
}
export const allClearStepsDone = (s: Pick<ConfirmSignPayState, "piesa" | "consent" | "deposit">) => clearToInstallSteps(s).every((x) => x.done);

// ---- ONE reminder series ----
/** Days after the request. Replaces the day 1/3 confirm markers + day 3/7 deposit reminders with one series. */
export const CLEAR_TO_INSTALL_REMINDER_DAYS = [1, 3, 7] as const;
export type ClearReminderDay = (typeof CLEAR_TO_INSTALL_REMINDER_DAYS)[number];
/** The office flag for an unconfirmed safety check stays on day 5 (piesa-owner-confirm.core PIESA_CONFIRM_SCHEDULE). */
export const CLEAR_TO_INSTALL_OFFICE_FLAG_DAY = 5;

/** Which reminder is due now: the latest day reached that has not gone, nothing once every step is done, nothing after day 7. */
export function clearToInstallReminderDue(f: { requestedAt: string | null; steps: Pick<ConfirmSignPayState, "piesa" | "consent" | "deposit">; sent: ClearReminderDay[]; now: Date }): ClearReminderDay | null {
  if (!f.requestedAt || !Number.isFinite(Date.parse(f.requestedAt)) || allClearStepsDone(f.steps)) return null;
  const days = (f.now.getTime() - Date.parse(f.requestedAt)) / 86_400_000;
  const newest = Math.max(0, ...f.sent);
  const due = CLEAR_TO_INSTALL_REMINDER_DAYS.filter((d) => d <= days && d > newest);
  return due.length ? due[due.length - 1]! : null;
}

/** DRAFT (Jo approves): the reminder names only what is still to do, in the same three-step order. */
export function renderClearToInstallReminderV2(f: ClearToInstallV2Facts & { day: ClearReminderDay; steps: Pick<ConfirmSignPayState, "piesa" | "consent" | "deposit"> }): { subject: string; text: string; html: string } {
  const first = f.firstName.trim() || "there";
  const left = clearToInstallSteps(f.steps).filter((s) => !s.done);
  if (!left.length) throw new Error("Nothing left to remind about");
  const subject = `Reminder: you're clear to install – ${f.address.trim() || "your home"}`;
  const item = (s: ClearStep) => (s.key === "pay" ? `${s.label} (${cents(f.amountCents / 100)}).` : `${s.label}.`);
  const lines = [
    `Hi ${first}, ${left.length === 1 ? "one quick thing" : `${left.length} quick things`} on one page, then ${f.installer} will call you to book the install day:`,
    ...left.map((s, i) => `${i + 1}. ${item(s)}`),
  ];
  const text = [...lines, f.link, ...SIGN_OFF].join("\n\n");
  const html = genericMail({ subject, heading: subject, lines, button: { url: f.link, label: "Open my page" }, afterButtonHtml: SIGN_OFF.join("<br />"), unsubscribe: "slot" });
  return { subject, text, html };
}
