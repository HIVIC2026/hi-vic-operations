// Decision 216 (Jo 24 Oct): one Contact history panel on every job — every email, text, call and portal message,
// newest first: date · direction · channel · what it was · delivered / failed — plus "Waiting for" and the
// "Last heard from us" header fact. PURE: merges rows the server already read from customer_email_sends,
// job_communications, sms_messages, messages and a few owner actions (enquiry, acceptance, payment). Nothing new is stored.
import { sendLabel } from "./send-failed.core";

export type ContactChannel = "Email" | "Text" | "Phone" | "Portal" | "Outlook" | "Website";
export const CONTACT_CHANNELS: ContactChannel[] = ["Email", "Text", "Phone", "Portal", "Outlook", "Website"];
export type ContactDirection = "sent" | "received" | "call" | "note";

export type ContactRow = {
  id: string; at: string; direction: ContactDirection; channel: ContactChannel;
  what: string; status: string; failed: boolean; byOffice: boolean;
};

export type EmailSendRow = { id: string; purpose: string; status: string; sent_at: string | null; created_at: string; error: string | null; communication_id: string | null };
export type CommRow = { id: string; channel: string; direction: string; subject: string | null; body: string; delivery_status: string; provider: string; sent_at: string | null; received_at: string | null; created_at: string; visibility: string; source_event: string | null };
export type SmsRow = { id: string; message_type: string; status: string; body: string; created_at: string };
export type PortalMessageRow = { id: string; body: string; created_at: string; internal: boolean; sender_label: string | null; channel: string };
export type OwnerActionRow = { id: string; at: string; what: string; channel: ContactChannel };

const FAILED = new Set(["failed", "bounced", "undelivered", "complained"]);
const clip = (s: string | null | undefined, n = 140) => { const v = (s ?? "").replace(/\s+/g, " ").trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
const statusWord = (s: string) => {
  const k = s.toLowerCase();
  if (FAILED.has(k)) return k === "undelivered" ? "Not delivered" : k === "bounced" ? "Bounced" : "Failed";
  if (k === "delivered") return "Delivered";
  if (k === "opened") return "Opened";
  if (k === "sent" || k === "accepted") return "Sent";
  if (k === "recorded" || k === "logged") return "Logged";
  if (["sending", "queued", "sending_unknown", "delivered_unrecorded"].includes(k)) return "Sending";
  return s.replace(/_/g, " ");
};

/** One list, newest first. job_communications rows that mirror a customer_email_sends or sms_messages row are shown once (the send). */
export function mergeContactHistory(i: { emails: EmailSendRow[]; comms: CommRow[]; sms: SmsRow[]; messages: PortalMessageRow[]; ownerActions: OwnerActionRow[] }): ContactRow[] {
  const out: ContactRow[] = [];
  const mirrored = new Set(i.emails.map((e) => e.communication_id).filter(Boolean) as string[]);
  // Every real text writes an sms_messages row (the send, with Twilio's status) AND a job_communications copy
  // (source_event "sms:<type>", same body, seconds later). Show the send once.
  const smsCopy = (c: CommRow) => c.channel === "sms" && c.direction === "outbound" && !!c.source_event?.startsWith("sms:")
    && i.sms.some((s) => `sms:${s.message_type}` === c.source_event && s.body === c.body && Math.abs(Date.parse(s.created_at) - Date.parse(c.created_at)) <= 10 * 60_000);
  for (const e of i.emails) out.push({ id: `email:${e.id}`, at: e.sent_at ?? e.created_at, direction: "sent", channel: "Email", what: sendLabel(e.purpose, "email") + (e.error && FAILED.has(e.status) ? ` — ${clip(e.error, 80)}` : ""), status: statusWord(e.status), failed: FAILED.has(e.status), byOffice: false });
  for (const c of i.comms) {
    if (mirrored.has(c.id) || smsCopy(c)) continue;
    const outbound = c.direction === "outbound";
    const ch: ContactChannel = c.provider === "outlook" ? "Outlook" : c.channel === "sms" ? "Text" : c.channel === "phone" || c.channel === "call" ? "Phone" : c.channel === "note" ? "Phone" : "Email";
    const direction: ContactDirection = c.channel === "phone" || c.channel === "call" ? "call" : c.channel === "note" ? "note" : outbound ? "sent" : "received";
    out.push({ id: `comm:${c.id}`, at: (outbound ? c.sent_at : c.received_at) ?? c.created_at, direction, channel: ch, what: clip(c.subject ? `${c.subject}${c.body ? ` — ${c.body}` : ""}` : c.body), status: statusWord(c.delivery_status), failed: FAILED.has(c.delivery_status), byOffice: c.source_event === "manual_log" || c.source_event === "office_log" });
  }
  for (const s of i.sms) out.push({ id: `sms:${s.id}`, at: s.created_at, direction: "sent", channel: "Text", what: clip(s.body) || sendLabel(s.message_type, "sms"), status: statusWord(s.status), failed: FAILED.has(s.status), byOffice: false });
  for (const m of i.messages) if (!m.internal) out.push({ id: `msg:${m.id}`, at: m.created_at, direction: m.sender_label === "Home Insulation Victoria" ? "sent" : "received", channel: "Portal", what: clip(`${m.sender_label ? `${m.sender_label}: ` : ""}${m.body}`), status: "Recorded", failed: false, byOffice: false });
  for (const a of i.ownerActions) out.push({ id: `owner:${a.id}`, at: a.at, direction: "received", channel: a.channel, what: a.what, status: "Recorded", failed: false, byOffice: false });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}

export const filterContacts = (rows: ContactRow[], channel: ContactChannel | "All") => (channel === "All" ? rows : rows.filter((r) => r.channel === channel));

/** "Last heard from us": the newest thing WE sent or said (email, text, call) that did not fail. */
export function lastHeardFromUs(rows: ContactRow[]): ContactRow | null {
  return rows.find((r) => (r.direction === "sent" || r.direction === "call") && !r.failed && r.status !== "Sending") ?? null;
}

export type WaitingFor = { who: "us" | "owner" | "installer" | "electrician" | "nothing"; text: string };
export const WAITING_LABEL: Record<WaitingFor["who"], string> = { us: "us", owner: "the owner", installer: "the installer", electrician: "the electrician", nothing: "nothing" };

/** Counts per channel for the filter chips. */
export function channelCounts(rows: ContactRow[]): Record<ContactChannel | "All", number> {
  const c = { All: rows.length } as Record<ContactChannel | "All", number>;
  for (const ch of CONTACT_CHANNELS) c[ch] = rows.filter((r) => r.channel === ch).length;
  return c;
}
