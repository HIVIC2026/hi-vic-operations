// A48 batch 2, part 2 (Jo 30 Oct 2026): the installer's run. I/O only — rules in run-route.core.ts.
// - offerRun: ONLY Jo's tap "Send to installer" on Choose installer (office function; never a sweep). The closed batch's
//   owners who said yes and are still waiting become one run for the installer Jo picked at Send (area_batch_sent
//   installer_business_id): ONE `run_offered` claim per home (route order, 24 h reply window), then the approved installer
//   text once (TEST job / TEST partner → test-send; real → the one real sender `sendRealSms`, type `run_offered`).
// - tradeRun / removeRunHome / declineRun: the installer's run page, business-scoped (trade-view ctxOrThrow — only the
//   run's own business). Owner contact only where the owner agreed to share. Removing / declining sends nothing to owners.
// - returnBatchToSuggestions: Jo's office "Back to suggestions" on a closed batch (final review I2) — passers back in the pool.
// - sweepRunOffers (15-minute tick): no reply in 24 h (or no text went within 24 h of the offer) → `run_expired` per home. Released homes are batch candidates again
//   with their standing pass (area-batch.core passHandedOn); owners are not asked again. Nothing lands in Needs me.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError } from "./workflow.server";
import { AREA_BATCH_CLOSED_EVENT, AREA_BATCH_RETURNED_EVENT, AREA_BATCH_SENT_EVENT, areaBatchReturnedKey, batchInstallers } from "./area-batch.core";
import { claimBatchEvent, homePoint, readAll, readByIds } from "./area-batch.server";
import { QUICK_TAPS_ANSWERED_EVENT, type QuickTapAnswers } from "./quick-taps.core";
import { jobWaitingForInstaller } from "./spot-release.core";
import { smsQuietReason } from "./quote-hold.core";
import { fullAddress } from "./address";
import {
  RUN_DECLINED_EVENT, RUN_EVENTS, RUN_OFFERED_TEXT_EVENT, RUN_TEXT_WENT, RUN_EXPIRED_EVENT, RUN_HOME_REMOVED_EVENT, RUN_OFFERED_EVENT, RUN_OFFERED_SMS_TYPE, RUN_REPLY_HOURS,
  RUN_MODE_CHOSEN_EVENT, RUN_MOVED_EVENT, RUN_SLOT_CANCELLED_EVENT, RUN_SLOT_CONFIRMED_EVENT, RUN_SLOT_CONFIRM_FAILED_EVENT, RUN_SLOT_EVENTS, RUN_SLOT_PROPOSED_EVENT, RUN_SLOT_RELEASED_EVENT, RUN_TIME_REMINDED_EVENT, RUN_TIME_TEXTED_EVENT,
  areaLines, isFillRow, orderRun, windowsFor, runExpiryDue, runIdOf, runLink, runOfferedKey, runOfferedSmsKey, runOfferedText, runReleaseKey, runState, runSuburb, tapRows,
  type RunEventRow, type RunState, type RunStatus,
} from "./run-route.core";
import {
  RUN_DEFAULT_START, RUN_FILL_RADIUS_M, RUN_PICK_TOO_SOON, RUN_PORTAL_MODE, RUN_SLOT_CANCELLED_SMS_TYPE, RUN_TEAM_MODE, RUN_TIME_REMINDER_SMS_TYPE, RUN_TIME_SMS_TYPE, RUN_WINDOW_CLAIMED_EVENT, RUN_WINDOW_EVENTS, RUN_WINDOW_FREED_EVENT,
  addDaysYmd, claimHolds, currentClaim, freeWindows, holds, pickTooSoon, planRunDays, runDayBlocker, runDayWords, runDays, runModeKey,
  runSlotCancelledKey, runSlotCancelledSmsKey, runSlotCancelledText, runSlotFilledKey, runTeamExpired, slotTimeWords,
  runSlotConfirmKey, runSlotKey, runSlotReleaseKey, runTeamTimeText, runTimeReminderSmsKey, runTimeReminderText, runTimeSmsKey, runTimeText, runWindowFreedKey, runWindowKey, slotDue, slotsOf, windowSlots, windowStartAt, windowWords,
  type OwnerRunSlotView, type Slot, type SlotState, type Window, type WindowClaim,
} from "./run-portal.core";
import { isReadyCheckTime } from "./ready-check-times.core";
import { smsHeldForRecipient } from "./sms.core";
import { isClosedOrArchivedJob } from "./mitti.core";
import { distanceM } from "./geo.core";

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
export async function offerRun(batchId: string, actorId: string | null, opts: { now?: Date; businessId?: string | null } = {}): Promise<OfferRunResult> {
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
    if (!existingState || existingState.status !== "offered" || existingState.textWent) throw new WorkflowError("This batch has already been sent to the installer — nothing was sent.");
    // 24 hours from the offer with no text: the run is expiring (the tick puts its owners back in the pool).
    if (runExpiryDue(existingState, now.toISOString())) throw new WorkflowError("This run's 24 hours are up without the text going, so its owners go back in the suggestions — nothing was sent.");
    // Send again goes to the run's own installer (final review I2: another installer = Back to suggestions first).
    if (opts.businessId && opts.businessId !== existingState.businessId) throw new WorkflowError("Send again goes to the installer this run was given to — tap Back to suggestions to choose another installer — nothing was sent.");
  }

  const members = existingState ? existingState.memberIds.filter(waiting) : passIds.filter(waiting);
  if (!members.length) throw new WorkflowError("None of the owners in this batch are still waiting — nothing was sent.");
  const testness = new Set(members.map((id) => jobBy.get(id)!["source"] === "qa_test"));
  if (testness.size > 1) throw new WorkflowError("TEST and real homes can't be in the same run — nothing was sent.");

  const sent = ev.find((e) => e.event_type === AREA_BATCH_SENT_EVENT && forBatch(e));
  // Final review I2: Jo may pick any installer that covers every home (default: the one she picked at Send).
  const businessId = existingState?.businessId || opts.businessId || s((sent?.details as { installer_business_id?: unknown } | null)?.installer_business_id);
  if (!businessId) throw new WorkflowError("We can't tell which installer this batch was for — nothing was sent.");
  const { data: biz } = await admin.from("businesses").select("id, name, signer_name, signer_mobile, phone, onboarding_notes").eq("id", businessId).maybeSingle();
  const b = biz as { id: string; name: string | null; signer_name: string | null; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null } | null;
  if (!b) throw new WorkflowError("That installer no longer exists — nothing was sent.");
  const { isTestPartner } = await import("./test-send.core");
  const partnerTest = isTestPartner(b);
  const test = testness.has(true) || partnerTest;

  // The installer must still be able to be offered every home (the Choose installer rule, at the moment of the tap).
  const homes = members.map((id) => ({ postcode: ((jobBy.get(id)?.["properties"] as { postcode?: string | null } | null)?.postcode ?? "").trim(), isTest: jobBy.get(id)!["source"] === "qa_test" }));
  if (!(await canTakeHomes(businessId, homes))) throw new WorkflowError(`${b.name || "That installer"} can't be offered every home in this run right now (not taking jobs, not approved, or doesn't cover the area) — nothing was sent.`);

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

/** The business can be offered every one of these homes (approved, active, taking jobs, credentials, a Full-EEC installer,
 *  covers the area — the Choose installer rule `installerCanBeOffered`). */
async function canTakeHomes(businessId: string, homes: { postcode: string; isTest: boolean }[]): Promise<boolean> {
  const facts = (await (await import("./installer-waiting.server")).installerFacts([businessId])).find((i) => i.id === businessId);
  return !!facts && batchInstallers([facts], homes).length > 0;
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
/** Task 8: a confirmed window the owner cancelled (their job was cancelled) — "Fill from nearby waiting owners". No owner
 *  details. `filledBy` = the job number of the owner it was offered to, once tapped. */
export type RunPageCancelled = { jobId: string; window: string; filledBy: string | null };
export type RunTeamMember = { userId: string; name: string };
/** `days` = the days the installer can pick (offered runs only); `defaultStart` = 8:00; `team` = who can do these Ready
 *  Checks (anyone active in the business's team with a sign-in, Jo 30 Oct); `me` = the person looking (the default). */
export type RunPage = { runId: string; status: RunStatus; expiresAt: string; suburb: string; homes: RunPageHome[]; days: string[]; defaultStart: string; team: RunTeamMember[]; me: string;
  /** How the run is booked once chosen (Task 8): "portal" (Move run available) or "team" (enter each agreed time). */
  mode: "portal" | "team" | null; cancelled: RunPageCancelled[] };

/** Anyone active in the business's team (an active sign-in on the business; Jo 30 Oct: doesn't have to be an approved
 *  installer). Name from their profile, else their staff row. */
async function runTeam(businessId: string): Promise<RunTeamMember[]> {
  const { data: mem } = await admin.from("business_members").select("user_id").eq("business_id", businessId).eq("active", true);
  const ids = [...new Set(((mem ?? []) as { user_id: string }[]).map((m) => m.user_id))];
  if (!ids.length) return [];
  const [{ data: prof }, { data: staff }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", ids),
    admin.from("partner_workers").select("profile_id, full_legal_name").eq("business_id", businessId).in("profile_id", ids).is("removed_at", null),
  ]);
  const name = (id: string) => (((prof ?? []) as { id: string; full_name: string | null }[]).find((p) => p.id === id)?.full_name ?? ((staff ?? []) as { profile_id: string | null; full_legal_name: string | null }[]).find((w) => w.profile_id === id)?.full_legal_name ?? "").trim();
  return ids.map((userId) => ({ userId, name: name(userId) || "Team member" })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- the installer's run page ---

/** The run page: each home still in the run (route order) — address, owner name + phone where the owner agreed to share,
 *  m² with its source (best first) and the quick-tap answers. A closed job (cancelled meanwhile) is left out. */
export async function tradeRun(runId: string, userId: string, opts: { now?: Date } = {}): Promise<RunPage> {
  const { state, events } = await loadRun(runId, userId);
  const open = state.status === "offered" || state.status === "answered";
  const ids = open ? state.memberIds : [];
  const choice = storedChoice(events, runId);
  const mode = state.status === "answered" && choice ? choice.mode : null;
  // Days: to pick (offered) or to move a Portal books run to (answered).
  const days = state.status === "offered" || mode === RUN_PORTAL_MODE ? runDays(opts.now ?? new Date()) : [];
  const team = state.status === "offered" ? await runTeam(state.businessId) : [];
  const runSlots = slotsOf(events).filter((x) => x.runId === runId);
  const cancelledSlots = open ? runSlots.filter((x) => x.state === "cancelled") : [];
  const fills = new Map(events.filter((e) => e.event_type === RUN_OFFERED_EVENT && runIdOf(e) === runId).map((e) => [s((e.details as { filled_from?: unknown } | null)?.filled_from), e.job_id] as const).filter((x): x is [string, string] => !!x[0]));
  const fillJobs = fills.size ? await slotJobsById([...fills.values()]) : new Map<string, SlotJob>();
  const cancelled: RunPageCancelled[] = cancelledSlots.map((x) => ({ jobId: x.jobId, window: `${runDayWords(x.day)}, ${slotTimeWords(x)}`, filledBy: fills.has(x.jobId) ? fillJobs.get(fills.get(x.jobId)!)?.job_number ?? "" : null }));
  if (!ids.length) return { runId, status: state.status, expiresAt: state.expiresAt, suburb: "", homes: [], days: [], defaultStart: RUN_DEFAULT_START, team, me: userId, mode, cancelled };
  const slotBy = new Map(runSlots.map((x) => [x.jobId, x]));
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
      slot: (() => { const x = slotBy.get(id); return x ? { window: `${runDayWords(x.day)}, ${slotTimeWords(x)}`, state: x.state } : null; })(),
    });
  }
  const suburbs = homes.map((h) => (jobBy.get(h.jobId)?.["properties"] as { suburb?: string | null } | null)?.suburb);
  return { runId, status: state.status, expiresAt: state.expiresAt, suburb: runSuburb(suburbs), homes, days, defaultStart: RUN_DEFAULT_START, team, me: userId, mode, cancelled };
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

