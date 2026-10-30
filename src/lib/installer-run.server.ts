// A48 batch 2, part 2 (Jo 30 Oct 2026): the installer's run. I/O only — rules in run-route.core.ts.
// - offerRun: ONLY Jo's tap "Send to installer" on Choose installer (office function; never a sweep). The closed batch's
//   owners who said yes and are still waiting become one run for the installer Jo picked at Send (area_batch_sent
//   installer_business_id): ONE `run_offered` claim per home (route order, 24 h reply window), then the approved installer
//   text once (TEST job / TEST partner → test-send; real → the one real sender `sendRealSms`, type `run_offered`).
// - tradeRun / removeRunHome / declineRun: the installer's run page, business-scoped (trade-view ctxOrThrow — only the
//   run's own business). Owner contact only where the owner agreed to share. Removing / declining sends nothing to owners.
// - sweepRunOffers (15-minute tick): no reply in 24 h → `run_expired` per home. Released homes are batch candidates again
//   with their standing pass (area-batch.core passHandedOn); owners are not asked again. Nothing lands in Needs me.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError } from "./workflow.server";
import { AREA_BATCH_CLOSED_EVENT, AREA_BATCH_SENT_EVENT, batchInstallers } from "./area-batch.core";
import { claimBatchEvent, homePoint, readAll, readByIds } from "./area-batch.server";
import { QUICK_TAPS_ANSWERED_EVENT, type QuickTapAnswers } from "./quick-taps.core";
import { jobWaitingForInstaller } from "./spot-release.core";
import { smsQuietReason } from "./quote-hold.core";
import { fullAddress } from "./address";
import {
  RUN_DECLINED_EVENT, RUN_EVENTS, RUN_OFFERED_TEXT_EVENT, RUN_TEXT_WENT, RUN_EXPIRED_EVENT, RUN_HOME_REMOVED_EVENT, RUN_OFFERED_EVENT, RUN_OFFERED_SMS_TYPE, RUN_REPLY_HOURS,
  RUN_MODE_CHOSEN_EVENT, RUN_SLOT_CONFIRMED_EVENT, RUN_SLOT_CONFIRM_FAILED_EVENT, RUN_SLOT_EVENTS, RUN_SLOT_PROPOSED_EVENT, RUN_SLOT_RELEASED_EVENT, RUN_TIME_REMINDED_EVENT, RUN_TIME_TEXTED_EVENT,
  areaLines, orderRun, runExpiryDue, runIdOf, runLink, runOfferedKey, runOfferedSmsKey, runOfferedText, runReleaseKey, runState, runSuburb, tapRows,
  type RunEventRow, type RunState, type RunStatus,
} from "./run-route.core";
import {
  RUN_DEFAULT_START, RUN_PORTAL_MODE, RUN_TIME_REMINDER_SMS_TYPE, RUN_TIME_SMS_TYPE, freeWindows, holds, planRunDays, runDayBlocker, runDayWords, runDays, runModeKey,
  runSlotConfirmKey, runSlotKey, runSlotReleaseKey, runTimeReminderSmsKey, runTimeReminderText, runTimeSmsKey, runTimeText, slotDue, slotsOf, windowStartAt, windowWords,
  type OwnerRunSlotView, type Slot, type SlotState, type Window,
} from "./run-portal.core";
import { isReadyCheckTime } from "./ready-check-times.core";
import { isClosedOrArchivedJob } from "./mitti.core";

const loose = admin as unknown as SupabaseClient;
const s = (v: unknown) => (v == null ? null : String(v));
const EVENT_COLS = "job_id, event_type, created_at, details";

async function inFours<T>(items: T[], run: (t: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += 4) await Promise.all(items.slice(i, i + 4).map(run));
}
const latestAnswer = (events: readonly RunEventRow[]) =>
  events.filter((e) => e.event_type === QUICK_TAPS_ANSWERED_EVENT).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
const answerOf = (e: RunEventRow | null) => (e?.details ?? {}) as { outcome?: unknown; consent_share?: unknown; answers?: QuickTapAnswers | null };

// ---- Jo's tap: Send to installer ---------------------------------------------------------------------------------------

export type OfferRunResult = { runId: string; installer: string; homes: number; text: { status: string; detail: string } };

/** Jo taps "Send to installer" on a closed batch. Every check first (nothing written if any fails), including that a real
 *  text can go now (customer messages on, the `run_offered` switch on, trade messages not paused, not quiet hours) and that
 *  the installer can still be offered every home; then one run_offered per home; then the installer text once. A batch is
 *  sent to the installer at most once — except that a run whose text never went (failed / held) is re-texted by the same
 *  tap (same run, no new claims). */
