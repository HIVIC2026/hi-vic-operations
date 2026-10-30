// A48 batch 2 (Jo 29–30 Oct 2026, spec part 1): area batches. I/O only — the rules are in area-batch.core.ts.
// - batchCandidates: website owners (hivic_sourced) waiting for an installer with a saved spot, most likely eligible,
//   not in an open batch, not being asked about a released spot. Missing locations are filled once through
//   ensurePropertyCoordinates (a few per load) before clustering; a home still without a location is left out. A home
//   with only a postcode (no full street address) is placed at its postcode's centre until the owner gives the address
//   (Jo 30 Oct, Task 3).
// - batchSuggestions: suggestBatches per TEST / real group, plus the installers who can be offered EVERY home.
// - sendBatch: Jo's one tap. Every check runs first (nothing written if any fails), then ONE `area_batch_sent` claim per
//   job (append-only workflow_events), then the owner's quick taps text once per job: TEST → test-send, real → the one
//   real SMS sender (`quick_taps` switch, consent, STOP). Never automatic: only the office Send calls this.
// - sweepAreaBatches (15-minute tick, Task 4): day-2 reminder, day-3 close, decline retries, day-14 no-answer close (rules
//   in area-batch.core planBatchSweep). Passers wait for Jo's OK ("Send to installer" on Choose installer,
//   batchesReadyToSend): a run NEVER goes to an installer automatically (Jo 30 Oct). Nothing lands in Needs me.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError, logEvent } from "./workflow.server";
import {
  AREA_BATCH_CLOSED_EVENT, AREA_BATCH_EVENTS, AREA_BATCH_LEFT_EVENT, AREA_BATCH_RETURNED_EVENT, AREA_BATCH_SENT_EVENT, NO_ANSWER_CLOSE_REASON, QUICK_TAPS_REMINDED_EVENT,
  QUICK_TAPS_REMINDER_SMS_TYPE, QUICK_TAPS_SMS_TYPE, areaBatchClosedKey, areaBatchKey, batchInstallers, batchSpanKm, likelyEligible, nextBatchSeq,
  openBatchId, outsideBatch, passHandedOn, planBatchSweep, standingPass, STAGE_CHANGED_EVENT, quickTapsLink, quickTapsReminderText, quickTapsSmsKey, quickTapsText, suggestBatches,
  type AreaBatchEventRow, type BatchHome, type SweepJob,
} from "./area-batch.core";
import { QUICK_TAPS_ANSWERED_EVENT } from "./quick-taps.core";
import { RUN_EVENTS, RUN_OFFERED_EVENT, isFillRow, runExpiryDue, runIdOf, runState, type RunEventRow, type RunState } from "./run-route.core";
import { installerWaiting } from "./installer-waiting-columns.core";
import { SPOT_RELEASE_EVENTS, jobWaitingForInstaller, spotReleaseState, type SpotReleaseEventRow } from "./spot-release.core";
import { declaredExtras, declaredInsulationDetail } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { distanceM, propertyPoint, type PropertyPoint } from "./geo.core";
import { parseStreet } from "./address-complete.core";
import { smsQuietReason } from "./quote-hold.core";
import { smsHeldForRecipient } from "./sms.core";

type Row = Record<string, unknown>;
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
const loose = admin as unknown as SupabaseClient;
const s = (v: unknown) => (v == null ? null : String(v));
const MAX_SEND = 10;
/** Location lookups per page load (each is a Vicmap / Google call); the rest are filled on later loads. */
const LOCATE_PER_LOAD = 25;

async function all(what: string, page: (from: number, to: number) => Res): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}
/** Id lookups in chunks of 150, four in flight (AGENTS: one all-ids URL stalls). */
async function byIds(what: string, ids: string[], q: (chunk: string[], from: number, to: number) => Res): Promise<Row[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const out: Row[] = [];
  for (let i = 0; i < chunks.length; i += 4) out.push(...(await Promise.all(chunks.slice(i, i + 4).map((c) => all(what, (f, t) => q(c, f, t))))).flat());
  return out;
}
const group = <T extends Row>(rows: T[], key: string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = String(r[key]); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
  return m;
};

// ---- reads -------------------------------------------------------------------------------------------------------

async function batchEvents(jobIds: string[]): Promise<Map<string, AreaBatchEventRow[]>> {
  const rows = jobIds.length ? await byIds("batch history", jobIds, (c, f, t) => loose.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [...AREA_BATCH_EVENTS]).range(f, t)) : [];
  return group(rows, "job_id") as unknown as Map<string, AreaBatchEventRow[]>;
}

/** The job's open batch id, or null. */
export async function openBatchFor(jobId: string): Promise<string | null> {
  return openBatchId((await batchEvents([jobId])).get(jobId) ?? []);
}
/** The job's batch events (sent / closed / left). */
export async function batchEventsFor(jobId: string): Promise<AreaBatchEventRow[]> {
  return (await batchEvents([jobId])).get(jobId) ?? [];
}

/** The postcode's centre (`src/data/vic-postcode-centroids.json`, [lat, lng]), or null for an unknown postcode. */
export async function postcodeCentre(postcode: string | null | undefined): Promise<PropertyPoint> {
  const pc = (postcode ?? "").trim();
  if (!/^\d{4}$/.test(pc)) return null;
  const { default: centres } = await import("@/data/vic-postcode-centroids.json");
  const c = (centres as unknown as Record<string, [number, number]>)[pc];
  return c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { lat: c[0], lng: c[1] } : null;
}
/** A full street address (number + street name) is on file. */
export const hasFullStreet = (addressLine: string | null | undefined): boolean => parseStreet(addressLine) !== null;

/** `carriedPass`: the owner already passed the quick taps in a batch they left (or as it closed) — put in a new batch
 *  without being asked again (Task 4 fix round 1). */