async function releaseAll(state: RunState, type: typeof RUN_DECLINED_EVENT | typeof RUN_EXPIRED_EVENT, actorId: string | null, summary: string, extra: Record<string, unknown> = {}): Promise<number> {
  let n = 0;
  await inFours(state.memberIds, async (jobId) => {
    if (await claimBatchEvent(jobId, actorId, type, summary, { run_id: state.runId, batch_id: state.batchId, business_id: state.businessId, ...extra, idempotency_key: runReleaseKey(type, state.runId, jobId) })) n++;
  });
  return n;
}

// ---- office: Back to suggestions (final review I2) -------------------------------------------------------------------------

/** Jo taps "Back to suggestions" on a closed batch waiting for Send to installer (e.g. no installer can take the homes): ONE
 *  `area_batch_returned {batch_id}` per passer still waiting releases the batch's pass, so each owner is a batch candidate
 *  again with their standing pass (not asked again). A run of this batch whose installer text never went is ended first
 *  (`run_expired`, reason office_returned). Refused once the run's text went (the installer has it). Nothing is sent. Twice →
 *  once. */
export async function returnBatchToSuggestions(batchId: string, actorId: string | null, opts: { now?: Date } = {}): Promise<{ homes: number }> {
  const now = opts.now ?? new Date();
  const closed = await readAll("the closed batch", (f, t) => loose.from("workflow_events").select(EVENT_COLS).eq("event_type", AREA_BATCH_CLOSED_EVENT).contains("details", { batch_id: batchId }).range(f, t));
  const passIds = [...new Set(closed.flatMap((e) => { const p = (e["details"] as { pass_job_ids?: unknown } | null)?.pass_job_ids; return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []; }))].sort();
  if (!passIds.length) throw new WorkflowError("That batch has no owners who said yes — nothing changed.");
  const [jobs, assigned, history] = await Promise.all([
    readByIds("the batch's homes", passIds, (c, f, t) => admin.from("jobs").select("id, stage, channel, deleted_at, qa_archived_at").in("id", c).range(f, t)),
    readByIds("the batch's installers", passIds, (c, f, t) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true).range(f, t)),
    readByIds("the batch's history", passIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).in("event_type", [...RUN_EVENTS]).range(f, t)),
  ]);
  const ev = history as unknown as RunEventRow[];
  const runIds = [...new Set(ev.filter((e) => e.event_type === RUN_OFFERED_EVENT && !isFillRow(e) && (e.details as { batch_id?: unknown } | null)?.batch_id === batchId).map(runIdOf).filter((x): x is string => !!x))];
  const runs = runIds.map((r) => runState(r, ev)).filter((x): x is RunState => !!x);
  if (runs.some((r) => r.status !== "offered" || r.textWent)) throw new WorkflowError("This batch has already been sent to the installer — nothing changed.");
  for (const r of runs) await releaseAll(r, RUN_EXPIRED_EVENT, actorId, "Run text never went — the office put this home back in the suggestions (owner not asked again)", { reason: "office_returned" });
  const withInstaller = new Set(assigned.map((a) => String(a["job_id"])));
  const jobBy = new Map(jobs.map((j) => [String(j["id"]), j]));
  const waiting = passIds.filter((id) => {
    const j = jobBy.get(id);
    return !!j && !j["qa_archived_at"] && jobWaitingForInstaller({ channel: s(j["channel"]), stage: s(j["stage"]), hasInstaller: withInstaller.has(id), deleted: !!j["deleted_at"] });
  });
  let homes = 0;
  for (const jobId of waiting) {
    if (await claimBatchEvent(jobId, actorId, AREA_BATCH_RETURNED_EVENT, "Office put this home back in the suggestions — it can go in a new batch without the owner being asked again",
      { batch_id: batchId, returned_by: actorId, returned_at: now.toISOString(), idempotency_key: areaBatchReturnedKey(batchId, jobId) })) homes++;
  }
  return { homes };
}

// ---- 15-minute tick ------------------------------------------------------------------------------------------------------

/** Runs offered in the last 7 days (each expires 24 h after the offer). */
const SWEEP_DAYS = 7;
export type RunSweep = { runs: number; expired: number; failed: number };

/** No reply within 24 hours → `run_expired` for every home still in the run (back in Jo's suggestions). Nothing is sent. */
export async function sweepRunOffers(nowIso: string = new Date().toISOString()): Promise<RunSweep> {
  const out: RunSweep = { runs: 0, expired: 0, failed: 0 };
  const since = new Date(Date.parse(nowIso) - SWEEP_DAYS * 86_400_000).toISOString();
  // Fix round 1: a Fill row (filled_from) only joins an answered run — never a run to expire. Its run's own offer rows are
  // older than the sweep window, so the history read below would see the Fill row alone and look like a fresh offer.
  const offered = (await readAll("offered runs", (f, t) => loose.from("workflow_events").select("job_id, details").eq("event_type", RUN_OFFERED_EVENT).gte("created_at", since).order("created_at").range(f, t)))
    .filter((e) => !isFillRow(e as unknown as RunEventRow));
  const runIds = [...new Set(offered.map((e) => runIdOf(e as unknown as RunEventRow)).filter((x): x is string => !!x))];
  if (!runIds.length) return out;
  const jobIds = [...new Set(offered.map((e) => String(e["job_id"])))];
  const events = (await readByIds("run history", jobIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).in("event_type", [...RUN_EVENTS]).range(f, t))) as unknown as RunEventRow[];
  out.runs = runIds.length;
  for (const runId of runIds) {
    const st = runState(runId, events);
    if (!st || !runExpiryDue(st, nowIso)) continue;
    try {
      out.expired += st.textWent
        ? await releaseAll(st, RUN_EXPIRED_EVENT, null, "No reply from the installer within 24 hours — back on the list for the next batch (owner not asked again)")
        : await releaseAll(st, RUN_EXPIRED_EVENT, null, "The installer's run text didn't go within 24 hours — back on the list for the next batch (owner not asked again)", { reason: "text_not_sent" });
    }
    catch (e) { out.failed++; console.error("run expiry failed", runId, (e as Error).message); }
  }
  return out;
}


// ---- Portal books (Task 7; fix round 1, Jo 30 Oct 2026) --------------------------------------------------------------------
// The installer picks the day (≥ 2 days ahead) + start (default 8:00) + WHO is doing these Ready Checks (anyone active in the
// business's team; default the person tapping) on the run page. First every check (nothing written if any fails): the
// business accept checks of the normal Ready Check accept (approved / can be offered, covers the area — `canTakeHomes`;
// nobody already assigned), and for a real run that the owner time text can go (customer messages + the `run_time` switch).
// Then each window is CLAIMED (person + day + every half-hour it covers, `run_window_claimed`; fix round 2) → `run_mode_chosen {mode: "portal"}` per home
// (stops the 24 h installer expiry) → one `run_slot_proposed` per home (1-hour windows in route order, after any windows the
// SAME PERSON already holds that day; 8 a day per person) → each owner's time text (TEST → test-send; real → the one real
// sender, type `run_time`; quiet hours → the 15-minute tick sends it after 7am). A pick that stopped part way is finished by
// the same pick again, or by the tick 10 minutes later — only for the homes picked then, and only while the day, the
// person, the business checks and (real runs) the owner text switch still allow it. The owner confirms on My job (secure link + code): the window books
// through ready-check-times bookAgreedTime → confirmBooking(job, "ready_check", …) — every existing Ready Check rule,
// message and Mitti step — with the chosen person assigned to the job first. "Can't make it" → another free window that
// day, at least 24 hours away (claimed first, the old window freed; booked straight away, never re-texted). None suit / no
// confirm within 24 h of the text → `run_slot_released` (window freed): back in the pool with the standing pass
// (area-batch.core passHandedOn). Nothing lands in Needs me.

const NOT_AVAILABLE = "That time is not available.";
/** Existing Ready Check wording (ready-check-times.server claim). */
const TAKEN = "That time has just been taken or has passed.";
const SLOT_LOOKBACK_DAYS = 45;
/** The tick finishes a day pick that stopped part way once it is this old (the installer may still be finishing it). */
const RESUME_AFTER_MINUTES = 10;

type SlotJob = { id: string; job_number: string | null; stage: string | null; source: string | null; channel: string | null; deleted_at: string | null; qa_archived_at: string | null; owners: { full_name: string | null; phone: string | null } | null; properties: { postcode: string | null } | null };
const slotJobsById = async (ids: string[]) => new Map((ids.length ? (await readByIds("the run's homes", ids, (c, f, t) => admin.from("jobs").select("id, job_number, stage, source, channel, deleted_at, qa_archived_at, owners(full_name, phone), properties(postcode)").in("id", c).range(f, t))) as unknown as SlotJob[] : []).map((j) => [j.id, j]));
const slotEventsFor = async (jobIds: string[]) => (jobIds.length ? (await readByIds("run windows", jobIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).in("event_type", [...RUN_SLOT_EVENTS]).range(f, t))) : []) as unknown as RunEventRow[];
/** Jobs with a confirmed Ready Check booking now (final review m6: a confirmed run window counts as booked — and holds the
 *  installer's time — only while that booking stands; the owner's Change time cancels it). */
const bookedReadyCheckJobs = async (ids: string[]) => new Set((ids.length ? await readByIds("Ready Check bookings", ids, (c, f, t) => admin.from("bookings").select("job_id").in("job_id", c).eq("kind", "ready_check").eq("status", "confirmed").range(f, t)) : []).map((b) => String(b["job_id"])));
const activeInstallerJobs = async (ids: string[]) => new Set((ids.length ? await readByIds("installers", ids, (c, f, t) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true).range(f, t)) : []).map((a) => String(a["job_id"])));

/** Every window this PERSON has on these days (any run of the business, any state), which of those homes are closed, and
 *  the earliest window ever proposed for them on the first day (the start of that day's grid of 8). Jo 30 Oct: the
 *  8-a-day cap and "same day twice" are per installer person. */
async function personDays(businessId: string, person: string, days: string[], now: Date): Promise<{ slots: Slot[]; closed: Set<string>; gridStart: string | null }> {
  const since = new Date(now.getTime() - SLOT_LOOKBACK_DAYS * 86_400_000).toISOString();
  const proposed = (await readAll("the installer's windows", (f, t) => loose.from("workflow_events").select("job_id, details").eq("event_type", RUN_SLOT_PROPOSED_EVENT).contains("details", { business_id: businessId, person }).gte("created_at", since).range(f, t)))
    .filter((e) => days.includes(String((e["details"] as { day?: unknown } | null)?.day)));
  const jobIds = [...new Set(proposed.map((e) => String(e["job_id"])))];
  if (!jobIds.length) return { slots: [], closed: new Set(), gridStart: null };
  const starts = proposed.filter((e) => (e["details"] as { day?: unknown }).day === days[0]).map((e) => String((e["details"] as { start?: unknown }).start ?? "")).filter(Boolean).sort();
  const [events, jobs, booked] = await Promise.all([slotEventsFor(jobIds), slotJobsById(jobIds), bookedReadyCheckJobs(jobIds)]);
  const slots = slotsOf(events).filter((x) => x.businessId === businessId && x.person === person && days.includes(x.day));
  // A home closed meanwhile, or a confirmed window whose booking was cancelled (owner's Change time), no longer holds its time.
  const closed = new Set([...jobIds.filter((id) => isClosedOrArchivedJob(jobs.get(id))), ...slots.filter((x) => x.state === "confirmed" && !booked.has(x.jobId)).map((x) => x.jobId)]);
  return { slots, closed, gridStart: starts[0] ?? null };
}
const heldBy = (d: { slots: Slot[]; closed: Set<string> }, keep: (x: Slot) => boolean): Window[] =>
  d.slots.filter((x) => holds(x) && !d.closed.has(x.jobId) && keep(x)).map((x) => ({ day: x.day, start: x.start, end: x.end }));

