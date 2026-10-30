// A48 batch 2, part 2 (Jo 30 Oct 2026, spec 2026-10-30-a48-batch2-part2-runs-design.md): the installer's run. PURE: no I/O.
// A run = a closed area batch's passers that Jo sent to the installer with one tap ("Send to installer"), minus the homes the
// installer removes. State is append-only workflow_events per job keyed by `run_id`:
//   run_offered {run_id, batch_id, business_id, job_ids (route order), expires_at}  — one per member, before the text
//   run_home_removed {run_id, batch_id}  — the installer removed this home (back to the pool, owner not told)
//   run_declined {run_id, batch_id}      — the installer said no (every member still in the run)
//   run_expired {run_id, batch_id}       — no reply within 24 hours (every member still in the run)
// A removed / declined / expired home's pass is released: its owner is a batch candidate again, carried with their standing
// pass (not asked again) — see area-batch.core `passHandedOn`.
import { distanceM } from "./geo.core";
import { QUICK_TAPS_COPY, type FiveYears, type Hatch, type QuickTapAnswers, type Roof } from "./quick-taps.core";

export const RUN_OFFERED_EVENT = "run_offered";
export const RUN_HOME_REMOVED_EVENT = "run_home_removed";
export const RUN_DECLINED_EVENT = "run_declined";
export const RUN_EXPIRED_EVENT = "run_expired";
/** The installer picked how the run is booked (Task 7: `{mode: "portal"}`): no 24-hour expiry after one of these. */
export const RUN_MODE_CHOSEN_EVENT = "run_mode_chosen";
export const RUN_REPLY_EVENTS: readonly string[] = [RUN_MODE_CHOSEN_EVENT];
// Portal books (Task 7, run-portal.core): per home, keyed by run_id + seq.
//   run_slot_proposed {run_id, batch_id, business_id, seq, day, start, end, by}  — the home's 1-hour arrival window
//   run_slot_confirmed {run_id, seq, day, start, end}  — the owner confirmed (then booked through bookAgreedTime)
//   run_slot_confirm_failed {run_id, seq, reason}      — the booking was refused; the window is waiting again
//   run_slot_released {run_id, batch_id, seq, why}     — none suit / no confirm in 24 h: back in the pool (carried pass)
//   run_time_texted / run_time_reminded {run_id, seq, status} — the owner's time text / 12-hour reminder went
export const RUN_SLOT_PROPOSED_EVENT = "run_slot_proposed";
export const RUN_SLOT_CONFIRMED_EVENT = "run_slot_confirmed";
export const RUN_SLOT_CONFIRM_FAILED_EVENT = "run_slot_confirm_failed";
export const RUN_SLOT_RELEASED_EVENT = "run_slot_released";
export const RUN_TIME_TEXTED_EVENT = "run_time_texted";
export const RUN_TIME_REMINDED_EVENT = "run_time_reminded";
export const RUN_SLOT_EVENTS = [RUN_SLOT_PROPOSED_EVENT, RUN_SLOT_CONFIRMED_EVENT, RUN_SLOT_CONFIRM_FAILED_EVENT, RUN_SLOT_RELEASED_EVENT, RUN_TIME_TEXTED_EVENT, RUN_TIME_REMINDED_EVENT] as const;
/** A home leaves the run and its owner's pass is free again (batch candidate, carried pass). */
export const RUN_RELEASE_EVENTS = [RUN_HOME_REMOVED_EVENT, RUN_DECLINED_EVENT, RUN_EXPIRED_EVENT, RUN_SLOT_RELEASED_EVENT] as const;

/** New installer text: its own SMS switch, partner audience, off until Jo switches it on. */
export const RUN_OFFERED_SMS_TYPE = "run_offered" as const;
export const RUN_REPLY_HOURS = 24;

export const runOfferedKey = (batchId: string, jobId: string) => `run-offered:v1:${batchId}:${jobId}`;
/** One key per send attempt: a resend (only when no earlier attempt went) never reuses a key a failed send claimed. */
export const runOfferedSmsKey = (runId: string, attempt: number) => `run-offered-sms:v1:${runId}:${attempt}`;
/** One per send attempt of the installer text (on the run's first home): {run_id, attempt, status}. */
export const RUN_OFFERED_TEXT_EVENT = "run_offered_text";
/** Attempt statuses meaning the text went (or may have gone) — never sent again. */
export const RUN_TEXT_WENT = ["sent", "already", "sent_unknown"] as const;
export const RUN_EVENTS = [RUN_OFFERED_EVENT, ...RUN_RELEASE_EVENTS, ...RUN_REPLY_EVENTS, RUN_OFFERED_TEXT_EVENT, ...RUN_SLOT_EVENTS] as const;
export const runReleaseKey = (type: (typeof RUN_RELEASE_EVENTS)[number], runId: string, jobId: string) => `${type}:v1:${runId}:${jobId}`;
/** The installer's run page (signed in, business-scoped). */
export const runLink = (base: string, runId: string) => `${base.replace(/\/+$/, "")}/field/run/${runId}`;