export async function offerRun(batchId: string, actorId: string | null, opts: { now?: Date } = {}): Promise<OfferRunResult> {
  const now = opts.now ?? new Date();
  const closed = await readAll("the closed batch", (f, t) => loose.from("workflow_events").select(EVENT_COLS).eq("event_type", AREA_BATCH_CLOSED_EVENT).contains("details", { batch_id: batchId }).range(f, t));
  const passIds = [...new Set(closed.flatMap((e) => { const p = (e["details"] as { pass_job_ids?: unknown } | null)?.pass_job_ids; return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []; }))].sort();
  if (!passIds.length) throw new WorkflowError("That batch has no owners who said yes — nothing was sent.");

  const [jobs, assigned, history] = await Promise.all([
    readByIds("the batch's homes", passIds, (c, f, t) => admin.from("jobs").select("id, job_number, stage, source, channel, deleted_at, qa_archived_at, properties(suburb, postcode)").in("id", c).range(f, t)),
    readByIds("the batch's installers", passIds, (c, f, t) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true).range(f, t)),
    readByIds("the batch's history", passIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).in("event_type", [AREA_BATCH_SENT_EVENT, QUICK_TAPS_ANSWERED_EVENT, RUN_OFFERED_TEXT_EVENT, ...RUN_EVENTS]).range(f, t)),
  ]);
  const ev = history as unknown as RunEventRow[];
  const forBatch = (e: RunEventRow) => (e.details as { batch_id?: unknown } | null)?.batch_id === batchId;
  const jobBy = new Map(jobs.map((j) => [String(j["id"]), j]));
  const withInstaller = new Set(assigned.map((a) => String(a["job_id"])));
  const waiting = (id: string) => {
    const j = jobBy.get(id);
    if (!j || j["qa_archived_at"]) return false;
    return jobWaitingForInstaller({ channel: s(j["channel"]), stage: s(j["stage"]), hasInstaller: withInstaller.has(id), deleted: !!j["deleted_at"] });
  };

  // Already sent to the installer: refused — unless the run is still open and its text never went (resend, same run).
  const existing = ev.filter((e) => e.event_type === RUN_OFFERED_EVENT && forBatch(e)).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const existingState = existing ? runState(runIdOf(existing) ?? "", ev) : null;
  const attempts = existingState ? ev.filter((e) => e.event_type === RUN_OFFERED_TEXT_EVENT && runIdOf(e) === existingState.runId) : [];
  if (existing) {
    const went = attempts.some((e) => (RUN_TEXT_WENT as readonly string[]).includes(String((e.details as { status?: unknown } | null)?.status)));
    if (!existingState || existingState.status !== "offered" || went) throw new WorkflowError("This batch has already been sent to the installer — nothing was sent.");
  }

  const members = existingState ? existingState.memberIds.filter(waiting) : passIds.filter(waiting);
  if (!members.length) throw new WorkflowError("None of the owners in this batch are still waiting — nothing was sent.");
  const testness = new Set(members.map((id) => jobBy.get(id)!["source"] === "qa_test"));
  if (testness.size > 1) throw new WorkflowError("TEST and real homes can't be in the same run — nothing was sent.");

  const sent = ev.find((e) => e.event_type === AREA_BATCH_SENT_EVENT && forBatch(e));
  const businessId = existingState?.businessId || s((sent?.details as { installer_business_id?: unknown } | null)?.installer_business_id);
  if (!businessId) throw new WorkflowError("We can't tell which installer this batch was for — nothing was sent.");
  const { data: biz } = await admin.from("businesses").select("id, name, signer_name, signer_mobile, phone, onboarding_notes").eq("id", businessId).maybeSingle();
  const b = biz as { id: string; name: string | null; signer_name: string | null; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null } | null;
  if (!b) throw new WorkflowError("That installer no longer exists — nothing was sent.");
  const { isTestPartner } = await import("./test-send.core");
  const partnerTest = isTestPartner(b);
  const test = testness.has(true) || partnerTest;

  // The installer must still be able to be offered every home (the Choose installer rule, at the moment of the tap).
  const facts = (await (await import("./installer-waiting.server")).installerFacts([businessId])).find((i) => i.id === businessId);
  const homes = members.map((id) => ({ postcode: ((jobBy.get(id)?.["properties"] as { postcode?: string | null } | null)?.postcode ?? "").trim(), isTest: jobBy.get(id)!["source"] === "qa_test" }));
  if (!facts || !batchInstallers([facts], homes).length) throw new WorkflowError(`${b.name || "That installer"} can't be offered every home in this run right now (not taking jobs, not approved, or doesn't cover the area) — nothing was sent.`);

  // The business owner's mobile (same rule as every other business-owner text).
  const to = b.signer_mobile ?? b.phone ?? null;
  if (!to) throw new WorkflowError(`${b.name || "The installer"} has no mobile on file — nothing was sent.`);
  if (!test) {
    // A real text that would be held must not leave a run waiting with no text: refuse first, like the batch Send.
    const { data: ws } = await loose.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
    const w = (ws ?? null) as { customer_comms_enabled?: boolean | null; sms_message_switches?: Record<string, boolean> | null; trade_messages_paused?: boolean | null } | null;
    if (w?.customer_comms_enabled !== true) throw new WorkflowError("Customer messages are switched off — nothing was sent.");
    if (w?.sms_message_switches?.[RUN_OFFERED_SMS_TYPE] !== true) throw new WorkflowError("The installer run texts are switched off — switch them on in Settings first. Nothing was sent.");
    // From the separate "Pause all trade messages" change: a missing column = not paused.
    if (w?.trade_messages_paused === true) throw new WorkflowError("Trade messages are paused — nothing was sent.");
    // A quiet-hours hold is never re-sent, and the 24-hour reply clock would run overnight.
    if (smsQuietReason(now.toISOString())) throw new WorkflowError("It's quiet hours (8pm–7am) — texts can't go now. Send again after 7am. Nothing was sent.");
  }

  let runId: string; let order: string[]; let offeredAt: string;
  if (existingState) {
    runId = existingState.runId; order = members; offeredAt = existingState.offeredAt;
  } else {
    // Route order on each home's location (the owner's confirmed address; postcode centre while there's no full address).
    const points = new Map<string, { lat: number; lng: number }>();
    await inFours(members, async (id) => { const p = await homePoint(id); if (p) points.set(id, p); });
    order = orderRun(members.map((id) => ({ jobId: id, lat: points.get(id)?.lat ?? Number.NaN, lng: points.get(id)?.lng ?? Number.NaN })));
    runId = crypto.randomUUID();
    offeredAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + RUN_REPLY_HOURS * 3_600_000).toISOString();
    for (const id of order) {
      const won = await claimBatchEvent(id, actorId, RUN_OFFERED_EVENT, `Run of ${order.length} Ready ${order.length === 1 ? "Check" : "Checks"} sent to ${b.name ?? "the installer"} — waiting for them to pick a day (24 hours)`,
        { run_id: runId, batch_id: batchId, business_id: b.id, business_name: b.name, job_ids: order, offered_at: offeredAt, expires_at: expiresAt, offered_by: actorId, idempotency_key: runOfferedKey(batchId, id) });
      if (!won) throw new WorkflowError("This batch has already been sent to the installer — nothing more was sent.");
    }
  }
  const suburb = runSuburb(order.map((id) => (jobBy.get(id)?.["properties"] as { suburb?: string | null } | null)?.suburb));

  const attempt = attempts.length + 1;
  const base = test ? (await import("./test-send.server")).TEST_APP_BASE : (await import("./set-password-link.core")).SET_PASSWORD_BASE;
  const body = runOfferedText({ name: b.signer_name, homes: order.length, suburb, link: runLink(base, runId) });
  let text: { status: string; detail: string };
  try {
    if (test) {
      const first = jobBy.get(order[0]!)!;
      const r = await (await import("./test-send.server")).sendTestSms({ jobId: order[0]!, jobSource: s(first["source"]), partnerIsTest: partnerTest, label: `run_offered:${runId}`, actorId }, to, body);
      text = { status: r.status, detail: r.detail };
    } else {
      const r = await (await import("./sms.server")).sendRealSms({ type: RUN_OFFERED_SMS_TYPE, idempotencyKey: runOfferedSmsKey(runId, attempt), to, body, businessId: b.id, event: { at: now.toISOString(), current: true } });
      text = { status: r.status, detail: r.detail };
    }
  } catch (e) { text = { status: "failed", detail: (e as Error).message }; }
  // Every attempt is recorded (on the run's first home), so a later tap knows whether the text went.
  await claimBatchEvent(order[0]!, actorId, RUN_OFFERED_TEXT_EVENT, `Run text to ${b.name ?? "the installer"}: ${text.status}`, { run_id: runId, batch_id: batchId, attempt, status: text.status, detail: text.detail.slice(0, 200), idempotency_key: `run-offered-text:v1:${runId}:${attempt}` })
    .catch((e) => console.error("run text attempt not recorded", runId, (e as Error).message));
  return { runId, installer: b.name ?? "", homes: order.length, text };
}

