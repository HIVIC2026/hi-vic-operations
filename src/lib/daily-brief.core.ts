// Pure rules for visit reminders (24h / 2h) and the 7am Melbourne daily brief. No I/O.
const TZ = "Australia/Melbourne";
const H = 3_600_000;

export type ReminderSlot = "24h" | "2h";

/** Which reminder is due now, if any. 24h runs from 24h until 2h before; 2h runs from 2h until the start. */
export function reminderDue(startIso: string, nowMs: number): ReminderSlot | null {
  const s = Date.parse(startIso);
  if (!Number.isFinite(s) || nowMs >= s) return null;
  if (nowMs >= s - 2 * H) return "2h";
  if (nowMs >= s - 24 * H) return "24h";
  return null;
}

/** Idempotency key: one per booking + slot + recipient + start time (a moved visit gets new reminders). */
export function reminderKey(bookingId: string, slot: ReminderSlot, who: "owner" | "trade", startIso: string) {
  return `visit-reminder-${slot}-${who}-${bookingId}-${Date.parse(startIso)}`;
}

function parts(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ymd: `${p["year"]}-${p["month"]}-${p["day"]}`, hour: Number(p["hour"]), minute: Number(p["minute"]) };
}
export const melbourneYmd = (ms: number) => parts(ms).ymd;
export const melbourneHour = (ms: number) => parts(ms).hour;

/** UTC instant of Melbourne midnight for a YYYY-MM-DD day (handles daylight saving). */
export function melbourneMidnight(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  let t = Date.UTC(y!, m! - 1, d!);
  for (let i = 0; i < 2; i++) {
    const p = parts(t);
    const [py, pm, pd] = p.ymd.split("-").map(Number);
    const shown = Date.UTC(py!, pm! - 1, pd!, p.hour, p.minute);
    t -= shown - Date.UTC(y!, m! - 1, d!);
  }
  return t;
}

export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** The brief is produced once per Melbourne day, from 7am. Returns the day to produce, or null. */
export function briefDueFor(nowMs: number, alreadyDone: boolean): string | null {
  if (alreadyDone) return null;
  return melbourneHour(nowMs) >= 7 ? melbourneYmd(nowMs) : null;
}

/** Yesterday (Melbourne) as UTC bounds [from, to). */
export function yesterdayBounds(briefDate: string) {
  const y = addDays(briefDate, -1);
  return { day: y, from: new Date(melbourneMidnight(y)).toISOString(), to: new Date(melbourneMidnight(briefDate)).toISOString() };
}

export type BriefNeed = { urgency: "urgent" | "today" | "soon"; jobNumber: string | null; why: string };
export type BriefRisk = { kind: "clock_30_day" | "esc_deadline" | "prestart_not_passed"; jobNumber: string | null; when: string; detail: string };
export type DailyBrief = {
  date: string;
  needs: { urgent: BriefNeed[]; today: BriefNeed[]; soon: BriefNeed[] };
  apQueue: number;
  atRisk: BriefRisk[];
  yesterday: { day: string; enquiries: number; bookings: number; installs: number; veecsSubmitted: number; veecsRegistered: number };
  /** AI replies that sent themselves yesterday (Melbourne day), real jobs only. */
  aiAutoSent: number;
};

/** Count of AI auto-sent replies in [from, to) on non-QA jobs. Rows are `email_ai_draft_sent` events. */
export function aiAutoSentCount(events: Array<{ job_id: string | null; created_at: string; details: Record<string, unknown> | null }>, jobSource: Map<string, string | null>, from: string, to: string): number {
  return events.filter((e) => e.details?.["via"] === "ai" && !!e.job_id && e.created_at >= from && e.created_at < to && jobSource.has(e.job_id) && jobSource.get(e.job_id) !== "qa_test").length;
}
/** The brief line for it; nothing when none went. */
export function aiAutoSentLine(n: number): string | null { return n > 0 ? `AI replies sent by themselves: ${n}` : null; }

export function buildDailyBrief(i: { date: string; needs: BriefNeed[]; apQueue: number; atRisk: BriefRisk[]; yesterday: DailyBrief["yesterday"]; aiAutoSent?: number }): DailyBrief {
  const by = (u: BriefNeed["urgency"]) => i.needs.filter((n) => n.urgency === u);
  return { date: i.date, needs: { urgent: by("urgent"), today: by("today"), soon: by("soon") }, apQueue: i.apQueue, atRisk: [...i.atRisk].sort((a, b) => a.when.localeCompare(b.when)), yesterday: i.yesterday, aiAutoSent: i.aiAutoSent ?? 0 };
}

/** Installs inside the next 7 days whose latest check for that start time has not passed. */
export function prestartNotPassed(bookings: Array<{ job_id: string; scheduled_start: string }>, checks: Array<{ job_id: string; scheduled_start: string; passed: boolean; checked_at: string }>) {
  return bookings.filter((b) => {
    const latest = checks.filter((c) => c.job_id === b.job_id && Date.parse(c.scheduled_start) === Date.parse(b.scheduled_start)).sort((a, c) => c.checked_at.localeCompare(a.checked_at))[0];
    return !latest || !latest.passed;
  });
}