// ---- window claims: person + day + every half-hour slot of the window, before any window is proposed -------------------

type Holder = { jobId: string; runId: string; batchId: string; businessId: string; seq: number; person: string; day: string; start: string; end: string };
type SlotRef = { person: string; day: string; slot: string };
/** A half-hour's claims are written while its day can still be picked (at most the 3-week horizon before it), so reading
 *  from SLOT_LOOKBACK_DAYS before the window's day never misses one and keeps the read bounded (final review m10). The
 *  bound is fixed per day, so every read of the same half-hour sees the same rows (generations stay consistent). */
const claimEventsFor = async (w: SlotRef) =>
  (await readAll("window claims", (f, t) => loose.from("workflow_events").select(EVENT_COLS).in("event_type", [...RUN_WINDOW_EVENTS]).contains("details", { person: w.person, day: w.day, slot: w.slot })
    .gte("created_at", `${addDaysYmd(w.day, -SLOT_LOOKBACK_DAYS)}T00:00:00.000Z`).range(f, t))) as unknown as RunEventRow[];
/** This home's claim in this run: the same window, or an earlier window of the same home (an owner moving to an
 *  overlapping window keeps the shared half-hour). */
const ours = (c: WindowClaim, h: { jobId: string; runId: string; seq: number }) => c.jobId === h.jobId && c.runId === h.runId && c.seq <= h.seq;
const slotRef = (h: { person: string; day: string }, slot: string): SlotRef => ({ person: h.person, day: h.day, slot });

async function slotClaimState(w: SlotRef, now: Date): Promise<{ gen: number; claim: WindowClaim | null; live: boolean }> {
  const { gen, claim } = currentClaim(await claimEventsFor(w), w);
  if (!claim) return { gen, claim: null, live: false };
  const [ev, jobs, booked] = await Promise.all([slotEventsFor([claim.jobId]), slotJobsById([claim.jobId]), bookedReadyCheckJobs([claim.jobId])]);
  const slot = slotsOf(ev).find((x) => x.runId === claim.runId && x.jobId === claim.jobId);
  // Final review m6: a confirmed window whose booking was cancelled (owner's Change time) no longer holds its half-hours.
  const unbooked = slot?.state === "confirmed" && !booked.has(claim.jobId);
  return { gen, claim, live: !unbooked && claimHolds(claim, slot, isClosedOrArchivedJob(jobs.get(claim.jobId)), now) };
}
/** Someone else's live claim holds any half-hour of this window. */
async function windowBlocked(h: Holder, now: Date): Promise<boolean> {
  for (const slot of windowSlots(h.start, h.end)) {
    const st = await slotClaimState(slotRef(h, slot), now);
    if (st.claim && st.live && !ours(st.claim, h)) return true;
  }
  return false;
}
async function freeGen(c: WindowClaim, actorId: string | null, why: string): Promise<boolean> {
  return claimBatchEvent(c.jobId, actorId, RUN_WINDOW_FREED_EVENT, `Ready Check time ${runDayWords(c.day)} from ${c.slot} freed (${why.replace(/_/g, " ")})`,
    { run_id: c.runId, person: c.person, day: c.day, slot: c.slot, start: c.start, gen: c.gen, seq: c.seq, why, idempotency_key: runWindowFreedKey(c.person, c.day, c.slot, c.gen) });
}
/** Claim one half-hour for this home: "ours" (already held by this home), "won" (claimed now) or "lost". A stale claim
 *  (its window released / moved / never proposed) is freed first. */
async function claimSlot(h: Holder, slot: string, actorId: string | null, now: Date): Promise<"ours" | "won" | "lost"> {
  const w = slotRef(h, slot);
  const st = await slotClaimState(w, now);
  if (st.claim && ours(st.claim, h) && st.live) return "ours";
  if (st.claim && st.claim.jobId === h.jobId && st.claim.runId === h.runId && st.claim.seq === h.seq) return "ours";
  if (st.claim && st.live) return "lost";
  if (st.claim) await freeGen(st.claim, actorId, "stale");
  const gen = st.gen + 1;
  const key = runWindowKey(h.person, h.day, slot, gen);
  const { data: prior, error: pe } = await loose.from("workflow_events").select("id").eq("event_type", RUN_WINDOW_CLAIMED_EVENT).contains("details", { idempotency_key: key }).limit(1);
  if (pe) throw new Error(`Could not check the installer's times: ${pe.message}`);
  if ((prior ?? []).length) return "lost";
  const { error } = await loose.from("workflow_events").insert({ job_id: h.jobId, actor_id: actorId, event_type: RUN_WINDOW_CLAIMED_EVENT, summary: `Ready Check window ${runDayWords(h.day)}, ${windowWords(h.start, h.end)} held for this home (from ${slot})`,
    details: { run_id: h.runId, batch_id: h.batchId, business_id: h.businessId, job_id: h.jobId, seq: h.seq, person: h.person, day: h.day, start: h.start, end: h.end, slot, gen, idempotency_key: key }, internal: true });
  if (error) { if (error.code === "23505") return "lost"; throw new Error(`Could not hold the time: ${error.message}`); }
  const after = currentClaim(await claimEventsFor(w), w);
  return after.claim && after.gen === gen && after.claim.jobId === h.jobId && after.claim.runId === h.runId && after.claim.seq === h.seq ? "won" : "lost";
}
/** Claim EVERY half-hour of the window for this home, all or nothing (true = it's ours): the half-hours won are freed
 *  again if a later one is lost. Race-proof once run-window-claims.sql is applied; before that the earliest row of a
 *  generation wins. */
async function claimWindow(h: Holder, actorId: string | null, now: Date): Promise<boolean> {
  if (!h.person) return true; // legacy window with no person: nothing to claim
  const won: string[] = [];
  for (const slot of windowSlots(h.start, h.end)) {
    let r: "ours" | "won" | "lost";
    try { r = await claimSlot(h, slot, actorId, now); }
    catch (e) { await freeSlots(h, won, actorId, "not_used", true); throw e; }
    if (r === "lost") { await freeSlots(h, won, actorId, "not_used", true); return false; }
    if (r === "won") won.push(slot);
  }
  return true;
}
/** Free this home's claims on these half-hours (exact = only this window's seq; else this seq or earlier). Never throws:
 *  a claim left behind goes stale. */
async function freeSlots(h: { jobId: string; runId: string; seq: number; person: string; day: string }, slots: readonly string[], actorId: string | null, why: string, exact: boolean): Promise<void> {
  if (!h.person) return;
  for (const slot of slots) {
    try {
      const { claim } = currentClaim(await claimEventsFor(slotRef(h, slot)), slotRef(h, slot));
      if (claim && claim.jobId === h.jobId && claim.runId === h.runId && (exact ? claim.seq === h.seq : claim.seq <= h.seq)) await freeGen(claim, actorId, why);
    } catch (e) { console.error("run window not freed (it goes stale)", h.runId, h.jobId, slot, (e as Error).message); }
  }
}
/** Free this home's whole window (released / moved / not used), every half-hour together; `keep` = half-hours the home's
 *  new window still covers (an owner's move to an overlapping window). */
async function freeWindow(h: { jobId: string; runId: string; seq: number; person: string; day: string; start: string; end: string }, actorId: string | null, why: string, opts: { exact?: boolean; keep?: readonly string[] } = {}): Promise<void> {
  await freeSlots(h, windowSlots(h.start, h.end).filter((x) => !opts.keep?.includes(x)), actorId, why, !!opts.exact);
}

// ---- the installer picks the day -------------------------------------------------------------------------------------------