export type BatchCandidate = BatchHome & { jobNumber: string; propertyId: string; ownerName: string; phone: string | null; suburb: string; isTest: boolean; source: string | null; carriedPass: boolean };
export type CandidateRead = { candidates: BatchCandidate[]; unlocated: number; refused: Map<string, string> };

/** Who can be put in a batch now. `jobIds` limits the read (Send re-checks its own homes); `locate` caps location lookups. */
export async function batchCandidates(opts: { includeTest?: boolean; testJobIds?: string[]; jobIds?: string[]; locate?: number; requireLocation?: boolean; now?: Date } = {}): Promise<CandidateRead> {
  const jobs = (await all("waiting jobs", (a, b) => {
    let q = admin.from("jobs").select("id, job_number, stage, source, channel, deleted_at, qa_archived_at, property_id, owners(full_name, phone), properties(address_line, suburb, postcode, declared:enrichment->base44->declared, answers:enrichment->base44->raw->answers)")
      .eq("stage", "ready_check_ready_to_schedule").eq("channel", "hivic_sourced").is("deleted_at", null).is("qa_archived_at", null);
    if (opts.jobIds) q = q.in("id", opts.jobIds.length ? opts.jobIds : ["00000000-0000-0000-0000-000000000000"]);
    if (opts.testJobIds) q = q.eq("source", "qa_test").in("id", opts.testJobIds.length ? opts.testJobIds : ["00000000-0000-0000-0000-000000000000"]);
    return q.order("created_at").order("id").range(a, b);
  })).filter((j) => j["channel"] === "hivic_sourced" && (opts.includeTest || opts.testJobIds || opts.jobIds || j["source"] !== "qa_test"));
  const refused = new Map<string, string>();
  const ids = jobs.map((j) => String(j["id"]));
  const propIds = [...new Set(jobs.map((j) => s(j["property_id"])).filter((x): x is string => !!x))];
  const [assigned, offers, saved, events, facts] = ids.length ? await Promise.all([
    byIds("installers", ids, (c, f, t) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true).range(f, t)),
    byIds("Ready Check offers", ids, (c, f, t) => admin.from("partner_offers").select("job_id, status, offered_at, businesses(name)").in("job_id", c).eq("kind", "ready_check").range(f, t)),
    byIds("saved spots", ids, (c, f, t) => admin.from("lead_campaign_responses").select("job_id, spot_saved_at, opted_out_at, saved_insulation").in("job_id", c).range(f, t)),
    byIds("batch and release history", ids, (c, f, t) => loose.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [...AREA_BATCH_EVENTS, QUICK_TAPS_ANSWERED_EVENT, ...SPOT_RELEASE_EVENTS, ...RUN_EVENTS]).range(f, t)),
    propIds.length ? byIds("property facts", propIds, (c, f, t) => loose.from("property_facts").select("property_id, fact_key, value").in("property_id", c).in("fact_key", ["coordinates", "roof_form"]).eq("is_current", true).range(f, t)) : Promise.resolve([] as Row[]),
  ]) : [[], [], [], [], []];
  const withInstaller = new Set(assigned.map((a) => String(a["job_id"])));
  const offersBy = group(offers, "job_id");
  const savedBy = new Map(saved.map((r) => [String(r["job_id"]), r]));
  const eventsBy = group(events, "job_id");
  const factsBy = group(facts, "property_id");
  const fact = (propertyId: string | null, key: string) => (propertyId ? factsBy.get(propertyId)?.find((f) => f["fact_key"] === key)?.["value"] : undefined);

  const keep: { j: Row; propertyId: string; point: { lat: number; lng: number } | null; fullStreet: boolean }[] = [];
  for (const j of jobs) {
    const id = String(j["id"]);
    const no = (why: string) => { refused.set(id, why); };
    const member = installerWaiting({
      channel: s(j["channel"]), stage: String(j["stage"]), deleted: !!j["deleted_at"], archived: !!j["qa_archived_at"], hasInstaller: withInstaller.has(id),
      offers: (offersBy.get(id) ?? []).map((o) => ({ status: String(o["status"]), offered_at: String(o["offered_at"]), business_name: (o["businesses"] as { name?: string } | null)?.name ?? null })),
    });
    if (!member) { no("it isn't waiting for an installer"); continue; }
    const sv = savedBy.get(id);
    if (!sv?.["spot_saved_at"] || sv["opted_out_at"]) { no("the owner hasn't saved a spot"); continue; }
    const ev = eventsBy.get(id) ?? [];
    if (openBatchId(ev as unknown as AreaBatchEventRow[])) { no("it's already in a batch waiting for answers"); continue; }
    // Task 8: a home added to a run by "Fill from nearby waiting owners" holds no pass of that run's batch — it is still in
    // an open run while its window holds (until released / the run ends).
    const ownRuns = [...new Set((ev as unknown as RunEventRow[]).filter((e) => e.event_type === RUN_OFFERED_EVENT).map(runIdOf).filter((x): x is string => !!x))];
    if (ownRuns.some((r) => { const st = runState(r, ev as unknown as RunEventRow[]); return !!st && st.memberIds.includes(id) && (st.status === "offered" || st.status === "answered"); })) { no("it's in a run sent to the installer"); continue; }
    if (passHandedOn(ev as unknown as AreaBatchEventRow[], id)) {
      const runIds = [...new Set((ev as unknown as RunEventRow[]).filter((e) => e.event_type === RUN_OFFERED_EVENT).map(runIdOf).filter((x): x is string => !!x))];
      const inRun = runIds.some((r) => { const st = runState(r, ev as unknown as RunEventRow[]); return !!st && st.memberIds.includes(id) && (st.status === "offered" || st.status === "answered"); });
      no(inRun ? "it's in a run sent to the installer" : "the owner said yes — it's waiting for you to tap Send to installer"); continue;
    }
    const release = spotReleaseState((ev as unknown as SpotReleaseEventRow[]).filter((e) => (SPOT_RELEASE_EVENTS as readonly string[]).includes(e.event_type)));
    if (release.state === "pending") { no("the owner is being asked to confirm a released spot"); continue; }
    const prop = (j["properties"] ?? null) as { declared?: Record<string, unknown> | null; answers?: Record<string, unknown> | null } | null;
    const extras = declaredExtras(prop?.answers ?? null);
    const insulation = s(sv["saved_insulation"]) ?? normaliseInsulation(extras.existing_insulation);
    const roof = fact(s(j["property_id"]), "roof_form");
    const likely = likelyEligible({
      propertyType: s(prop?.declared?.["property_type"]), topFloor: extras.top_floor, overFiveYears: s(prop?.declared?.["over_five_years"]),
      insulation, insulationThickness: declaredInsulationDetail(prop?.answers ?? null).insulation_thickness, roofForm: typeof roof === "string" ? roof : null,
    });
    if (!likely) { no("its answers don't look likely eligible yet"); continue; }
    const propertyId = s(j["property_id"]) ?? "";
    keep.push({ j, propertyId, point: propertyPoint(fact(propertyId, "coordinates")), fullStreet: hasFullStreet((prop as { address_line?: string | null } | null)?.address_line) });
  }

  // Fill missing locations once (stored as the property's `coordinates` fact), a few at a time. Only full street addresses
  // can be looked up; a postcode-only home is placed at its postcode's centre until the owner gives the full address.
  for (const k of keep) if (!k.point && !k.fullStreet) k.point = await postcodeCentre((k.j["properties"] as { postcode?: string | null } | null)?.postcode);
  // A postcode-only home with no known postcode centre is never looked up by street: it waits for its full address.
  const missing = keep.filter((k) => !k.point && k.propertyId && k.fullStreet).slice(0, opts.locate ?? LOCATE_PER_LOAD);
  if (missing.length) {
    const { ensurePropertyCoordinates } = await import("./property-coordinates.server");
    for (let i = 0; i < missing.length; i += 4) {
      await Promise.all(missing.slice(i, i + 4).map(async (k) => { k.point = propertyPoint(await ensurePropertyCoordinates(String(k.j["id"]), k.propertyId)); }));
    }
  }
  const candidates: BatchCandidate[] = [];
  let unlocated = 0;
  for (const { j, propertyId, point } of keep) {
    const id = String(j["id"]);
    if (!point) { unlocated++; if (opts.requireLocation !== false) { refused.set(id, "we don't have its location yet"); continue; } }
    const prop = (j["properties"] ?? null) as { suburb?: string | null; postcode?: string | null } | null;
    const owner = (j["owners"] ?? null) as { full_name?: string | null; phone?: string | null } | null;
    candidates.push({
      jobId: id, jobNumber: String(j["job_number"] ?? ""), propertyId, lat: point?.lat ?? Number.NaN, lng: point?.lng ?? Number.NaN,
      postcode: (prop?.postcode ?? "").trim(), suburb: (prop?.suburb ?? "").trim(), spotSavedAt: String(savedBy.get(id)?.["spot_saved_at"]),
      ownerName: (owner?.full_name ?? "").trim(), phone: owner?.phone ?? null, isTest: j["source"] === "qa_test", source: s(j["source"]),
      carriedPass: standingPass((eventsBy.get(id) ?? []) as unknown as AreaBatchEventRow[], id),
    });
  }
  return { candidates, unlocated, refused };
}

