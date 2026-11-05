// Photo-quote installers Part 2 (Task 10): From photos installers add their own job with the quote in one step.
import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { throw new Error("live database used"); } } }));
const { ownPhotoQuoteGate, recordOwnPhotoQuote, OWN_PHOTO_REF } = await import("../src/lib/own-photo-quote.server");
const { validateInstallerPrice } = await import("../src/lib/installer-price.core");

const old = (t0: Date) => ({ now: new Date(t0.getTime() + 11 * 60_000) });
const good = { underR2: true, removeM2: 10, installM2: 80, product: "Bradford Gold R5", priceIncGst: 2400, included: ["Ceiling insulation - supply & install", "Removal of existing insulation"] };
test("gate: a photos business must send a valid photo quote; under R2 = No is refused; a Ready Check business is unchanged", () => {
  expect(ownPhotoQuoteGate("photos", { ...good, underR2: false })).toContain("Over R2 isn't eligible for the rebate.");
  expect(ownPhotoQuoteGate("photos", null)).toEqual(["Fill in the photo quote: existing insulation, sqm and your price."]);
  expect(ownPhotoQuoteGate("photos", good)).toEqual([]);
  expect(ownPhotoQuoteGate("ready_check", null)).toEqual([]);
  expect(ownPhotoQuoteGate("ready_check", good)).toEqual(["This installer quotes from a Ready Check."]);
});

let t: Tables, drafts: unknown[], sends: unknown[], stage: string, moves: string[];
const deps = () => ({
  getStage: async () => stage,
  stageEntryBlockers: async () => [] as string[],
  transition: async (_j: string, to: string) => { moves.push(to); stage = to; },
  db: memoryPostgrest(t) as never,
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: Record<string, unknown>) => { t.workflow_events!.push({ id: `e${t.workflow_events!.length}`, job_id, actor_id, event_type, summary, details: details ?? {} }); },
  draft: async (...a: unknown[]) => { drafts.push(a); },
  autoSend: async (_j: string, o: unknown) => { sends.push(o); return { sent: false, reasons: ["Waiting for office review before sending"] }; },
  sendOnPress: false,
});
beforeEach(() => { t = { workflow_events: [], ceiling_measurements: [] }; drafts = []; sends = []; stage = "ready_check_ready_to_schedule"; moves = []; });
const ev = (type: string) => t.workflow_events!.filter((e) => e["event_type"] === type);

test("valid → one current photo measurement, one installer_price_set, one product, the own-customer draft, the guarded release; no Ready Check form", async () => {
  const r = await recordOwnPhotoQuote("j", "boss", "nogap", good, deps());
  expect(r).toEqual({ sent: false, held: ["Waiting for office review before sending"] });
  const cur = t.ceiling_measurements!.filter((m) => m["is_current"]);
  expect(cur).toHaveLength(1);
  expect(cur[0]).toMatchObject({ external_source: "photo_quote", external_id: OWN_PHOTO_REF, status: "complete", measured_area_m2: 80, removal_m2: 10, removal_required: true });
  expect(ev("installer_price_set")).toHaveLength(1);
  expect(ev("installer_price_set")[0]!["details"]).toMatchObject({ price_inc_gst: 2400, product_option: "Bradford Gold R5", business_id: "nogap" });
  // Jo 16:44: the price record is exactly what the Your price card saves for the same answers.
  const card = validateInstallerPrice({ priceIncGst: 2400, included: good.included, productOption: "Bradford Gold R5", removalRequired: true }).record!;
  expect(ev("installer_price_set")[0]!["details"]).toMatchObject(card);
  expect(ev("mitti_product_recorded")).toHaveLength(1);
  expect(drafts).toEqual([["j", "boss", OWN_PHOTO_REF, { totalIncGst: 2400, includes: good.included.join(", "), areaM2: 80, photo: { record: card, product: "Bradford Gold R5", removeM2: 10 } }]]);
  expect(sends).toHaveLength(1); expect(sends[0]).toMatchObject({ formCompleted: true }); expect(sends[0]).not.toHaveProperty("enabled");
  expect(t.workflow_events!.some((e) => /mitti_audit|ready_check_form_created|will_call|partner_call/.test(String(e["event_type"])))).toBe(false);
});
test("the ticks are stored on the claim; sqm to remove without the removal tick is refused before anything is written", async () => {
  seedJob();
  await expect(recordOwnPhotoQuote("j", "boss", "nogap", { ...good, included: ["Ceiling insulation - supply & install"] }, deps())).rejects.toThrow(`You've put sqm to remove, so tick "Removal of existing insulation".`);
  expect(t.workflow_events).toHaveLength(0);
  await recordOwnPhotoQuote("j", "boss", "nogap", { ...good, included: [...good.included, "Other"], includedOther: "Downlight covers" }, deps());
  expect(ev("photo_quote_submitted")[0]!["details"]).toMatchObject({ inputs: { included: [...good.included, "Other"], includedOther: "Downlight covers" } });
  expect(ev("installer_price_set")[0]!["details"]).toMatchObject({ included: [...good.included, "Other"], included_other: "Downlight covers" });
});
test("Try again resumes: no second measurement, price or product", async () => {
  await recordOwnPhotoQuote("j", "boss", "nogap", good, deps());
  await recordOwnPhotoQuote("j", "boss", "nogap", good, deps());
  expect(t.ceiling_measurements!.filter((m) => m["is_current"])).toHaveLength(1);
  expect(ev("installer_price_set")).toHaveLength(1);
  expect(ev("mitti_product_recorded")).toHaveLength(1);
});
test("send-on-press switch on → the release is asked to send now (switch itself unchanged)", async () => {
  await recordOwnPhotoQuote("j", "boss", "nogap", good, { ...deps(), sendOnPress: true });
  expect(sends[0]).toMatchObject({ enabled: true });
});