export type ChooseRunDayResult = { slots: { jobId: string; day: string; start: string; end: string }[] };
/** `jobIds` = the homes picked at the day pick (fix round 2: a home left out then is never given a window later). */
type RunChoice = { mode: typeof RUN_PORTAL_MODE | typeof RUN_TEAM_MODE; day: string; second: string | null; start: string; person: string; chosenBy: string | null; at: string; jobIds: string[] };
const pickedIds = (d: { job_ids?: unknown } | null | undefined) => (Array.isArray(d?.job_ids) ? d!.job_ids.filter((x): x is string => typeof x === "string") : null);
function storedChoice(events: readonly RunEventRow[], runId: string): RunChoice | null {
  const rows = events.filter((x) => x.event_type === RUN_MODE_CHOSEN_EVENT && runIdOf(x) === runId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const e = rows[0];
  if (!e) return null;
  const d = (e.details ?? {}) as { mode?: unknown; day?: unknown; second_day?: unknown; start?: unknown; person?: unknown; chosen_by?: unknown; job_ids?: unknown };
  const chosenBy = s(d.chosen_by);
  // Older picks (no stored list): only the homes that have this pick themselves.
  const jobIds = pickedIds(d) ?? [...new Set(rows.map((x) => x.job_id))];
  return { mode: d.mode === RUN_TEAM_MODE ? RUN_TEAM_MODE : RUN_PORTAL_MODE, day: String(d.day ?? ""), second: s(d.second_day) || null, start: String(d.start ?? RUN_DEFAULT_START), person: s(d.person) || chosenBy || "", chosenBy, at: e.created_at, jobIds };
}

/** A real run's owner time texts can't go now (customer messages off / the `run_time` switch off), or null. TEST job /
 *  TEST partner runs: never blocked. */
async function ownerTextsBlocker(businessId: string, homes: readonly { isTest: boolean }[]): Promise<string | null> {
  const { isTestPartner } = await import("./test-send.core");
  if (homes.some((h) => h.isTest) || isTestPartner(await businessOf(businessId))) return null;
  const { data: ws } = await loose.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
  const w = (ws ?? null) as { customer_comms_enabled?: boolean | null; sms_message_switches?: Record<string, boolean> | null } | null;
  if (w?.customer_comms_enabled !== true) return "Customer messages are switched off — nothing was sent.";
  if (w?.sms_message_switches?.[RUN_TIME_SMS_TYPE] !== true) return "The owner time texts are switched off — switch them on in Settings first. Nothing was sent.";
  return null;
}

/** Claims (all or nothing), then run_mode_chosen per home, then run_slot_proposed per home, then the owners' texts. */
async function writeChoice(state: RunState, c: RunChoice, slots: readonly { jobId: string; day: string; start: string; end: string }[], actorId: string | null, now: Date, fresh: boolean) {
  const holders: Holder[] = slots.map((x) => ({ jobId: x.jobId, runId: state.runId, batchId: state.batchId, businessId: state.businessId, seq: 1, person: c.person, day: x.day, start: x.start, end: x.end }));
  const won: Holder[] = [];
  const undo = async () => { for (const h of won) await freeWindow(h, actorId, "not_used", { exact: true }); };
  for (const h of holders) {
    if (!(await claimWindow(h, actorId, now))) { await undo(); throw new WorkflowError(TAKEN); }
    won.push(h);
  }
  for (const h of holders) {
    const w = await claimBatchEvent(h.jobId, c.chosenBy ?? actorId, RUN_MODE_CHOSEN_EVENT, `Installer chose Portal books: ${runDayWords(c.day)}${c.second ? ` and ${runDayWords(c.second)}` : ""}, from ${c.start}`,
      { run_id: state.runId, batch_id: state.batchId, business_id: state.businessId, mode: RUN_PORTAL_MODE, day: c.day, second_day: c.second, start: c.start, person: c.person, chosen_by: c.chosenBy, job_ids: c.jobIds, idempotency_key: runModeKey(state.runId, h.jobId) });
    if (!w && fresh) { await undo(); throw new WorkflowError(NOT_OPEN); }
  }
  for (const h of holders) {
    await claimBatchEvent(h.jobId, actorId, RUN_SLOT_PROPOSED_EVENT, `Ready Check window ${runDayWords(h.day)}, ${windowWords(h.start, h.end)} — waiting for the owner to confirm`,
      { run_id: state.runId, batch_id: state.batchId, business_id: state.businessId, seq: 1, person: c.person, day: h.day, start: h.start, end: h.end, starts_at: windowStartAt(h.day, h.start).toISOString(), by: "portal", idempotency_key: runSlotKey(state.runId, h.jobId, 1) });
  }
  // The owners' texts now (outside quiet hours); anything held goes from the 15-minute tick.
  await sweepRunSlots(now.toISOString(), { jobIds: state.memberIds }).catch((e) => console.error("run time texts deferred to the tick", state.runId, (e as Error).message));
}

/** Finish a day pick that stopped part way: homes PICKED at the day pick, still in the run, with no window get theirs
 *  (same day, start and person, after the windows already given). Null = nothing to do — or not safe to do any more, so
 *  nothing is proposed: the day is no longer a day the installer may choose, the person has left the team, the business
 *  can't take the homes, a real run's owner texts are switched off; a window under the owner lead time is skipped. */
async function completeRunChoice(state: RunState, c: RunChoice, actorId: string | null, now: Date): Promise<ChooseRunDayResult | null> {
  const picked = c.jobIds.filter((id) => state.memberIds.includes(id));
  if (!picked.length) return null;
  const [ev, jobs, assigned] = await Promise.all([slotEventsFor(picked), slotJobsById(picked), activeInstallerJobs(picked)]);
  const here = slotsOf(ev).filter((x) => x.runId === state.runId);
  const has = new Set(here.map((x) => x.jobId));
  const missing = picked.filter((id) => { const j = jobs.get(id); return !has.has(id) && !!j && !j.qa_archived_at && jobWaitingForInstaller({ channel: j.channel, stage: j.stage, hasInstaller: assigned.has(id), deleted: !!j.deleted_at }); });
  if (!missing.length) return null;
  // Can never be placed now (the day has gone, the person left, the business can't take them): released back to the pool
  // like a "none suit" (standing pass, owner not asked, not texted), once per home.
  if (runDayBlocker(c.day, now) || (c.second && runDayBlocker(c.second, now))) { await releaseUnplaced(state, missing, actorId); return null; }
  if (!(await runTeam(state.businessId)).some((m) => m.userId === c.person)) { await releaseUnplaced(state, missing, actorId); return null; }
  const homes = missing.map((id) => ({ postcode: (jobs.get(id)?.properties?.postcode ?? "").trim(), isTest: jobs.get(id)?.source === "qa_test" }));
  if (!(await canTakeHomes(state.businessId, homes))) { await releaseUnplaced(state, missing, actorId); return null; }
  // Temporary: the owner time texts are switched off — wait, retry on later ticks.
  if (await ownerTextsBlocker(state.businessId, homes)) return null;
  const days = c.second ? [c.day, c.second] : [c.day];
  const held = heldBy(await personDays(state.businessId, c.person, days, now), () => true);
  const plan = planRunDays({ memberIds: missing, day: c.day, start: c.start, secondDay: c.second, held });
  if (!plan.ok) throw new WorkflowError(plan.why);
  const slots = plan.slots.filter((x) => !pickTooSoon(x.day, x.start, now));
  const tooSoon = plan.slots.filter((x) => pickTooSoon(x.day, x.start, now)).map((x) => x.jobId);
  if (slots.length) await writeChoice(state, c, slots, actorId, now, false);
  if (tooSoon.length) await releaseUnplaced(state, tooSoon, actorId);
  if (!slots.length) return null;
  return { slots: [...here.filter(holds).map((x) => ({ jobId: x.jobId, day: x.day, start: x.start, end: x.end })), ...slots] };
}

/** Homes a resume can't place: released like "none suit" (same `run_slot_released`, so they are batch candidates again with
 *  their standing pass; the owner isn't asked or texted). Once per home (the release key). */
async function releaseUnplaced(state: RunState, jobIds: readonly string[], actorId: string | null): Promise<void> {
  for (const jobId of jobIds) {
    await claimBatchEvent(jobId, actorId, RUN_SLOT_RELEASED_EVENT, "No Ready Check window could be given for this home — back on the list for the next batch (owner not asked again)",
      { run_id: state.runId, batch_id: state.batchId, business_id: state.businessId, seq: 0, why: "not_placed", idempotency_key: runSlotReleaseKey(state.runId, jobId) });
  }
}

/** The accept checks shared by Portal books and Our team books (nothing written if any fails): the person is active in the
 *  business's team; homes closed meanwhile are left out (never texted); a home that already has an installer is refused
 *  ("nobody assigned yet"); the business can take every home (approved / can be offered / area); a real run's owner texts
 *  can go (customer messages + the `run_time` switch). */
async function acceptChecks(state: RunState, person: string): Promise<{ members: string[] }> {
  // Who's doing these Ready Checks: anyone active in this business's team (Jo 30 Oct).
  if (!(await runTeam(state.businessId)).some((m) => m.userId === person)) throw new WorkflowError("Please choose who's doing these Ready Checks.");
  const [jobs, assigned] = await Promise.all([slotJobsById(state.memberIds), activeInstallerJobs(state.memberIds)]);
  const open = state.memberIds.filter((id) => { const j = jobs.get(id); return !!j && !isClosedOrArchivedJob(j); });
  const taken = open.filter((id) => assigned.has(id));
  if (taken.length) throw new WorkflowError(`${taken.map((id) => jobs.get(id)?.job_number || "A home").join(", ")} already ${taken.length === 1 ? "has" : "have"} an installer — take ${taken.length === 1 ? "it" : "them"} out of the run first. Nothing was sent.`);
  const members = open.filter((id) => { const j = jobs.get(id)!; return jobWaitingForInstaller({ channel: j.channel, stage: j.stage, hasInstaller: false, deleted: !!j.deleted_at }); });
  if (!members.length) throw new WorkflowError("None of the homes in this run are still waiting.");
  // The business accept checks of the normal Ready Check accept (approved / can be offered, area). Per-person Full EEC is
  // not needed for Ready Checks (Jo 30 Oct); confirmBooking still checks the business at booking.
  const homes = members.map((id) => ({ postcode: (jobs.get(id)?.properties?.postcode ?? "").trim(), isTest: jobs.get(id)?.source === "qa_test" }));
  if (!(await canTakeHomes(state.businessId, homes))) throw new WorkflowError("Your business can't take every home in this run right now (not approved, not taking jobs, or the area isn't covered). Nothing was sent.");
  // A real run's owner texts must be able to go (else owners would wait with no text): refuse first.
  const textsOff = await ownerTextsBlocker(state.businessId, homes);
  if (textsOff) throw new WorkflowError(textsOff);
  return { members };
}

/** Installer, Portal books: pick the day (and a second day when more than 8 homes don't fit), the start time and who is
 *  doing them (`opts.personId`, default the person tapping). */
export async function chooseRunDay(runId: string, userId: string, dayIso: string, startHHMM: string | null | undefined = RUN_DEFAULT_START, secondDayIso: string | null = null, opts: { now?: Date; personId?: string | null } = {}): Promise<ChooseRunDayResult> {
  const now = opts.now ?? new Date();
  const { state, events } = await loadRun(runId, userId);
  const start = startHHMM || RUN_DEFAULT_START;
  const second = secondDayIso || null;
  const person = opts.personId || userId;
  // A day pick that stopped part way: the same pick again finishes it.
  if (state.status === "answered") {
    const c = storedChoice(events, runId);
    if (c && c.mode === RUN_PORTAL_MODE && c.day === dayIso && c.second === second && c.start === start && c.person === person) {
      const r = await completeRunChoice(state, c, userId, now);
      if (r) return r;
    }
    throw new WorkflowError(NOT_OPEN);
  }
  if (state.status !== "offered" || runExpiryDue(state, now.toISOString())) throw new WorkflowError(NOT_OPEN);
  if (!isReadyCheckTime(start)) throw new WorkflowError("Please choose a time.");
  const b1 = runDayBlocker(dayIso, now);
  if (b1) throw new WorkflowError(b1);
  if (second) {
    const b2 = runDayBlocker(second, now);
    if (b2) throw new WorkflowError(b2);
    if (second === dayIso) throw new WorkflowError("Please pick a different second day.");
  }
  const { members } = await acceptChecks(state, person);
  // Same day twice: windows this person already holds on those days (other runs) come first; 8 a day per person.
  const days = second ? [dayIso, second] : [dayIso];
  const held = heldBy(await personDays(state.businessId, person, days, now), (x) => x.runId !== runId);
  const plan = planRunDays({ memberIds: members, day: dayIso, start, secondDay: second, held });
  if (!plan.ok) throw new WorkflowError(plan.why);
  // A window someone else is taking right now → refused before anything is written.
  for (const x of plan.slots) {
    if (await windowBlocked({ jobId: x.jobId, runId, batchId: state.batchId, businessId: state.businessId, seq: 1, person, day: x.day, start: x.start, end: x.end }, now)) throw new WorkflowError(TAKEN);
  }
  await writeChoice(state, { mode: RUN_PORTAL_MODE, day: dayIso, second, start, person, chosenBy: userId, at: now.toISOString(), jobIds: members }, plan.slots, userId, now, true);
  return { slots: plan.slots };
}

/** 15-minute tick: day picks that stopped part way (a picked home with the choice but no window, or no choice yet) are
 *  finished. Runs whose picked homes all have a window, or picked under 10 minutes ago, are skipped before any per-run read. */
async function resumeRunChoices(now: Date): Promise<{ resumed: number; failed: number }> {
  const out = { resumed: 0, failed: 0 };
  const since = new Date(now.getTime() - SLOT_LOOKBACK_DAYS * 86_400_000).toISOString();
  const chosen = (await readAll("run day picks", (f, t) => loose.from("workflow_events").select("job_id, created_at, details").eq("event_type", RUN_MODE_CHOSEN_EVENT).gte("created_at", since).range(f, t))) as unknown as RunEventRow[];
  const picks = new Map<string, { jobIds: Set<string>; at: string }>();
  for (const e of chosen) {
    const runId = runIdOf(e);
    // A team-booked run has no portal windows to finish (Task 8).
    if (!runId || (e.details as { mode?: unknown } | null)?.mode === RUN_TEAM_MODE) continue;
    const p = picks.get(runId) ?? { jobIds: new Set<string>(), at: e.created_at };
    p.jobIds.add(e.job_id);
    for (const id of pickedIds(e.details as { job_ids?: unknown } | null) ?? []) p.jobIds.add(id);
    if (e.created_at < p.at) p.at = e.created_at;
    picks.set(runId, p);
  }
  const fresh = (runId: string) => now.getTime() - Date.parse(picks.get(runId)!.at) < RESUME_AFTER_MINUTES * 60_000;
  const old = [...picks.keys()].filter((r) => !fresh(r));
  if (!old.length) return out;
  const pickedJobs = [...new Set(old.flatMap((r) => [...picks.get(r)!.jobIds]))];
  const proposed = (await readByIds("run windows", pickedJobs, (c, f, t) => loose.from("workflow_events").select("job_id, details").in("job_id", c).in("event_type", [RUN_SLOT_PROPOSED_EVENT, RUN_SLOT_RELEASED_EVENT]).range(f, t))) as unknown as RunEventRow[];
  const windowed = new Set(proposed.map((e) => `${runIdOf(e)}|${e.job_id}`));
  const allHaveWindows = (runId: string) => [...picks.get(runId)!.jobIds].every((id) => windowed.has(`${runId}|${id}`));
  const runIds = old.filter((r) => !allHaveWindows(r));
  if (!runIds.length) return out;
  const jobIds = [...new Set(runIds.flatMap((r) => [...picks.get(r)!.jobIds]))];
  const first = (await readByIds("the runs", jobIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).eq("event_type", RUN_OFFERED_EVENT).range(f, t))) as unknown as RunEventRow[];
  const listed = [...new Set(first.flatMap((e) => { const j = (e.details as { job_ids?: unknown } | null)?.job_ids; return Array.isArray(j) ? j.map(String) : [e.job_id]; }))];
  const events = (await readByIds("run history", listed, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).in("event_type", [...RUN_EVENTS]).range(f, t))) as unknown as RunEventRow[];
  for (const runId of runIds) {
    const st = runState(runId, events);
    const c = storedChoice(events, runId);
    if (!st || st.status !== "answered" || !c || c.mode !== RUN_PORTAL_MODE) continue;
    try { if (await completeRunChoice(st, c, null, now)) out.resumed++; }
    catch (e) { out.failed++; console.error("run day pick not finished", runId, (e as Error).message); }
  }
  return out;
}

