// Part 10 Task 4 — "Enter your price" step: Boss OR Office save the price; Lead Installer / crew are refused server-side
// and nothing is written; "Send quote to owner" releases ONLY through the existing guarded auto-send
// (maybeAutoSendInstallerQuote with every check), and only while OWN_CUSTOMER_SEND_ON_PRESS_ENABLED is on.
// Runs the real server over an in-memory database; Mitti, the quote draft and the sender are recorders.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const T: Tables = {};
const admin = memoryPostgrest(T);
const calls: { fn: string; args: unknown }[] = [];
let autoSendResult: { sent: boolean; reasons: string[] } = { sent: true, reasons: [] };
const background: (() => Promise<unknown>)[] = [];

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: unknown) => { await admin.from("workflow_events").insert({ job_id, actor_id, event_type, summary, details: details ?? {} }); },
}));
mock.module("../src/lib/background.server", () => ({ runAfterResponse: (t: () => Promise<unknown>) => { background.push(t); return "queue_only"; } }));
mock.module("../src/lib/mitti.server", () => ({ syncMittiAssessment: async () => { calls.push({ fn: "syncMittiAssessment", args: null }); }, realMittiCall: async () => ({}) }));
const mittiCore = await import("../src/lib/mitti.core");
mock.module("../src/lib/mitti.core", () => ({ ...mittiCore, mittiApi: () => ({ getAudit: async () => ({ audit_id: "audit-1", modified_at: "2026-11-04T01:00:00Z", items: [] }) }) }));
mock.module("../src/lib/installer-quote.server", () => ({ draftInstallerQuoteFromReadyCheck: async (...a: unknown[]) => { calls.push({ fn: "draft", args: a }); return { ready: true }; } }));
mock.module("../src/lib/auto-quote-send.server", () => ({ maybeAutoSendInstallerQuote: async (jobId: string, opts: unknown) => { calls.push({ fn: "maybeAutoSendInstallerQuote", args: { jobId, opts } }); return autoSendResult; } }));
// Jo 4 Nov 2026: the business's own PIESA rate (rate card PIESA line) — null = not set → the quote can't be sent.
let piesaRate: number | null = 275;
mock.module("../src/lib/installer-paid-electricians.server", () => ({ installerSafetyCheckPrice: async (id: string | null) => { calls.push({ fn: "installerSafetyCheckPrice", args: id }); return id === BIZ ? piesaRate : null; } }));

const { setInstallerPrice, installerPriceView } = await import("../src/lib/installer-price-set.server");
const { PRICE_LOCKED, PRICE_ENTRY_REFUSED, PIESA_PRICE_NOT_SET } = await import("../src/lib/installer-price.core");
const { IN_HOUSE_PIESA_HOLD_REASON } = await import("../src/lib/installer-paid-electricians.core");

const JOB = "job-1", BIZ = "biz-1", BOSS = "u-boss", OFFICE = "u-office", LEAD = "u-lead";
const input = { priceIncGst: 2500, included: ["Ceiling insulation - supply & install"] };
const priceEvents = () => (T["workflow_events"] ?? []).filter((e) => e["event_type"] === "installer_price_set");

