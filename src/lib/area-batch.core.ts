// Area batches (A48 batch 2). PURE: no I/O. Owner answers and the roof fact come in as plain values.
import { distanceM } from "./geo.core";
import { installerCanBeOffered, type WaitingInstaller } from "./installer-waiting-columns.core";
import { QUICK_TAPS_ANSWERED_EVENT, QUICK_TAPS_DECLINE_REASON } from "./quick-taps.core";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export type LikelyFacts = {
  propertyType: string | null;
  topFloor: string | null;
  overFiveYears: string | null;
  insulation: string | null;
  insulationThickness: string | null;
  roofForm: string | null;
};

/** Most likely eligible: house/townhouse (or top-floor unit), over 5 years, no insulation or "thin", roof not fully flat (unknown is fine). */
export function likelyEligible(f: LikelyFacts): boolean {
  const type = norm(f.propertyType);
  const homeOk = type === "house" || type === "townhouse" || (type === "apartment" && norm(f.topFloor) === "yes");
  if (!homeOk) return false;
  if (norm(f.overFiveYears) !== "yes") return false;
  if (norm(f.roofForm) === "low_slope_flat") return false;
  const ins = norm(f.insulation);
  return ins === "none" || (ins === "present" && norm(f.insulationThickness) === "thin");
}

export type BatchHome = { jobId: string; lat: number; lng: number; postcode: string; spotSavedAt: string };

const RADIUS_M = 10_000;
const MAX_BATCH = 10;
const MIN_BATCH = 8;
const SMALL_BATCH_WAIT_MS = 14 * 86_400_000;

/**
 * Densest-first greedy. Each home is tried as a centre; its batch is the nearest homes within 10 km of it
 * (centre included, capped at 10). A batch needs 8+ homes, or fewer only if every home has waited 14+ days.
 * The largest valid batch is taken, its homes are removed, repeat. A home is never in two batches.
 */
export function suggestBatches(homes: BatchHome[], nowIso: string): BatchHome[][] {
  const now = Date.parse(nowIso);
  const waitedEnough = (h: BatchHome) => now - Date.parse(h.spotSavedAt) >= SMALL_BATCH_WAIT_MS;
  const valid = (b: BatchHome[]) => b.length >= MIN_BATCH || (b.length > 0 && b.every(waitedEnough));
  let left = [...homes];
  const out: BatchHome[][] = [];
  for (;;) {
    let best: BatchHome[] | null = null;
    for (const c of left) {
      const batch = left
        .map((h) => ({ h, d: h === c ? 0 : distanceM(c, h) }))
        .filter((x) => x.d <= RADIUS_M)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_BATCH)
        .map((x) => x.h);
      if (valid(batch) && (!best || batch.length > best.length)) best = batch;
    }
    if (!best) return out;
    out.push(best);
    const taken = new Set(best);
    left = left.filter((h) => !taken.has(h));
  }
}

// One definition, shared with the m² totals (it lives in excluded-areas.core so those cores stay light).
export { excludedAreaName } from "./excluded-areas.core";

// ---- Send (Task 2): events, keys, owner text, covering installers. PURE. ------------------------------------------------
/** One `area_batch_sent` per job (append-only workflow_events), written before the owner's text. */
export const AREA_BATCH_SENT_EVENT = "area_batch_sent";
/** Written per job when its batch closes (Task 4). A sent batch with no close for that job is still open. */
export const AREA_BATCH_CLOSED_EVENT = "area_batch_closed";
/** Written per job when the owner's new address is over 10 km from the batch centre (Task 3, Jo 30 Oct): the home is back
 *  in the pool for the next batch, but the owner can still finish the quick taps of this batch (they are not told). */
export const AREA_BATCH_LEFT_EVENT = "area_batch_left";
export const AREA_BATCH_EVENTS = [AREA_BATCH_SENT_EVENT, AREA_BATCH_CLOSED_EVENT, AREA_BATCH_LEFT_EVENT] as const;

/** New owner texts: each has its own SMS switch, off until Jo switches it on. */
export const QUICK_TAPS_SMS_TYPE = "quick_taps" as const;
export const QUICK_TAPS_REMINDER_SMS_TYPE = "quick_taps_reminder" as const;