const tradeName = (b: { name?: string | null; trading_name?: string | null } | null) => ((b?.trading_name ?? b?.name ?? "") || "your installer").replace(/^\[TEST PARTNER\]\s*/, "");
async function businessOf(id: string) {
  const { data } = await admin.from("businesses").select("id, name, trading_name, onboarding_notes").eq("id", id).maybeSingle();
  return data as { id: string; name: string | null; trading_name?: string | null; onboarding_notes: string | null } | null;
}

/** Real owner time texts / reminders that would only be held now (customer messages off, that text's switch off): the
 *  real sender isn't called (it would write a held row every tick); retried on the first tick after they're on. */
type OwnerTextsOff = { time: boolean; reminder: boolean };
async function ownerTextsOff(): Promise<OwnerTextsOff> {
  const { data, error } = await loose.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Could not read the message switches: ${error.message}`);
  const w = (data ?? null) as { customer_comms_enabled?: boolean | null; sms_message_switches?: Record<string, boolean> | null } | null;
  const off = (type: string) => w?.customer_comms_enabled !== true || w?.sms_message_switches?.[type] !== true;
  return { time: off(RUN_TIME_SMS_TYPE), reminder: off(RUN_TIME_REMINDER_SMS_TYPE) };
}

/** The owner's time text or 12-hour reminder, once per window. Quiet hours / held → nothing recorded (the tick retries).
 *  Held for the owner themselves (STOP, no consent, not a mobile — final review m5): never retried — the time text releases
 *  the window once (`not_textable`, back in the pool with the standing pass); the reminder is recorded once as not sent. */
async function textSlot(x: Slot, job: SlotJob, kind: "time" | "reminder", now: Date, off: OwnerTextsOff | null = null): Promise<string> {
  if (smsQuietReason(now.toISOString())) return "quiet hours";
  const link = await (await import("./veec-copy-email.server")).ownerMyJobLink(x.jobId);
  if (!link) return "owner link missing";
  const to = job.owners?.phone ?? null;
  const type = kind === "time" ? RUN_TIME_SMS_TYPE : RUN_TIME_REMINDER_SMS_TYPE;
  const notTextable = async () => {
    if (kind === "time") await releaseSlot(x, null, "not_textable");
    else await claimBatchEvent(x.jobId, null, RUN_TIME_REMINDED_EVENT, "Owner not reminded to confirm their Ready Check window: their number can't be texted (STOP, no consent or not a mobile)",
      { run_id: x.runId, business_id: x.businessId, seq: x.seq, status: "not_textable", idempotency_key: `${type}-sent:v1:${x.runId}:${x.jobId}:${x.seq}` });
    return "not_textable";
  };
  if (!to) return notTextable();
  const biz = await businessOf(x.businessId);
  const f = { name: job.owners?.full_name ?? null, day: runDayWords(x.day), time: slotTimeWords(x), link };
  // A team-entered time (fix round 1, Jo 30 Oct): its own approved wording — no other times are offered.
  const body = kind === "time" ? (x.by === "team" ? runTeamTimeText : runTimeText)({ ...f, installer: tradeName(biz) }) : runTimeReminderText(f);
  const { isTestPartner } = await import("./test-send.core");
  const test = job.source === "qa_test" || isTestPartner(biz);
  if (!test && off?.[kind]) return "held";
  let r: { status: string; detail: string };
  try {
    if (test) r = await (await import("./test-send.server")).sendTestSms({ jobId: x.jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `${type}:${x.runId}:${x.seq}`, actorId: null }, to, body);
    else r = await (await import("./sms.server")).sendRealSms({ type, idempotencyKey: kind === "time" ? runTimeSmsKey(x.runId, x.jobId, x.seq) : runTimeReminderSmsKey(x.runId, x.jobId, x.seq), to, body, jobId: x.jobId });
  } catch (e) { r = { status: "failed", detail: (e as Error).message }; }
  if (!test && smsHeldForRecipient(r)) return notTextable();
  if ((RUN_TEXT_WENT as readonly string[]).includes(r.status)) {
    await claimBatchEvent(x.jobId, null, kind === "time" ? RUN_TIME_TEXTED_EVENT : RUN_TIME_REMINDED_EVENT, kind === "time" ? "Owner texted their Ready Check window to confirm" : "Owner reminded to confirm their Ready Check window (12 hours)",
      { run_id: x.runId, business_id: x.businessId, seq: x.seq, status: r.status, idempotency_key: `${type}-sent:v1:${x.runId}:${x.jobId}:${x.seq}` });
  }
  return r.status;
}

const RELEASE_SUMMARY = {
  none_suit: "Owner said none of the times suit — back on the list for the next batch (not asked again)",
  no_confirm: "Owner didn't confirm their Ready Check window within 24 hours — back on the list for the next batch (not asked again)",
  time_passed: "The Ready Check time the installer's team entered passed without the owner confirming — back on the list for the next batch (not asked again)",
  not_textable: "The owner's number can't be texted (STOP, no consent or not a mobile), so they couldn't get their Ready Check window — back on the list for the next batch (not asked again)",
} as const;
async function releaseSlot(x: Slot, actorId: string | null, why: keyof typeof RELEASE_SUMMARY): Promise<boolean> {
  const won = await claimBatchEvent(x.jobId, actorId, RUN_SLOT_RELEASED_EVENT, RELEASE_SUMMARY[why],
    { run_id: x.runId, batch_id: x.batchId, business_id: x.businessId, seq: x.seq, why, idempotency_key: runSlotReleaseKey(x.runId, x.jobId) });
  await freeWindow(x, actorId, why);
  await endMovedBooking(x, actorId);
  return won;
}

/** Fix round 1: a home that WAS booked from this run (an earlier window confirmed) and is now released after Move run
 *  (none suit / no confirm) — the run's installer assignment is ended (the existing visit-release shape: active off, ended
 *  at, reason) so the home really is back in Jo's suggestions with its standing pass, and the job's Mitti Ready Check
 *  form is released (existing releaseReadyCheckFormOnCancel) so it no longer shows the old booking. A home booked again
 *  meanwhile (stage not "to schedule") is left alone; the form is released only when the update really ended this run's
 *  business's assignment (Task 9). Best-effort: never stops the release. */
async function endMovedBooking(x: Slot, actorId: string | null): Promise<void> {
  try {
    const ev = await slotEventsFor([x.jobId]);
    const wasBooked = ev.some((e) => e.event_type === RUN_SLOT_CONFIRMED_EVENT && runIdOf(e) === x.runId && Number((e.details as { seq?: unknown } | null)?.seq ?? 0) < x.seq);
    if (!wasBooked) return;
    const { data: job } = await admin.from("jobs").select("stage").eq("id", x.jobId).maybeSingle();
    if (!job || job.stage !== "ready_check_ready_to_schedule") return;
    const why = "Run moved and the owner didn't confirm a new Ready Check time — back on the list for the next batch";
    const { data: ended, error: ue } = await admin.from("job_assignments").update({ active: false, ended_at: new Date().toISOString(), end_reason: why } as never).eq("job_id", x.jobId).eq("role", "installer").eq("business_id", x.businessId).eq("active", true).select("id");
    if (ue) throw new Error(`the installer assignment could not be ended: ${ue.message}`);
    // Task 9: only when this run's business really had the home (an assignment ended just now) is its Mitti form released.
    if (!((ended ?? []) as unknown[]).length) return;
    await (await import("./mitti-pickup.server")).releaseReadyCheckFormOnCancel(x.jobId, actorId, "the run was moved and the owner didn't confirm a new time");
  } catch (e) { console.error("moved run home not unassigned", x.runId, x.jobId, (e as Error).message); }
}

export type RunSlotSweep = { texted: number; reminded: number; released: number; resumed: number; failed: number };
/** 15-minute tick: unfinished day picks are finished; then each waiting window → the owner's text (when it hasn't gone),
 *  the 12-hour reminder (once), or released 24 hours after the text (or when the window starts with no text). A home
 *  closed meanwhile is skipped and never texted. */
export async function sweepRunSlots(nowIso: string = new Date().toISOString(), opts: { jobIds?: string[] } = {}): Promise<RunSlotSweep> {
  const out: RunSlotSweep = { texted: 0, reminded: 0, released: 0, resumed: 0, failed: 0 };
  const now = new Date(nowIso);
  let jobIds = opts.jobIds;
  if (!jobIds) {
    try { const r = await resumeRunChoices(now); out.resumed = r.resumed; out.failed += r.failed; }
    catch (e) { out.failed++; console.error("run day picks not checked", (e as Error).message); }
    try { const r = await sweepTeamBookings(now); out.released += r.released; out.failed += r.failed; }
    catch (e) { out.failed++; console.error("team bookings not checked", (e as Error).message); }
    try { const r = await sweepCancelledTexts(now); out.failed += r.failed; }
    catch (e) { out.failed++; console.error("held cancel texts not checked", (e as Error).message); }
    const since = new Date(now.getTime() - SLOT_LOOKBACK_DAYS * 86_400_000).toISOString();
    const proposed = await readAll("run windows", (f, t) => loose.from("workflow_events").select("job_id").eq("event_type", RUN_SLOT_PROPOSED_EVENT).gte("created_at", since).range(f, t));
    jobIds = [...new Set(proposed.map((e) => String(e["job_id"])))];
  }
  if (!jobIds.length) return out;
  const [events, jobs] = await Promise.all([slotEventsFor(jobIds), slotJobsById(jobIds)]);
  let off: OwnerTextsOff | null = null;
  for (const x of slotsOf(events).filter((y) => y.state === "proposed")) {
    const job = jobs.get(x.jobId);
    if (!job || isClosedOrArchivedJob(job)) continue;
    try {
      const due = slotDue(x, now);
      if (due === "release") { if (await releaseSlot(x, null, x.by === "team" ? "time_passed" : "no_confirm")) out.released++; }
      else if (due === "text" || due === "remind") {
        off ??= await ownerTextsOff();
        const st = await textSlot(x, job, due === "text" ? "time" : "reminder", now, off);
        if ((RUN_TEXT_WENT as readonly string[]).includes(st)) out[due === "text" ? "texted" : "reminded"]++;
        else if (st === "not_textable" && due === "text") out.released++;
      }
    } catch (e) { out.failed++; console.error("run window step failed", x.runId, x.jobId, (e as Error).message); }
  }
  return out;
}

// ---- the owner (My job, secure link + code) ------------------------------------------------------------------------------

async function ownerSlot(jobId: string): Promise<Slot | null> {
  const mine = slotsOf(await slotEventsFor([jobId])).filter((x) => x.jobId === jobId).sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
  return mine.find(holds) ?? mine[0] ?? null;
}
/** The installer person's free windows that day for this owner's own pick (at least 24 hours away). */
async function freeFor(x: Slot, now: Date): Promise<{ start: string; end: string }[]> {
  // A team-entered time has no portal grid: the team agreed it with the owner by phone (Task 8).
  if (x.by === "team") return [];
  const d = await personDays(x.businessId, x.person, [x.day], now);
  return freeWindows({ day: x.day, gridStart: d.gridStart ?? x.start, held: heldBy(d, (y) => y.jobId !== x.jobId), now }).filter((w) => w.start !== x.start);
}

/** What the owner's run card shows. Never shows other owners' details. */
export async function ownerRunSlotState(jobId: string, opts: { now?: Date } = {}): Promise<OwnerRunSlotView> {
  const now = opts.now ?? new Date();
  const x = await ownerSlot(jobId);
  if (!x || x.state === "released" || x.state === "cancelled") return { kind: "none" };
  const { data: job } = await admin.from("jobs").select("stage, deleted_at, qa_archived_at").eq("id", jobId).maybeSingle();
  if (!job || isClosedOrArchivedJob(job)) return { kind: "none" };
  const base = { day: runDayWords(x.day), time: slotTimeWords(x), installer: tradeName(await businessOf(x.businessId)), team: x.by === "team" };
  if (x.state === "confirmed") return (await bookedReadyCheckJobs([jobId])).has(jobId) ? { kind: "confirmed", ...base } : { kind: "none" };
  return { kind: "proposed", ...base, free: (await freeFor(x, now)).map((w) => ({ ...w, label: windowWords(w.start, w.end) })) };
}

/** Book the window: the chosen person is assigned to the job, then the existing Ready Check booking. */
async function bookSlot(x: Slot, actorId: string): Promise<{ ok: true; booked: true }> {
  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("id, stage, channel, deleted_at, qa_archived_at").eq("id", x.jobId).maybeSingle(),
    admin.from("job_assignments").select("id, business_id").eq("job_id", x.jobId).eq("role", "installer").eq("active", true).maybeSingle(),
  ]);
  if (!job || isClosedOrArchivedJob(job) || job.stage !== "ready_check_ready_to_schedule" || (asg && asg.business_id !== x.businessId)) throw new WorkflowError(NOT_AVAILABLE);
  const attempt = x.failedConfirms + 1;
  const won = await claimBatchEvent(x.jobId, actorId, RUN_SLOT_CONFIRMED_EVENT, `Owner confirmed their Ready Check time: ${runDayWords(x.day)}, ${slotTimeWords(x)}`,
    { run_id: x.runId, batch_id: x.batchId, business_id: x.businessId, seq: x.seq, day: x.day, start: x.start, end: x.end, idempotency_key: runSlotConfirmKey(x.runId, x.jobId, x.seq, attempt) });
  if (!won) return { ok: true, booked: true }; // a second tap: the first one books
  let created: string | null = null;
  try {
    if (!asg) {
      // The person chosen at the day pick ("Who's doing these Ready Checks?"); older windows: whoever picked the day.
      let by = x.person || null;
      if (!by) {
        const chosen = (await readAll("the run's choice", (f, t) => loose.from("workflow_events").select("details").eq("job_id", x.jobId).eq("event_type", RUN_MODE_CHOSEN_EVENT).contains("details", { run_id: x.runId }).range(f, t)))[0];
        by = s((chosen?.["details"] as { chosen_by?: unknown } | null)?.chosen_by);
      }
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

/** Owner: "Can't make it" → take another free window that day (at least 24 hours away) = booked there. The new window is
 *  claimed first and the old one freed; it is never re-texted and their 24 hours don't restart if the booking fails. */
export async function ownerPickRunWindow(jobId: string, userId: string, start: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const x = await ownerSlot(jobId);
  if (!x || x.state !== "proposed") throw new WorkflowError(NOT_AVAILABLE);
  if (start === x.start) return ownerConfirmRunSlot(jobId, userId, opts);
  if (pickTooSoon(x.day, start, now)) throw new WorkflowError(RUN_PICK_TOO_SOON);
  const w = (await freeFor(x, now)).find((f) => f.start === start);
  if (!w) throw new WorkflowError(TAKEN);
  const seq = x.seq + 1;
  const h: Holder = { jobId, runId: x.runId, batchId: x.batchId, businessId: x.businessId, seq, person: x.person, day: x.day, start: w.start, end: w.end };
  if (!(await claimWindow(h, userId, now))) throw new WorkflowError(TAKEN);
  const won = await claimBatchEvent(jobId, userId, RUN_SLOT_PROPOSED_EVENT, `Owner picked another Ready Check window: ${runDayWords(x.day)}, ${windowWords(w.start, w.end)}`,
    { run_id: x.runId, batch_id: x.batchId, business_id: x.businessId, seq, person: x.person, day: x.day, start: w.start, end: w.end, starts_at: windowStartAt(x.day, w.start).toISOString(), by: "owner", idempotency_key: runSlotKey(x.runId, jobId, seq) });
  if (!won) { await freeWindow(h, userId, "not_used", { exact: true }); throw new WorkflowError(TAKEN); }
  // The old window's half-hours, except any the new window still covers.
  await freeWindow(x, userId, "moved", { keep: windowSlots(w.start, w.end) });
  return bookSlot({ ...x, seq, start: w.start, end: w.end, by: "owner", failedConfirms: 0 }, userId);
}

/** Owner: none of the times suit → back in the pool (not asked again). Twice → once. */
export async function ownerNoRunWindow(jobId: string, userId: string, _opts: { now?: Date } = {}) {
  const x = await ownerSlot(jobId);
  if (x?.state === "released") return { ok: true as const };
  if (!x || x.state !== "proposed") throw new WorkflowError(NOT_AVAILABLE);
  await releaseSlot(x, userId, "none_suit");
  return { ok: true as const };
}

// ---- Our team books (Task 8, Jo 30 Oct 2026) ----------------------------------------------------------------------------------
// The installer chooses "Our team books" (same accept checks and "Who's doing these Ready Checks?" as Portal books): one
// `run_mode_chosen {mode: "team"}` per home stops the 24 h expiry. Their team calls each owner and enters the agreed day + exact
// time on the run page — no portal limits (any day from now, any time, no 8-a-day cap, no window claims). Each entered time is
// a `run_slot_proposed {by: "team"}` and goes through the SAME owner flow: the approved time text (exact time in the existing
// Ready Check wording, "at 9am"), the 12-hour reminder, Confirm → bookAgreedTime → confirmBooking. A home not booked within
// 5 days of the choice → `run_slot_released {why: "team_not_booked"}` (once; back to Jo's suggestions with the standing pass).

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Installer: "Our team books" (`opts.personId` = who's doing them, default the person tapping). Nothing is sent. */
export async function chooseTeamBooks(runId: string, userId: string, opts: { now?: Date; personId?: string | null } = {}): Promise<{ homes: number }> {
  const now = opts.now ?? new Date();
  const { state } = await loadRun(runId, userId);
  if (state.status !== "offered" || runExpiryDue(state, now.toISOString())) throw new WorkflowError(NOT_OPEN);
  const person = opts.personId || userId;
  const { members } = await acceptChecks(state, person);
  for (const jobId of members) {
    const won = await claimBatchEvent(jobId, userId, RUN_MODE_CHOSEN_EVENT, "Installer chose Our team books — their team calls the owner and enters the time (5 days)",
      { run_id: runId, batch_id: state.batchId, business_id: state.businessId, mode: RUN_TEAM_MODE, person, chosen_by: userId, job_ids: members, idempotency_key: runModeKey(runId, jobId) });
    if (!won) throw new WorkflowError(NOT_OPEN);
  }
  return { homes: members.length };
}

/** Installer (Our team books): the day + exact time the team agreed with this owner. A home not yet confirmed can be given a
 *  new time (the owner gets the new text). */
export async function enterTeamTime(runId: string, userId: string, jobId: string, day: string, time: string, opts: { now?: Date } = {}): Promise<{ day: string; start: string }> {
  const now = opts.now ?? new Date();
  const { state, events } = await loadRun(runId, userId);
  if (!state.jobIds.includes(jobId)) throw new WorkflowError("That home isn't in this run.");
  const c = storedChoice(events, runId);
  if (state.status !== "answered" || !c || c.mode !== RUN_TEAM_MODE || runTeamExpired(teamChosenAt(events, runId, jobId) ?? c.at, now) || !state.memberIds.includes(jobId)) throw new WorkflowError(NOT_OPEN);
  if (!YMD_RE.test(day)) throw new WorkflowError("Please choose a day.");
  if (!HHMM.test(time)) throw new WorkflowError("Please choose a time.");
  const startsAt = windowStartAt(day, time);
  if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= now.getTime()) throw new WorkflowError(TAKEN);
  const [jobs, ev] = await Promise.all([slotJobsById([jobId]), slotEventsFor([jobId])]);
  const j = jobs.get(jobId);
  if (!j || isClosedOrArchivedJob(j)) throw new WorkflowError("That home is no longer waiting.");
  const cur = slotsOf(ev).find((x) => x.runId === runId && x.jobId === jobId);
  if (cur?.state === "confirmed") throw new WorkflowError("That home is already booked.");
  if (cur && cur.state !== "proposed") throw new WorkflowError(NOT_OPEN);
  const textsOff = await ownerTextsBlocker(state.businessId, [{ isTest: j.source === "qa_test" }]);
  if (textsOff) throw new WorkflowError(textsOff);
  const seq = (cur?.seq ?? 0) + 1;
  const end = windowsFor(time, 1).windows[0]?.end ?? "23:59";
  const won = await claimBatchEvent(jobId, userId, RUN_SLOT_PROPOSED_EVENT, `Installer's team entered the Ready Check time ${runDayWords(day)}, ${slotTimeWords({ by: "team", day, start: time, end })} — waiting for the owner to confirm`,
    { run_id: runId, batch_id: state.batchId, business_id: state.businessId, seq, person: c.person, day, start: time, end, starts_at: startsAt.toISOString(), by: "team", entered_by: userId, idempotency_key: runSlotKey(runId, jobId, seq) });
  if (!won) throw new WorkflowError(TAKEN);
  await sweepRunSlots(now.toISOString(), { jobIds: [jobId] }).catch((e) => console.error("team time text deferred to the tick", runId, jobId, (e as Error).message));
  return { day, start: time };
}