// ---- the installer's run page ----------------------------------------------------------------------------------------

async function loadRun(runId: string, userId: string): Promise<{ state: RunState; events: RunEventRow[] }> {
  const { ctxOrThrow } = await import("./trade-view.server");
  const c = await ctxOrThrow(userId);
  const offered = await readAll("the run", (f, t) => loose.from("workflow_events").select(EVENT_COLS).eq("event_type", RUN_OFFERED_EVENT).contains("details", { run_id: runId }).range(f, t));
  const first = offered[0] as unknown as RunEventRow | undefined;
  if (!first || s((first.details as { business_id?: unknown } | null)?.business_id) !== c.biz.id) throw new WorkflowError("This run isn't for your business.");
  const jobIds = [...new Set(offered.map((e) => String(e["job_id"])))];
  const events = (await readByIds("the run's history", jobIds, (ch, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", ch).in("event_type", [...RUN_EVENTS]).range(f, t))) as unknown as RunEventRow[];
  const state = runState(runId, events);
  if (!state) throw new WorkflowError("This run isn't for your business.");
  return { state, events };
}

export type RunPageHome = { jobId: string; jobNumber: string; address: string; ownerName: string | null; phone: string | null; area: string[]; taps: [string, string][]; slot: { window: string; state: SlotState } | null };
/** `days` = the days the installer can pick (offered runs only); `defaultStart` = 8:00. */
export type RunPage = { runId: string; status: RunStatus; expiresAt: string; suburb: string; homes: RunPageHome[]; days: string[]; defaultStart: string };

/** The run page: each home still in the run (route order) — address, owner name + phone where the owner agreed to share,
 *  m² with its source (best first) and the quick-tap answers. A closed job (cancelled meanwhile) is left out. */
export async function tradeRun(runId: string, userId: string, opts: { now?: Date } = {}): Promise<RunPage> {
  const { state, events } = await loadRun(runId, userId);
  const open = state.status === "offered" || state.status === "answered";
  const ids = open ? state.memberIds : [];
  const days = state.status === "offered" ? runDays(opts.now ?? new Date()) : [];
  if (!ids.length) return { runId, status: state.status, expiresAt: state.expiresAt, suburb: "", homes: [], days: [], defaultStart: RUN_DEFAULT_START };
  const slotBy = new Map(slotsOf(events).filter((x) => x.runId === runId).map((x) => [x.jobId, x]));
  const [jobs, answers] = await Promise.all([
    readByIds("the run's homes", ids, (c, f, t) => admin.from("jobs").select("id, job_number, stage, deleted_at, qa_archived_at, property_id, estimated_area_m2, estimated_area_unknown, owners(full_name, phone), properties(address_line, suburb, postcode)").in("id", c).range(f, t)),
    readByIds("the owners' answers", ids, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).eq("event_type", QUICK_TAPS_ANSWERED_EVENT).range(f, t)),
  ]);
  const propIds = [...new Set(jobs.map((j) => s(j["property_id"])).filter((x): x is string => !!x))];
  const facts = propIds.length ? await readByIds("area estimates", propIds, (c, f, t) => loose.from("property_facts").select("property_id, value").in("property_id", c).eq("fact_key", "preliminary_ceiling_area").eq("is_current", true).range(f, t)) : [];
  const jobBy = new Map(jobs.map((j) => [String(j["id"]), j]));
  const homes: RunPageHome[] = [];
  for (const id of ids) {
    const j = jobBy.get(id);
    if (!j || j["deleted_at"] || j["qa_archived_at"] || j["stage"] === "cancelled") continue;
    const a = answerOf(latestAnswer((answers as unknown as RunEventRow[]).filter((e) => e.job_id === id)));
    const share = a.consent_share === true;
    const owner = (j["owners"] ?? null) as { full_name?: string | null; phone?: string | null } | null;
    const p = (j["properties"] ?? null) as { address_line?: string | null; suburb?: string | null; postcode?: string | null } | null;
    const prelim = facts.find((f) => f["property_id"] === j["property_id"])?.["value"] as { net_m2?: unknown; tier?: unknown } | null | undefined;
    homes.push({
      jobId: id, jobNumber: String(j["job_number"] ?? ""), address: fullAddress(p?.address_line, p?.suburb, p?.postcode),
      ownerName: share ? (owner?.full_name ?? "").trim() || null : null, phone: share ? owner?.phone ?? null : null,
      area: areaLines({ ownerM2: j["estimated_area_unknown"] ? null : (j["estimated_area_m2"] as number | null), prelim }),
      taps: tapRows(a.answers ?? null),
      slot: (() => { const x = slotBy.get(id); return x ? { window: `${runDayWords(x.day)}, ${windowWords(x.start, x.end)}`, state: x.state } : null; })(),
    });
  }
  const suburbs = homes.map((h) => (jobBy.get(h.jobId)?.["properties"] as { suburb?: string | null } | null)?.suburb);
  return { runId, status: state.status, expiresAt: state.expiresAt, suburb: runSuburb(suburbs), homes, days, defaultStart: RUN_DEFAULT_START };
}

const NOT_OPEN = "This run is no longer open.";

/** The installer removes a home before choosing a day: back in the pool (owner not told). Every home removed → the run
 *  ends (nothing sent to anyone). Twice → once. */
export async function removeRunHome(runId: string, jobId: string, userId: string): Promise<{ status: RunStatus }> {
  const { state } = await loadRun(runId, userId);
  if (!state.jobIds.includes(jobId)) throw new WorkflowError("That home isn't in this run.");
  if (state.removedIds.includes(jobId)) return { status: state.status };
  if (state.status !== "offered") throw new WorkflowError(NOT_OPEN);
  await claimBatchEvent(jobId, userId, RUN_HOME_REMOVED_EVENT, "Installer took this home out of their run — back on the list for the next batch (owner not told)",
    { run_id: runId, batch_id: state.batchId, business_id: state.businessId, removed_by: userId, idempotency_key: runReleaseKey(RUN_HOME_REMOVED_EVENT, runId, jobId) });
  return { status: state.memberIds.length <= 1 ? "ended" : state.status };
}

/** The installer says no: every home still in the run goes back to Jo's suggestions (owners not asked again). */
export async function declineRun(runId: string, userId: string): Promise<{ status: RunStatus }> {
  const { state } = await loadRun(runId, userId);
  if (state.status !== "offered") throw new WorkflowError(NOT_OPEN);
  await releaseAll(state, RUN_DECLINED_EVENT, userId, "Installer said no to the run — back on the list for the next batch (owner not asked again)");
  return { status: "declined" };
}

async function releaseAll(state: RunState, type: typeof RUN_DECLINED_EVENT | typeof RUN_EXPIRED_EVENT, actorId: string | null, summary: string): Promise<number> {
  let n = 0;
  await inFours(state.memberIds, async (jobId) => {
    if (await claimBatchEvent(jobId, actorId, type, summary, { run_id: state.runId, batch_id: state.batchId, business_id: state.businessId, idempotency_key: runReleaseKey(type, state.runId, jobId) })) n++;
  });
  return n;
}

// ---- 15-minute tick ------------------------------------------------------------------------------------------------------

/** Runs offered in the last 7 days (each expires 24 h after the offer). */
const SWEEP_DAYS = 7;
export type RunSweep = { runs: number; expired: number; failed: number };

/** No reply within 24 hours → `run_expired` for every home still in the run (back in Jo's suggestions). Nothing is sent. */
export async function sweepRunOffers(nowIso: string = new Date().toISOString()): Promise<RunSweep> {
  const out: RunSweep = { runs: 0, expired: 0, failed: 0 };
  const since = new Date(Date.parse(nowIso) - SWEEP_DAYS * 86_400_000).toISOString();
  const offered = await readAll("offered runs", (f, t) => loose.from("workflow_events").select("job_id, details").eq("event_type", RUN_OFFERED_EVENT).gte("created_at", since).order("created_at").range(f, t));
  const runIds = [...new Set(offered.map((e) => runIdOf(e as unknown as RunEventRow)).filter((x): x is string => !!x))];
  if (!runIds.length) return out;
  const jobIds = [...new Set(offered.map((e) => String(e["job_id"])))];
  const events = (await readByIds("run history", jobIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).in("event_type", [...RUN_EVENTS]).range(f, t))) as unknown as RunEventRow[];
  out.runs = runIds.length;
  for (const runId of runIds) {
    const st = runState(runId, events);
    if (!st || !runExpiryDue(st, nowIso)) continue;
    try { out.expired += await releaseAll(st, RUN_EXPIRED_EVENT, null, "No reply from the installer within 24 hours — back on the list for the next batch (owner not asked again)"); }
    catch (e) { out.failed++; console.error("run expiry failed", runId, (e as Error).message); }
  }
  return out;
}


// ---- Portal books (Task 7) -------------------------------------------------------------------------------------------------
// The installer picks the day (≥ 2 days ahead) + start (default 8:00) on the run page → `run_mode_chosen {mode: "portal"}`
// per home (stops the 24 h installer expiry) → one `run_slot_proposed` per home (1-hour windows in route order, after any
// windows the same installer already holds that day) → each owner's time text (TEST → test-send; real → the one real sender,
// type `run_time`; quiet hours → the 15-minute tick sends it after 7am). The owner confirms on My job (secure link + code):
// the window books through ready-check-times bookAgreedTime → confirmBooking(job, "ready_check", …) — every existing Ready
// Check rule, message and Mitti step — with the installer assigned to the job first (the person who picked the day).
// "Can't make it" → another free window that day (booked straight away). None suit / no confirm within 24 h of the text →
// `run_slot_released`: back in the pool with the standing pass (area-batch.core passHandedOn). Nothing lands in Needs me.

const NOT_AVAILABLE = "That time is not available.";
/** Existing Ready Check wording (ready-check-times.server claim). */
const TAKEN = "That time has just been taken or has passed.";
const SLOT_LOOKBACK_DAYS = 45;

type SlotJob = { id: string; stage: string | null; source: string | null; channel: string | null; deleted_at: string | null; qa_archived_at: string | null; owners: { full_name: string | null; phone: string | null } | null };
const slotJobsById = async (ids: string[]) => new Map((await readByIds("the run's homes", ids, (c, f, t) => admin.from("jobs").select("id, stage, source, channel, deleted_at, qa_archived_at, owners(full_name, phone)").in("id", c).range(f, t)) as unknown as SlotJob[]).map((j) => [j.id, j]));
const slotEventsFor = async (jobIds: string[]) => (jobIds.length ? (await readByIds("run windows", jobIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).in("event_type", [...RUN_SLOT_EVENTS]).range(f, t))) : []) as unknown as RunEventRow[];

