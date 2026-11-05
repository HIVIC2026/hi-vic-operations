// "Quote sent" email to the installer's business office (Jo 5 Nov 2026 22:45). When the quote for an installer's OWN
// customer (jobs.channel = 'installer_sourced') goes to the owner, the installer's office gets ONE branded email saying the
// quote went out, what it was for, the price, how long it is valid and when Home Insulation Victoria will follow the owner
// up. Design: docs/templates/mjml/installer_quote-sent.mjml (the "Enter your price" layout). HIV leads get nothing.
// Pure: wording, formatting, the plan, the key and the link. No I/O. Sent by installer-quote-sent-email.server.ts.
import { partnerEmailLayout, type PartnerBlock } from "./partner-email.core";

/** APPROVED by Jo 5 Nov 2026 22:45 (branded design). Replaces the unused draft that lived in own-customer-ready-check-copy.core. */
export const INSTALLER_QUOTE_SENT_EMAIL_APPROVED: boolean = true;

/** Recorded ONCE per quote BEFORE the email is sent (details: { key, quote_id, business_id, to }); internal. */
export const INSTALLER_QUOTE_SENT_EVENT = "installer_quote_sent_email" as const;
/** Recorded ONCE per quote when the email is held (flag off / no office email / trade messages paused); internal. */
export const INSTALLER_QUOTE_SENT_HELD_EVENT = "installer_quote_sent_email_held" as const;
/** `customer_email_sends.purpose` for the one attempt per quote. */
export const INSTALLER_QUOTE_SENT_PURPOSE = "installer_quote_sent_email" as const;
/** One attempt per quote, ever (a re-run of the release hook, a retry or a second Send never emails again). */
export const installerQuoteSentKey = (quoteId: string) => `installer-quote-sent:v1:${quoteId}`;
/** The installer's job page (the boss signs in; the quote status card is on it). Same base rule as the "Enter your price" email. */
export const installerQuoteSentLink = (base: string, jobId: string) => `${base.replace(/\/+$/, "")}/field/${jobId}`;

const TZ = "Australia/Melbourne";
/** "Sat 5 Dec 2026" in Melbourne time (the panel line). */
export function quoteSentDayLabel(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`;
}
/** "5 Dec 2026" in Melbourne time (the inbox preview line). */
export function quoteSentShortDayLabel(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}`;
}
/** "$4,850" for whole dollars, "$4,850.50" otherwise. */
export function quoteSentMoney(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(n);
}

export type InstallerQuoteSentFacts = {
  /** The business signer's first name (the greeting); null → "there". */
  recipientFirst: string | null;
  /** The owner's first name; null → "the owner". */
  ownerFirst: string | null;
  ownerFull: string;
  jobNumber: string;
  address: string;
  totalIncGst: number;
  /** Last instant the quote is valid (quote-expiry.core `quoteExpiresAt` − 1 ms). */
  validUntil: Date;
  quoteUrl: string;
  test?: boolean;
};

/** Approved subject: "HV-1234: Quote sent to Sarah". */
export const installerQuoteSentSubject = (jobNumber: string, ownerFirst: string | null) => `${jobNumber}: Quote sent to ${ownerFirst?.trim() || "the owner"}`;

/** The approved copy (Jo 5 Nov 2026 22:45) in the partner email look. "they" — the owner's gender isn't recorded. */
export function renderInstallerQuoteSentEmail(f: InstallerQuoteSentFacts): { subject: string; html: string; text: string; mjml: string } {
  const owner = f.ownerFirst?.trim() || null;
  const subject = installerQuoteSentSubject(f.jobNumber, owner);
  const place = owner ? `${owner}'s place` : "the owner's place";
  const blocks: PartnerBlock[] = [
    { kind: "hi", text: `Hi ${f.recipientFirst?.trim() || "there"},` },
    { kind: "p", text: `The quote for ${place} went out today.` },
    {
      kind: "card", title: `${f.jobNumber} · ${f.ownerFull}`, subtitle: f.address,
      blocks: [
        { kind: "p", text: `Quote: ${quoteSentMoney(f.totalIncGst)} inc GST` },
        { kind: "p", text: `Valid until ${quoteSentDayLabel(f.validUntil)}` },
      ],
    },
    { kind: "p", text: `We'll touch base with ${owner ?? "the owner"} on day 3 and again 2 days before it expires. You'll hear from us the moment they accept or decline.` },
    { kind: "button", label: "See the quote", url: f.quoteUrl },
  ];
  const m = partnerEmailLayout({ subject, heading: "Quote sent.", blocks, preview: `${f.jobNumber} Quote sent — valid until ${quoteSentShortDayLabel(f.validUntil)}`, test: f.test === true });
  return { subject, ...m };
}

export type InstallerQuoteSentPlan =
  | { action: "skip"; reason: string }
  | { action: "done" }
  | { action: "held"; reason: string }
  | { action: "send" | "test_send"; to: string };

/**
 * What to do for this quote. `skip` = never an email for this quote (not an installer's own customer, not an installation
 * quote, not sent, job closed); `done` = an attempt already exists (one per quote, never retried after a send or a
 * failure); `held` = recorded once and retried on a later run; otherwise send to the business office email.
 */
export function installerQuoteSentPlan(p: {
  channel: string | null | undefined; kind: string | null | undefined; sentAt: string | null | undefined; deleted: boolean;
  approved: boolean; test: boolean; officeEmail: string | null | undefined; paused: string | null; alreadyAttempted: boolean;
}): InstallerQuoteSentPlan {
  if (p.channel !== "installer_sourced") return { action: "skip", reason: "not an installer's own customer" };
  if (p.kind !== "installation") return { action: "skip", reason: "not an installation quote" };
  if (!p.sentAt) return { action: "skip", reason: "quote not sent to the owner" };
  if (p.deleted) return { action: "skip", reason: "job closed" };
  if (p.alreadyAttempted) return { action: "done" };
  if (!p.test && !p.approved) return { action: "held", reason: "email wording not approved yet (INSTALLER_QUOTE_SENT_EMAIL_APPROVED)" };
  const to = p.officeEmail?.trim();
  if (!to) return { action: "held", reason: "no office email on file for the installer" };
  if (p.paused) return { action: "held", reason: p.paused };
  return { action: p.test ? "test_send" : "send", to };
}

export const firstNameOf = (full: string | null | undefined): string | null => (full ?? "").trim().split(/\s+/)[0] || null;