/** When this home's 5 team-booking days started: its own `run_mode_chosen` (the run's choice, or — a home added by Fill — when
 *  it was added). */
const teamChosenAt = (events: readonly RunEventRow[], runId: string, jobId: string): string | null =>
  events.filter((e) => e.event_type === RUN_MODE_CHOSEN_EVENT && runIdOf(e) === runId && e.job_id === jobId).map((e) => e.created_at).sort()[0] ?? null;

/** 15-minute tick: team-booked runs chosen 5+ days ago → each home not booked (no confirmed time) goes back to Jo's
 *  suggestions with the standing pass, once (each home's 5 days from its own choice row). Closed homes are skipped. Nothing
 *  is sent. */
async function sweepTeamBookings(now: Date): Promise<{ released: number; failed: number }> {
  const out = { released: 0, failed: 0 };
  const since = new Date(now.getTime() - SLOT_LOOKBACK_DAYS * 86_400_000).toISOString();
  const chosen = (await readAll("team-booked runs", (f, t) => loose.from("workflow_events").select("job_id, created_at, details").eq("event_type", RUN_MODE_CHOSEN_EVENT).contains("details", { mode: RUN_TEAM_MODE }).gte("created_at", since).range(f, t))) as unknown as RunEventRow[];
  const first = new Map<string, string>();
  for (const e of chosen) { const r = runIdOf(e); if (r && (!first.has(r) || e.created_at < first.get(r)!)) first.set(r, e.created_at); }
  const due = [...first.keys()].filter((r) => runTeamExpired(first.get(r)!, now));
  if (!due.length) return out;
  const offered = (await readByIds("the runs", [...new Set(chosen.filter((e) => due.includes(runIdOf(e) ?? "")).map((e) => e.job_id))], (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).eq("event_type", RUN_OFFERED_EVENT).range(f, t))) as unknown as RunEventRow[];
  const jobIds = [...new Set(offered.filter((e) => due.includes(runIdOf(e) ?? "")).map((e) => e.job_id))];
  const [events, jobs] = await Promise.all([
    readByIds("run history", jobIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).in("event_type", [...RUN_EVENTS]).range(f, t)) as unknown as Promise<RunEventRow[]>,
    slotJobsById(jobIds),
  ]);
  for (const runId of due) {
    const st = runState(runId, events);
    if (!st || st.status !== "answered") continue;
    const slots = slotsOf(events).filter((x) => x.runId === runId);
    for (const id of st.memberIds) {
      const j = jobs.get(id);
      const x = slots.find((y) => y.jobId === id);
      if (!j || isClosedOrArchivedJob(j) || x?.state === "confirmed" || x?.state === "cancelled") continue;
      // Final review I4: a time the team entered and the owner was texted, not confirmed yet, is never withdrawn here —
      // slotDue releases it once that time passes unconfirmed (time_passed).
      if (x?.state === "proposed" && x.by === "team") continue;
      if (!runTeamExpired(teamChosenAt(events, runId, id) ?? first.get(runId)!, now)) continue;
      try {
        if (await claimBatchEvent(id, null, RUN_SLOT_RELEASED_EVENT, "Not booked by the installer's team within 5 days — back on the list for the next batch (owner not asked again)",
          { run_id: runId, batch_id: st.batchId, business_id: st.businessId, seq: x?.seq ?? 0, why: "team_not_booked", idempotency_key: runSlotReleaseKey(runId, id) })) out.released++;
      } catch (e) { out.failed++; console.error("team booking expiry failed", runId, id, (e as Error).message); }
    }
  }
  return out;
}