// ---- suggestions ---------------------------------------------------------------------------------------------------

export type SuggestedHome = { jobId: string; jobNumber: string; ownerName: string; suburb: string; postcode: string; spotSavedAt: string; isTest: boolean };
export type SuggestedBatch = { homes: SuggestedHome[]; suburbs: string[]; spanKm: number; isTest: boolean; installers: { id: string; name: string }[] };
export type BatchSuggestions = { batches: SuggestedBatch[]; candidates: number; unlocated: number };

export async function batchSuggestions(opts: { includeTest?: boolean; testJobIds?: string[]; testBusinessIds?: string[]; now?: Date } = {}): Promise<BatchSuggestions> {
  const now = opts.now ?? new Date();
  const [{ candidates, unlocated }, installers] = await Promise.all([
    batchCandidates({ ...(opts.includeTest ? { includeTest: true } : {}), ...(opts.testJobIds ? { testJobIds: opts.testJobIds } : {}), now }),
    (await import("./installer-waiting.server")).installerFacts(opts.testBusinessIds),
  ]);
  const batches: SuggestedBatch[] = [];
  for (const isTest of [false, true]) {
    const groupHomes = candidates.filter((c) => c.isTest === isTest);
    for (const b of suggestBatches(groupHomes, now.toISOString())) {
      const homes = b as BatchCandidate[];
      batches.push({
        homes: homes.map((h) => ({ jobId: h.jobId, jobNumber: h.jobNumber, ownerName: h.ownerName, suburb: h.suburb, postcode: h.postcode, spotSavedAt: h.spotSavedAt, isTest: h.isTest })),
        suburbs: [...new Set(homes.map((h) => [h.suburb, h.postcode].filter(Boolean).join(" ")).filter(Boolean))].sort(),
        spanKm: batchSpanKm(homes), isTest,
        installers: batchInstallers(installers, homes).map((i) => ({ id: i.id, name: i.name })),
      });
    }
  }
  return { batches, candidates: candidates.length, unlocated };
}

// ---- Send (office, one tap) ------------------------------------------------------------------------------------------

export type SendBatchResult = { batchId: string; installer: string; homes: number; texts: { jobId: string; status: string; detail: string }[] };

/** Jo taps Send. Every check first; then one claim per job; then one text per job. Refuses if any home is already in an
 *  open batch (one batch at a time) or can't be batched any more. */