/** Every window the business has on these days (any run, any state), which of those homes are closed, and the earliest
 *  window ever proposed on the first day (the start of that day's grid of 8). */
async function businessDays(businessId: string, days: string[], now: Date): Promise<{ slots: Slot[]; closed: Set<string>; gridStart: string | null }> {
  const since = new Date(now.getTime() - SLOT_LOOKBACK_DAYS * 86_400_000).toISOString();
  const proposed = (await readAll("the installer's windows", (f, t) => loose.from("workflow_events").select("job_id, details").eq("event_type", RUN_SLOT_PROPOSED_EVENT).contains("details", { business_id: businessId }).gte("created_at", since).range(f, t)))
    .filter((e) => days.includes(String((e["details"] as { day?: unknown } | null)?.day)));
  const jobIds = [...new Set(proposed.map((e) => String(e["job_id"])))];
  if (!jobIds.length) return { slots: [], closed: new Set(), gridStart: null };
  const starts = proposed.filter((e) => (e["details"] as { day?: unknown }).day === days[0]).map((e) => String((e["details"] as { start?: unknown }).start ?? "")).filter(Boolean).sort();
  const [events, jobs] = await Promise.all([slotEventsFor(jobIds), slotJobsById(jobIds)]);
  const closed = new Set(jobIds.filter((id) => isClosedOrArchivedJob(jobs.get(id))));
  return { slots: slotsOf(events).filter((x) => x.businessId === businessId && days.includes(x.day)), closed, gridStart: starts[0] ?? null };
}
const heldBy = (d: { slots: Slot[]; closed: Set<string> }, keep: (x: Slot) => boolean): Window[] =>
  d.slots.filter((x) => holds(x) && !d.closed.has(x.jobId) && keep(x)).map((x) => ({ day: x.day, start: x.start, end: x.end }));

