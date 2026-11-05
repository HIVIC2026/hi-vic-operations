// G7 (Jo 4 Nov 2026, pack 2 batch 4): a Ready Check can be booked with "Not sure yet" for who's going. The person is
// picked on the job page by 5pm the day before; the Mitti Ready Check form is made when the person is picked (not at
// booking). Not picked by 5pm the day before → ONE email to the installer's office (DRAFT, behind
// READY_CHECK_PERSON_EMAIL_APPROVED) and a Home Insulation Victoria "Needs me" row. No text to the boss. PURE: wording,
// keys, the 5pm rule, the pending/picked state from the job's events. The sweep is ready-check-person.server.
import { partnerEmailLayout } from "./partner-email.core";
import { VISIT_ALLOCATED_EVENT } from "./visit-allocation.core";

/** DRAFT wording: nothing reaches a real installer office until Jo approves the rendered email. */
export const READY_CHECK_PERSON_EMAIL_APPROVED = true as boolean; // ON 5 Nov 2026 10:52
/** Written by commit_in_house_visit (v2) when a Ready Check is booked with no person; names the booking. */
export const READY_CHECK_PERSON_PENDING_EVENT = "ready_check_person_pending" as const;
/** Recorded once per key BEFORE a send (TEST or real). */
export const READY_CHECK_PERSON_EMAIL_EVENT = "ready_check_person_email" as const;
/** Recorded once per key when a real send is held (flag off / comms off / trade pause / sender refused); never claims the key. */
export const READY_CHECK_PERSON_HELD_EVENT = "ready_check_person_held" as const;
/** The office row (needs_office) — one per booking; cleared once the booking is no longer the confirmed one or a person is picked. */
export const READY_CHECK_PERSON_MISSING_EVENT = "ready_check_person_missing" as const;

export const readyCheckPersonKey = (jobId: string, bookingId: string) => `ready-check-person:v1:${jobId}:${bookingId}`;

// Installer-facing words (Jo's own words, 4 Nov 2026 19:58).
export const READY_CHECK_PERSON_WORDS = {
  notSureYet: "Not sure yet", // Jo 4 Nov 2026 — the extra "Who's going" option
  pickBy: "Pick who's going by 5pm the day before", // Jo 4 Nov 2026 — the Next step line while nobody is picked
  pickButton: "Pick who's going", // Jo's phrase; the button under the person dropdown
  /** The Next step line's "Ready Check · {when}" row gets this second row while nobody is picked. */
  nobodyYet: "Who's going: not picked yet", // DRAFT
} as const;

const TZ = "Australia/Melbourne";
const parts = (iso: string, o: Intl.DateTimeFormatOptions) => {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).formatToParts(new Date(iso))) p[x.type] = x.value;
  return p;
};
/** The visit's Melbourne day (YYYY-MM-DD). */
export function readyCheckYmd(startIso: string): string {
  const p = parts(startIso, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
}
/** 5pm Melbourne on the day before the visit, as an ISO instant. */
export function pickPersonDeadline(startIso: string): string {
  const ymd = readyCheckYmd(startIso);
  const [y, m, d] = ymd.split("-").map(Number);
  // Noon UTC on the previous calendar day is always inside that Melbourne day (UTC+10/+11); find its Melbourne 5pm.
  const probe = new Date(Date.UTC(y!, m! - 1, d! - 1, 12));
  const mel = parts(probe.toISOString(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const offsetMin = (Date.UTC(Number(mel["year"]), Number(mel["month"]) - 1, Number(mel["day"]), Number(mel["hour"]), Number(mel["minute"])) - probe.getTime()) / 60_000;
  return new Date(Date.UTC(y!, m! - 1, d! - 1, 17, 0) - offsetMin * 60_000).toISOString();
}
/** "send" from 5pm the day before until the visit starts; "wait" before; "too_late" once the visit has started. */
export function personEmailDue(f: { startIso: string; now: Date }): "send" | "wait" | "too_late" {
  const now = f.now.getTime();
  if (now >= Date.parse(f.startIso)) return "too_late";
  return now >= Date.parse(pickPersonDeadline(f.startIso)) ? "send" : "wait";
}
/** "Thu 12 Nov, 9:00am" (Melbourne). */
export function readyCheckWhen(startIso: string): string {
  const p = parts(startIso, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const h = Number(p["hour"]) % 24, m = Number(p["minute"]);
  return `${p["weekday"]} ${p["day"]} ${p["month"]}, ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** The pending / picked state of the confirmed Ready Check booking from the job's events (append-only, newest wins):
 *  pending = the booking was made with "Not sure yet" and nobody has been put on it since. `name` = who's going when picked. */
export function readyCheckPersonState(events: { event_type: string; details: unknown; created_at: string }[], bookingId: string | null): { pending: boolean; name: string | null } {
  if (!bookingId) return { pending: false, name: null };
  const pend = events.filter((e) => e.event_type === READY_CHECK_PERSON_PENDING_EVENT && (e.details as { booking_id?: unknown } | null)?.booking_id === bookingId).map((e) => e.created_at).sort().pop() ?? null;
  const alloc = events.filter((e) => e.event_type === VISIT_ALLOCATED_EVENT && (e.details as { visit?: unknown } | null)?.visit === "ready_check").sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const name = alloc ? String((alloc.details as { worker_name?: unknown }).worker_name ?? "") || null : null;
  if (!pend) return { pending: false, name };
  if (alloc && alloc.created_at > pend) return { pending: false, name };
  return { pending: true, name: null };
}

// DRAFT email — subject is Jo's (4 Nov 2026 19:58); the three body lines are drafts for her.
export const READY_CHECK_PERSON_EMAIL = {
  subject: (jobNumber: string) => `${jobNumber}: who's doing the Ready Check tomorrow?`, // Jo 4 Nov 2026
  line1: (address: string, when: string) => `The Ready Check at ${address} is booked for ${when}, and nobody's been picked to go yet.`, // DRAFT
  line2: "Pick who's going on the job page and we'll set up their Mitti form.", // DRAFT
  button: "Open the job", // existing partner-email button words
} as const;
export function renderReadyCheckPersonEmail(i: { jobNumber: string; address: string; startIso: string; jobUrl: string; test?: boolean }): { subject: string; html: string; text: string } {
  const subject = READY_CHECK_PERSON_EMAIL.subject(i.jobNumber);
  const out = partnerEmailLayout({
    subject, test: i.test ?? false,
    blocks: [
      { kind: "p", text: READY_CHECK_PERSON_EMAIL.line1(i.address, readyCheckWhen(i.startIso)) },
      { kind: "p", text: READY_CHECK_PERSON_EMAIL.line2 },
      { kind: "button", label: READY_CHECK_PERSON_EMAIL.button, url: i.jobUrl },
    ],
  });
  return { subject, html: out.html, text: out.text };
}

/** Home Insulation Victoria "Needs me" row (Jo's words, 4 Nov 2026). */
export const readyCheckPersonMissingLine = (address: string) => `Ready Check tomorrow at ${address} — nobody picked yet`;