export async function sendBatch(jobIdsIn: string[], businessId: string, actorId: string | null, opts: { now?: Date } = {}): Promise<SendBatchResult> {
  const now = opts.now ?? new Date();
  const jobIds = [...new Set(jobIdsIn)];
  if (!jobIds.length) throw new WorkflowError("Pick at least one home.");
  if (jobIds.length > MAX_SEND) throw new WorkflowError(`A batch is at most ${MAX_SEND} homes.`);

  const { data: numbers, error: ne } = await admin.from("jobs").select("id, job_number").in("id", jobIds);
  if (ne) throw new WorkflowError(`Could not read the jobs: ${ne.message} — nothing was sent.`);
  const label = (id: string) => String((numbers ?? []).find((n) => n.id === id)?.job_number ?? "a job that no longer exists");
  // One batch at a time: any home already in an open batch refuses the whole Send.
  const evs = await batchEvents(jobIds);
  const inBatch = jobIds.filter((id) => openBatchId(evs.get(id) ?? []));
  if (inBatch.length) throw new WorkflowError(`${inBatch.map(label).join(", ")} ${inBatch.length === 1 ? "is" : "are"} already in a batch waiting for answers — nothing was sent.`);

  // The same candidate rules as the suggestions (location not needed here: coverage is by postcode).
  const { candidates, refused } = await batchCandidates({ jobIds, includeTest: true, locate: 0, requireLocation: false, now });
  const byId = new Map(candidates.map((c) => [c.jobId, c]));
  const not = jobIds.filter((id) => !byId.has(id));
  if (not.length) throw new WorkflowError(`${not.map((id) => `${label(id)} can't be put in a batch (${refused.get(id) ?? "it isn't waiting for an installer"})`).join("; ")} — nothing was sent.`);
  const homes = jobIds.map((id) => byId.get(id)!);
  const testness = new Set(homes.map((h) => h.isTest));
  if (testness.size > 1) throw new WorkflowError("TEST and real homes can't be in the same batch — nothing was sent.");
  const isTest = testness.has(true);

  const installer = (await (await import("./installer-waiting.server")).installerFacts([businessId])).find((i) => i.id === businessId);
  if (!installer || !batchInstallers([installer], homes).length) throw new WorkflowError(`${installer?.name || "That installer"} doesn't cover every home in this batch — nothing was sent.`);
  const { count: cards, error: rce } = await loose.from("rate_cards").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("kind", "installer").eq("is_active", true);
  if (rce) throw new WorkflowError(`Could not check the installer's rate card: ${rce.message}`);
  if (!(cards ?? 0)) throw new WorkflowError(`${installer.name}: this installer has no rate card yet — nothing was sent.`);

  if (!isTest) {
    const { data: ws } = await admin.from("workflow_settings").select("customer_comms_enabled, sms_message_switches").eq("id", 1).maybeSingle();
    const w = ws as { customer_comms_enabled?: boolean | null; sms_message_switches?: Record<string, boolean> | null } | null;
    if (w?.customer_comms_enabled !== true) throw new WorkflowError("Customer messages are switched off — nothing was sent.");
    if (w?.sms_message_switches?.[QUICK_TAPS_SMS_TYPE] !== true) throw new WorkflowError("The quick taps texts are switched off — switch them on in Settings first. Nothing was sent.");
    if (smsQuietReason(now.toISOString())) throw new WorkflowError("It's quiet hours (8pm–7am) — texts can't go now. Send again after 7am. Nothing was sent.");
  }
  const { ownerMyJobLink } = await import("./veec-copy-email.server");
  const links = new Map<string, string | null>();
  await Promise.all(homes.map(async (h) => links.set(h.jobId, await ownerMyJobLink(h.jobId))));
  const noLink = homes.filter((h) => !h.carriedPass && !links.get(h.jobId));
  if (noLink.length) throw new WorkflowError(`${noLink.map((h) => h.jobNumber).join(", ")}: the owner has no working My job link — nothing was sent.`);

  // Claims: one area_batch_sent per job, before any text. The batch centre is the first home (suggestBatches lists the
  // centre home first); its location is kept so a home whose address changes can be measured against it (Task 3).
  const batchId = crypto.randomUUID();
  const centreHome = homes[0]!;
  const centre = Number.isFinite(centreHome.lat) && Number.isFinite(centreHome.lng) ? { lat: centreHome.lat, lng: centreHome.lng } : null;
  const claimed: BatchCandidate[] = [];
  for (const h of homes) {
    const key = areaBatchKey(h.jobId, nextBatchSeq(evs.get(h.jobId) ?? []));
    const won = await claim(h.jobId, actorId, AREA_BATCH_SENT_EVENT, `Area batch sent (${homes.length} ${homes.length === 1 ? "home" : "homes"}, ${installer.name}) — quick taps texted to the owner`,
      { batch_id: batchId, installer_business_id: businessId, installer_name: installer.name, job_ids: jobIds, centre_job_id: centreHome.jobId, centre, sent_by: actorId, idempotency_key: key, ...(h.carriedPass ? { carried_pass: true } : {}) });
    if (!won) {
      // Someone else batched this home at the same moment: undo ours (append-only close) and send nothing.
      for (const c of claimed) await claim(c.jobId, actorId, AREA_BATCH_CLOSED_EVENT, "Area batch stopped before any text went (another batch took a home)", { batch_id: batchId, pass_job_ids: [], freed_job_ids: claimed.map((x) => x.jobId), reason: "send_interrupted" });
      throw new WorkflowError(`${h.jobNumber} was just put in another batch — nothing was sent.`);
    }
    claimed.push(h);
  }

  const texts: SendBatchResult["texts"] = [];
  const send = async (h: BatchCandidate) => {
    // Already said yes in a batch they left: recorded in this batch, never asked again.
    if (h.carriedPass) { texts.push({ jobId: h.jobId, status: "not_texted", detail: "the owner already said yes — not asked again" }); return; }
    try {
      const r = await textOwner(h, batchId, links.get(h.jobId)!, businessId, actorId);
      texts.push({ jobId: h.jobId, ...r });
    } catch (e) { texts.push({ jobId: h.jobId, status: "failed", detail: (e as Error).message }); }
  };
  for (let i = 0; i < homes.length; i += 4) await Promise.all(homes.slice(i, i + 4).map(send));
  return { batchId, installer: installer.name, homes: homes.length, texts };
}

async function claim(jobId: string, actorId: string | null, type: string, summary: string, details: Record<string, unknown>): Promise<boolean> {
  const key = details["idempotency_key"];
  if (key) {
    const { data: prior, error: pe } = await loose.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", type).contains("details", { idempotency_key: key }).limit(1);
    if (pe) throw new Error(`Could not check the batch history: ${pe.message}`);
    if ((prior ?? []).length) return false;
  }
  const { error } = await loose.from("workflow_events").insert({ job_id: jobId, actor_id: actorId, event_type: type, summary, details, internal: true });
  if (error) { if (error.code === "23505") return false; throw new Error(`Could not record the batch: ${error.message}`); }
  return true;
}

type TextTo = Pick<BatchCandidate, "jobId" | "ownerName" | "phone" | "isTest" | "source">;
/** The quick taps text (or the day-2 reminder), once per job + batch (TEST → test-send; real → the one real sender with
 *  its own switch). */
async function textOwner(h: TextTo, batchId: string, myJobLink: string, businessId: string | null, actorId: string | null, step: "sent" | "reminder" = "sent"): Promise<{ status: string; detail: string }> {
  const link = quickTapsLink(myJobLink);
  const body = step === "reminder" ? quickTapsReminderText(h.ownerName, link) : quickTapsText(h.ownerName, link);
  if (h.isTest) {
    const { data: biz } = businessId ? await admin.from("businesses").select("onboarding_notes").eq("id", businessId).maybeSingle() : { data: null };
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestSms } = await import("./test-send.server");
    const label = step === "reminder" ? `quick_taps_reminder:${batchId}` : `quick_taps:${batchId}`;
    const r = await sendTestSms({ jobId: h.jobId, jobSource: h.source, partnerIsTest: isTestPartner(biz ?? null), label, actorId }, h.phone ?? "", body);
    return { status: r.status, detail: r.detail };
  }
  const { sendRealSms } = await import("./sms.server");
  const type = step === "reminder" ? QUICK_TAPS_REMINDER_SMS_TYPE : QUICK_TAPS_SMS_TYPE;
  const r = await sendRealSms({ type, idempotencyKey: quickTapsSmsKey(batchId, h.jobId, step), to: h.phone, body, jobId: h.jobId });
  return { status: r.status, detail: r.detail };
}

