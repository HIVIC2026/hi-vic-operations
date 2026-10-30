// A48 batch 2 part 2, Task 7 (Jo 30 Oct 2026, spec 2026-10-30-a48-batch2-part2-runs-design.md): "Portal books". PURE: no I/O.
// The installer picks a day (at least 2 days ahead) and a start time (default 8:00). The portal gives each home in route
// order a 1-hour arrival window, at most 8 a day for the installer (extras go to a second day they pick); a second run for
// the same installer on the same day starts after the first run's last window. Each owner gets their window by text and
// confirms within 24 hours (one reminder at 12 hours); "can't make it" → another free window that day; none suit / no
// confirm → back to the pool (a batch candidate again with their standing pass). Events: run-route.core.
import { formatInstallDay, installStartAt } from "./install-days.core";
import { melbourneYmd } from "./piesa-windows.core";
import { READY_CHECK_TIME_LEAD_HOURS } from "./ready-check-times.core";
import { melbourneClock } from "./installer-texts.core";
import {
  MAX_PER_DAY, RUN_SLOT_CANCELLED_EVENT, RUN_SLOT_CONFIRMED_EVENT, RUN_SLOT_CONFIRM_FAILED_EVENT, RUN_SLOT_PROPOSED_EVENT, RUN_SLOT_RELEASED_EVENT, RUN_TIME_REMINDED_EVENT,
  RUN_TIME_TEXTED_EVENT, runIdOf, windowsFor, type RunEventRow,
} from "./run-route.core";

export const RUN_MIN_DAYS_AHEAD = 2;
export const RUN_DEFAULT_START = "08:00";
/** Days the installer can pick from (same horizon as Ready Check times). */
export const RUN_HORIZON_DAYS = 21;
export const RUN_CONFIRM_HOURS = 24;
export const RUN_REMINDER_HOURS = 12;
export const RUN_PORTAL_MODE = "portal" as const;
/** Task 8, "Our team books": the installer's team calls the owners and enters each agreed day + time (no portal limits). */
export const RUN_TEAM_MODE = "team" as const;
/** Homes the team hasn't booked within 5 days of choosing "Our team books" go back to Jo's suggestions (once). */
export const RUN_TEAM_BOOK_DAYS = 5;
export const runTeamExpired = (chosenAt: string, now: Date) => now.getTime() >= Date.parse(chosenAt) + RUN_TEAM_BOOK_DAYS * 86_400_000;

/** New owner texts: own switches, owner audience, off until Jo switches them on. */
export const RUN_TIME_SMS_TYPE = "run_time" as const;
export const RUN_TIME_REMINDER_SMS_TYPE = "run_time_reminder" as const;
export const runTimeSmsKey = (runId: string, jobId: string, seq: number) => `run-time-sms:v1:${runId}:${jobId}:${seq}`;
export const runTimeReminderSmsKey = (runId: string, jobId: string, seq: number) => `run-time-reminder-sms:v1:${runId}:${jobId}:${seq}`;
export const runModeKey = (runId: string, jobId: string) => `run-mode:v1:${runId}:${jobId}`;
export const runSlotKey = (runId: string, jobId: string, seq: number) => `run-slot:v1:${runId}:${jobId}:${seq}`;
export const runSlotConfirmKey = (runId: string, jobId: string, seq: number, attempt: number) => `run-slot-confirmed:v1:${runId}:${jobId}:${seq}:${attempt}`;
/** A home's window is released once per run (it is then out of the run for good). */
export const runSlotReleaseKey = (runId: string, jobId: string) => `run-slot-released:v1:${runId}:${jobId}`;

const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "there";
/** Jo approved 30 Oct 2026 (part 2 spec; "at" dropped before the window, Jo 30 Oct). Verbatim. `time` = windowWords(…),
 *  e.g. "…is Tuesday 27 October between 9:00 and 10:00am with…". */
export const runTimeText = (f: { name: string | null | undefined; day: string; time: string; installer: string; link: string }) =>
  `Hi ${first(f.name)}, your free Ready Check is ${f.day} ${f.time} with ${f.installer}. Tap to confirm or pick another time: ${f.link} - Home Insulation Victoria`;