export type ChooseRunDayResult = { slots: { jobId: string; day: string; start: string; end: string }[] };

/** Installer, Portal books: pick the day (and a second day when more than 8 homes don't fit) and the start time. */
export async function chooseRunDay(runId: string, userId: string, dayIso: string, startHHMM: string | null | undefined = RUN_DEFAULT_START, secondDayIso: string | null = null, opts: { now?: Date } = {}): Promise<ChooseRunDayResult> {
  const now = opts.now ?? new Date();
  const { state } = await loadRun(runId, userId);
  if (state.status !== "offered" || runExpiryDue(state, now.toISOString())) throw new WorkflowError(NOT_OPEN);
  const start = startHHMM || RUN_DEFAULT_START;
  if (!isReadyCheckTime(start)) throw new WorkflowError("Please choose a time.");
  const b1 = runDayBlocker(dayIso, now);
  if (b1) throw new WorkflowError(b1);
  const second = secondDayIso || null;
  if (second) {
    const b2 = runDayBlocker(second, now);
    if (b2) throw new WorkflowError(b2);
    if (second === dayIso) throw new WorkflowError("Please pick a different second day.");
  }
  // Homes still waiting for an installer (a home cancelled meanwhile is left out and never texted).
  const [jobs, assigned] = await Promise.all([slotJobsById(state.memberIds), readByIds("installers", state.memberIds, (c, f, t) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true).range(f, t))]);
  const withInstaller = new Set(assigned.map((a) => String(a["job_id"])));
  const members = state.memberIds.filter((id) => { const j = jobs.get(id); return !!j && !j.qa_archived_at && jobWaitingForInstaller({ channel: j.channel, stage: j.stage, hasInstaller: withInstaller.has(id), deleted: !!j.deleted_at }); });
  if (!members.length) throw new WorkflowError("None of the homes in this run are still waiting.");
  // Same day twice: windows this installer already holds on those days (other runs) come first.
  const days = second ? [dayIso, second] : [dayIso];
  const held = heldBy(await businessDays(state.businessId, days, now), (x) => x.runId !== runId);
  const plan = planRunDays({ memberIds: members, day: dayIso, start, secondDay: second, held });
  if (!plan.ok) throw new WorkflowError(plan.why);
  for (const id of members) {
    const won = await claimBatchEvent(id, userId, RUN_MODE_CHOSEN_EVENT, `Installer chose Portal books: ${runDayWords(dayIso)}${second ? ` and ${runDayWords(second)}` : ""}, from ${start}`,
      { run_id: runId, batch_id: state.batchId, business_id: state.businessId, mode: RUN_PORTAL_MODE, day: dayIso, second_day: second, start, chosen_by: userId, idempotency_key: runModeKey(runId, id) });
    if (!won) throw new WorkflowError(NOT_OPEN);
  }
  for (const x of plan.slots) {
    await claimBatchEvent(x.jobId, userId, RUN_SLOT_PROPOSED_EVENT, `Ready Check window ${runDayWords(x.day)}, ${windowWords(x.start, x.end)} — waiting for the owner to confirm`,
      { run_id: runId, batch_id: state.batchId, business_id: state.businessId, seq: 1, day: x.day, start: x.start, end: x.end, starts_at: windowStartAt(x.day, x.start).toISOString(), by: "portal", idempotency_key: runSlotKey(runId, x.jobId, 1) });
  }
  // The owners' texts now (outside quiet hours); anything held goes from the 15-minute tick.
  await sweepRunSlots(now.toISOString(), { jobIds: plan.slots.map((x) => x.jobId) }).catch((e) => console.error("run time texts deferred to the tick", runId, (e as Error).message));
  return { slots: plan.slots };
}