// ---- a home whose address changed (Task 3, Jo 30 Oct) -------------------------------------------------------------------

/** Where the job's home is now: its current `coordinates` fact; with no full street address, its postcode's centre. */
export async function homePoint(jobId: string): Promise<PropertyPoint> {
  const { data: job } = await admin.from("jobs").select("property_id, properties(address_line, postcode)").eq("id", jobId).maybeSingle();
  const propertyId = (job as { property_id?: string | null } | null)?.property_id ?? null;
  if (!propertyId) return null;
  const { data: f } = await loose.from("property_facts").select("value").eq("property_id", propertyId).eq("fact_key", "coordinates").eq("is_current", true).limit(1).maybeSingle();
  const p = propertyPoint((f as { value?: unknown } | null)?.value);
  if (p) return p;
  const prop = ((job as { properties?: unknown } | null)?.properties ?? null) as { address_line?: string | null; postcode?: string | null } | null;
  return hasFullStreet(prop?.address_line) ? null : postcodeCentre(prop?.postcode);
}

/** The owner's new address is over 10 km from the batch centre → the home leaves this batch (append-only
 *  `area_batch_left {batch_id, reason: "address_moved"}`), back in the pool for the next one. Nothing is sent. Unknown
 *  location or unknown centre → stays. Returns true when it left. */
export async function leaveBatchIfMoved(jobId: string, batchId: string, point: PropertyPoint): Promise<boolean> {
  if (!point) return false;
  const sent = (await batchEventsFor(jobId)).find((e) => e.event_type === AREA_BATCH_SENT_EVENT && (e.details as { batch_id?: unknown } | null)?.batch_id === batchId);
  if (!sent) return false;
  const d = (sent.details ?? {}) as { centre?: { lat?: unknown; lng?: unknown } | null; centre_job_id?: unknown; job_ids?: unknown };
  let centre: PropertyPoint = d.centre && Number.isFinite(Number(d.centre.lat)) && Number.isFinite(Number(d.centre.lng)) ? { lat: Number(d.centre.lat), lng: Number(d.centre.lng) } : null;
  if (!centre) {
    const centreJob = typeof d.centre_job_id === "string" ? d.centre_job_id : Array.isArray(d.job_ids) && typeof d.job_ids[0] === "string" ? d.job_ids[0] : null;
    if (centreJob && centreJob !== jobId) centre = await homePoint(centreJob);
  }
  if (!centre || !outsideBatch(centre, point)) return false;
  return claim(jobId, null, AREA_BATCH_LEFT_EVENT, "Owner's new address is over 10 km from the rest of the batch — back on the list for the next batch (owner not told)",
    { batch_id: batchId, reason: "address_moved", distance_m: Math.round(distanceM(centre, point)), idempotency_key: `area-batch-left:v1:${batchId}:${jobId}` });
}

// ---- 15-minute tick (Task 4) -------------------------------------------------------------------------------------------