function seed(o: { channel?: string; readyCheckComplete?: boolean; quoteSentAt?: string | null } = {}) {
  for (const k of Object.keys(T)) delete T[k];
  calls.length = 0; background.length = 0; autoSendResult = { sent: true, reasons: [] }; piesaRate = 275;
  T["jobs"] = [{ id: JOB, channel: o.channel ?? "installer_sourced", originating_installer_business_id: BIZ, stage: "ready_check_complete", deleted_at: null, property_id: "p1" }];
  T["properties"] = [{ id: "p1", address_line: "12 Example St", suburb: "Box Hill", state: "VIC", postcode: "3128" }];
  T["profiles"] = [{ id: BOSS, business_id: BIZ }, { id: OFFICE, business_id: BIZ }, { id: LEAD, business_id: BIZ }];
  T["business_members"] = [
    { business_id: BIZ, user_id: BOSS, member_role: "business_admin", active: true },
    { business_id: BIZ, user_id: OFFICE, member_role: "office", active: true },
    { business_id: BIZ, user_id: LEAD, member_role: "member", active: true },
  ];
  T["workflow_events"] = [];
  T["ceiling_measurements"] = [{ id: "m1", job_id: JOB, is_current: true, external_source: "mitti", external_id: "audit-1", status: o.readyCheckComplete === false ? "in_progress" : "complete", raw_snapshot: [], removal_required: false, measured_area_m2: 120 }];
  T["quotes"] = o.quoteSentAt ? [{ id: "q1", job_id: JOB, kind: "installation", sent_at: o.quoteSentAt, status: "issued" }] : [];
  T["electrician_choice_events"] = [];
}