/** Jo approved 30 Oct 2026 (part 2 spec). Verbatim. No name on file → "Hi there,". */
export const runOfferedText = (f: { name: string | null | undefined; homes: number; suburb: string; link: string }) =>
  `Hi ${(f.name ?? "").trim().split(/\s+/)[0] || "there"}, you've got a run of ${f.homes} Ready Checks around ${f.suburb}. Pick your day: ${f.link} - Home Insulation Victoria`;

// ---- route order + arrival windows ---------------------------------------------------------------------------------------

export type RunHome = { jobId: string; lat: number; lng: number };
const located = (h: RunHome) => Number.isFinite(h.lat) && Number.isFinite(h.lng);
const byId = (a: RunHome, b: RunHome) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0);

/** Shortest-route order: start at the home furthest from the centre of the run, then always the nearest home not yet
 *  visited. Ties go to the lower job id, so the order is always the same. Homes without a location go last (by job id). */
export function orderRun(homes: readonly RunHome[]): string[] {
  const pts = homes.filter(located);
  const rest = homes.filter((h) => !located(h)).sort(byId).map((h) => h.jobId);
  if (!pts.length) return rest;
  const centre = { lat: pts.reduce((s, h) => s + h.lat, 0) / pts.length, lng: pts.reduce((s, h) => s + h.lng, 0) / pts.length };
  const pick = (from: RunHome[], d: (h: RunHome) => number, far: boolean) =>
    [...from].sort((a, b) => (far ? d(b) - d(a) : d(a) - d(b)) || byId(a, b))[0]!;
  let cur = pick(pts, (h) => distanceM(centre, h), true);
  const out = [cur.jobId];
  let left = pts.filter((h) => h !== cur);
  while (left.length) {
    const from = cur;
    cur = pick(left, (h) => distanceM(from, h), false);
    out.push(cur.jobId);
    left = left.filter((h) => h !== cur);
  }
  return [...out, ...rest];
}

export const WINDOW_MINUTES = 60;
export const MAX_PER_DAY = 8;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Back-to-back 1-hour arrival windows from the start time, at most 8 in a day. `overflow` = homes that need a second day. */
export function windowsFor(startHHMM: string, count: number): { windows: { start: string; end: string }[]; overflow: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startHHMM.trim());
  if (!m) throw new Error(`Start time must be HH:MM, got "${startHHMM}"`);
  const n = Math.max(0, Math.floor(count));
  const start = Number(m[1]) * 60 + Number(m[2]);
  const fit = Math.min(n, MAX_PER_DAY, Math.floor((24 * 60 - start) / WINDOW_MINUTES));
  const windows = Array.from({ length: fit }, (_, i) => ({ start: hhmm(start + i * WINDOW_MINUTES), end: hhmm(start + (i + 1) * WINDOW_MINUTES) }));
  return { windows, overflow: n - fit };
}

// ---- run state -----------------------------------------------------------------------------------------------------------

export type RunEventRow = { job_id: string; event_type: string; created_at: string; details: unknown };
const det = (e: RunEventRow) => (e.details ?? {}) as { run_id?: unknown; batch_id?: unknown; business_id?: unknown; job_ids?: unknown; expires_at?: unknown };
export const runIdOf = (e: RunEventRow): string | null => { const v = det(e).run_id; return typeof v === "string" && v ? v : null; };

export type RunStatus = "offered" | "answered" | "declined" | "expired" | "ended";
export type RunState = {
  runId: string; batchId: string; businessId: string; offeredAt: string; expiresAt: string;
  /** Route order at the offer. */
  jobIds: string[];
  /** Still in the run (route order). */
  memberIds: string[];
  removedIds: string[];
  status: RunStatus;
};