export type AreaBatchSweep = { jobs: number; reminded: number; closed: number; declinesFinished: number; noAnswerClosed: number; failed: number };
/** Statuses meaning the reminder went (or already went) — real sender or test-send. */
const REMINDER_WENT = ["sent", "already", "sent_unknown"];
/** Once-only claims for the decline retry and the day-14 close. */
const DECLINE_RETRIED_EVENT = "quick_taps_decline_retried";
const NO_ANSWER_CLOSED_EVENT = "quick_taps_no_answer_closed";
/** Batches sent in the last 21 days (closed at day 3; a home with no answer is closed at day 14 from its first send). */
const SWEEP_DAYS = 21;
const sweepJobFields = "id, stage, source, channel, deleted_at, qa_archived_at, owners(full_name, phone)";
type SweepRow = { id: string; stage: string; source: string | null; channel: string | null; deleted_at: string | null; qa_archived_at: string | null; owners: { full_name?: string | null; phone?: string | null } | null };

async function inFours<T>(items: T[], run: (t: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += 4) await Promise.all(items.slice(i, i + 4).map(run));
}

/** Day-2 reminder (quiet hours → the next tick outside them), day-3 close (passers wait for Jo's OK, non-answerers back in
 *  the pool), decline answers whose close failed are finished again, day-14 no-answer close (quiet). Never offers a run,
 *  never raises a Needs me row. Reads are batched by job id; steps run four at a time. */
export async function sweepAreaBatches(nowIso: string = new Date().toISOString()): Promise<AreaBatchSweep> {
  const out: AreaBatchSweep = { jobs: 0, reminded: 0, closed: 0, declinesFinished: 0, noAnswerClosed: 0, failed: 0 };
  const since = new Date(Date.parse(nowIso) - SWEEP_DAYS * 86_400_000).toISOString();
  const recent = await all("sent batches", (f, t) => loose.from("workflow_events").select("job_id").eq("event_type", AREA_BATCH_SENT_EVENT).gte("created_at", since).order("created_at").range(f, t));
  const ids = [...new Set(recent.map((r) => String(r["job_id"])))];
  if (!ids.length) return out;
  const [jobs, assigned, history] = await Promise.all([
    byIds("batched jobs", ids, (c, f, t) => admin.from("jobs").select(sweepJobFields).in("id", c).range(f, t)),
    byIds("batched jobs' installers", ids, (c, f, t) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true).range(f, t)),
    byIds("batch history", ids, (c, f, t) => loose.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [...AREA_BATCH_EVENTS, QUICK_TAPS_ANSWERED_EVENT, QUICK_TAPS_REMINDED_EVENT, STAGE_CHANGED_EVENT, NO_ANSWER_CLOSED_EVENT, DECLINE_RETRIED_EVENT]).range(f, t)),
  ]);
  const withInstaller = new Set(assigned.map((a) => String(a["job_id"])));
  const eventsBy = group(history, "job_id") as unknown as Map<string, AreaBatchEventRow[]>;
  const rows = new Map((jobs as unknown as SweepRow[]).map((j) => [j.id, j]));
  const sweepJobs: SweepJob[] = [...rows.values()].map((j) => ({
    jobId: j.id,
    waiting: !j.qa_archived_at && jobWaitingForInstaller({ channel: j.channel, stage: j.stage, hasInstaller: withInstaller.has(j.id), deleted: !!j.deleted_at }),
    events: eventsBy.get(j.id) ?? [],
  }));
  out.jobs = sweepJobs.length;
  const plan = planBatchSweep(sweepJobs, nowIso, smsQuietReason(nowIso) != null);
  const step = async (what: string, jobId: string, run: () => Promise<boolean>, count: keyof AreaBatchSweep) => {
    try { if (await run()) out[count]++; } catch (e) { out.failed++; console.error(`area batch ${what} failed`, jobId, (e as Error).message); }
  };

  // Day 3: close the batch for each member not closed yet (claims keyed per batch + job, so a repeat writes nothing).
  const closeSteps = plan.closes.flatMap((c) => c.closeJobIds.map((jobId) => ({ c, jobId })));
  await inFours(closeSteps, ({ c, jobId }) => step("close", jobId, () => {
    const role = c.passJobIds.includes(jobId) ? "pass" : c.freedJobIds.includes(jobId) ? "freed" : "none";
    const summary = role === "pass" ? "Area batch closed — the owner said yes; waiting for your OK to send to the installer"
      : role === "freed" ? "Area batch closed — no answer; back on the list for the next batch" : "Area batch closed";
    return claim(jobId, null, AREA_BATCH_CLOSED_EVENT, summary, { batch_id: c.batchId, pass_job_ids: c.passJobIds, freed_job_ids: c.freedJobIds, result: role, idempotency_key: areaBatchClosedKey(c.batchId, jobId) });
  }, "closed"));

  // Day 2: the approved reminder. Claimed only once it went (sent / already sent); a held text (switch off, quiet hours…)
  // stays unclaimed so a later tick tries again — the real sender's own key never sends it twice. Final review m5: while
  // customer messages or the reminder switch are off, a real reminder isn't tried at all (no held row per tick); one held
  // for the owner themselves (STOP, no consent, not a mobile) is recorded once as not sent and never tried again.
  let remindersOff: boolean | null = null;
  const realRemindersOff = async () => {
    if (remindersOff !== null) return remindersOff;
    const { data, error } = await loose.from("workflow_settings").select("customer_comms_enabled, sms_message_switches").eq("id", 1).maybeSingle();
    if (error) throw new Error(`Could not read the message switches: ${error.message}`);
    const w = (data ?? null) as { customer_comms_enabled?: boolean | null; sms_message_switches?: Record<string, boolean> | null } | null;
    return (remindersOff = w?.customer_comms_enabled !== true || w?.sms_message_switches?.[QUICK_TAPS_REMINDER_SMS_TYPE] !== true);
  };
  await inFours(plan.reminders, ({ batchId, jobId }) => step("reminder", jobId, async () => {
    const j = rows.get(jobId)!;
    if (j.source !== "qa_test" && await realRemindersOff()) return false;
    const sent = (eventsBy.get(jobId) ?? []).find((e) => e.event_type === AREA_BATCH_SENT_EVENT && (e.details as { batch_id?: unknown } | null)?.batch_id === batchId);
    const businessId = s((sent?.details as { installer_business_id?: unknown } | null)?.installer_business_id);
    const details = { batch_id: batchId, idempotency_key: quickTapsSmsKey(batchId, jobId, "reminder") };
    const link = await (await import("./veec-copy-email.server")).ownerMyJobLink(jobId);
    if (!link) {
      const won = await claim(jobId, null, QUICK_TAPS_REMINDED_EVENT, "Day-2 reminder not sent: no working owner job link", { ...details, status: "no_link" });
      if (won) await logEvent(jobId, null, "quick_taps_reminder_not_sent", "No working owner job link, so the owner could not be reminded about their quick taps", { batch_id: batchId }, { internal: true });
      return false;
    }
    const r = await textOwner({ jobId, ownerName: (j.owners?.full_name ?? "").trim(), phone: j.owners?.phone ?? null, isTest: j.source === "qa_test", source: j.source }, batchId, link, businessId, null, "reminder");
    if (j.source !== "qa_test" && (smsHeldForRecipient(r) || !j.owners?.phone)) {
      await claim(jobId, null, QUICK_TAPS_REMINDED_EVENT, "Day-2 reminder not sent: the owner's number can't be texted (STOP, no consent or not a mobile)", { ...details, status: "not_textable" });
      return false;
    }
    if (!REMINDER_WENT.includes(r.status)) return false;
    return claim(jobId, null, QUICK_TAPS_REMINDED_EVENT, "Day-2 reminder: quick taps text to the owner", { ...details, status: r.status });
  }, "reminded"));

  // A decline whose close failed: close + email again (finishDecline is idempotent), once per job + batch. A close that
  // still fails counts as failed. Nothing in Needs me.
  if (plan.declineRetries.length) {
    const { finishDecline } = await import("./quick-taps.server");
    await inFours(plan.declineRetries, ({ batchId, jobId }) => step("decline", jobId, async () => {
      const won = await claim(jobId, null, DECLINE_RETRIED_EVENT, "Quick taps: finishing the owner's decline again (the close had failed)", { batch_id: batchId, idempotency_key: `quick-taps:v1:${batchId}:${jobId}:decline_retry` });
      if (!won) return false;
      const r = await finishDecline(jobId);
      if (r === "cancel_failed") throw new Error("the job still couldn't be closed");
      return r === "finished";
    }, "declinesFinished"));
  }

  // Day 14 from the first send, never answered: closed quietly (nobody is told), once per job.
  if (plan.noAnswerCloses.length) {
    const { cancelJobFully } = await import("./office-actions.server");
    await inFours(plan.noAnswerCloses, ({ batchId, jobId }) => step("day-14 close", jobId, async () => {
      const won = await claim(jobId, null, NO_ANSWER_CLOSED_EVENT, "Quick taps: no answer 14 days after the first text — job closed quietly", { batch_id: batchId, idempotency_key: `quick-taps:v1:${batchId}:${jobId}:no_answer_closed` });
      if (!won) return false;
      await cancelJobFully(jobId, NO_ANSWER_CLOSE_REASON, null, { tell: { owner: false, installer: false } });
      return true;
    }, "noAnswerClosed"));
  }
  return out;
}

