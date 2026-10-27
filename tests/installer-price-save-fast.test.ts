// Speed (trade buttons, Jo approved 28 Oct 2026, fix 2 "Speed up Save price"): Save price stores the price and drafts the
// owner's quote ONCE from the Ready Check already stored, then replies. The Mitti sync (and, on a Complete form, the
// fresh-form auto-send decision) runs after the reply through `runAfterResponse`; the 15-minute Mitti pull stays the
// backup. Real installer-price-set / installer-price modules over an in-memory database; Mitti, the quote writer, the
// auto-send step and the request lifecycle are stand-ins that record what they were asked to do.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const JOB = "00000000-0000-4000-8000-00000000e001";
const BIZ = "00000000-0000-4000-8000-00000000e0b1";
const BOSS = "00000000-0000-4000-8000-00000000e0a1";
const AUDIT = "audit_e001";
// The Ready Check as the last Mitti sync stored it (no price: decision 278, the boss prices on the portal).
const STORED = [{ label: "Enter the measured ceiling area (m²)", value: "120" }, { label: "Is there existing insulation?", value: "No" }];

let tables: Tables;
let seq = 0;
const seed = (status: "complete" | "draft") => {
  tables = {
    jobs: [{ id: JOB, channel: "installer_sourced", originating_installer_business_id: BIZ, stage: "measured_estimate_ready", deleted_at: null }],
    ceiling_measurements: [{ id: "m1", job_id: JOB, is_current: true, status, external_source: "mitti", external_id: AUDIT, raw_snapshot: STORED, removal_required: false, measured_area_m2: 120 }],
    workflow_events: [],
  };
};
seed("complete");

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t) } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (jobId: string, actorId: string | null, event_type: string, summary: string, details: unknown) => {
    tables["workflow_events"]!.push({ id: `ev${++seq}`, job_id: jobId, actor_id: actorId, event_type, summary, details, created_at: new Date(Date.now() + seq).toISOString() });
  },
}));
mock.module("../src/lib/pilot.server", () => ({ requireMember: async () => undefined, applyCobrand: async () => { calls.push("applyCobrand"); } }));

// Mitti never answers: anything that waited on it would hang the save.
const calls: string[] = [];
const never = () => new Promise<never>(() => {});
mock.module("../src/lib/mitti.server", () => ({
  syncMittiAssessment: (..._a: unknown[]) => { calls.push("syncMittiAssessment"); return mitti === "ok" ? Promise.resolve({ completed: true }) : mitti === "down" ? Promise.reject(new Error("Mitti 503")) : never(); },
  realMittiCall: (..._a: unknown[]) => { calls.push("mitti:http"); return mitti === "ok" ? Promise.resolve({ id: AUDIT, completed: true, modified_at: "2026-10-28T00:00:00Z", items: [] }) : mitti === "down" ? Promise.reject(new Error("Mitti 503")) : never(); },
}));
let mitti: "never" | "ok" | "down" = "never";

// The one quote writer: record what it was given, and what the portal price reads as at that moment (real reader).
const drafts: { entries: { label: string; value: string | null }[]; auditId: string; pricedEntries: { label: string; value: string | null }[] }[] = [];
mock.module("../src/lib/installer-quote.server", () => ({
  draftInstallerQuoteFromReadyCheck: async (jobId: string, _actor: string | null, entries: { label: string; value: string | null }[], auditId: string) => {
    calls.push("draft");
    if (draftThrows) throw new Error("TEST quote write failed");
    const { entriesWithInstallerPrice } = await import("../src/lib/installer-price.server");
    drafts.push({ entries, auditId, pricedEntries: (await entriesWithInstallerPrice(jobId, entries)) as { label: string; value: string | null }[] });
    return { ready: true, blockers: [] };
  },
}));
mock.module("../src/lib/auto-quote-send.server", () => ({ maybeAutoSendInstallerQuote: async () => { calls.push("maybeAutoSend"); return { done: "held" }; } }));
let basicsReady = true;
let draftThrows = false;
mock.module("../src/lib/ready-check-basics.server", () => ({ checkReadyCheckBasics: async () => { calls.push("basics"); return { ready: basicsReady, missing: [], stops: [] }; } }));

// Request lifecycle: the test holds the background work and runs it by hand.
const background: (() => Promise<unknown>)[] = [];
mock.module("../src/lib/background.server", () => ({ requestContext: { getStore: () => undefined }, runAfterResponse: (task: () => Promise<unknown>) => { background.push(task); return "wait_until"; } }));