/** The owner's own My job link, on the quick taps screen. */
export const quickTapsLink = (myJobLink: string) => `${myJobLink}?screen=taps`;
const hiName = (fullName: string | null | undefined) => (fullName ?? "").trim().split(/\s+/)[0] || "there";
/** Jo approved 30 Oct 2026 (replaces the spec's first wording). Verbatim. No name → "Hi there," (Jo approved). */
export const quickTapsText = (fullName: string | null | undefined, link: string) =>
  `Hi ${hiName(fullName)}, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote: ${link} - Home Insulation Victoria`;
/** Day-2 reminder (sent by Task 4's sweep). Jo approved 30 Oct 2026. Verbatim. */
export const quickTapsReminderText = (fullName: string | null | undefined, link: string) =>
  `Hi ${hiName(fullName)}, just a reminder - please confirm a few quick details so we can book your free Ready Check: ${link}`;

/** Claim key of a job's n-th batch: the same job can never be claimed twice for the same slot. */
export const areaBatchKey = (jobId: string, seq: number) => `area-batch:v1:${jobId}:${seq}`;
export const quickTapsSmsKey = (batchId: string, jobId: string, step: "sent" | "reminder") => `quick-taps:v1:${batchId}:${jobId}:${step}`;

export type AreaBatchEventRow = { event_type: string; created_at: string; details: unknown };
const bid = (e: AreaBatchEventRow) => { const v = (e.details as { batch_id?: unknown } | null)?.batch_id; return typeof v === "string" && v ? v : null; };

