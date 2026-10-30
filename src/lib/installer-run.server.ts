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
import { AREA_BATCH_CLOSED_EVENT, AREA_BATCH_SENT_EVENT } from "./area-batch.core";
import { claimBatchEvent, homePoint, readAll, readByIds } from "./area-batch.server";
import { QUICK_TAPS_ANSWERED_EVENT, type QuickTapAnswers } from "./quick-taps.core";
import { jobWaitingForInstaller } from "./spot-release.core";
import { smsQuietReason } from "./quote-hold.core";
import { fullAddress } from "./address";
import {
  RUN_DECLINED_EVENT, RUN_EVENTS, RUN_EXPIRED_EVENT, RUN_HOME_REMOVED_EVENT, RUN_OFFERED_EVENT, RUN_OFFERED_SMS_TYPE, RUN_REPLY_HOURS,
  areaLines, orderRun, runExpiryDue, runIdOf, runLink, runOfferedKey, runOfferedSmsKey, runOfferedText, runReleaseKey, runState, runSuburb, tapRows,
  type RunEventRow, type RunState, type RunStatus,
} from "./run-route.core";

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

/** Jo taps "Send to installer" on a closed batch. Every check first (nothing written if any fails); then one run_offered per
 *  home; then the installer text once. A batch is sent to the installer at most once. */