test("final review fix: the own photo job moves to Ready Check complete so the release can take it to the quote stage", async () => {
  await recordOwnPhotoQuote("j", "boss", "nogap", good, deps());
  expect(moves).toEqual(["ready_check_complete"]);
  await recordOwnPhotoQuote("j", "boss", "nogap", good, deps());
  expect(moves).toEqual(["ready_check_complete"]);
});

// ---- Review fix round, IMPORTANT 1 ----
const { claimOwnPhotoQuote, sweepOwnPhotoQuotes } = await import("../src/lib/own-photo-quote.server");
const tickDeps = () => ({ ...deps(), draft: async (...a: unknown[]) => { drafts.push(a); t.quotes!.push({ id: `q${t.quotes!.length}`, job_id: a[0], kind: "installation", status: "draft" }); } });
const seedJob = () => { t.jobs = [{ id: "j", stage: "ready_check_ready_to_schedule", deleted_at: null, qa_archived_at: null }]; t.quotes = []; };

test("crash between the job save and the quote records: the claim alone → the tick finishes it once (idempotent)", async () => {
  seedJob();
  await claimOwnPhotoQuote("j", "boss", "nogap", good, memoryPostgrest(t) as never);
  expect(ev("photo_quote_submitted")).toHaveLength(1);
  expect(ev("photo_quote_submitted")[0]!["details"]).toMatchObject({ own_customer: true, business_id: "nogap", inputs: { installM2: 80, removeM2: 10, priceIncGst: 2400, product: "Bradford Gold R5" } });
  expect(t.ceiling_measurements).toHaveLength(0);
  const first = await sweepOwnPhotoQuotes(old(new Date()), tickDeps());
  expect(first.finished).toEqual(["j"]);
  expect(t.ceiling_measurements!.filter((m) => m["is_current"] && m["external_source"] === "photo_quote")).toHaveLength(1);
  expect(ev("installer_price_set")).toHaveLength(1);
  expect(drafts).toHaveLength(1); expect(sends).toHaveLength(1);
  const again = await sweepOwnPhotoQuotes(old(new Date()), tickDeps());
  expect(again.finished).toEqual([]);
  expect(drafts).toHaveLength(1); expect(sends).toHaveLength(1);
  expect(ev("installer_price_set")).toHaveLength(1);
});
test("the tick leaves a finished Add a job photo quote alone, and flags a failure once a day", async () => {
  seedJob();
  await claimOwnPhotoQuote("j", "boss", "nogap", good, memoryPostgrest(t) as never);
  const broken = { ...tickDeps(), draft: async () => { throw new Error("boom"); }, logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: Record<string, unknown>) => { t.workflow_events!.push({ id: `e${t.workflow_events!.length}`, job_id, actor_id, event_type, summary, details: details ?? {}, created_at: new Date().toISOString() }); } };
  expect((await sweepOwnPhotoQuotes(old(new Date()), broken)).failed).toEqual(["j"]);
  expect((await sweepOwnPhotoQuotes(old(new Date()), broken)).failed).toEqual(["j"]);
  expect(ev("own_photo_quote_failed").filter((e) => (e["details"] as { from?: string }).from === "tick")).toHaveLength(1);
});
test("Try again with a changed price before any quote → the claim and installer_price_set follow the new price", async () => {
  seedJob();
  await claimOwnPhotoQuote("j", "boss", "nogap", good, memoryPostgrest(t) as never);
  await recordOwnPhotoQuote("j", "boss", "nogap", { ...good, priceIncGst: 2600 }, deps());
  expect(ev("photo_quote_submitted")).toHaveLength(1);
  expect((ev("photo_quote_submitted")[0]!["details"] as { inputs: { priceIncGst: number } }).inputs.priceIncGst).toBe(2600);
  expect(ev("installer_price_set").at(-1)!["details"]).toMatchObject({ price_inc_gst: 2600 });
  expect((drafts.at(-1) as unknown[])[3]).toMatchObject({ totalIncGst: 2600 });
});
test("Try again with a changed price once the quote exists → refused with a plain line; nothing changes", async () => {
  seedJob();
  await recordOwnPhotoQuote("j", "boss", "nogap", good, tickDeps());
  await expect(recordOwnPhotoQuote("j", "boss", "nogap", { ...good, priceIncGst: 2600 }, tickDeps())).rejects.toThrow("This job's quote is already made, so the answers can't change here. Email us if something's wrong.");
  expect(ev("installer_price_set")).toHaveLength(1);
  expect((ev("photo_quote_submitted")[0]!["details"] as { inputs: { priceIncGst: number } }).inputs.priceIncGst).toBe(2400);
});