const tradeName = (b: { name?: string | null; trading_name?: string | null } | null) => ((b?.trading_name ?? b?.name ?? "") || "your installer").replace(/^\[TEST PARTNER\]\s*/, "");
async function businessOf(id: string) {
  const { data } = await admin.from("businesses").select("id, name, trading_name, onboarding_notes").eq("id", id).maybeSingle();
  return data as { id: string; name: string | null; trading_name?: string | null; onboarding_notes: string | null } | null;
}

/** The owner's time text or 12-hour reminder, once per window. Quiet hours / held → nothing recorded (the tick retries). */
async function textSlot(x: Slot, job: SlotJob, kind: "time" | "reminder", now: Date): Promise<string> {
  if (smsQuietReason(now.toISOString())) return "quiet hours";
  const link = await (await import("./veec-copy-email.server")).ownerMyJobLink(x.jobId);
  if (!link) return "owner link missing";
  const to = job.owners?.phone ?? null;
  if (!to) return "no mobile";
  const biz = await businessOf(x.businessId);
  const f = { name: job.owners?.full_name ?? null, day: runDayWords(x.day), time: windowWords(x.start, x.end), link };
  const body = kind === "time" ? runTimeText({ ...f, installer: tradeName(biz) }) : runTimeReminderText(f);
  const type = kind === "time" ? RUN_TIME_SMS_TYPE : RUN_TIME_REMINDER_SMS_TYPE;
  const { isTestPartner } = await import("./test-send.core");
  let r: { status: string; detail: string };
  try {
    if (job.source === "qa_test" || isTestPartner(biz)) r = await (await import("./test-send.server")).sendTestSms({ jobId: x.jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `${type}:${x.runId}:${x.seq}`, actorId: null }, to, body);
    else r = await (await import("./sms.server")).sendRealSms({ type, idempotencyKey: kind === "time" ? runTimeSmsKey(x.runId, x.jobId, x.seq) : runTimeReminderSmsKey(x.runId, x.jobId, x.seq), to, body, jobId: x.jobId });
  } catch (e) { r = { status: "failed", detail: (e as Error).message }; }
  if ((RUN_TEXT_WENT as readonly string[]).includes(r.status)) {
    await claimBatchEvent(x.jobId, null, kind === "time" ? RUN_TIME_TEXTED_EVENT : RUN_TIME_REMINDED_EVENT, kind === "time" ? "Owner texted their Ready Check window to confirm" : "Owner reminded to confirm their Ready Check window (12 hours)",
      { run_id: x.runId, business_id: x.businessId, seq: x.seq, status: r.status, idempotency_key: `${type}-sent:v1:${x.runId}:${x.jobId}:${x.seq}` });
  }
  return r.status;
}