// ---- Move run (Task 8) ----------------------------------------------------------------------------------------------------------
// Sick, weather: the installer picks a new day (same rules as the day pick: 2+ days ahead, start time, 8 a day per person, a
// second day when needed). Every owner still holding a window gets a new one (seq + 1) to confirm — the same text, reminder
// and 24 hours. The run's window claims move with them (old freed, new claimed, all or nothing). A confirmed owner's booking
// is released through the existing Ready Check change path (`releaseBookedReadyCheck`: booking cancelled, back to "to
// schedule", installer kept), and their confirm rebooks through bookAgreedTime → confirmBooking (Mitti + emails as usual).

/** Stages a run home's visit can still be moved at: waiting to be booked, or booked and not done yet. */
const MOVABLE_STAGES: readonly string[] = ["ready_check_ready_to_schedule", "ready_check_scheduled"];

/** Installer: move a Portal books run to a new day. */
export async function moveRun(runId: string, userId: string, dayIso: string, startHHMM: string | null | undefined = RUN_DEFAULT_START, opts: { now?: Date; secondDay?: string | null } = {}): Promise<ChooseRunDayResult> {
  const now = opts.now ?? new Date();
  const { state, events } = await loadRun(runId, userId);
  const c = storedChoice(events, runId);
  if (state.status !== "answered" || !c || c.mode !== RUN_PORTAL_MODE) throw new WorkflowError(NOT_OPEN);
  const start = startHHMM || RUN_DEFAULT_START;
  const second = opts.secondDay || null;
  if (!isReadyCheckTime(start)) throw new WorkflowError("Please choose a time.");
  const b1 = runDayBlocker(dayIso, now);
  if (b1) throw new WorkflowError(b1);
  if (second) {
    const b2 = runDayBlocker(second, now);
    if (b2) throw new WorkflowError(b2);
    if (second === dayIso) throw new WorkflowError("Please pick a different second day.");
  }
  const held0 = slotsOf(events).filter((x) => x.runId === runId && holds(x));
  const jobs = await slotJobsById(held0.map((x) => x.jobId));
  // Final review I3: only visits still ahead (window not started) on jobs still waiting to be booked / booked for their
  // Ready Check move; a visit that has started, passed or been done stays as it is.
  const movable = (x: Slot) => { const j = jobs.get(x.jobId); return !!j && !isClosedOrArchivedJob(j) && MOVABLE_STAGES.includes(String(j.stage)) && windowStartAt(x.day, x.start).getTime() > now.getTime(); };
  const moving = state.memberIds.map((id) => held0.find((x) => x.jobId === id)).filter((x): x is Slot => !!x && movable(x));
  if (!moving.length) throw new WorkflowError("None of the homes in this run are still waiting.");
  if (!(await runTeam(state.businessId)).some((m) => m.userId === c.person)) throw new WorkflowError("Please choose who's doing these Ready Checks.");
  const textsOff = await ownerTextsBlocker(state.businessId, moving.map((x) => ({ isTest: jobs.get(x.jobId)?.source === "qa_test" })));
  if (textsOff) throw new WorkflowError(textsOff);
  const days = second ? [dayIso, second] : [dayIso];
  const held = heldBy(await personDays(state.businessId, c.person, days, now), (x) => x.runId !== runId);
  const plan = planRunDays({ memberIds: moving.map((x) => x.jobId), day: dayIso, start, secondDay: second, held });
  if (!plan.ok) throw new WorkflowError(plan.why);
  const byJob = new Map(moving.map((x) => [x.jobId, x]));
  const holders: Holder[] = plan.slots.map((p) => ({ jobId: p.jobId, runId, batchId: state.batchId, businessId: state.businessId, seq: byJob.get(p.jobId)!.seq + 1, person: c.person, day: p.day, start: p.start, end: p.end }));
  // Another run's live claim on a new window → refused before anything is written (this run's own old windows move).
  for (const h of holders) if (!(await ownOldClaimOnly(h, now))) throw new WorkflowError(TAKEN);
  // The claims move: the run's old windows freed, then every new window claimed (all or nothing).
  for (const x of moving) await freeWindow(x, userId, "moved");
  const won: Holder[] = [];
  for (const h of holders) {
    if (!(await claimWindow(h, userId, now))) { for (const w of won) await freeWindow(w, userId, "not_used", { exact: true }); throw new WorkflowError(TAKEN); }
    won.push(h);
  }
  const where = `${runDayWords(dayIso)}${second ? ` and ${runDayWords(second)}` : ""}, from ${start}`;
  const moved: Holder[] = [];
  for (const h of holders) {
    const x = byJob.get(h.jobId)!;
    if (x.state === "confirmed") {
      try { await (await import("./ready-check-times.server")).releaseBookedReadyCheck(h.jobId, userId, `Installer moved their run to ${where} — the owner confirms a new window`); }
      catch (e) { console.error("run move: booking not released, home left as booked", runId, h.jobId, (e as Error).message); await freeWindow(h, userId, "not_used", { exact: true }); continue; }
    }
    await claimBatchEvent(h.jobId, userId, RUN_MOVED_EVENT, `Installer moved the run to ${where}`,
      { run_id: runId, batch_id: state.batchId, business_id: state.businessId, day: dayIso, second_day: second, start, seq: h.seq, by: userId, was: { day: x.day, start: x.start, state: x.state }, idempotency_key: `run-moved:v1:${runId}:${h.jobId}:${h.seq}` });
    await claimBatchEvent(h.jobId, userId, RUN_SLOT_PROPOSED_EVENT, `Run moved: new Ready Check window ${runDayWords(h.day)}, ${windowWords(h.start, h.end)} — waiting for the owner to confirm`,
      { run_id: runId, batch_id: state.batchId, business_id: state.businessId, seq: h.seq, person: c.person, day: h.day, start: h.start, end: h.end, starts_at: windowStartAt(h.day, h.start).toISOString(), by: "move", idempotency_key: runSlotKey(runId, h.jobId, h.seq) });
    moved.push(h);
  }
  await sweepRunSlots(now.toISOString(), { jobIds: moved.map((h) => h.jobId) }).catch((e) => console.error("moved run texts deferred to the tick", runId, (e as Error).message));
  return { slots: moved.map((h) => ({ jobId: h.jobId, day: h.day, start: h.start, end: h.end })) };
}
/** The only live claim on this window's half-hours is this run's own (an old window that moves with it). */
async function ownOldClaimOnly(h: Holder, now: Date): Promise<boolean> {
  for (const slot of windowSlots(h.start, h.end)) {
    const st = await slotClaimState(slotRef(h, slot), now);
    if (st.claim && st.live && st.claim.runId !== h.runId) return false;
  }
  return true;
}

// ---- the owner cancels a confirmed window (Task 8) ------------------------------------------------------------------------------
// The owner cancels their job on My job after confirming their window (cancelOwnerJob → this hook): ONE `run_slot_cancelled`,
// the window's claims freed, and the installer (the business owner's mobile) told once — `run_slot_cancelled` (TEST → test-send;
// real → the one real sender, own switch, off until Jo switches it on). The run page then shows "Fill from nearby waiting
// owners": tapped → the nearest owner with a standing pass within 10 km of the cancelled home is added to the run and gets
// that window through the portal window flow (claim → text → confirm / can't make it / none suit). Not tapped → nothing.

/** Hook after the owner's own cancel. Only a CONFIRMED run window counts; once per window. Never texts the owner. */
export async function runOwnerCancelled(jobId: string, opts: { now?: Date } = {}): Promise<{ told: boolean; text?: string }> {
  const now = opts.now ?? new Date();
  const x = await ownerSlot(jobId);
  if (!x || x.state !== "confirmed") return { told: false };
  const won = await claimBatchEvent(jobId, null, RUN_SLOT_CANCELLED_EVENT, `Owner cancelled their confirmed Ready Check (${runDayWords(x.day)}, ${slotTimeWords(x)}) — the installer is told and can fill the time from nearby waiting owners`,
    { run_id: x.runId, batch_id: x.batchId, business_id: x.businessId, seq: x.seq, person: x.person, day: x.day, start: x.start, end: x.end, by: "owner", idempotency_key: runSlotCancelledKey(x.runId, jobId, x.seq) });
  if (!won) return { told: false };
  await freeWindow(x, null, "cancelled");
  return { told: true, text: await textInstallerCancelled(x, now) };
}

/** Recorded once when the installer's cancel text actually went (sent / already / sent_unknown); the tick retries until then. */
export const RUN_SLOT_CANCELLED_TEXTED_EVENT = "run_slot_cancelled_texted";

/** 15-minute tick (fix round 1): a cancel text that was held (quiet hours, switch off, sender down) is tried again while the
 *  cancelled time is still unfilled and still ahead; once it goes it is recorded and never tried again. */
