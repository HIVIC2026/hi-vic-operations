// Resend delivery updates: pure rules. Signature check follows Svix (what Resend uses), event mapping, plain bounce words.
import { createHmac } from "node:crypto";
import { OUR_DOMAINS, type MailMessage } from "./outlook-correspondence.core";
import { isMailSystemSender } from "./owner-email-presentation.core";

export type DeliveryResult = "delivered" | "bounced";

const MAX_AGE_S = 300;

const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

/** Svix scheme: HMAC-SHA256 of `${id}.${timestamp}.${raw}` keyed by the base64 secret after `whsec_`. Any `v1,` entry may match. */
export function verifyResendSignature(raw: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, nowMs: number): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > MAX_AGE_S) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${raw}`).digest("base64");
  return headers.signature.split(/\s+/).some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && !!sig && same(sig, expected);
  });
}

/** Plain-words reason for a bounce. */
export function bounceWords(raw: string | null): string {
  const t = (raw ?? "").toLowerCase();
  if (/user unknown|unknown user|mailbox (not found|unavailable|does not exist)|does not exist|no such (user|mailbox)|address rejected|invalid (recipient|mailbox)/.test(t)) return "Email address doesn't exist";
  if (/mailbox full|over quota|quota exceeded|inbox is full/.test(t)) return "Their inbox is full";
  return "Their email provider refused it";
}

/** `email.delivered` and `email.bounced` become a result; every other event (or one without an email id) is ignored. */
export function resendEventResult(evt: { type: string; data?: { email_id?: string; bounce?: { message?: string; subType?: string } } }): { emailId: string; result: DeliveryResult; detail: string | null } | null {
  const emailId = evt?.data?.email_id;
  if (!emailId) return null;
  if (evt.type === "email.delivered") return { emailId, result: "delivered", detail: null };
  if (evt.type === "email.bounced") return { emailId, result: "bounced", detail: bounceWords(evt.data?.bounce?.message ?? null) };
  return null;
}

/** An Outlook "couldn't be delivered" notice: from the mail system (any direction — Exchange Online sends these from our
 *  own domain, which normalises as outbound), or inbound with a mail-system sender or a bounce-style subject. */
export function isBounceNotice(m: MailMessage): boolean {
  if (isMailSystemSender(m.from)) return true;
  if (m.direction !== "inbound") return false;
  if (/mailer-daemon|postmaster|microsoftexchange/i.test(m.from ?? "")) return true;
  return /^\s*(undeliverable:|delivery status notification \(failure\)|mail delivery failed)/i.test(m.subject ?? "");
}

/** The first address in the notice that is not ours and not the sender: the one that bounced. */
export function bouncedAddress(m: MailMessage): string | null {
  const from = (m.from ?? "").toLowerCase();
  for (const found of m.body.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const e = found[0].toLowerCase().replace(/[.]+$/, "");
    if (e === from || OUR_DOMAINS.some((d) => e.endsWith(`@${d.toLowerCase()}`))) continue;
    return e;
  }
  return null;
}

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

/** Which Outlook reply bounced: sent to that address in the 7 days before the notice; subject match first, else newest. */
export function matchBounce(
  notice: { address: string; at: string; subject: string | null },
  sent: { id: string; to: string; subject: string | null; sentAt: string }[],
): string | null {
  const at = Date.parse(notice.at);
  const address = notice.address.toLowerCase();
  const cands = sent
    .map((s) => ({ s, t: Date.parse(s.sentAt) }))
    .filter(({ s, t }) => s.to.toLowerCase() === address && Number.isFinite(t) && t <= at && at - t <= SEVEN_DAYS_MS)
    .sort((a, b) => b.t - a.t);
  const nSubject = (notice.subject ?? "").toLowerCase();
  const bySubject = cands.find(({ s }) => !!s.subject?.trim() && nSubject.includes(s.subject.trim().toLowerCase()));
  return (bySubject ?? cands[0])?.s.id ?? null;
}

/** workflow_events type written when the office clears the "Email bounced" tag (append-only; the tag compares against the newest). */
export const EMAIL_BOUNCE_CLEARED_EVENT = "email_bounce_cleared";

export type EmailResult = { at: string; result: DeliveryResult | null };

/** The "Email bounced" tag: the newest email with a result bounced, it is newer than the last clear, and nothing delivered since. */
export function emailBouncedNow(sends: EmailResult[], clearedAt: string | null): boolean {
  let newest: { t: number; result: DeliveryResult } | null = null;
  for (const e of sends) {
    if (!e.result) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    if (!newest || t > newest.t) newest = { t, result: e.result };
  }
  if (!newest || newest.result !== "bounced") return false;
  const cleared = clearedAt ? Date.parse(clearedAt) : NaN;
  return !(Number.isFinite(cleared) && newest.t <= cleared);
}

/** Many jobs at once: which of them show the tag. Rows are outbound emails that have a result, plus clear events. */
export function bouncedJobIds(emails: (EmailResult & { jobId: string })[], clears: { jobId: string; at: string }[]): Set<string> {
  const byJob = new Map<string, EmailResult[]>();
  for (const e of emails) byJob.set(e.jobId, [...(byJob.get(e.jobId) ?? []), e]);
  const cleared = new Map<string, string>();
  for (const c of clears) if (!cleared.get(c.jobId) || cleared.get(c.jobId)! < c.at) cleared.set(c.jobId, c.at);
  const out = new Set<string>();
  for (const [id, rows] of byJob) if (emailBouncedNow(rows, cleared.get(id) ?? null)) out.add(id);
  return out;
}