// ---- ready for Jo's OK (Choose installer) ----------------------------------------------------------------------------------

export type ReadyHome = { jobId: string; jobNumber: string; ownerName: string; suburb: string; postcode: string };
/** `state`: "ready" = waiting for Send to installer; "text_not_sent" = sent, but the installer's text didn't go (office label
 *  "Text didn't go — Send again"; the button re-texts the same run, `runId`). `installer` = the one Jo picked at Send (or the
 *  run's installer); `installers` = every installer that can be offered every home now, that one first (final review I2). */
export type ReadyBatch = { batchId: string; closedAt: string; isTest: boolean; installer: { id: string; name: string }; homes: ReadyHome[];
  state: "ready" | "text_not_sent"; runId: string | null; installers: { id: string; name: string }[] };

/** Closed batches with owners who said yes, still waiting for an installer: the passers, their suburbs, the installer Jo
 *  picked at Send and the installers who could take them. Nothing is sent from here; "Send to installer" is Jo's tap
 *  (installer-run.server). Zero passers left, sent back to the suggestions, or already sent to the installer (its text
 *  went, or the run ended) → not listed; a run whose text never went (and isn't past its 24 hours) is listed as
 *  "text_not_sent". No age cut-off (final review I2): the read starts from the homes still waiting for an installer (the
 *  same bounded pool as the suggestions), so a batch stays listed as long as any of its passers waits. */