async function sweepCancelledTexts(now: Date): Promise<{ failed: number }> {
  const out = { failed: 0 };
  const since = new Date(now.getTime() - SLOT_LOOKBACK_DAYS * 86_400_000).toISOString();
  const cancels = (await readAll("cancelled run windows", (f, t) => loose.from("workflow_events").select(EVENT_COLS).eq("event_type", RUN_SLOT_CANCELLED_EVENT).gte("created_at", since).range(f, t))) as unknown as RunEventRow[];
  if (!cancels.length) return out;
  const jobIds = [...new Set(cancels.map((e) => e.job_id))];
  const [texted, events] = await Promise.all([
    readByIds("cancel texts", jobIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).eq("event_type", RUN_SLOT_CANCELLED_TEXTED_EVENT).range(f, t)) as unknown as Promise<RunEventRow[]>,
    slotEventsFor(jobIds),
  ]);
  const went = new Set(texted.map((e) => `${runIdOf(e)}|${e.job_id}|${Number((e.details as { seq?: unknown } | null)?.seq ?? 0)}`));
  const due = slotsOf(events).filter((x) => x.state === "cancelled" && !went.has(`${x.runId}|${x.jobId}|${x.seq}`) && windowStartAt(x.day, x.start).getTime() > now.getTime());
  if (!due.length) return out;
  if (smsQuietReason(now.toISOString())) return out;
  // Task 9: while a real text would only be held (customer messages off, the run_slot_cancelled switch off, trade messages
  // paused), the real sender is not called at all — it would write a new held sms_messages row every tick. TEST runs still
  // go through test-send. Retried on the first tick after it is switched on.
  const { data: wsRow, error: we } = await loose.from("workflow_settings").select("*").eq("id", 1).maybeSingle();
  if (we) throw new Error(`Could not read the message switches: ${we.message}`);
  const w = (wsRow ?? null) as { customer_comms_enabled?: boolean | null; sms_message_switches?: Record<string, boolean> | null; trade_messages_paused?: boolean | null } | null;
  const realOff = w?.customer_comms_enabled !== true || w?.sms_message_switches?.[RUN_SLOT_CANCELLED_SMS_TYPE] !== true || w?.trade_messages_paused === true;
  for (const x of due) {
    try {
      // Filled meanwhile (the installer tapped Fill) → nothing to tell.
      const { data: fill, error } = await loose.from("workflow_events").select("id").eq("event_type", RUN_OFFERED_EVENT).contains("details", { run_id: x.runId, filled_from: x.jobId, filled_seq: x.seq }).limit(1);
      if (error) throw new Error(error.message);
      if ((fill ?? []).length) continue;
      await textInstallerCancelled(x, now, { realOff });
    } catch (e) { out.failed++; console.error("held cancel text not retried", x.runId, x.jobId, (e as Error).message); }
  }
  return out;
}

async function textInstallerCancelled(x: Slot, _now: Date, opts: { realOff?: boolean } = {}): Promise<string> {
  const status = await sendInstallerCancelled(x, opts);
  if ((RUN_TEXT_WENT as readonly string[]).includes(status)) {
    await claimBatchEvent(x.jobId, null, RUN_SLOT_CANCELLED_TEXTED_EVENT, "Installer texted that the owner cancelled their Ready Check time",
      { run_id: x.runId, business_id: x.businessId, seq: x.seq, status, idempotency_key: `run-slot-cancelled-texted:v1:${x.runId}:${x.jobId}:${x.seq}` })
      .catch((e) => console.error("cancel text not recorded", x.runId, x.jobId, (e as Error).message));
  }
  return status;
}

/** `realOff`: a real text would only be held now — return "held" without calling the real sender (nothing written). */
async function sendInstallerCancelled(x: Slot, opts: { realOff?: boolean } = {}): Promise<string> {
  const [{ data: biz }, jobs] = await Promise.all([
    admin.from("businesses").select("id, name, signer_name, signer_mobile, phone, onboarding_notes").eq("id", x.businessId).maybeSingle(),
    slotJobsById([x.jobId]),
  ]);
  const b = biz as { id: string; name: string | null; signer_name: string | null; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null } | null;
  const to = b?.signer_mobile ?? b?.phone ?? null;
  if (!b || !to) return "no mobile";
  const { isTestPartner } = await import("./test-send.core");
  const source = jobs.get(x.jobId)?.source ?? null;
  const test = source === "qa_test" || isTestPartner(b);
  if (!test && opts.realOff) return "held";
  const base = test ? (await import("./test-send.server")).TEST_APP_BASE : (await import("./set-password-link.core")).SET_PASSWORD_BASE;
  const body = runSlotCancelledText({ name: b.signer_name, day: runDayWords(x.day), time: slotTimeWords(x), link: runLink(base, x.runId) });
  try {
    if (test) return (await (await import("./test-send.server")).sendTestSms({ jobId: x.jobId, jobSource: source, partnerIsTest: isTestPartner(b), label: `${RUN_SLOT_CANCELLED_SMS_TYPE}:${x.runId}:${x.seq}`, actorId: null }, to, body)).status;
    return (await (await import("./sms.server")).sendRealSms({ type: RUN_SLOT_CANCELLED_SMS_TYPE, idempotencyKey: runSlotCancelledSmsKey(x.runId, x.jobId, x.seq), to, body, jobId: x.jobId, businessId: b.id })).status;
  } catch (e) { console.error("run slot cancelled installer text not sent", x.runId, x.jobId, (e as Error).message); return "failed"; }
}

/** Installer: "Fill from nearby waiting owners" on a cancelled window. Once per cancelled window (a repeat tap returns the
 *  owner it went to). */
export async function fillCancelledSlot(runId: string, userId: string, cancelledJobId: string, opts: { now?: Date } = {}): Promise<{ jobId: string }> {
  const now = opts.now ?? new Date();
  const { state, events } = await loadRun(runId, userId);
  const x = slotsOf(events).find((y) => y.runId === runId && y.jobId === cancelledJobId && y.state === "cancelled");
  if (!x) throw new WorkflowError(NOT_AVAILABLE);
  const prior = events.find((e) => e.event_type === RUN_OFFERED_EVENT && runIdOf(e) === runId && (e.details as { filled_from?: unknown; filled_seq?: unknown } | null)?.filled_from === cancelledJobId && Number((e.details as { filled_seq?: unknown }).filled_seq) === x.seq);
  const choice = storedChoice(events, runId);
  if (prior) {
    // Task 9: a team Fill that stopped after the Fill row (no run_mode_chosen for the added home) is finished by the repeat tap.
    if (choice?.mode === RUN_TEAM_MODE && !events.some((e) => e.event_type === RUN_MODE_CHOSEN_EVENT && runIdOf(e) === runId && e.job_id === prior.job_id))
      await teamFillChoice(state, choice, prior.job_id, cancelledJobId, userId);
    return { jobId: prior.job_id };
  }
  if (state.status !== "answered") throw new WorkflowError(NOT_OPEN);
  // Fix round 1: on a TEAM run the filled owner is added "to be booked by the team" — the team calls them and enters the time
  // as for its other homes (no portal window, no claim, no text now).
  const team = choice?.mode === RUN_TEAM_MODE;
  if (!team && pickTooSoon(x.day, x.start, now)) throw new WorkflowError(RUN_PICK_TOO_SOON);
  const nobody = "No waiting owners nearby right now.";
  const point = await homePoint(cancelledJobId);
  if (!point) throw new WorkflowError(nobody);
  const runTest = (await slotJobsById([cancelledJobId])).get(cancelledJobId)?.source === "qa_test";
  const { batchCandidates } = await import("./area-batch.server");
  const near = (await batchCandidates({ includeTest: runTest })).candidates
    .filter((c) => c.carriedPass && c.isTest === runTest && !state.jobIds.includes(c.jobId) && Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map((c) => ({ c, d: distanceM(point, c) })).filter((n) => n.d <= RUN_FILL_RADIUS_M)
    .sort((a, b) => a.d - b.d || (a.c.jobId < b.c.jobId ? -1 : 1));
  let pick: (typeof near)[number]["c"] | null = null;
  for (const n of near) if (await canTakeHomes(state.businessId, [{ postcode: n.c.postcode, isTest: n.c.isTest }])) { pick = n.c; break; }
  if (!pick) throw new WorkflowError(nobody);
  const textsOff = await ownerTextsBlocker(state.businessId, [{ isTest: pick.isTest }]);
  if (textsOff) throw new WorkflowError(textsOff);
  if (team) {
    const won = await claimBatchEvent(pick.jobId, userId, RUN_OFFERED_EVENT, `Added to ${tradeName(await businessOf(state.businessId))}'s run for a cancelled Ready Check time (Fill from nearby waiting owners) — their team calls the owner and enters the time`,
      { run_id: runId, batch_id: state.batchId, business_id: state.businessId, job_ids: [pick.jobId], offered_at: now.toISOString(), offered_by: userId, filled_from: cancelledJobId, filled_seq: x.seq, idempotency_key: runSlotFilledKey(runId, cancelledJobId, x.seq) });
    if (!won) return { jobId: pick.jobId };
    await teamFillChoice(state, choice!, pick.jobId, cancelledJobId, userId);
    return { jobId: pick.jobId };
  }
  const h: Holder = { jobId: pick.jobId, runId, batchId: state.batchId, businessId: state.businessId, seq: 1, person: x.person, day: x.day, start: x.start, end: x.end };
  if (!(await claimWindow(h, userId, now))) throw new WorkflowError(TAKEN);
  const won = await claimBatchEvent(pick.jobId, userId, RUN_OFFERED_EVENT, `Offered a cancelled Ready Check time from ${tradeName(await businessOf(state.businessId))}'s run (Fill from nearby waiting owners)`,
    { run_id: runId, batch_id: state.batchId, business_id: state.businessId, job_ids: [pick.jobId], offered_at: now.toISOString(), offered_by: userId, filled_from: cancelledJobId, filled_seq: x.seq, idempotency_key: runSlotFilledKey(runId, cancelledJobId, x.seq) });
  if (!won) { await freeWindow(h, userId, "not_used", { exact: true }); return { jobId: pick.jobId }; }
  await claimBatchEvent(pick.jobId, userId, RUN_SLOT_PROPOSED_EVENT, `Ready Check window ${runDayWords(x.day)}, ${windowWords(x.start, x.end)} (a cancelled time, filled from nearby) — waiting for the owner to confirm`,
    { run_id: runId, batch_id: state.batchId, business_id: state.businessId, seq: 1, person: x.person, day: x.day, start: x.start, end: x.end, starts_at: windowStartAt(x.day, x.start).toISOString(), by: "fill", idempotency_key: runSlotKey(runId, pick.jobId, 1) });
  await sweepRunSlots(now.toISOString(), { jobIds: [pick.jobId] }).catch((e) => console.error("filled window text deferred to the tick", runId, (e as Error).message));
  return { jobId: pick.jobId };
}

/** A home added to a TEAM run by Fill: its own 5 days for the team to book it (from now), like the run's other homes had from
 *  the choice. Once per run + home (the mode key). */
async function teamFillChoice(state: RunState, choice: RunChoice, jobId: string, cancelledJobId: string, userId: string): Promise<void> {
  await claimBatchEvent(jobId, userId, RUN_MODE_CHOSEN_EVENT, "Added to an Our team books run — their team calls the owner and enters the time (5 days)",
    { run_id: state.runId, batch_id: state.batchId, business_id: state.businessId, mode: RUN_TEAM_MODE, person: choice.person, chosen_by: userId, job_ids: [jobId], filled_from: cancelledJobId, idempotency_key: runModeKey(state.runId, jobId) });
}
