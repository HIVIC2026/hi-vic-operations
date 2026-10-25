// Decision 333 (Jo, 25 Oct 2026): safety check (PIESA) times work like install days — "I want the electrician to offer
// the times and the owner chooses, just like installer." Pure rules only. Mirrors install-days.core / ready-check-times.core:
// once the PIESA offer is accepted the ELECTRICIAN offers the owner 3 times on 3 different days (within 24 hours of
// accepting — the D93 offer text "Offer the owner 3 times within 24 hours"); the owner taps one (booked) or suggests
// 1–5 days of their own; the electrician takes one of those at an arrival time they choose (booked) or offers 3 new
// times — back and forth until agreed, no office step. Agreement books through confirmBooking(kind "assessment").
// Decision 307 stays: the owner can't take a time (or suggest days) until the 30-day box is ticked for this PIESA cycle.
// Old jobs that started the old way (the owner picked 3–5 windows, piesa_window_round set) still finish the old way:
// those rows are never read as this flow's times, and the old picker only reopens for a job that already has a round.
// Storage: appointment_proposals (kind assessment, note PIESA_TIME_NOTE) — no new table or column.
import { formatInstallDay, installStartAt } from "./install-days.core";
import { PIESA_HORIZON_DAYS, isBusinessDay, melbourneYmd } from "./piesa-windows.core";
import { thirtyDayAckBlocker } from "./thirty-day-ack.core";

/** appointment_proposals.note marker for this flow's rows (kind assessment). */
export const PIESA_TIME_NOTE = "piesa_time";
/** The electrician offers this many times, each on a different day. */
export const PIESA_OFFER_TIMES = 3;
/** The owner may suggest 1–5 days of their own. */
export const PIESA_OWNER_SUGGEST_MAX = 5;
/** Every offered or taken time is at least this far away. */
export const PIESA_TIME_LEAD_HOURS = 24;
/** The electrician offers within this many hours of accepting the job (D93 text; the 24h coordination reminder chases it). */
export const PIESA_OFFER_WITHIN_HOURS = 24;
/** Same 3-week horizon the owner's old PIESA windows used. */
export const PIESA_TIMES_HORIZON_DAYS = PIESA_HORIZON_DAYS;

/** Normal hours: arrival 8am–3pm Melbourne (the visit fits inside the 8am–4pm safety check day used everywhere). */
export const PIESA_TIMES = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00"] as const;
export type PiesaTime = (typeof PIESA_TIMES)[number];
export const isPiesaTime = (t: unknown): t is PiesaTime => typeof t === "string" && (PIESA_TIMES as readonly string[]).includes(t);
/** Owner-suggested days are stored at the first arrival time; the electrician sets the real time when taking one. */
export const OWNER_DAY_ANCHOR_TIME: PiesaTime = "08:00";

export const piesaStartAt = (ymd: string, time: string): Date => installStartAt(ymd, time);
/** "Tuesday 27 October at 8:30am"; owner-suggested days show the day only. */
export const formatPiesaTime = (startIso: string, withTime = true) => formatInstallDay(startIso, withTime);

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days that can be offered or suggested: business days with at least one time 24h+ away, within the horizon. */
export function allowedPiesaTimeDays(now: Date = new Date()): string[] {
  const out: string[] = [];
  const today = melbourneYmd(now);
  const lead = now.getTime() + PIESA_TIME_LEAD_HOURS * 3_600_000;
  const last = PIESA_TIMES[PIESA_TIMES.length - 1]!;
  for (let i = 0; i <= PIESA_TIMES_HORIZON_DAYS; i++) {
    const d = addDays(today, i);
    if (!isBusinessDay(d)) continue;
    if (piesaStartAt(d, last).getTime() < lead) continue;
    out.push(d);
  }
  return out;
}

/** Times on a day that are still 24h+ away. */
export function allowedPiesaTimes(day: string, now: Date = new Date()): PiesaTime[] {
  const lead = now.getTime() + PIESA_TIME_LEAD_HOURS * 3_600_000;
  return PIESA_TIMES.filter((t) => piesaStartAt(day, t).getTime() >= lead);
}

export type PiesaTimePick = { day: string; time: string };

/** Electrician's offer: exactly 3 times, each on a different allowed day, each inside normal hours and 24h+ away. */
export function electricianPiesaTimesBlockers(picks: PiesaTimePick[], now: Date = new Date()): string[] {
  const b: string[] = [];
  const allowed = allowedPiesaTimeDays(now);
  if (picks.length !== PIESA_OFFER_TIMES) b.push(`Please choose ${PIESA_OFFER_TIMES} times.`);
  if (new Set(picks.map((p) => p.day)).size !== picks.length) b.push("Please choose each time on a different day.");
  if (picks.some((p) => !isPiesaTime(p.time))) b.push("Please choose a time between 8am and 3pm for each day.");
  if (picks.some((p) => !allowed.includes(p.day))) b.push("One of those days is no longer available. Please choose again.");
  else if (picks.some((p) => isPiesaTime(p.time) && !allowedPiesaTimes(p.day, now).includes(p.time))) b.push("Each time must be at least 24 hours away.");
  return b;
}

