// Decisions 245 + 247 (Jo 24 Oct): matched Outlook mail that asks for a change raises a Needs me row
// "Owner asks to … → Apply / Ignore"; mail the copier cannot match raises "Match this email" (Match / Not a customer).
// Nothing changes on a job without the office's tap. PURE: classifies the workflow events the Outlook copier writes
// (event types below, written by the backend) and the office's resolution events. Renders nothing when there are none.
//
// Event contract (workflow_events; job_id is required by the table):
//  email_change_request  job_id = the matched job. details: { message_id, from, subject, received_at, kind, summary?, excerpt?, proposed? }
//                         kind: cancel | day_change | contact_details | document | other; proposed: { phone?, email? } for contact_details.
//  email_unmatched       job_id = the copier's best-guess job. details: { message_id, from, subject, received_at, excerpt?, guess_reason?, no_guess? }
//                         no_guess: true = job_id is only a placeholder; the row shows "No guess".
//  email_change_request_resolved  details: { request_event_id, message_id?, decision: applied | ignored }   (written by the office tap)
//  email_unmatched_resolved       details: { source_event_id, message_id?, decision: matched | not_customer, job_id? }

export const EMAIL_CHANGE_REQUEST_EVENT = "email_change_request";
export const EMAIL_UNMATCHED_EVENT = "email_unmatched";
export const EMAIL_CHANGE_RESOLVED_EVENT = "email_change_request_resolved";
export const EMAIL_UNMATCHED_RESOLVED_EVENT = "email_unmatched_resolved";
export const EMAIL_ASK_EVENT_TYPES = [EMAIL_CHANGE_REQUEST_EVENT, EMAIL_UNMATCHED_EVENT, EMAIL_CHANGE_RESOLVED_EVENT, EMAIL_UNMATCHED_RESOLVED_EVENT] as const;

export type ChangeKind = "cancel" | "day_change" | "contact_details" | "document" | "other";
export const CHANGE_KINDS: ChangeKind[] = ["cancel", "day_change", "contact_details", "document", "other"];
/** What the Needs me line says (decision 245 wording "Owner asks to …"). */
export const CHANGE_LINE: Record<ChangeKind, string> = {
  cancel: "Owner asks to cancel",
  day_change: "Owner can't make the day",
  contact_details: "Owner asks to change contact details",
  document: "Owner sent a photo or document",
  other: "Owner asks for a change",
};
/** What Apply does (the office tap). Only contact details are applied by the portal itself; the rest open the job's own guarded action. */
export const APPLY_ACTION: Record<ChangeKind, "update_contact" | "open_cancel" | "open_job"> = {
  cancel: "open_cancel", day_change: "open_job", contact_details: "update_contact", document: "open_job", other: "open_job",
};

export type AskEvent = { id: string; job_id: string; event_type: string; created_at: string; details: unknown };

export type ChangeAskRow = {
  eventId: string; jobId: string; at: string; kind: ChangeKind; line: string; from: string | null; subject: string | null; excerpt: string | null;
  proposed: { phone?: string; email?: string } | null; apply: (typeof APPLY_ACTION)[ChangeKind];
};
export type UnmatchedRow = { eventId: string; guessJobId: string | null; at: string; from: string | null; subject: string | null; excerpt: string | null; guessReason: string | null; line: string };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const clip = (s: string | null, n = 90) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isPhone = (s: string) => /^\+?[\d\s()-]{8,16}$/.test(s);

/**
 * Open rows only: a request is closed by its resolution event (by event id, else by message id). Duplicate events for the
 * same message (copier retries) show once — the newest. Oldest first so the longest-waiting email is on top.
 */
export function openEmailAsks(events: AskEvent[]): { changes: ChangeAskRow[]; unmatched: UnmatchedRow[] } {
  const resolvedIds = new Set<string>(), resolvedMsgs = new Set<string>();
  for (const e of events) {
    if (e.event_type !== EMAIL_CHANGE_RESOLVED_EVENT && e.event_type !== EMAIL_UNMATCHED_RESOLVED_EVENT) continue;
    const d = obj(e.details);
    const ref = str(d["request_event_id"]) ?? str(d["source_event_id"]);
    if (ref) resolvedIds.add(ref);
    const msg = str(d["message_id"]);
    if (msg) resolvedMsgs.add(msg);
  }
  const latest = new Map<string, AskEvent>();
  for (const e of events) {
    if (e.event_type !== EMAIL_CHANGE_REQUEST_EVENT && e.event_type !== EMAIL_UNMATCHED_EVENT) continue;
    const msg = str(obj(e.details)["message_id"]);
    const key = `${e.event_type}:${msg ?? e.id}`;
    const cur = latest.get(key);
    if (!cur || cur.created_at < e.created_at) latest.set(key, e);
  }
  const changes: ChangeAskRow[] = [], unmatched: UnmatchedRow[] = [];
  for (const e of latest.values()) {
    const d = obj(e.details);
    const msg = str(d["message_id"]);
    if (resolvedIds.has(e.id) || (msg && resolvedMsgs.has(msg))) continue;
    const at = str(d["received_at"]) ?? e.created_at;
    if (e.event_type === EMAIL_CHANGE_REQUEST_EVENT) {
      const kind = (CHANGE_KINDS as string[]).includes(String(d["kind"])) ? (d["kind"] as ChangeKind) : "other";
      const p = obj(d["proposed"]);
      const phone = str(p["phone"]), email = str(p["email"]);
      const proposed = kind === "contact_details" && ((phone && isPhone(phone)) || (email && isEmail(email))) ? { ...(phone && isPhone(phone) ? { phone } : {}), ...(email && isEmail(email) ? { email } : {}) } : null;
      // Contact details with nothing usable cannot be applied by the portal: the office opens the job instead.
      const apply = kind === "contact_details" && !proposed ? "open_job" : APPLY_ACTION[kind];
      const summary = str(d["summary"]);
      changes.push({ eventId: e.id, jobId: e.job_id, at, kind, line: summary ?? CHANGE_LINE[kind], from: str(d["from"]), subject: str(d["subject"]), excerpt: clip(str(d["excerpt"])), proposed, apply });
    } else {
      const guess = d["no_guess"] === true ? null : e.job_id;
      unmatched.push({ eventId: e.id, guessJobId: guess, at, from: str(d["from"]), subject: str(d["subject"]), excerpt: clip(str(d["excerpt"])), guessReason: str(d["guess_reason"]), line: `Email from ${str(d["from"]) ?? "an unknown sender"}${str(d["subject"]) ? ` · “${clip(str(d["subject"]), 60)}”` : ""}` });
    }
  }
  changes.sort((a, b) => a.at.localeCompare(b.at));
  unmatched.sort((a, b) => a.at.localeCompare(b.at));
  return { changes, unmatched };
}