describe("who can enter the price", () => {
  beforeEach(() => seed());
  test("Boss saves: one installer_price_set event, set_by = the boss", async () => {
    const r = await setInstallerPrice(JOB, BOSS, input);
    expect(r.stored.record.price_inc_gst).toBe(2500);
    expect(r.sent).toBe(false);
    expect(priceEvents()).toHaveLength(1);
    expect(priceEvents()[0]!["details"]).toMatchObject({ set_by: BOSS, business_id: BIZ, price_inc_gst: 2500 });
  });
  test("Office saves too (Part 5 role rule), set_by = the office person", async () => {
    const r = await setInstallerPrice(JOB, OFFICE, input);
    expect(r.stored.record.price_inc_gst).toBe(2500);
    expect(priceEvents()[0]!["details"]).toMatchObject({ set_by: OFFICE });
  });
  test("Lead Installer / crew (member) are refused and nothing is written; the view gives them null", async () => {
    await expect(setInstallerPrice(JOB, LEAD, input)).rejects.toThrow(PRICE_ENTRY_REFUSED);
    expect(priceEvents()).toHaveLength(0);
    expect(background).toHaveLength(0);
    expect(await installerPriceView(JOB, LEAD)).toBeNull();
  });
  test("someone from another business is refused", async () => {
    await expect(setInstallerPrice(JOB, "u-stranger", input)).rejects.toThrow(PRICE_ENTRY_REFUSED);
    expect(priceEvents()).toHaveLength(0);
  });
  test("Home Insulation Victoria lead → refused before any permission or write", async () => {
    seed({ channel: "hivic_sourced" });
    await expect(setInstallerPrice(JOB, BOSS, input)).rejects.toThrow("Only your own customers' jobs take your price here.");
    expect(priceEvents()).toHaveLength(0);
  });
  test("quote already sent → PRICE_LOCKED before any write", async () => {
    seed({ quoteSentAt: "2026-11-03T00:00:00Z" });
    await expect(setInstallerPrice(JOB, BOSS, input, { send: true })).rejects.toThrow(PRICE_LOCKED);
    expect(priceEvents()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe("Send quote to owner — only through the guarded auto-send, only with the switch on", () => {
  beforeEach(() => seed());
  test("switch off (as shipped): send:true saves and prepares in the background; the sender is never asked to send", async () => {
    const r = await setInstallerPrice(JOB, BOSS, input, { send: true });
    expect(r.sent).toBe(false);
    expect(r.reasons).toEqual([]);
    expect(calls.map((c) => c.fn)).toEqual([]); // nothing inline
    expect(background).toHaveLength(1);
    await background[0]!();
    const send = calls.find((c) => c.fn === "maybeAutoSendInstallerQuote")!;
    expect((send.args as { opts: { enabled?: boolean } }).opts.enabled).toBeUndefined(); // AUTO_QUOTE_SEND_ENABLED decides, as before
  });
  test("switch on, Ready Check Complete, every check passes → prepared then maybeAutoSendInstallerQuote once with enabled: true → sent", async () => {
    const r = await setInstallerPrice(JOB, BOSS, input, { send: true, sendOnPressEnabled: true });
    expect(r.sent).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(calls.map((c) => c.fn)).toEqual(["installerSafetyCheckPrice", "syncMittiAssessment", "draft", "maybeAutoSendInstallerQuote"]);
    const send = calls[3]!.args as { jobId: string; opts: { enabled?: boolean; formCompleted: boolean } };
    expect(send.jobId).toBe(JOB);
    expect(send.opts).toMatchObject({ enabled: true, formCompleted: true });
    expect(background).toHaveLength(0); // sent inline, not again in the background
    expect(priceEvents()).toHaveLength(1);
  });
  test("switch on but a check holds the quote → { sent: false, reasons } come back to the screen; the price is still saved", async () => {
    autoSendResult = { sent: false, reasons: ["Electrician not onboarded: Sample Sparky"] };
    const r = await setInstallerPrice(JOB, OFFICE, input, { send: true, sendOnPressEnabled: true });
    expect(r.sent).toBe(false);
    expect(r.reasons).toEqual(["Electrician not onboarded: Sample Sparky"]);
    expect(priceEvents()).toHaveLength(1);
  });
  test("switch on but the Ready Check isn't Complete → saved, not sent, the plain reason, sender never asked", async () => {
    seed({ readyCheckComplete: false });
    const r = await setInstallerPrice(JOB, BOSS, input, { send: true, sendOnPressEnabled: true });
    expect(r.sent).toBe(false);
    expect(r.reasons).toEqual(["Ready Check not marked Complete in Mitti yet"]);
    expect(calls.map((c) => c.fn)).toEqual(["installerSafetyCheckPrice", "syncMittiAssessment"]);
    expect(priceEvents()).toHaveLength(1);
  });
  // Jo 4 Nov 2026: no PIESA rate on the business → the quote can't be sent until it is set; never a default $349.
  test("switch on but the business has no PIESA rate → saved, not sent, 'Set your PIESA price in My business first', sender never asked; the draft is still prepared (held) in the background", async () => {
    piesaRate = null;
    const r = await setInstallerPrice(JOB, BOSS, input, { send: true, sendOnPressEnabled: true });
    expect(r.sent).toBe(false);
    expect(r.reasons).toEqual([PIESA_PRICE_NOT_SET]);
    expect(PIESA_PRICE_NOT_SET).toBe("Set your PIESA price in My business first");
    expect(calls.map((c) => c.fn)).toEqual(["installerSafetyCheckPrice"]);
    expect(priceEvents()).toHaveLength(1);
    expect(background).toHaveLength(1);
    await background[0]!();
    const send = calls.find((c) => c.fn === "maybeAutoSendInstallerQuote")!;
    expect((send.args as { opts: { enabled?: boolean } }).opts.enabled).toBeUndefined(); // never asked to release
    // the card says it too, and the button falls back to "Save"
    const v = await installerPriceView(JOB, BOSS);
    expect(v).toMatchObject({ canSet: true, piesaPriceSet: false });
    piesaRate = 275;
    expect(await installerPriceView(JOB, BOSS)).toMatchObject({ piesaPriceSet: true });
  });
  test("the office's 'no PIESA rate' hold coming back from the guarded send reads as the installer line", async () => {
    autoSendResult = { sent: false, reasons: [IN_HOUSE_PIESA_HOLD_REASON] };
    const r = await setInstallerPrice(JOB, OFFICE, input, { send: true, sendOnPressEnabled: true });
    expect(r.reasons).toEqual([PIESA_PRICE_NOT_SET]);
  });
  test("switch on, Save (send:false) → saved and prepared in the background only, never sent inline", async () => {
    const r = await setInstallerPrice(JOB, BOSS, input, { send: false, sendOnPressEnabled: true });
    expect(r.sent).toBe(false);
    expect(calls).toHaveLength(0);
    expect(background).toHaveLength(1);
  });
});
