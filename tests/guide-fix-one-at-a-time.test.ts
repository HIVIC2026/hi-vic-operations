/**
 * Guide fix 7 (Jo, 29 Oct 2026, decision 426): safety check (PIESA) offers go to ONE electrician at a time,
 * nearest first, 24 hours each, back to the office after 2 misses. Installers' own jobs: the installer's chosen
 * electrician first; if they don't take it, back to the office (never another electrician). Offers already out finish.
 * Would fail if the batch path ("many electricians at once") came back for new safety check offers.
 *
 * Fix wave (final review): the REAL allocation.server / auto-offer.server / repeat-piesa.server run against an
 * in-memory database for the "offers ran out" paths. Own file: it replaces workflow.server for the whole process.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  autoOfferInstallerElectrician, autoOfferReturnedSummary, autoOfferStep, piesaRanOutStep,
  type AutoOfferCandidate, type AutoOfferFacts, type AutoOfferRow,
} from "../src/lib/auto-offer.core";
import { repeatRoundActive } from "../src/lib/repeat-piesa.core";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const cand = (id: string, o: Partial<AutoOfferCandidate> = {}): AutoOfferCandidate => ({
  business_id: id, name: id.toUpperCase(), coversPostcode: true, paused: false, credentialsOk: true, workersCleared: true, blocker: null, activeJobs: 0, distanceKm: 10, testPartner: false, ...o,
});
const base = (rows: AutoOfferRow[] = []): AutoOfferFacts => ({ kind: "piesa", switchOn: true, jobReady: true, hasTrade: false, returned: false, rows });
const miss = (id: string, status = "expired"): AutoOfferRow => ({ business_id: id, status, offered_at: "2026-10-29T00:00:00Z", auto: true });

// ---- in-memory database for the server paths ----
const J = "00000000-0000-4000-8000-0000000007a1";
const tables: Tables = {};
const rpcCalls: string[] = [];
class WorkflowError extends Error {}
const db = memoryPostgrest(tables);
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => db.from(t), rpc: async (name: string) => { rpcCalls.push(name); return { data: false, error: null }; } },
}));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => {
    tables["workflow_events"]!.push({ id: `ev-${tables["workflow_events"]!.length + 1}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, created_at: new Date().toISOString() });
  },
  piesaRequestFacts: async () => ({ installerIntakeQualified: true, currentQuoteApproved: true, payment: { cleared: true, blocker: "" }, repeatBlocker: null }),
  stageEntryBlockers: async () => [],
  transition: async () => undefined,
}));

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const offer = (id: string, biz: string, status: string, offeredMinAgo: number, summary: Record<string, unknown> = {}) =>
  ({ id, job_id: J, business_id: biz, kind: "piesa", status, offered_at: ago(offeredMinAgo), batch: 1, summary });
function seed(o: { mode?: string; autoOn?: boolean; offers?: Record<string, unknown>[]; events?: Record<string, unknown>[] } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  rpcCalls.length = 0;
  Object.assign(tables, {
    jobs: [{ id: J, stage: "piesa_and_install_window_pending", channel: "hivic_sourced", source: "website", deleted_at: null, offer_dispatch_override: null, next_action: null }],
    workflow_settings: [{ id: 1, offer_dispatch_mode: o.mode ?? "automatic", auto_electrician_offers: o.autoOn ?? false }],
    partner_offers: o.offers ?? [],
    job_assignments: [],
    workflow_events: o.events ?? [],
  });
}
const events = (type: string) => tables["workflow_events"]!.filter((e) => e["event_type"] === type);
const job = () => tables["jobs"]![0]!;

const alloc = await import("../src/lib/allocation.server");
const autoSrv = await import("../src/lib/auto-offer.server");

describe("guide fix 7 — safety check offers one at a time", () => {
  test("our jobs: nearest electrician first, then the next nearest after a miss", () => {
    const cs = [cand("far", { distanceKm: 40 }), cand("near", { distanceKm: 3 }), cand("mid", { distanceKm: 12 })];
    expect(autoOfferStep({ ...base(), candidates: cs })).toMatchObject({ action: "offer", businessId: "near", attempt: 1 });
    expect(autoOfferStep({ ...base([miss("near")]), candidates: cs })).toMatchObject({ action: "offer", businessId: "mid", attempt: 2 });
    expect(autoOfferStep({ ...base([miss("near"), miss("mid", "declined")]), candidates: cs })).toMatchObject({ action: "return_to_office", reason: "two_misses" });
  });
  test("installers' own jobs: their chosen electrician first; if they don't take it, back to the office", () => {
    const cs = [cand("near", { distanceKm: 1 }), cand("theirs", { distanceKm: 30 })];
    expect(autoOfferStep({ ...base(), candidates: cs, usualBusinessId: "theirs" })).toMatchObject({ action: "offer", businessId: "theirs", basis: "usual_electrician" });
    expect(autoOfferStep({ ...base([miss("theirs")]), candidates: cs, usualBusinessId: "theirs" })).toMatchObject({ action: "return_to_office", reason: "preferred_missed" });
    expect(autoOfferReturnedSummary("piesa", "preferred_missed", 1)).toBe("Automatic electrician offers: the installer's electrician didn't take it — choose again");
  });
  test("automatic dispatch mode no longer sends safety check offers to a batch", () => {
    const auto = readFileSync("src/lib/auto-offer.server.ts", "utf8");
    expect(auto).not.toContain('mode !== "automatic"');
    const src = readFileSync("src/lib/allocation.server.ts", "utf8");
    const start = src.slice(src.indexOf("async function autoStartPiesaOffers"), src.indexOf("async function flagUnapprovedElectricians"));
    expect(start).toContain("autoOfferForJob");
    expect(start).not.toContain("startPiesaAllocation(");
  });
});

describe("fix wave 4 — installer's electrician can't be offered → back to the office, never someone else", () => {
  const cs = [cand("near", { distanceKm: 1 }), cand("mid", { distanceKm: 5 })];
  test.each([
    ["no agreed rate", cand("theirs", { blocker: "No agreed electrician rate recorded." })],
    ["lapsed document", cand("theirs", { credentialsOk: false })],
    ["doesn't cover the postcode", cand("theirs", { coversPostcode: false })],
    ["paused", cand("theirs", { paused: true })],
  ])("%s", (_why, theirs) => {
    const step = autoOfferStep({ ...base(), candidates: [...cs, theirs], usualBusinessId: "theirs" });
    expect(step).toMatchObject({ action: "return_to_office", reason: "preferred_blocked", misses: 0 });
  });
  test("chosen electrician not an approved electrician at all (not a candidate)", () => {
    expect(autoOfferStep({ ...base(), candidates: cs, usualBusinessId: "gone" })).toMatchObject({ action: "return_to_office", reason: "preferred_blocked" });
  });
  test("office wording", () => {
    expect(autoOfferReturnedSummary("piesa", "preferred_blocked", 0)).toBe("Automatic electrician offers: the installer's electrician can't be offered this job — choose again");
  });
  test("which electrician is the installer's: first one that can be offered, else the first chosen (so the job goes to the office)", () => {
    const all = [cand("a", { blocker: "x" }), cand("b"), cand("near", { distanceKm: 1 })];
    expect(autoOfferInstallerElectrician(["a", "b"], all)).toBe("b");
    expect(autoOfferInstallerElectrician(["a"], all)).toBe("a");
    expect(autoOfferInstallerElectrician(["gone"], all)).toBe("gone");
    expect(autoOfferInstallerElectrician([], all)).toBeNull();
    // TEST parity: a live electrician chosen on a TEST job can't be offered it.
    expect(autoOfferInstallerElectrician(["b"], all, true)).toBe("b");
    expect(autoOfferStep({ ...base(), jobIsTest: true, candidates: all, usualBusinessId: "b" })).toMatchObject({ action: "return_to_office", reason: "preferred_blocked" });
  });
  test("server: the installer's choice is kept even when it can't be offered (no `!c.blocker` filter)", () => {
    const src = readFileSync("src/lib/auto-offer.server.ts", "utf8");
    expect(src).not.toContain("c.preferred && !c.blocker");
    expect(src).toContain("autoOfferInstallerElectrician(");
    expect(src).toContain("jobChosenElectrician(");
  });
});

describe("pure: what happens when a job's safety check offers run out", () => {
  const f = { stageWaiting: true, anyAccepted: false, officePicks: false, switchOn: true, exhaustedSinceLatestOffer: false };
  test("an older batch ran out → the office (once)", () => {
    expect(piesaRanOutStep({ ...f, latest: { auto: false, officeChoice: false } })).toBe("coverage_exhausted");
    expect(piesaRanOutStep({ ...f, latest: { auto: false, officeChoice: false }, exhaustedSinceLatestOffer: true })).toBe("none");
  });
  test("automatic offer ran out: the switch on → the automatic offers carry on; off → the office", () => {
    expect(piesaRanOutStep({ ...f, latest: { auto: true, officeChoice: true } })).toBe("none");
    expect(piesaRanOutStep({ ...f, switchOn: false, latest: { auto: true, officeChoice: true } })).toBe("switch_off_hand_back");
  });
  test("office pick, office-picks mode, accepted, wrong stage or no offers → nothing new", () => {
    expect(piesaRanOutStep({ ...f, latest: { auto: false, officeChoice: true } })).toBe("none");
    expect(piesaRanOutStep({ ...f, officePicks: true, latest: { auto: false, officeChoice: false } })).toBe("none");
    expect(piesaRanOutStep({ ...f, anyAccepted: true, latest: { auto: false, officeChoice: false } })).toBe("none");
    expect(piesaRanOutStep({ ...f, stageWaiting: false, latest: { auto: false, officeChoice: false } })).toBe("none");
    expect(piesaRanOutStep({ ...f, latest: null })).toBe("none");
  });
  test("repeat round = the payer was chosen after the latest reopen (or with no reopen)", () => {
    expect(repeatRoundActive(null, null)).toBe(false);
    expect(repeatRoundActive("2026-10-20T00:00:00Z", null)).toBe(true);
    expect(repeatRoundActive("2026-10-20T00:00:00Z", "2026-10-21T00:00:00Z")).toBe(false);
    expect(repeatRoundActive("2026-10-22T00:00:00Z", "2026-10-21T00:00:00Z")).toBe(true);
  });
});

describe("fix wave 2 — an older batch that runs out reaches the office (real server, in-memory db)", () => {
  beforeEach(() => seed({ offers: [offer("o1", "b1", "declined", 300), offer("o2", "b2", "pending", 300), offer("o3", "b3", "pending", 300)] }));
  test("last batch offer declined → ONE rec_coverage_exhausted + next action; no new batch", async () => {
    await alloc.respondToRecOffer("o2", "u1", false, null);
    expect(events("rec_coverage_exhausted")).toHaveLength(0); // o3 still open: the batch is still out
    await alloc.respondToRecOffer("o3", "u1", false, null);
    const ex = events("rec_coverage_exhausted");
    expect(ex).toHaveLength(1);
    expect(ex[0]!["summary"]).toBe("No approved electrician left to offer the piesa to — needs Home Insulation Victoria");
    expect(ex[0]!["details"]).toMatchObject({ kind: "piesa" });
    expect((ex[0]!["details"] as { offered: string[] }).offered.sort()).toEqual(["b1", "b2", "b3"]);
    expect(job()["next_action"]).toBe("Needs Home Insulation Victoria: no approved electrician coverage");
    expect(rpcCalls).not.toContain("claim_rec_offer_batch"); // never a new batch
    expect(tables["partner_offers"]).toHaveLength(3);
  });
  test("once: a later trigger for the same run-out writes nothing more", async () => {
    tables["partner_offers"]!.push(offer("o0", "b0", "pending", 400)); // an older straggler, answered after the run-out
    await alloc.respondToRecOffer("o2", "u1", false, null);
    await alloc.respondToRecOffer("o3", "u1", false, null);
    expect(events("rec_coverage_exhausted")).toHaveLength(0); // o0 still pending
    await alloc.respondToRecOffer("o0", "u1", false, null);
    expect(events("rec_coverage_exhausted")).toHaveLength(1);
    // Simulate another refill trigger (e.g. a sweep) for the same run-out.
    tables["partner_offers"]!.push(offer("o9", "b9", "pending", 500));
    await alloc.respondToRecOffer("o9", "u1", false, null);
    expect(events("rec_coverage_exhausted")).toHaveLength(1);
  });
  test("office-picks mode keeps today's behaviour (Needs me 'add more trades'): no exhaustion event", async () => {
    tables["workflow_settings"]![0]!["offer_dispatch_mode"] = "office_picks";
    await alloc.respondToRecOffer("o2", "u1", false, null);
    await alloc.respondToRecOffer("o3", "u1", false, null);
    expect(events("rec_coverage_exhausted")).toHaveLength(0);
    expect(rpcCalls).not.toContain("claim_rec_offer_batch");
  });
});

describe("fix wave 1 — automatic electrician offers switched off: the job goes to the office visibly, once", () => {
  test("hand-back writes the 'returned to office' event + next action once (no repeat every tick)", async () => {
    seed();
    expect(await autoSrv.handPiesaToOfficeAutoOff(J)).toBe(true);
    expect(await autoSrv.handPiesaToOfficeAutoOff(J)).toBe(false);
    const ev = events("auto_offer_returned_to_office");
    expect(ev).toHaveLength(1);
    expect(ev[0]!["summary"]).toBe("Automatic electrician offers are switched off — choose an electrician");
    expect(ev[0]!["details"]).toMatchObject({ kind: "piesa", reason: "switch_off", misses: 0 });
    expect(job()["next_action"]).toBe("Needs Home Insulation Victoria: choose an electrician for the PIESA");
    expect(tables["partner_offers"]).toHaveLength(0); // never a batch
    expect(rpcCalls).toEqual([]);
  });
  test("after a reopen the job can be handed back again", async () => {
    seed({ events: [{ id: "e1", job_id: J, event_type: "auto_offer_returned_to_office", summary: "x", details: { kind: "piesa" }, created_at: ago(120) }, { id: "e2", job_id: J, event_type: "piesa_superseded_on_reopen", summary: "r", details: { key: "reopen:x", had_check: false }, created_at: ago(60) }] });
    expect(await autoSrv.handPiesaToOfficeAutoOff(J)).toBe(true);
    expect(await autoSrv.handPiesaToOfficeAutoOff(J)).toBe(false);
  });
  test("an automatic offer that runs out after the switch was turned off → the office (not a batch)", async () => {
    seed({ offers: [offer("a1", "b1", "pending", 30, { auto_offer: true, office_choice: true })] });
    await alloc.respondToRecOffer("a1", "u1", false, null);
    expect(events("auto_offer_returned_to_office")).toHaveLength(1);
    expect(events("rec_coverage_exhausted")).toHaveLength(0);
    expect(rpcCalls).not.toContain("claim_rec_offer_batch");
  });
  test("tick: autoStartPiesaOffers hands the job back when the automatic offers say switch_off", () => {
    const src = readFileSync("src/lib/allocation.server.ts", "utf8");
    const start = src.slice(src.indexOf("async function autoStartPiesaOffers"), src.indexOf("async function flagUnapprovedElectricians"));
    expect(start).toMatch(/reason === "switch_off"[\s\S]*handPiesaToOfficeAutoOff\(j\.id[,)]/);
    expect(start).not.toContain("startPiesaAllocation(");
  });
});

describe("fix wave 3 — repeat checks keep their refill (the old batch path)", () => {
  test("repeat round: last offer declined → the next batch is claimed as before", async () => {
    seed({ offers: [offer("r1", "b1", "pending", 30)], events: [{ id: "c1", job_id: J, event_type: "repeat_piesa_payer_chosen", summary: "c", details: { deadline: "2026-10-01", payer: "hivic" }, created_at: ago(60) }] });
    await alloc.respondToRecOffer("r1", "u1", false, null);
    expect(rpcCalls).toContain("claim_rec_offer_batch");
    expect(events("rec_coverage_exhausted")).toHaveLength(0);
  });
  test("a payer chosen BEFORE the latest reopen is not a repeat round: no batch", async () => {
    seed({ offers: [offer("r1", "b1", "pending", 30)], events: [
      { id: "c1", job_id: J, event_type: "repeat_piesa_payer_chosen", summary: "c", details: { deadline: "2026-10-01", payer: "hivic" }, created_at: ago(300) },
      { id: "r0", job_id: J, event_type: "piesa_superseded_on_reopen", summary: "r", details: { key: "reopen:x", had_check: false }, created_at: ago(200) },
    ] });
    await alloc.respondToRecOffer("r1", "u1", false, null);
    expect(rpcCalls).not.toContain("claim_rec_offer_batch");
    expect(events("rec_coverage_exhausted")).toHaveLength(1);
  });
  test("first-time check (no repeat): never a new batch", async () => {
    seed({ offers: [offer("r1", "b1", "pending", 30)] });
    await alloc.respondToRecOffer("r1", "u1", false, null);
    expect(rpcCalls).not.toContain("claim_rec_offer_batch");
  });
});