const { setInstallerPrice } = await import("../src/lib/installer-price-set.server");
const { quotedPriceFromEntries } = await import("../src/lib/installer-led.core");

/** Resolves with the save, or rejects if it is still waiting after `ms` (it would be waiting on Mitti). */
const within = <T,>(p: Promise<T>, ms = 1500) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`Save price still waiting after ${ms} ms`)), ms))]);

afterEach(() => { calls.length = 0; drafts.length = 0; background.length = 0; mitti = "never"; basicsReady = true; draftThrows = false; seed("complete"); });

describe("Save price replies without waiting on Mitti", () => {
  test("Complete form: price stored, owner quote drafted once from the stored Ready Check, reply — Mitti never touched before the reply", async () => {
    const saved = await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] }));
    expect(saved.record.price_inc_gst).toBe(3000);
    expect(calls).toEqual(["draft"]); // no sync, no Mitti HTTP, no auto-send before the reply
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.auditId).toBe(AUDIT);
    expect(drafts[0]!.entries).toEqual(STORED);
    // The draft is made with the NEW price (the portal price is in front of the stored form answers).
    expect(quotedPriceFromEntries(drafts[0]!.pricedEntries, false).price?.totalIncGst).toBe(3000);
    expect(background).toHaveLength(1); // the Mitti work is scheduled once, after the reply
  });

  test("a second save drafts from the newer price (latest wins), still without Mitti", async () => {
    await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 2000, included: ["Ceiling insulation - supply & install"] }));
    await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3500, included: ["Ceiling insulation - supply & install"] }));
    expect(drafts.map((d) => quotedPriceFromEntries(d.pricedEntries, false).price?.totalIncGst)).toEqual([2000, 3500]);
    expect(calls.filter((c) => c.startsWith("mitti") || c === "syncMittiAssessment")).toEqual([]);
    expect(background).toHaveLength(2);
  });

  test("open form: the basics rule still decides (drafted when the basics are in, never before)", async () => {
    seed("draft");
    await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] }));
    expect(calls).toEqual(["basics", "draft", "applyCobrand"]);
    calls.length = 0; drafts.length = 0;
    basicsReady = false;
    await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3100, included: ["Ceiling insulation - supply & install"] }));
    expect(calls).toEqual(["basics"]);
    expect(drafts).toHaveLength(0);
  });

  test("no stored Ready Check yet: price saved, nothing drafted, the sync still runs after the reply", async () => {
    tables["ceiling_measurements"] = [];
    const saved = await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] }));
    expect(saved.record.price_inc_gst).toBe(3000);
    expect(drafts).toHaveLength(0);
    expect(background).toHaveLength(1);
  });

  test("an unreadable stored Ready Check drafts nothing; a failed draft never fails the save (the 15-minute tick retries)", async () => {
    tables["ceiling_measurements"]![0]!["raw_snapshot"] = "not a list";
    expect((await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] }))).record.price_inc_gst).toBe(3000);
    expect(calls).toEqual([]);
    seed("complete");
    draftThrows = true;
    expect((await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3100, included: ["Ceiling insulation - supply & install"] }))).record.price_inc_gst).toBe(3100);
    expect(calls).toEqual(["draft"]);
    expect(background).toHaveLength(2);
  });
});

describe("after the reply", () => {
  test("Complete form: the Mitti sync runs, then the fresh form decides auto-send — no second draft", async () => {
    await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] }));
    calls.length = 0;
    mitti = "ok";
    await background[0]!();
    expect(calls).toEqual(["syncMittiAssessment", "mitti:http", "maybeAutoSend"]);
    expect(drafts).toHaveLength(1);
  });

  test("open form: only the regular sync runs (it drafts from the fresh form itself)", async () => {
    seed("draft");
    await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] }));
    calls.length = 0;
    mitti = "ok";
    await background[0]!();
    expect(calls).toEqual(["syncMittiAssessment"]);
  });

  test("Mitti down after the reply: the background task never throws", async () => {
    await within(setInstallerPrice(JOB, BOSS, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] }));
    calls.length = 0;
    mitti = "down";
    await expect(background[0]!()).resolves.toBeUndefined();
    expect(calls).toEqual(["syncMittiAssessment", "mitti:http"]);
    expect(calls).not.toContain("maybeAutoSend");
  });
});