/** The run's state from its events (any jobs' events may be passed; only this run's are read). Null = no such run. */
export function runState(runId: string, events: readonly RunEventRow[]): RunState | null {
  const mine = events.filter((e) => runIdOf(e) === runId);
  const offers = mine.filter((e) => e.event_type === RUN_OFFERED_EVENT).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!offers.length) return null;
  const d = det(offers[0]!);
  const listed = Array.isArray(d.job_ids) ? d.job_ids.filter((x): x is string => typeof x === "string") : [];
  const offeredJobs = new Set(offers.map((e) => e.job_id));
  const jobIds = [...listed.filter((j) => offeredJobs.has(j)), ...[...offeredJobs].filter((j) => !listed.includes(j)).sort()];
  // Out of the run: removed by the installer, or the owner's window released (none suit / no confirm).
  const removed = new Set(mine.filter((e) => e.event_type === RUN_HOME_REMOVED_EVENT).map((e) => e.job_id));
  const slotReleased = new Set(mine.filter((e) => e.event_type === RUN_SLOT_RELEASED_EVENT).map((e) => e.job_id));
  const memberIds = jobIds.filter((j) => !removed.has(j) && !slotReleased.has(j));
  const has = (t: string) => mine.some((e) => e.event_type === t);
  const status: RunStatus = has(RUN_DECLINED_EVENT) ? "declined" : has(RUN_EXPIRED_EVENT) ? "expired" : !memberIds.length ? "ended"
    : mine.some((e) => RUN_REPLY_EVENTS.includes(e.event_type)) ? "answered" : "offered";
  const offeredAt = offers[0]!.created_at;
  // The installer's 24 hours count from the first text that actually went (sent / already / sent_unknown). Attempts recorded
  // but none went → no clock yet (Jo's tap re-texts the run). No attempt recorded at all → from the offer (stored expiry).
  const attempts = mine.filter((e) => e.event_type === RUN_OFFERED_TEXT_EVENT).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const firstWent = attempts.find((e) => (RUN_TEXT_WENT as readonly string[]).includes(String((e.details as { status?: unknown } | null)?.status)));
  const stored = typeof d.expires_at === "string" ? d.expires_at : new Date(Date.parse(offeredAt) + RUN_REPLY_HOURS * 3_600_000).toISOString();
  const expiresAt = firstWent ? new Date(Date.parse(firstWent.created_at) + RUN_REPLY_HOURS * 3_600_000).toISOString() : attempts.length ? NO_EXPIRY : stored;
  return { runId, batchId: String(d.batch_id ?? ""), businessId: String(d.business_id ?? ""), offeredAt, expiresAt, jobIds, memberIds, removedIds: jobIds.filter((j) => removed.has(j)), status };
}

/** expiresAt while no attempt of the installer text has gone: never due. */
export const NO_EXPIRY = "9999-12-31T00:00:00.000Z";
/** Still waiting for the installer's reply and 24 hours have passed. */
export const runExpiryDue = (s: RunState, nowIso: string): boolean => s.status === "offered" && Date.parse(nowIso) >= Date.parse(s.expiresAt);

// ---- run page facts -------------------------------------------------------------------------------------------------------

/** The m² lines, best source first (spec part 2). Only the two sources the spec names are shown: the aerial roof outline
 *  (preliminary_ceiling_area at tier E — aerial/Solar) and the owner's own estimate. Rounded to whole m². */
export function areaLines(f: { ownerM2: number | null | undefined; prelim: { net_m2?: unknown; tier?: unknown } | null | undefined }): string[] {
  const out: string[] = [];
  const aerial = Number(f.prelim?.net_m2);
  if (f.prelim?.tier === "E" && Number.isFinite(aerial) && aerial > 0) out.push(`${Math.round(aerial)} m² · aerial roof outline, approx.`);
  const own = Number(f.ownerM2);
  if (f.ownerM2 != null && Number.isFinite(own) && own > 0) out.push(`${Math.round(own)} m² · owner's estimate`);
  return out;
}

const optLabel = <V extends string>(opts: readonly { value: V; label: string }[], v: V | undefined) => (v ? opts.find((o) => o.value === v)?.label ?? null : null);
/** The owner's quick-tap answers, as label/answer rows (Jo's question wording and answer labels, verbatim). The roof tap is
 *  the roof shape (sloped / flat / some of each). */
export function tapRows(a: QuickTapAnswers | null | undefined): [string, string][] {
  if (!a) return [];
  const rows: [string, string | null][] = [
    [QUICK_TAPS_COPY.hatch.question, optLabel<Hatch>(QUICK_TAPS_COPY.hatch.options, a.hatch)],
    [QUICK_TAPS_COPY.roof.question, optLabel<Roof>(QUICK_TAPS_COPY.roof.options, a.roof)],
    [QUICK_TAPS_COPY.five_years.question, optLabel<FiveYears>(QUICK_TAPS_COPY.five_years.options, a.five_years)],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}
/** The suburb the run is "around": the most common one; a tie goes to the earliest in route order. */
export function runSuburb(suburbs: readonly (string | null | undefined)[]): string {
  const clean = suburbs.map((s) => (s ?? "").trim()).filter(Boolean);
  if (!clean.length) return "Victoria";
  const n = new Map<string, number>();
  for (const s of clean) n.set(s, (n.get(s) ?? 0) + 1);
  return clean.reduce((best, s) => (n.get(s)! > n.get(best)! ? s : best), clean[0]!);
}
