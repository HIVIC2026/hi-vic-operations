// New job flow, Part 9, Task 12: complaints (VEU Code of Conduct) — acknowledge within 5 business days, aim to resolve
// within 20. Office process only: the office records when a complaint came in, when it acknowledged it (by hand — no
// approved automatic owner wording) and when it was resolved, as job events; these PURE rules turn them into the two
// office rows. Business days = the shared Melbourne calendar (melbourne-time.core `addMelbourneBusinessDays`).
import { addMelbourneBusinessDays } from "./melbourne-time.core";

export const COMPLAINT_RECEIVED_EVENT = "complaint_received";
export const COMPLAINT_ACKNOWLEDGED_EVENT = "complaint_acknowledged";
export const COMPLAINT_RESOLVED_EVENT = "complaint_resolved";
export const COMPLAINT_ACK_BUSINESS_DAYS = 5;
export const COMPLAINT_RESOLVE_BUSINESS_DAYS = 20;
/** The ack row opens this many business days before ack-by; the resolve row this many before resolve-by. */
const ACK_ROW_LEAD_DAYS = 1;
const RESOLVE_ROW_LEAD_DAYS = 3;

export type ComplaintChannel = "phone" | "email" | "text" | "in_person" | "other";
export type ComplaintEvent = { event_type: string; created_at: string; details?: Record<string, unknown> | null };
export type ComplaintCode = "complaint_ack_due" | "complaint_resolve_due";
export type ComplaintNeed = { code: ComplaintCode; since: string; dueBy: string; urgency: "today" | "urgent" };
export type ComplaintState = { receivedAt: string; channel: string | null; summary: string | null; acknowledgedAt: string | null; resolvedAt: string | null; ackBy: string; resolveBy: string };

/** Ack-by and resolve-by (end of the Melbourne business day) from when the complaint came in. */
export function complaintDue(receivedAt: string): { ackBy: string; resolveBy: string } {
  return { ackBy: addMelbourneBusinessDays(receivedAt, COMPLAINT_ACK_BUSINESS_DAYS), resolveBy: addMelbourneBusinessDays(receivedAt, COMPLAINT_RESOLVE_BUSINESS_DAYS) };
}

const ms = (iso: string) => Date.parse(iso);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The latest complaint on the job and what has happened to it since (events before it belong to an earlier complaint). */
export function complaintState(events: ComplaintEvent[]): ComplaintState | null {
  const sorted = [...events].filter((e) => Number.isFinite(ms(e.created_at))).sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const idx = sorted.map((e) => e.event_type).lastIndexOf(COMPLAINT_RECEIVED_EVENT);
  if (idx < 0) return null;
  const r = sorted[idx]!;
  const receivedAt = str(r.details?.["received_at"]) && Number.isFinite(ms(String(r.details?.["received_at"]))) ? String(r.details?.["received_at"]) : r.created_at;
  const after = sorted.slice(idx + 1);
  const acknowledgedAt = after.find((e) => e.event_type === COMPLAINT_ACKNOWLEDGED_EVENT)?.created_at ?? null;
  const resolvedAt = after.find((e) => e.event_type === COMPLAINT_RESOLVED_EVENT)?.created_at ?? null;
  return { receivedAt, channel: str(r.details?.["channel"]), summary: str(r.details?.["summary"]), acknowledgedAt, resolvedAt, ...complaintDue(receivedAt) };
}

/** The office rows open right now: `complaint_ack_due` from 1 business day before ack-by until acknowledged (urgent once
 *  past), `complaint_resolve_due` from 3 business days before resolve-by until resolved. */
export function complaintNeeds(events: ComplaintEvent[], now: number): ComplaintNeed[] {
  const s = complaintState(events);
  if (!s) return [];
  const out: ComplaintNeed[] = [];
  const ackFrom = ms(addMelbourneBusinessDays(s.receivedAt, COMPLAINT_ACK_BUSINESS_DAYS - ACK_ROW_LEAD_DAYS - 1)) + 1;
  if (!s.acknowledgedAt && now >= ackFrom) out.push({ code: "complaint_ack_due", since: s.receivedAt, dueBy: s.ackBy, urgency: now > ms(s.ackBy) ? "urgent" : "today" });
  const resolveFrom = ms(addMelbourneBusinessDays(s.receivedAt, COMPLAINT_RESOLVE_BUSINESS_DAYS - RESOLVE_ROW_LEAD_DAYS - 1)) + 1;
  if (!s.resolvedAt && now >= resolveFrom) out.push({ code: "complaint_resolve_due", since: s.receivedAt, dueBy: s.resolveBy, urgency: "today" });
  return out;
}

/** "Fri 6 Nov" for a due instant, in Melbourne time. */
export function complaintDueDay(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p["weekday"]} ${p["day"]} ${p["month"]}`;
}

/** Needs me line per row (office-only wording). */
export function complaintNeedsLine(n: Pick<ComplaintNeed, "code" | "dueBy" | "urgency">): string {
  const day = complaintDueDay(n.dueBy);
  if (n.code === "complaint_ack_due") return n.urgency === "urgent" ? `Complaint — acknowledgement overdue (was due ${day})` : `Complaint — acknowledge by ${day}`;
  return `Complaint — aim to resolve by ${day}`;
}