// ---- Re-review (5 Nov): the tick never re-drafts a finished photo quote, and leaves fresh claims to the live request ----
test("finished marker: once the quote is made the claim says so; a later declined quote is never re-drafted or re-sent", async () => {
  seedJob();
  await recordOwnPhotoQuote("j", "boss", "nogap", good, tickDeps());
  expect((ev("photo_quote_submitted")[0]!["details"] as { finished_at?: string }).finished_at).toBeTruthy();
  t.quotes![0]!["status"] = "declined";
  const r = await sweepOwnPhotoQuotes(old(new Date()), tickDeps());
  expect(r.finished).toEqual([]);
  expect(drafts).toHaveLength(1); expect(sends).toHaveLength(1);
});
test("older claims with no marker: a quote in ANY status, or an installer_quote_drafted / held event, counts as finished", async () => {
  for (const status of ["declined", "expired", "superseded", "cancelled"]) {
    t = { workflow_events: [], ceiling_measurements: [] }; drafts = []; sends = []; seedJob();
    await claimOwnPhotoQuote("j", "boss", "nogap", good, memoryPostgrest(t) as never);
    t.quotes!.push({ id: "q-old", job_id: "j", kind: "installation", status });
    expect((await sweepOwnPhotoQuotes(old(new Date()), tickDeps())).finished).toEqual([]);
    expect(drafts).toHaveLength(0);
  }
  for (const type of ["installer_quote_drafted", "installer_quote_held"]) {
    t = { workflow_events: [], ceiling_measurements: [] }; drafts = []; sends = []; seedJob();
    await claimOwnPhotoQuote("j", "boss", "nogap", good, memoryPostgrest(t) as never);
    t.workflow_events!.push({ id: `x-${type}`, job_id: "j", event_type: type, details: {}, created_at: new Date().toISOString() });
    expect((await sweepOwnPhotoQuotes(old(new Date()), tickDeps())).finished).toEqual([]);
    expect(drafts).toHaveLength(0);
  }
});
test("the tick skips claims under 10 minutes old (the live Add a job request is still finishing them)", async () => {
  seedJob();
  const t0 = new Date();
  await claimOwnPhotoQuote("j", "boss", "nogap", good, memoryPostgrest(t) as never);
  expect((await sweepOwnPhotoQuotes({ now: new Date(t0.getTime() + 9 * 60_000) }, tickDeps())).finished).toEqual([]);
  expect(drafts).toHaveLength(0);
  expect((await sweepOwnPhotoQuotes({ now: new Date(t0.getTime() + 11 * 60_000) }, tickDeps())).finished).toEqual(["j"]);
});