export async function offerRun(batchId: string, actorId: string | null, opts: { now?: Date } = {}): Promise<OfferRunResult> {
  const now = opts.now ?? new Date();
  const closed = await readAll("the closed batch", (f, t) => loose.from("workflow_events").select(EVENT_COLS).eq("event_type", AREA_BATCH_CLOSED_EVENT).contains("details", { batch_id: batchId }).range(f, t));
  const passIds = [...new Set(closed.flatMap((e) => { const p = (e["details"] as { pass_job_ids?: unknown } | null)?.pass_job_ids; return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []; }))].sort();
  if (!passIds.length) throw new WorkflowError("That batch has no owners who said yes — nothing was sent.");

  const [jobs, assigned, history] = await Promise.all([
    readByIds("the batch's homes", passIds, (c, f, t) => admin.from("jobs").select("id, job_number, stage, source, channel, deleted_at, qa_archived_at, properties(suburb)").in("id", c).range(f, t)),
    readByIds("the batch's installers", passIds, (c, f, t) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true).range(f, t)),
    readByIds("the batch's history", passIds, (c, f, t) => loose.from("workflow_events").select(EVENT_COLS).in("job_id", c).in("event_type", [AREA_BATCH_SENT_EVENT, QUICK_TAPS_ANSWERED_EVENT, ...RUN_EVENTS]).range(f, t)),
  ]);
  const ev = history as unknown as RunEventRow[];
  const forBatch = (e: RunEventRow) => (e.details as { batch_id?: unknown } | null)?.batch_id === batchId;
  if (ev.some((e) => e.event_type === RUN_OFFERED_EVENT && forBatch(e))) throw new WorkflowError("This batch has already been sent to the installer — nothing was sent.");

  const withInstaller = new Set(assigned.map((a) => String(a["job_id"])));
  const jobBy = new Map(jobs.map((j) => [String(j["id"]), j]));
  const members = passIds.filter((id) => {
    const j = jobBy.get(id);
    if (!j || j["qa_archived_at"]) return false;
    return jobWaitingForInstaller({ channel: s(j["channel"]), stage: s(j["stage"]), hasInstaller: withInstaller.has(id), deleted: !!j["deleted_at"] });
  });
  if (!members.length) throw new WorkflowError("None of the owners in this batch are still waiting — nothing was sent.");
  const testness = new Set(members.map((id) => jobBy.get(id)!["source"] === "qa_test"));
  if (testness.size > 1) throw new WorkflowError("TEST and real homes can't be in the same run — nothing was sent.");

  const sent = ev.find((e) => e.event_type === AREA_BATCH_SENT_EVENT && forBatch(e));
  const businessId = s((sent?.details as { installer_business_id?: unknown } | null)?.installer_business_id);
  if (!businessId) throw new WorkflowError("We can't tell which installer this batch was for — nothing was sent.");
  const { data: biz } = await admin.from("businesses").select("id, name, signer_name, signer_mobile, phone, onboarding_notes").eq("id", businessId).maybeSingle();
  const b = biz as { id: string; name: string | null; signer_name: string | null; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null } | null;
  if (!b) throw new WorkflowError("That installer no longer exists — nothing was sent.");
  const { isTestPartner } = await import("./test-send.core");
  const partnerTest = isTestPartner(b);
  const test = testness.has(true) || partnerTest;
  // The business owner's mobile (same rule as every other business-owner text).
  const to = b.signer_mobile ?? b.phone ?? null;
  if (!to) throw new WorkflowError(`${b.name || "The installer"} has no mobile on file — nothing was sent.`);
  // A quiet-hours hold is never re-sent, and the 24-hour reply clock would run overnight: refuse like the batch Send does.
  if (!test && smsQuietReason(now.toISOString())) throw new WorkflowError("It's quiet hours (8pm–7am) — texts can't go now. Send again after 7am. Nothing was sent.");

  // Route order on each home's location (the owner's confirmed address; postcode centre while there's no full address).
  const points = new Map<string, { lat: number; lng: number }>();
  await inFours(members, async (id) => { const p = await homePoint(id); if (p) points.set(id, p); });
  const order = orderRun(members.map((id) => ({ jobId: id, lat: points.get(id)?.lat ?? Number.NaN, lng: points.get(id)?.lng ?? Number.NaN })));
  const suburb = runSuburb(order.map((id) => (jobBy.get(id)?.["properties"] as { suburb?: string | null } | null)?.suburb));

  const runId = crypto.randomUUID();
  const offeredAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + RUN_REPLY_HOURS * 3_600_000).toISOString();
  for (const id of order) {
    const won = await claimBatchEvent(id, actorId, RUN_OFFERED_EVENT, `Run of ${order.length} Ready ${order.length === 1 ? "Check" : "Checks"} sent to ${b.name ?? "the installer"} — waiting for them to pick a day (24 hours)`,
      { run_id: runId, batch_id: batchId, business_id: b.id, business_name: b.name, job_ids: order, offered_at: offeredAt, expires_at: expiresAt, offered_by: actorId, idempotency_key: runOfferedKey(batchId, id) });
    if (!won) throw new WorkflowError("This batch has already been sent to the installer — nothing more was sent.");
  }

  const base = test ? (await import("./test-send.server")).TEST_APP_BASE : (await import("./set-password-link.core")).SET_PASSWORD_BASE;
  const body = runOfferedText({ name: b.signer_name, homes: order.length, suburb, link: runLink(base, runId) });
  let text: { status: string; detail: string };
  try {
    if (test) {
      const first = jobBy.get(order[0]!)!;
      const r = await (await import("./test-send.server")).sendTestSms({ jobId: order[0]!, jobSource: s(first["source"]), partnerIsTest: partnerTest, label: `run_offered:${runId}`, actorId }, to, body);
      text = { status: r.status, detail: r.detail };
    } else {
      const r = await (await import("./sms.server")).sendRealSms({ type: RUN_OFFERED_SMS_TYPE, idempotencyKey: runOfferedSmsKey(runId), to, body, businessId: b.id, event: { at: offeredAt, current: true } });
      text = { status: r.status, detail: r.detail };
    }
  } catch (e) { text = { status: "failed", detail: (e as Error).message }; }
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

export type RunPageHome = { jobId: string; jobNumber: string; address: string; ownerName: string | null; phone: string | null; area: string[]; taps: [string, string][] };
export type RunPage = { runId: string; status: RunStatus; expiresAt: string; suburb: string; homes: RunPageHome[] };

/** The run page: each home still in the run (route order) — address, owner name + phone where the owner agreed to share,
 *  m² with its source (best first) and the quick-tap answers. A closed job (cancelled meanwhile) is left out. */
export async function tradeRun(runId: string, userId: string): Promise<RunPage> {
  const { state } = await loadRun(runId, userId);
  const open = state.status === "offered" || state.status === "answered";
  const ids = open ? state.memberIds : [];
  if (!ids.length) return { runId, status: state.status, expiresAt: state.expiresAt, suburb: "", homes: [] };
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
    });
  }
  const suburbs = homes.map((h) => (jobBy.get(h.jobId)?.["properties"] as { suburb?: string | null } | null)?.suburb);
  return { runId, status: state.status, expiresAt: state.expiresAt, suburb: runSuburb(suburbs), homes };
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