const latestSentNotIn = (events: readonly AreaBatchEventRow[], endTypes: readonly string[]): string | null => {
  const ended = new Set(events.filter((e) => endTypes.includes(e.event_type)).map(bid).filter(Boolean));
  const open = events.filter((e) => e.event_type === AREA_BATCH_SENT_EVENT && bid(e) && !ended.has(bid(e)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return open.length ? bid(open[0]!) : null;
};
/** The job's open batch (sent, not closed for this job, not left), or null. One batch per job at a time. */
export const openBatchId = (events: readonly AreaBatchEventRow[]): string | null => latestSentNotIn(events, [AREA_BATCH_CLOSED_EVENT, AREA_BATCH_LEFT_EVENT]);
/** The batch whose quick taps the owner answers: sent and not closed for this job. A home that LEFT its batch (address
 *  moved) still finishes these taps — it just isn't counted in that batch any more. */
export const tapsBatchId = (events: readonly AreaBatchEventRow[]): string | null => latestSentNotIn(events, [AREA_BATCH_CLOSED_EVENT]);
/** Over 10 km from the batch centre (the same radius batches are built with). */
export const outsideBatch = (centre: { lat: number; lng: number }, home: { lat: number; lng: number }): boolean => distanceM(centre, home) > RADIUS_M;
export const nextBatchSeq = (events: readonly AreaBatchEventRow[]) => events.filter((e) => e.event_type === AREA_BATCH_SENT_EVENT).length + 1;

/** Widest gap between two homes in the batch, in km (1 decimal). */
export function batchSpanKm(homes: readonly { lat: number; lng: number }[]): number {
  let m = 0;
  for (let i = 0; i < homes.length; i++) for (let j = i + 1; j < homes.length; j++) m = Math.max(m, distanceM(homes[i]!, homes[j]!));
  return Math.round(m / 100) / 10;
}

export type BatchInstaller = WaitingInstaller & { covers_all_victoria?: boolean | null };
const VIC_POSTCODE = /^[38]\d{3}$/;
/** Installers who can be offered EVERY home: the Choose installer rule (`installerCanBeOffered`, verified postcode area),
 *  or an office-verified "anywhere in Victoria" area for a Victorian postcode. */
export function batchInstallers<I extends BatchInstaller>(installers: readonly I[], homes: readonly { postcode: string; isTest: boolean }[]): I[] {
  if (!homes.length) return [];
  return installers.filter((i) => homes.every((h) => {
    const pc = (h.postcode ?? "").trim();
    const all = i.covers_all_victoria === true && VIC_POSTCODE.test(pc);
    return installerCanBeOffered(all ? { ...i, service_postcodes: [pc] } : i, { postcode: pc || null, isTest: h.isTest });
  }));
}

/** The TEST office login never sees suggested batches (their functions are not on its allowlist); roles unknown → hidden. */
export const showAreaBatches = (roles: readonly string[] | null | undefined): boolean => !!roles && roles.includes("admin") && !roles.includes("qa_office");

// ---- sweep (Task 4): day-2 reminder, day-3 close, day-14 no-answer close. PURE. ----------------------------------------
/** One per job + batch, claimed before the day-2 reminder text. */
export const QUICK_TAPS_REMINDED_EVENT = "quick_taps_reminded";
const ANSWERED = QUICK_TAPS_ANSWERED_EVENT;
const PASS = "pass";
const DECLINES = Object.keys(QUICK_TAPS_DECLINE_REASON);
const HOUR_MS = 3_600_000;
export const REMIND_AFTER_HOURS = 48; // day 2
export const CLOSE_AFTER_HOURS = 72; // day 3
export const NO_ANSWER_CLOSE_HOURS = 14 * 24; // day 14 from the first send
/** cancelJobFully reason for a home whose owner never answered (closed quietly — nobody is told). */
export const NO_ANSWER_CLOSE_REASON = "Quick taps: no answer after 14 days";
export const areaBatchClosedKey = (batchId: string, jobId: string) => `area-batch-closed:v1:${batchId}:${jobId}`;

/** A job as the sweep sees it. `waiting` = still a website job waiting for an installer (Ready Check scheduling stage,
 *  nobody assigned, not deleted or archived). `events` = its batch events, quick-taps answers and reminder claims. */
export type SweepJob = { jobId: string; waiting: boolean; events: readonly AreaBatchEventRow[] };
export type BatchClose = { batchId: string; passJobIds: string[]; freedJobIds: string[]; closeJobIds: string[] };
export type BatchSweepPlan = { reminders: { batchId: string; jobId: string }[]; closes: BatchClose[]; declineRetries: { batchId: string; jobId: string }[]; noAnswerCloses: { batchId: string; jobId: string }[] };
/** A stage change on the job (logEvent `stage_changed`): after a decline / first send it means the office moved or reopened
 *  the job, so the sweep leaves it alone. */
export const STAGE_CHANGED_EVENT = "stage_changed";

const outcomeOf = (e: AreaBatchEventRow) => { const v = (e.details as { outcome?: unknown } | null)?.outcome; return typeof v === "string" ? v : null; };
const has = (j: SweepJob, type: string, batchId: string) => j.events.some((e) => e.event_type === type && bid(e) === batchId);
const answerFor = (j: SweepJob, batchId: string) => j.events.find((e) => e.event_type === ANSWERED && bid(e) === batchId) ?? null;
const passedIn = (j: SweepJob, batchId: string) => { const a = answerFor(j, batchId); return !!a && outcomeOf(a) === PASS; };
/** Sent into this batch carrying a pass from a batch the owner left (not asked again). */
const carriedIn = (j: SweepJob, batchId: string) => j.events.some((e) => e.event_type === AREA_BATCH_SENT_EVENT && bid(e) === batchId && (e.details as { carried_pass?: unknown } | null)?.carried_pass === true);
const stageChangedAfter = (j: SweepJob, iso: string) => j.events.some((e) => e.event_type === STAGE_CHANGED_EVENT && e.created_at > iso);

/** What the 15-minute sweep does now. Nothing here ever offers a run to an installer (Jo's OK, Task 6).
 *  - Day 2 (48h after the batch was sent): ONE reminder to each owner still waiting who hasn't answered, hasn't left the
 *    batch and isn't closed out of it — not during quiet hours (the next tick outside them sends it); never after day 3.
 *    Owners carried in with a standing pass are never reminded.
 *  - Day 3 (72h): the batch closes for every member: passers = answered "pass" (or carried in with a standing pass) and
 *    still waiting; freed = no answer and still waiting (back in the pool). Homes that LEFT the batch, declines and jobs
 *    closed meanwhile are in neither list.
 *  - Any job whose latest answer is a decline but is still waiting (not cancelled yet) → finish the decline again (a
 *    failed close) — not if the job's stage changed after the answer (the office reopened it). Once per job + batch.
 *  - 14 days after the job's FIRST send with no answer at all, still waiting, no stage change since → closed quietly.
 *    Once per job (keyed by the first batch). */
export function planBatchSweep(jobs: readonly SweepJob[], nowIso: string, quiet: boolean): BatchSweepPlan {
  const now = Date.parse(nowIso);
  const plan: BatchSweepPlan = { reminders: [], closes: [], declineRetries: [], noAnswerCloses: [] };
  const batches = new Map<string, { sentAt: number; members: SweepJob[] }>();
  for (const j of jobs) {
    for (const e of j.events) {
      const b = e.event_type === AREA_BATCH_SENT_EVENT ? bid(e) : null;
      if (!b) continue;
      const t = Date.parse(e.created_at);
      const cur = batches.get(b) ?? { sentAt: t, members: [] };
      cur.sentAt = Math.min(cur.sentAt, t);
      if (!cur.members.includes(j)) cur.members.push(j);
      batches.set(b, cur);
    }
  }
  for (const [batchId, { sentAt, members }] of [...batches].sort((a, b) => a[1].sentAt - b[1].sentAt)) {
    const age = now - sentAt;
    if (!Number.isFinite(age)) continue;
    const notClosed = members.filter((j) => !has(j, AREA_BATCH_CLOSED_EVENT, batchId));
    if (!notClosed.length) continue;
    const inBatch = (j: SweepJob) => j.waiting && !has(j, AREA_BATCH_LEFT_EVENT, batchId);
    if (age >= CLOSE_AFTER_HOURS * HOUR_MS) {
      plan.closes.push({
        batchId,
        passJobIds: members.filter((j) => inBatch(j) && (passedIn(j, batchId) || (!answerFor(j, batchId) && carriedIn(j, batchId)))).map((j) => j.jobId).sort(),
        freedJobIds: members.filter((j) => inBatch(j) && !answerFor(j, batchId) && !carriedIn(j, batchId)).map((j) => j.jobId).sort(),
        closeJobIds: notClosed.map((j) => j.jobId).sort(),
      });
    } else if (age >= REMIND_AFTER_HOURS * HOUR_MS && !quiet) {
      for (const j of notClosed) if (inBatch(j) && !answerFor(j, batchId) && !carriedIn(j, batchId) && !has(j, QUICK_TAPS_REMINDED_EVENT, batchId)) plan.reminders.push({ batchId, jobId: j.jobId });
    }
  }
  for (const j of jobs) {
    const answers = j.events.filter((e) => e.event_type === ANSWERED).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const latest = answers[0] ? outcomeOf(answers[0]) : null;
    const latestBatch = answers[0] ? bid(answers[0]) : null;
    if (latest && latestBatch && DECLINES.includes(latest) && j.waiting && !stageChangedAfter(j, answers[0]!.created_at)) plan.declineRetries.push({ batchId: latestBatch, jobId: j.jobId });
    const first = j.events.filter((e) => e.event_type === AREA_BATCH_SENT_EVENT && bid(e)).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    const firstSent = first ? Date.parse(first.created_at) : Number.NaN;
    if (first && !answers.length && j.waiting && Number.isFinite(firstSent) && now - firstSent >= NO_ANSWER_CLOSE_HOURS * HOUR_MS && !stageChangedAfter(j, first.created_at))
      plan.noAnswerCloses.push({ batchId: bid(first)!, jobId: j.jobId });
  }
  return plan;
}

/** The job's pass was handed on: it is in a close's pass list, so it waits for Jo's OK to send it to the installer and is
 *  never put in another batch. */
export const passHandedOn = (events: readonly AreaBatchEventRow[], jobId: string): boolean =>
  events.some((e) => e.event_type === AREA_BATCH_CLOSED_EVENT && ((e.details as { pass_job_ids?: unknown } | null)?.pass_job_ids as unknown[] | undefined)?.includes?.(jobId) === true);
/** A pass not handed on yet (the owner left that batch, or answered as it closed): carried forward — the owner can be put
 *  in a new batch without being asked again, and counts as a passer at that batch's close. */
export const standingPass = (events: readonly AreaBatchEventRow[], jobId: string): boolean => {
  const latest = events.filter((e) => e.event_type === ANSWERED).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return !!latest && outcomeOf(latest) === PASS && !passHandedOn(events, jobId);
};