async function releaseSlot(x: Slot, actorId: string | null, why: "none_suit" | "no_confirm"): Promise<boolean> {
  return claimBatchEvent(x.jobId, actorId, RUN_SLOT_RELEASED_EVENT, why === "none_suit" ? "Owner said none of the times suit — back on the list for the next batch (not asked again)" : "Owner didn't confirm their Ready Check window within 24 hours — back on the list for the next batch (not asked again)",
    { run_id: x.runId, batch_id: x.batchId, business_id: x.businessId, seq: x.seq, why, idempotency_key: runSlotReleaseKey(x.runId, x.jobId) });
}

export type RunSlotSweep = { texted: number; reminded: number; released: number; failed: number };
/** 15-minute tick: each waiting window → the owner's text (when it hasn't gone), the 12-hour reminder (once), or released
 *  24 hours after the text (or when the window starts with no text). A home closed meanwhile is skipped and never texted. */
export async function sweepRunSlots(nowIso: string = new Date().toISOString(), opts: { jobIds?: string[] } = {}): Promise<RunSlotSweep> {
  const out: RunSlotSweep = { texted: 0, reminded: 0, released: 0, failed: 0 };
  const now = new Date(nowIso);
  let jobIds = opts.jobIds;
  if (!jobIds) {
    const since = new Date(now.getTime() - SLOT_LOOKBACK_DAYS * 86_400_000).toISOString();
    const proposed = await readAll("run windows", (f, t) => loose.from("workflow_events").select("job_id").eq("event_type", RUN_SLOT_PROPOSED_EVENT).gte("created_at", since).range(f, t));
    jobIds = [...new Set(proposed.map((e) => String(e["job_id"])))];
  }
  if (!jobIds.length) return out;
  const [events, jobs] = await Promise.all([slotEventsFor(jobIds), slotJobsById(jobIds)]);
  for (const x of slotsOf(events).filter((y) => y.state === "proposed")) {
    const job = jobs.get(x.jobId);
    if (!job || isClosedOrArchivedJob(job)) continue;
    try {
      const due = slotDue(x, now);
      if (due === "release") { if (await releaseSlot(x, null, "no_confirm")) out.released++; }
      else if (due === "text") { if ((RUN_TEXT_WENT as readonly string[]).includes(await textSlot(x, job, "time", now))) out.texted++; }
      else if (due === "remind") { if ((RUN_TEXT_WENT as readonly string[]).includes(await textSlot(x, job, "reminder", now))) out.reminded++; }
    } catch (e) { out.failed++; console.error("run window step failed", x.runId, x.jobId, (e as Error).message); }
  }
  return out;
}

// ---- the owner (My job, secure link + code) ------------------------------------------------------------------------------

async function ownerSlot(jobId: string): Promise<Slot | null> {
  const mine = slotsOf(await slotEventsFor([jobId])).filter((x) => x.jobId === jobId).sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
  return mine.find(holds) ?? mine[0] ?? null;
}
async function freeFor(x: Slot, now: Date): Promise<{ start: string; end: string }[]> {
  const d = await businessDays(x.businessId, [x.day], now);
  return freeWindows({ day: x.day, gridStart: d.gridStart ?? x.start, held: heldBy(d, (y) => y.jobId !== x.jobId), now }).filter((w) => w.start !== x.start);
}


/** What the owner's run card shows. Never shows other owners' details. */
export async function ownerRunSlotState(jobId: string, opts: { now?: Date } = {}): Promise<OwnerRunSlotView> {
  const now = opts.now ?? new Date();
  const x = await ownerSlot(jobId);
  if (!x || x.state === "released") return { kind: "none" };
  const { data: job } = await admin.from("jobs").select("stage, deleted_at, qa_archived_at").eq("id", jobId).maybeSingle();
  if (!job || isClosedOrArchivedJob(job)) return { kind: "none" };
  const base = { day: runDayWords(x.day), time: windowWords(x.start, x.end), installer: tradeName(await businessOf(x.businessId)) };
  if (x.state === "confirmed") return { kind: "confirmed", ...base };
  return { kind: "proposed", ...base, free: (await freeFor(x, now)).map((w) => ({ ...w, label: windowWords(w.start, w.end) })) };
}