/** Owner: none of the electrician's times suit → 1–5 days of their own (the electrician then picks the time). */
export function ownerPiesaDaysBlockers(days: string[], now: Date = new Date()): string[] {
  const b: string[] = [];
  const allowed = allowedPiesaTimeDays(now);
  const uniq = new Set(days);
  if (uniq.size !== days.length) b.push("Each day can only be chosen once.");
  if (uniq.size < 1) b.push("Please choose at least 1 day.");
  if (uniq.size > PIESA_OWNER_SUGGEST_MAX) b.push(`Please choose no more than ${PIESA_OWNER_SUGGEST_MAX} days.`);
  if ([...uniq].some((d) => !allowed.includes(d))) b.push("One of those days is no longer available. Please choose again.");
  return b;
}

/** Electrician takes one of the owner's days at an arrival time inside normal hours, 24h+ away. */
export function electricianTakeDayBlocker(day: string, time: string, now: Date = new Date()): string | null {
  if (!isPiesaTime(time)) return "Please choose a time between 8am and 3pm.";
  if (!allowedPiesaTimes(day, now).includes(time)) return "The time must be at least 24 hours away.";
  return null;
}

export type PiesaProposalRow = {
  id: string; proposer_role: string | null; status: string; starts_at: string;
  note?: string | null; piesa_window_round?: number | null; electrician_window?: boolean | null; install_day?: boolean | null;
};

/** Rows that belong to this flow: kind assessment, not the owner's old windows (round), not fixes windows, not install days.
 *  Old single times from the old "propose a time" panel read the same way (read both): an electrician's time is the
 *  owner's to answer, an owner's time is the electrician's. */
export function isPiesaTimeRow(r: PiesaProposalRow): boolean {
  return r.piesa_window_round == null && !r.electrician_window && !r.install_day;
}

export type PiesaTimeTurn = "booked" | "no_electrician" | "legacy_owner_windows" | "electrician_to_offer" | "owner_to_answer" | "electrician_to_answer";

/** Whose move it is. Open = still proposed and not yet passed. */
export function piesaTimeTurn(i: { booked: boolean; hasElectrician: boolean; legacyOwnerWindowsOpen: number; rows: PiesaProposalRow[]; now?: Date }): { turn: PiesaTimeTurn; open: PiesaProposalRow[] } {
  const now = (i.now ?? new Date()).getTime();
  const open = i.rows.filter((r) => isPiesaTimeRow(r) && r.status === "proposed" && Date.parse(r.starts_at) > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (i.booked) return { turn: "booked", open: [] };
  // Old way (before 25 Oct): the owner's windows are with the electricians; the first to take one books it.
  if (!i.hasElectrician) return { turn: i.legacyOwnerWindowsOpen > 0 ? "legacy_owner_windows" : "no_electrician", open: [] };
  const elec = open.filter((r) => r.proposer_role === "electrician");
  if (elec.length) return { turn: "owner_to_answer", open: elec };
  if (open.length) return { turn: "electrician_to_answer", open };
  return { turn: "electrician_to_offer", open: [] };
}

/** The owner's old 3–5 window picker opens only for a job that already started the old way (a round exists) and was
 *  asked for more times or had its times reopened. New jobs never see it: the electrician offers the times. */
export function oldOwnerPickerOpen(i: { round: number; moreTimesAsked: boolean; reopened: boolean }): boolean {
  if (i.round < 1) return false;
  return (i.round === 1 && i.moreTimesAsked) || i.reopened;
}

/** Owner taking a time or suggesting days: only on their move, and only once the 30-day box is ticked (decision 307). */
export function ownerPiesaMoveBlocker(i: { turn: PiesaTimeTurn; ackNeeded: boolean; understandsThirtyDays: boolean | null | undefined }): string | null {
  if (i.turn !== "owner_to_answer") return "Safety check times can't be chosen right now.";
  return thirtyDayAckBlocker({ needed: i.ackNeeded, understandsThirtyDays: i.understandsThirtyDays });
}

/** next_action wording per turn (office and trade lists read jobs.next_action). */
export const PIESA_TIMES_NEXT_ACTION = {
  electrician_to_offer: "Waiting for the electrician to offer the owner 3 safety check times (within 24 hours)",
  owner_to_answer: "Waiting for the owner to pick one of the electrician's safety check times",
  electrician_to_answer: "Waiting for the electrician to take one of the owner's days or offer new times",
} as const;
