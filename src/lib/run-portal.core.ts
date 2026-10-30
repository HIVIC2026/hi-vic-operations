// A48 batch 2 part 2, Task 7 (Jo 30 Oct 2026, spec 2026-10-30-a48-batch2-part2-runs-design.md): "Portal books". PURE: no I/O.
// The installer picks a day (at least 2 days ahead) and a start time (default 8:00). The portal gives each home in route
// order a 1-hour arrival window, at most 8 a day for the installer (extras go to a second day they pick); a second run for
// the same installer on the same day starts after the first run's last window. Each owner gets their window by text and
// confirms within 24 hours (one reminder at 12 hours); "can't make it" → another free window that day; none suit / no
// confirm → back to the pool (a batch candidate again with their standing pass). Events: run-route.core.
import { formatInstallDay, installStartAt } from "./install-days.core";
import { melbourneYmd } from "./piesa-windows.core";
import {
  MAX_PER_DAY, RUN_SLOT_CONFIRMED_EVENT, RUN_SLOT_CONFIRM_FAILED_EVENT, RUN_SLOT_PROPOSED_EVENT, RUN_SLOT_RELEASED_EVENT, RUN_TIME_REMINDED_EVENT,
  RUN_TIME_TEXTED_EVENT, runIdOf, windowsFor, type RunEventRow,
} from "./run-route.core";

export const RUN_MIN_DAYS_AHEAD = 2;
export const RUN_DEFAULT_START = "08:00";
/** Days the installer can pick from (same horizon as Ready Check times). */
export const RUN_HORIZON_DAYS = 21;
export const RUN_CONFIRM_HOURS = 24;
export const RUN_REMINDER_HOURS = 12;
export const RUN_PORTAL_MODE = "portal" as const;

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
/** Jo approved 30 Oct 2026 (part 2 spec). Verbatim. `time` = windowWords(…), e.g. "between 9:00 and 10:00am". */
export const runTimeText = (f: { name: string | null | undefined; day: string; time: string; installer: string; link: string }) =>
  `Hi ${first(f.name)}, your free Ready Check is ${f.day} at ${f.time} with ${f.installer}. Tap to confirm or pick another time: ${f.link} - Home Insulation Victoria`;
/** Jo approved 30 Oct 2026 (part 2 spec): the 12-hour reminder. Verbatim. */
export const runTimeReminderText = (f: { name: string | null | undefined; day: string; time: string; link: string }) =>
  `Hi ${first(f.name)}, please confirm your free Ready Check on ${f.day} at ${f.time}: ${f.link}`;

const clock12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return { t: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`, ap: h < 12 ? "am" : "pm" };
};
/** "between 9:00 and 10:00am" (one am/pm at the end when both match, else "between 11:00am and 12:00pm"). */
export function windowWords(start: string, end: string): string {
  const a = clock12(start); const b = clock12(end);
  return a.ap === b.ap ? `between ${a.t} and ${b.t}${b.ap}` : `between ${a.t}${a.ap} and ${b.t}${b.ap}`;
}
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
/** Free windows that day: on the grid, not held by another home, and not started yet. */
export function freeWindows(f: { day: string; gridStart: string; held: readonly Window[]; now: Date }): { start: string; end: string }[] {
  return dayGrid(f.gridStart).filter((w) => !f.held.some((h) => h.day === f.day && h.start < w.end && w.start < h.end) && windowStartAt(f.day, w.start).getTime() > f.now.getTime());
}

// ---- slot state ---------------------------------------------------------------------------------------------------------

export type SlotState = "proposed" | "confirmed" | "released";
export type Slot = Window & {
  runId: string; jobId: string; batchId: string; businessId: string; seq: number; state: SlotState;
  proposedAt: string; textedAt: string | null; remindedAt: string | null; failedConfirms: number;
};
type D = { batch_id?: unknown; business_id?: unknown; seq?: unknown; day?: unknown; start?: unknown; end?: unknown };
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
      by.set(key, { runId: runIdOf(e)!, jobId: e.job_id, batchId: str(d.batch_id), businessId: str(d.business_id), seq, state: "proposed", day: str(d.day), start: str(d.start), end: str(d.end), proposedAt: e.created_at, textedAt: null, remindedAt: null, failedConfirms: 0 });
    } else if (!cur || cur.state === "released") continue;
    else if (e.event_type === RUN_SLOT_RELEASED_EVENT) cur.state = "released";
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

/** The owner's run card on My job. */
export type OwnerRunSlotView =
  | { kind: "none" }
  | { kind: "proposed"; day: string; time: string; installer: string; free: { start: string; end: string; label: string }[] }
  | { kind: "confirmed"; day: string; time: string; installer: string };

export type SlotDue = "text" | "remind" | "release" | null;
/** What the 15-minute tick does for a waiting window. The owner's 24 hours count from their text (it may be held, e.g.
 *  overnight or while the switch is off); never past the window itself. Not texted by the window's start → released. */
export function slotDue(s: Slot, now: Date): SlotDue {
  if (s.state !== "proposed") return null;
  const t = now.getTime();
  const windowAt = windowStartAt(s.day, s.start).getTime();
  if (!s.textedAt) return t >= windowAt ? "release" : "text";
  const texted = Date.parse(s.textedAt);
  if (t >= Math.min(texted + RUN_CONFIRM_HOURS * 3_600_000, windowAt)) return "release";
  if (!s.remindedAt && t >= texted + RUN_REMINDER_HOURS * 3_600_000) return "remind";
  return null;
}