export async function batchesReadyToSend(opts: { includeTest?: boolean; testJobIds?: string[]; testBusinessIds?: string[]; now?: Date } = {}): Promise<ReadyBatch[]> {
  const now = opts.now ?? new Date();
  const pool = await all("waiting jobs", (a, b) => {
    let q = admin.from("jobs").select("id").eq("stage", "ready_check_ready_to_schedule").eq("channel", "hivic_sourced").is("deleted_at", null).is("qa_archived_at", null);
    if (opts.testJobIds) q = q.in("id", opts.testJobIds.length ? opts.testJobIds : ["00000000-0000-0000-0000-000000000000"]);
    return q.order("created_at").order("id").range(a, b);
  });
  const poolIds = [...new Set(pool.map((j) => String(j["id"])))];
  if (!poolIds.length) return [];
  const closed = await byIds("closed batches", poolIds, (c, f, t) => loose.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).eq("event_type", AREA_BATCH_CLOSED_EVENT).range(f, t));
  const byBatch = new Map<string, { closedAt: string; pass: string[] }>();
  for (const e of closed) {
    const d = (e["details"] ?? {}) as { batch_id?: unknown; pass_job_ids?: unknown };
    const b = typeof d.batch_id === "string" ? d.batch_id : null;
    if (!b) continue;
    const pass = Array.isArray(d.pass_job_ids) ? d.pass_job_ids.filter((x): x is string => typeof x === "string") : [];
    const cur = byBatch.get(b);
    const at = String(e["created_at"]);
    if (!cur || at < cur.closedAt) byBatch.set(b, { closedAt: at, pass: cur ? [...new Set([...cur.pass, ...pass])] : pass });
    else cur.pass = [...new Set([...cur.pass, ...pass])];
  }
  const inPool = new Set(poolIds);
  const passIds = [...new Set([...byBatch.values()].flatMap((b) => b.pass))].filter((id) => inPool.has(id));
  if (!passIds.length) return [];
  const [jobs, assigned, history, installerFacts] = await Promise.all([
    byIds("waiting passers", passIds, (c, f, t) => admin.from("jobs").select("id, job_number, stage, source, channel, deleted_at, qa_archived_at, owners(full_name), properties(suburb, postcode)").in("id", c).range(f, t)),
    byIds("passers' installers", passIds, (c, f, t) => admin.from("job_assignments").select("job_id").in("job_id", c).eq("role", "installer").eq("active", true).range(f, t)),
    byIds("sent batches and runs", passIds, (c, f, t) => loose.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [AREA_BATCH_SENT_EVENT, AREA_BATCH_RETURNED_EVENT, ...RUN_EVENTS]).range(f, t)),
    (async () => (await import("./installer-waiting.server")).installerFacts(opts.testBusinessIds))(),
  ]);
  const runEvents = history as unknown as RunEventRow[];
  const batchOf = (e: Row) => s((e["details"] as { batch_id?: unknown } | null)?.batch_id);
  const returned = new Set(history.filter((e) => e["event_type"] === AREA_BATCH_RETURNED_EVENT).map((e) => `${batchOf(e)}|${String(e["job_id"])}`));
  // Runs Jo sent per batch (never a Fill row). A batch is sent to the installer once its text went or its run is over — then
  // it is never listed again, even after a decline / expiry, when its owners are back in the suggestions with their pass.
  const runsBy = new Map<string, RunState[]>();
  for (const runId of new Set(runEvents.filter((e) => e.event_type === RUN_OFFERED_EVENT && !isFillRow(e)).map(runIdOf).filter((x): x is string => !!x))) {
    const st = runState(runId, runEvents);
    if (st) runsBy.set(st.batchId, [...(runsBy.get(st.batchId) ?? []), st]);
  }
  const withInstaller = new Set(assigned.map((a) => String(a["job_id"])));
  const jobBy = new Map(jobs.map((j) => [String(j["id"]), j]));
  const out: ReadyBatch[] = [];
  for (const [batchId, b] of byBatch) {
    const runs = runsBy.get(batchId) ?? [];
    if (runs.some((r) => r.status !== "offered" || r.textWent || runExpiryDue(r, now.toISOString()))) continue;
    const run = runs[0] ?? null;
    const members = run ? run.memberIds : b.pass;
    const homes: (ReadyHome & { isTest: boolean })[] = [];
    for (const id of members) {
      const j = jobBy.get(id);
      if (!j || j["qa_archived_at"] || returned.has(`${batchId}|${id}`)) continue;
      if (!jobWaitingForInstaller({ channel: s(j["channel"]), stage: s(j["stage"]), hasInstaller: withInstaller.has(id), deleted: !!j["deleted_at"] })) continue;
      const isTest = j["source"] === "qa_test";
      if (isTest && !opts.includeTest && !opts.testJobIds) continue;
      const owner = (j["owners"] ?? null) as { full_name?: string | null } | null;
      const prop = (j["properties"] ?? null) as { suburb?: string | null; postcode?: string | null } | null;
      homes.push({ jobId: id, jobNumber: String(j["job_number"] ?? ""), ownerName: (owner?.full_name ?? "").trim(), suburb: (prop?.suburb ?? "").trim(), postcode: (prop?.postcode ?? "").trim(), isTest });
    }
    if (!homes.length) continue;
    const sent = history.find((e) => e["event_type"] === AREA_BATCH_SENT_EVENT && homes.some((h) => h.jobId === String(e["job_id"])) && batchOf(e) === batchId);
    const d = (sent?.["details"] ?? {}) as { installer_business_id?: unknown; installer_name?: unknown };
    const runOffer = run ? runEvents.find((e) => e.event_type === RUN_OFFERED_EVENT && runIdOf(e) === run.runId) : null;
    const covering = batchInstallers(installerFacts, homes).map((i) => ({ id: i.id, name: i.name }));
    const installer = run
      ? { id: run.businessId, name: s((runOffer?.details as { business_name?: unknown } | null)?.business_name) ?? covering.find((i) => i.id === run.businessId)?.name ?? "" }
      : { id: s(d.installer_business_id) ?? "", name: s(d.installer_name) ?? "" };
    out.push({
      batchId, closedAt: b.closedAt, isTest: homes.every((h) => h.isTest), installer,
      homes: homes.sort((x, y) => x.jobNumber.localeCompare(y.jobNumber)).map(({ isTest: _t, ...h }) => h),
      state: run ? "text_not_sent" : "ready", runId: run?.runId ?? null,
      installers: [...covering.filter((i) => i.id === installer.id), ...covering.filter((i) => i.id !== installer.id)],
    });
  }
  return out.sort((a, b) => a.closedAt.localeCompare(b.closedAt));
}

/** Shared with the installer's run (installer-run.server): the same once-only claim and batched id reads. */
export { claim as claimBatchEvent, byIds as readByIds, all as readAll };
