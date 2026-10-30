// A48 batch 2 (Jo 29–30 Oct 2026, spec part 1): area batches. I/O only — the rules are in area-batch.core.ts.
// - batchCandidates: website owners (hivic_sourced) waiting for an installer with a saved spot, most likely eligible,
//   not in an open batch, not being asked about a released spot. Missing locations are filled once through
//   ensurePropertyCoordinates (a few per load) before clustering; a home still without a location is left out.
// - batchSuggestions: suggestBatches per TEST / real group, plus the installers who can be offered EVERY home.
// - sendBatch: Jo's one tap. Every check runs first (nothing written if any fails), then ONE `area_batch_sent` claim per
//   job (append-only workflow_events), then the owner's quick taps text once per job: TEST → test-send, real → the one
//   real SMS sender (`quick_taps` switch, consent, STOP). Never automatic: only the office Send calls this.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkflowError } from "./workflow.server";
import {
  AREA_BATCH_CLOSED_EVENT, AREA_BATCH_SENT_EVENT, QUICK_TAPS_SMS_TYPE, areaBatchKey, batchInstallers, batchSpanKm, likelyEligible, nextBatchSeq,
  openBatchId, quickTapsLink, quickTapsSmsKey, quickTapsText, suggestBatches, type AreaBatchEventRow, type BatchHome,
} from "./area-batch.core";
import { installerWaiting } from "./installer-waiting-columns.core";
import { SPOT_RELEASE_EVENTS, spotReleaseState, type SpotReleaseEventRow } from "./spot-release.core";
import { declaredExtras, declaredInsulationDetail } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { propertyPoint } from "./geo.core";
import { smsQuietReason } from "./quote-hold.core";

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
  const rows = jobIds.length ? await byIds("batch history", jobIds, (c, f, t) => loose.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [AREA_BATCH_SENT_EVENT, AREA_BATCH_CLOSED_EVENT]).range(f, t)) : [];
  return group(rows, "job_id") as unknown as Map<string, AreaBatchEventRow[]>;
}

/** The job's open batch id, or null. */
export async function openBatchFor(jobId: string): Promise<string | null> {
  return openBatchId((await batchEvents([jobId])).get(jobId) ?? []);
}

export type BatchCandidate = BatchHome & { jobNumber: string; propertyId: string; ownerName: string; phone: string | null; suburb: string; isTest: boolean; source: string | null };
export type CandidateRead = { candidates: BatchCandidate[]; unlocated: number; refused: Map<string, string> };

/** Who can be put in a batch now. `jobIds` limits the read (Send re-checks its own homes); `locate` caps location lookups. */
export async function batchCandidates(opts: { includeTest?: boolean; testJobIds?: string[]; jobIds?: string[]; locate?: number; requireLocation?: boolean; now?: Date } = {}): Promise<CandidateRead> {
  const jobs = (await all("waiting jobs", (a, b) => {
    let q = admin.from("jobs").select("id, job_number, stage, source, channel, deleted_at, qa_archived_at, property_id, owners(full_name, phone), properties(suburb, postcode, declared:enrichment->base44->declared, answers:enrichment->base44->raw->answers)")
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
    byIds("batch and release history", ids, (c, f, t) => loose.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [AREA_BATCH_SENT_EVENT, AREA_BATCH_CLOSED_EVENT, ...SPOT_RELEASE_EVENTS]).range(f, t)),
    propIds.length ? byIds("property facts", propIds, (c, f, t) => loose.from("property_facts").select("property_id, fact_key, value").in("property_id", c).in("fact_key", ["coordinates", "roof_form"]).eq("is_current", true).range(f, t)) : Promise.resolve([] as Row[]),
  ]) : [[], [], [], [], []];
  const withInstaller = new Set(assigned.map((a) => String(a["job_id"])));
  const offersBy = group(offers, "job_id");
  const savedBy = new Map(saved.map((r) => [String(r["job_id"]), r]));
  const eventsBy = group(events, "job_id");
  const factsBy = group(facts, "property_id");
  const fact = (propertyId: string | null, key: string) => (propertyId ? factsBy.get(propertyId)?.find((f) => f["fact_key"] === key)?.["value"] : undefined);

  const keep: { j: Row; propertyId: string; point: { lat: number; lng: number } | null }[] = [];
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
    keep.push({ j, propertyId, point: propertyPoint(fact(propertyId, "coordinates")) });
  }

  // Fill missing locations once (stored as the property's `coordinates` fact), a few at a time.
  const missing = keep.filter((k) => !k.point && k.propertyId).slice(0, opts.locate ?? LOCATE_PER_LOAD);
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
  const noLink = homes.filter((h) => !links.get(h.jobId));
  if (noLink.length) throw new WorkflowError(`${noLink.map((h) => h.jobNumber).join(", ")}: the owner has no working My job link — nothing was sent.`);

  // Claims: one area_batch_sent per job, before any text.
  const batchId = crypto.randomUUID();
  const claimed: BatchCandidate[] = [];
  for (const h of homes) {
    const key = areaBatchKey(h.jobId, nextBatchSeq(evs.get(h.jobId) ?? []));
    const won = await claim(h.jobId, actorId, AREA_BATCH_SENT_EVENT, `Area batch sent (${homes.length} ${homes.length === 1 ? "home" : "homes"}, ${installer.name}) — quick taps texted to the owner`,
      { batch_id: batchId, installer_business_id: businessId, installer_name: installer.name, job_ids: jobIds, sent_by: actorId, idempotency_key: key });
    if (!won) {
      // Someone else batched this home at the same moment: undo ours (append-only close) and send nothing.
      for (const c of claimed) await claim(c.jobId, actorId, AREA_BATCH_CLOSED_EVENT, "Area batch stopped before any text went (another batch took a home)", { batch_id: batchId, pass_job_ids: [], freed_job_ids: claimed.map((x) => x.jobId), reason: "send_interrupted" });
      throw new WorkflowError(`${h.jobNumber} was just put in another batch — nothing was sent.`);
    }
    claimed.push(h);
  }

  const texts: SendBatchResult["texts"] = [];
  const send = async (h: BatchCandidate) => {
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

/** The quick taps text, once per job + batch (TEST → test-send; real → the one real sender with its own switch). */
async function textOwner(h: BatchCandidate, batchId: string, myJobLink: string, businessId: string, actorId: string | null): Promise<{ status: string; detail: string }> {
  const body = quickTapsText(h.ownerName, quickTapsLink(myJobLink));
  if (h.isTest) {
    const { data: biz } = await admin.from("businesses").select("onboarding_notes").eq("id", businessId).maybeSingle();
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestSms } = await import("./test-send.server");
    const r = await sendTestSms({ jobId: h.jobId, jobSource: h.source, partnerIsTest: isTestPartner(biz ?? null), label: `quick_taps:${batchId}`, actorId }, h.phone ?? "", body);
    return { status: r.status, detail: r.detail };
  }
  const { sendRealSms } = await import("./sms.server");
  const r = await sendRealSms({ type: QUICK_TAPS_SMS_TYPE, idempotencyKey: quickTapsSmsKey(batchId, h.jobId, "sent"), to: h.phone, body, jobId: h.jobId });
  return { status: r.status, detail: r.detail };
}