/** Jo approved 30 Oct 2026 (Task 8 fix round 1): the time text for a TEAM-entered time — no other times are offered, so no
 *  "pick another time". Verbatim. `time` = exactTimeWords(…), e.g. "…is Sunday 25 October at 6:15am with…". */
export const runTeamTimeText = (f: { name: string | null | undefined; day: string; time: string; installer: string; link: string }) =>
  `Hi ${first(f.name)}, your free Ready Check is ${f.day} ${f.time} with ${f.installer}. Tap to confirm: ${f.link} - Home Insulation Victoria`;
/** Jo approved 30 Oct 2026 (part 2 spec): the 12-hour reminder ("at" dropped before the window). Verbatim. */
export const runTimeReminderText = (f: { name: string | null | undefined; day: string; time: string; link: string }) =>
  `Hi ${first(f.name)}, please confirm your free Ready Check on ${f.day} ${f.time}: ${f.link}`;

const clock12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return { t: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`, ap: h < 12 ? "am" : "pm" };
};
/** "between 9:00 and 10:00am" (one am/pm at the end when both match, else "between 11:00am and 12:00pm"). */
export function windowWords(start: string, end: string): string {
  const a = clock12(start); const b = clock12(end);
  return a.ap === b.ap ? `between ${a.t} and ${b.t}${b.ap}` : `between ${a.t}${a.ap} and ${b.t}${b.ap}`;
}
/** A team-entered time is an exact time, not a window: the existing Ready Check time wording ("at 9am", "at 6:15am" —
 *  as in formatInstallDay / the Ready Check booked text). */
export const exactTimeWords = (day: string, start: string) => `at ${melbourneClock(installStartAt(day, start).toISOString())}`;
/** The owner-facing time of a home's window: exact for a team-entered time, else the 1-hour window. */
export const slotTimeWords = (x: { by: string; day: string; start: string; end: string }) => (x.by === "team" ? exactTimeWords(x.day, x.start) : windowWords(x.start, x.end));
/** "Tuesday 27 October". */
export const runDayWords = (ymd: string) => formatInstallDay(installStartAt(ymd, "12:00").toISOString(), false);
export const windowStartAt = (day: string, start: string) => installStartAt(day, start);

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Days the installer can choose: from 2 days ahead (Melbourne) up to the horizon. */
export function runDays(now: Date): string[] {
  const today = melbourneYmd(now);
  return Array.from({ length: RUN_HORIZON_DAYS - RUN_MIN_DAYS_AHEAD + 1 }, (_, i) => addDaysYmd(today, RUN_MIN_DAYS_AHEAD + i));
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** A day the installer may choose (at least 2 days ahead, within the horizon). */
export function runDayBlocker(day: string | null | undefined, now: Date): string | null {
  if (!day || !YMD.test(day) || addDaysYmd(day, 0) !== day) return "Please choose a day.";
  if (!runDays(now).includes(day)) return day < addDaysYmd(melbourneYmd(now), RUN_MIN_DAYS_AHEAD) ? "The day must be at least 2 days away." : "Please choose a day in the next 3 weeks.";
  return null;
}

// ---- the plan: windows per home --------------------------------------------------------------------------------------

export type Window = { day: string; start: string; end: string };
export type PlannedSlot = Window & { jobId: string };
export type PlanResult = { ok: true; slots: PlannedSlot[] } | { ok: false; why: string };

/** Windows for the run's homes in route order: the first day from the start time, then the second day. Windows the same
 *  installer already holds that day (another run) come first — this run starts after their last window, and the day still
 *  holds at most 8. */
export function planRunDays(f: { memberIds: readonly string[]; day: string; start: string; secondDay?: string | null; held: readonly Window[] }): PlanResult {
  const out: PlannedSlot[] = [];
  let left = [...f.memberIds];
  const fill = (day: string) => {
    const taken = f.held.filter((w) => w.day === day);
    const after = taken.reduce((m, w) => (w.end > m ? w.end : m), "00:00");
    const start = after > f.start ? after : f.start;
    const room = Math.max(0, MAX_PER_DAY - taken.length);
    const { windows } = windowsFor(start, Math.min(left.length, room));
    windows.forEach((w, i) => out.push({ jobId: left[i]!, day, start: w.start, end: w.end }));
    left = left.slice(windows.length);
  };
  fill(f.day);
  if (left.length && f.secondDay && f.secondDay !== f.day) fill(f.secondDay);
  if (left.length) return { ok: false, why: f.secondDay ? `${left.length} ${left.length === 1 ? "home doesn't" : "homes don't"} fit on those two days. Please pick other days.` : `${left.length} more ${left.length === 1 ? "home needs" : "homes need"} a second day. Please pick a second day.` };
  return { ok: true, slots: out };
}

/** The installer's day for owners who can't make their window: 8 one-hour windows from the earliest start that day. */
export function dayGrid(gridStart: string): { start: string; end: string }[] {
  return windowsFor(gridStart, MAX_PER_DAY).windows;
}
/** An owner's own pick must start at least the existing Ready Check lead time (24 hours) from now. */
export const RUN_OWNER_PICK_LEAD_HOURS = READY_CHECK_TIME_LEAD_HOURS;
/** Existing Ready Check wording (ready-check-times.core). */
export const RUN_PICK_TOO_SOON = "The time must be at least 24 hours away.";
export const pickTooSoon = (day: string, start: string, now: Date) => windowStartAt(day, start).getTime() < now.getTime() + RUN_OWNER_PICK_LEAD_HOURS * 3_600_000;
/** Free windows that day for an owner's own pick: on the grid, not held by another home, and at least 24 hours away. */
export function freeWindows(f: { day: string; gridStart: string; held: readonly Window[]; now: Date }): { start: string; end: string }[] {
  return dayGrid(f.gridStart).filter((w) => !f.held.some((h) => h.day === f.day && h.start < w.end && w.start < h.end) && !pickTooSoon(f.day, w.start, f.now));
}

// ---- slot state ---------------------------------------------------------------------------------------------------------

export type SlotState = "proposed" | "confirmed" | "released" | "cancelled";
export type Slot = Window & {
  /** The installer person doing it (Jo 30 Oct: "Who's doing these Ready Checks?"); the 8-a-day cap is per person. */
  person: string; by: string;
  runId: string; jobId: string; batchId: string; businessId: string; seq: number; state: SlotState;
  proposedAt: string; textedAt: string | null; remindedAt: string | null; failedConfirms: number;
};
type D = { batch_id?: unknown; business_id?: unknown; seq?: unknown; day?: unknown; start?: unknown; end?: unknown; person?: unknown; by?: unknown };
const dd = (e: RunEventRow) => (e.details ?? {}) as D;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Each home's current window per run (latest seq wins). Rows of any jobs/types may be passed. */
export function slotsOf(events: readonly RunEventRow[]): Slot[] {
  const by = new Map<string, Slot>();
  const rows = events.filter((e) => runIdOf(e)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const e of rows) {
    const key = `${runIdOf(e)}|${e.job_id}`;
    const d = dd(e);
    const seq = Number(d.seq ?? 0);
    const cur = by.get(key);
    if (e.event_type === RUN_SLOT_PROPOSED_EVENT) {
      if (cur && (cur.state === "released" || seq <= cur.seq)) continue;
      // An owner's own pick is never re-texted and doesn't restart their 24 hours: it keeps the earlier text's times
      // (no earlier text → counted from the pick itself).
      const ownerPick = str(d.by) === "owner" && !!cur;
      by.set(key, { runId: runIdOf(e)!, jobId: e.job_id, batchId: str(d.batch_id), businessId: str(d.business_id), person: str(d.person), by: str(d.by), seq, state: "proposed", day: str(d.day), start: str(d.start), end: str(d.end), proposedAt: e.created_at,
        textedAt: ownerPick ? cur!.textedAt ?? e.created_at : null, remindedAt: ownerPick ? cur!.remindedAt : null, failedConfirms: 0 });
    } else if (!cur || cur.state === "released") continue;
    else if (e.event_type === RUN_SLOT_RELEASED_EVENT) cur.state = "released";
    else if (e.event_type === RUN_SLOT_CANCELLED_EVENT) { if (seq === cur.seq) cur.state = "cancelled"; }
    else if (seq !== cur.seq) continue;
    else if (e.event_type === RUN_SLOT_CONFIRMED_EVENT) cur.state = "confirmed";
    else if (e.event_type === RUN_SLOT_CONFIRM_FAILED_EVENT) { cur.state = "proposed"; cur.failedConfirms++; }
    else if (e.event_type === RUN_TIME_TEXTED_EVENT) cur.textedAt ??= e.created_at;
    else if (e.event_type === RUN_TIME_REMINDED_EVENT) cur.remindedAt ??= e.created_at;
  }
  return [...by.values()];
}
/** Windows holding the installer's time: proposed or confirmed. */
export const holds = (s: Slot) => s.state === "proposed" || s.state === "confirmed";

/** The owner's run card on My job. `team` = a time the installer's team entered (exact time; Confirm / Can't make it only,
 *  "Can't make it" = back on the list like "None of these suit"). */
export type OwnerRunSlotView =
  | { kind: "none" }
  | { kind: "proposed"; day: string; time: string; installer: string; team: boolean; free: { start: string; end: string; label: string }[] }
  | { kind: "confirmed"; day: string; time: string; installer: string; team: boolean };

export type SlotDue = "text" | "remind" | "release" | null;
/** What the 15-minute tick does for a waiting window. The owner's 24 hours count from their text (it may be held, e.g.
 *  overnight or while the switch is off); never past the window itself. Not texted by the window's start → released. */
export function slotDue(s: Slot, now: Date): SlotDue {
  if (s.state !== "proposed") return null;
  const t = now.getTime();
  const windowAt = windowStartAt(s.day, s.start).getTime();
  // A team-entered time (Task 8): the text and the 12-hour reminder only, before the time; never released at 24 h (the team
  // may enter another time meanwhile). Fix round 1: once the time itself passes unconfirmed → released (back to the pool).
  if (s.by === "team") {
    if (t >= windowAt) return "release";
    if (!s.textedAt) return "text";
    return !s.remindedAt && t >= Date.parse(s.textedAt) + RUN_REMINDER_HOURS * 3_600_000 ? "remind" : null;
  }
  if (!s.textedAt) return t >= windowAt ? "release" : "text";
  const texted = Date.parse(s.textedAt);
  if (t >= Math.min(texted + RUN_CONFIRM_HOURS * 3_600_000, windowAt)) return "release";
  if (!s.remindedAt && t >= texted + RUN_REMINDER_HOURS * 3_600_000) return "remind";
  return null;
}

// ---- owner cancels a confirmed window (Task 8) -------------------------------------------------------------------------------
/** New INSTALLER text (Task 8): the owner cancelled a confirmed window. Own switch `run_slot_cancelled`, off until Jo switches
 *  it on; DRAFT wording (wordingApproved false) until Jo approves it. */
export const RUN_SLOT_CANCELLED_SMS_TYPE = "run_slot_cancelled" as const;
export const runSlotCancelledText = (f: { name: string | null | undefined; day: string; time: string; link: string }) =>
  `Hi ${first(f.name)}, an owner cancelled their Ready Check on ${f.day} ${f.time}. To offer that time to a nearby waiting owner: ${f.link} - Home Insulation Victoria`;
export const runSlotCancelledKey = (runId: string, jobId: string, seq: number) => `run-slot-cancelled:v1:${runId}:${jobId}:${seq}`;
export const runSlotCancelledSmsKey = (runId: string, jobId: string, seq: number) => `run-slot-cancelled-sms:v1:${runId}:${jobId}:${seq}`;
/** "Fill from nearby waiting owners": the slot goes to ONE owner, once per cancelled window. */
export const runSlotFilledKey = (runId: string, cancelledJobId: string, seq: number) => `run-slot-filled:v1:${runId}:${cancelledJobId}:${seq}`;
/** Nearby = within 10 km of the cancelled home (the batch radius). */
export const RUN_FILL_RADIUS_M = 10_000;

// ---- window claims (no double-booking) ---------------------------------------------------------------------------------------
// Windows are 1 hour but starts sit on the half-hour grid (READY_CHECK_TIMES), so a window claims EVERY half-hour slot it
// covers (08:00–09:00 → 08:00 and 08:30; fix round 2): an 08:00 and an 08:30 window of the same person collide on 08:30.
// One claim per installer person + day + slot, written BEFORE a window is proposed (installer's day pick or an owner's own
// pick), all of a window's slots or none, and freed together when that window is released or moved. Generation n = the
// n-th claim of that slot; the pending migration docs/pending-migrations/run-window-claims.sql makes each key unique
// (race-proof); until then the server checks first and the earliest row of a generation wins.
export const RUN_WINDOW_CLAIMED_EVENT = "run_window_claimed";
export const RUN_WINDOW_FREED_EVENT = "run_window_freed";
export const RUN_WINDOW_EVENTS = [RUN_WINDOW_CLAIMED_EVENT, RUN_WINDOW_FREED_EVENT] as const;
/** v2 (fix round 2): keyed per half-hour slot (v1 keyed the window start). */
export const runWindowKey = (person: string, day: string, slot: string, gen: number) => `run-window:v2:${person}:${day}:${slot}:${gen}`;
export const runWindowFreedKey = (person: string, day: string, slot: string, gen: number) => `run-window-freed:v2:${person}:${day}:${slot}:${gen}`;
/** A claim whose window was never proposed (the writer stopped part way) stops blocking after this long. */
export const RUN_CLAIM_IN_FLIGHT_MINUTES = 15;

const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number) as [number, number]; return h * 60 + m; };
const hhmmOf = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
/** Every half-hour slot a window covers: from its start (rounded down to the half-hour) up to its end. */
export function windowSlots(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Math.floor(mins(start) / 30) * 30; t < mins(end); t += 30) out.push(hhmmOf(t));
  return out;
}

/** `start` = the claiming window's start; `slot` = the half-hour claimed. */
export type WindowClaim = { person: string; day: string; slot: string; start: string; gen: number; jobId: string; runId: string; seq: number; at: string };
type CD = { person?: unknown; day?: unknown; slot?: unknown; start?: unknown; gen?: unknown; seq?: unknown };
/** The current (latest generation, not freed) claim of one half-hour slot, or null; `gen` = the latest generation used (0 = none). */
export function currentClaim(events: readonly RunEventRow[], w: { person: string; day: string; slot: string }): { gen: number; claim: WindowClaim | null } {
  const mine = events.filter((e) => { const d = (e.details ?? {}) as CD; return d.person === w.person && d.day === w.day && d.slot === w.slot; });
  const claimed = new Map<number, WindowClaim>();
  for (const e of [...mine].filter((e) => e.event_type === RUN_WINDOW_CLAIMED_EVENT).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const d = (e.details ?? {}) as CD;
    const gen = Number(d.gen ?? 0);
    if (!claimed.has(gen)) claimed.set(gen, { person: w.person, day: w.day, slot: w.slot, start: str(d.start), gen, jobId: e.job_id, runId: runIdOf(e) ?? "", seq: Number(d.seq ?? 0), at: e.created_at });
  }
  const freed = new Set(mine.filter((e) => e.event_type === RUN_WINDOW_FREED_EVENT).map((e) => Number(((e.details ?? {}) as CD).gen ?? 0)));
  const gen = Math.max(0, ...claimed.keys(), ...freed);
  const c = claimed.get(gen);
  return { gen, claim: c && !freed.has(gen) ? c : null };
}
/** Does this claim still hold its half-hour? Its home closed → no. Its window proposed (that seq or later) → only while that
 *  home's current window (same person + day) still covers this half-hour (an owner's move to an overlapping window keeps
 *  the shared half-hour). Not proposed yet → only for the first 15 minutes (someone may be writing it now). */
export function claimHolds(c: WindowClaim, slot: Slot | undefined, jobClosed: boolean, now: Date): boolean {
  if (jobClosed) return false;
  if (slot && slot.seq >= c.seq) return holds(slot) && slot.day === c.day && slot.person === c.person && windowSlots(slot.start, slot.end).includes(c.slot);
  return now.getTime() - Date.parse(c.at) < RUN_CLAIM_IN_FLIGHT_MINUTES * 60_000;
}