/** Book the window: the installer is assigned (the person who picked the day), then the existing Ready Check booking. */
async function bookSlot(x: Slot, actorId: string): Promise<{ ok: true; booked: true }> {
  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("id, stage, channel, deleted_at, qa_archived_at").eq("id", x.jobId).maybeSingle(),
    admin.from("job_assignments").select("id, business_id").eq("job_id", x.jobId).eq("role", "installer").eq("active", true).maybeSingle(),
  ]);
  if (!job || isClosedOrArchivedJob(job) || job.stage !== "ready_check_ready_to_schedule" || (asg && asg.business_id !== x.businessId)) throw new WorkflowError(NOT_AVAILABLE);
  const attempt = x.failedConfirms + 1;
  const won = await claimBatchEvent(x.jobId, actorId, RUN_SLOT_CONFIRMED_EVENT, `Owner confirmed their Ready Check window: ${runDayWords(x.day)}, ${windowWords(x.start, x.end)}`,
    { run_id: x.runId, batch_id: x.batchId, business_id: x.businessId, seq: x.seq, day: x.day, start: x.start, end: x.end, idempotency_key: runSlotConfirmKey(x.runId, x.jobId, x.seq, attempt) });
  if (!won) return { ok: true, booked: true }; // a second tap: the first one books
  let created: string | null = null;
  try {
    if (!asg) {
      const chosen = (await readAll("the run's choice", (f, t) => loose.from("workflow_events").select("details").eq("job_id", x.jobId).eq("event_type", RUN_MODE_CHOSEN_EVENT).contains("details", { run_id: x.runId }).range(f, t)))[0];
      const by = s((chosen?.["details"] as { chosen_by?: unknown } | null)?.chosen_by);
      if (!by) throw new WorkflowError(NOT_AVAILABLE);
      const { data: row, error } = await admin.from("job_assignments").insert({ job_id: x.jobId, user_id: by, role: "installer", business_id: x.businessId, assigned_by: by, first_response_at: new Date().toISOString() } as never).select("id").single();
      if (error || !row) throw new Error(error?.message ?? "The installer could not be assigned.");
      created = (row as { id: string }).id;
    }
    const { bookAgreedTime } = await import("./ready-check-times.server");
    await bookAgreedTime(x.jobId, null, windowStartAt(x.day, x.start).toISOString(), actorId, "owner (run window)");
  } catch (e) {
    if (created) await admin.from("job_assignments").update({ active: false } as never).eq("id", created);
    await claimBatchEvent(x.jobId, actorId, RUN_SLOT_CONFIRM_FAILED_EVENT, `Ready Check window not booked: ${(e as Error).message}`,
      { run_id: x.runId, business_id: x.businessId, seq: x.seq, reason: (e as Error).message.slice(0, 200), idempotency_key: `run-slot-confirm-failed:v1:${x.runId}:${x.jobId}:${x.seq}:${attempt}` }).catch(() => undefined);
    throw e;
  }
  return { ok: true, booked: true };
}

/** Owner: "Confirm" their window = booked. A repeat tap books nothing more. */
export async function ownerConfirmRunSlot(jobId: string, userId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const x = await ownerSlot(jobId);
  if (x?.state === "confirmed") return { ok: true as const, booked: true as const };
  if (!x || x.state !== "proposed" || windowStartAt(x.day, x.start).getTime() <= now.getTime()) throw new WorkflowError(NOT_AVAILABLE);
  return bookSlot(x, userId);
}

/** Owner: "Can't make it" → take another free window that day = booked there. */
export async function ownerPickRunWindow(jobId: string, userId: string, start: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const x = await ownerSlot(jobId);
  if (!x || x.state !== "proposed") throw new WorkflowError(NOT_AVAILABLE);
  if (start === x.start) return ownerConfirmRunSlot(jobId, userId, opts);
  const w = (await freeFor(x, now)).find((f) => f.start === start);
  if (!w) throw new WorkflowError(TAKEN);
  const seq = x.seq + 1;
  const won = await claimBatchEvent(jobId, userId, RUN_SLOT_PROPOSED_EVENT, `Owner picked another Ready Check window: ${runDayWords(x.day)}, ${windowWords(w.start, w.end)}`,
    { run_id: x.runId, batch_id: x.batchId, business_id: x.businessId, seq, day: x.day, start: w.start, end: w.end, starts_at: windowStartAt(x.day, w.start).toISOString(), by: "owner", idempotency_key: runSlotKey(x.runId, jobId, seq) });
  if (!won) throw new WorkflowError(TAKEN);
  return bookSlot({ ...x, seq, start: w.start, end: w.end, textedAt: null, remindedAt: null, failedConfirms: 0 }, userId);
}

/** Owner: none of the times suit → back in the pool (not asked again). Twice → once. */
export async function ownerNoRunWindow(jobId: string, userId: string, _opts: { now?: Date } = {}) {
  const x = await ownerSlot(jobId);
  if (x?.state === "released") return { ok: true as const };
  if (!x || x.state !== "proposed") throw new WorkflowError(NOT_AVAILABLE);
  await releaseSlot(x, userId, "none_suit");
  return { ok: true as const };
}
