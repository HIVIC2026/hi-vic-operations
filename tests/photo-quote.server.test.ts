// Photo-quote installers Task 5: "Send for quote" writes what a completed Mitti Ready Check writes, once, then the normal
// quote builder and automatic send. In-memory database; no live calls.
import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { throw new Error("live database used"); } } }));
const { submitPhotoQuote, photoQuoteHandBackBlocker } = await import("../src/lib/photo-quote.server");
const { handBackJob } = await import("../src/lib/trade-view.server");

const give = { batchId: "B1", businessId: "nogap", givenAt: "2026-11-05T23:00:00Z" };
const good = { underR2: true, removeM2: 20, installM2: 84.5, product: "Bradford Gold R5" };
let t: Tables, stage: string, calls: { gen: number; send: unknown[]; forms: number; held: unknown[]; trans: string[] }, blockers: string[];
const deps = (o: Record<string, unknown> = {}) => ({
  db: memoryPostgrest(t) as never,
  access: async (_j: string, u: string) => { if (u !== "boss") throw new Error("no"); return "nogap"; },
  photoGive: async () => give,
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: Record<string, unknown>) => { t.workflow_events!.push({ id: `e${t.workflow_events!.length}`, job_id, actor_id, event_type, summary, details: details ?? {}, created_at: new Date().toISOString() }); },
  getStage: async () => stage,
  stageEntryBlockers: async () => blockers,
  transition: async (_j: string, to: string) => { calls.trans.push(to); stage = to; },
  ensureForms: async () => { calls.forms++; },
  generateQuotes: async (job_id: string) => { calls.gen++; t.quotes!.push({ id: "q1", job_id, kind: "installation", status: "draft" }); },
  autoSend: async (_j: string, o: unknown) => { calls.send.push(o); return { sent: false, reasons: [] }; },
  held: async (...a: unknown[]) => { calls.held.push(a); },
  now: () => new Date("2026-11-06T02:00:00Z"),
  ...o,
});
const ev = (type: string) => t.workflow_events!.filter((e) => e["event_type"] === type);
beforeEach(() => {
  t = { workflow_events: [], ceiling_measurements: [{ id: "old", job_id: "j", is_current: true, external_source: null, external_id: null, status: "draft" }], quotes: [] };
  stage = "ready_check_ready_to_schedule"; blockers = []; calls = { gen: 0, send: [], forms: 0, held: [], trans: [] };
});

test("refused, nothing written: not this business's job / not a photos job / wrong stage", async () => {
  expect(await submitPhotoQuote("j", "stranger", good, deps())).toEqual({ ok: false, message: "This job isn't assigned to you." });
  expect(await submitPhotoQuote("j", "boss", good, deps({ photoGive: async () => null }))).toEqual({ ok: false, message: "This job isn't quoted from photos." });
  expect(await submitPhotoQuote("j", "boss", good, deps({ photoGive: async () => ({ ...give, businessId: "rapid" }) }))).toEqual({ ok: false, message: "This job isn't quoted from photos." });
  stage = "ready_check_scheduled";
  expect(await submitPhotoQuote("j", "boss", good, deps())).toEqual({ ok: false, message: "This job isn't waiting for a photo quote." });
  expect(t.workflow_events).toEqual([]); expect(t.ceiling_measurements).toHaveLength(1); expect(calls.gen).toBe(0);
});
test("form problems → ok:false joined with •, nothing written", async () => {
  expect(await submitPhotoQuote("j", "boss", { underR2: false, removeM2: 0, installM2: 80, product: null }, deps())).toEqual({ ok: false, message: "Over R2 isn't eligible. Use Can't do this one. • Pick the product" });
  expect(t.workflow_events).toEqual([]);
});
test("valid → one current complete measurement, product, eligibility, submitted event, quote stage, quote built once, auto-send with formCompleted", async () => {
  const r = await submitPhotoQuote("j", "boss", good, deps());
  expect(r).toEqual({ ok: true, sent: false, held: [] });
  const current = t.ceiling_measurements!.filter((m) => m["is_current"]);
  expect(current).toHaveLength(1);
  expect(current[0]).toMatchObject({ status: "complete", external_source: "photo_quote", external_id: "photo:B1", measured_area_m2: 84.5, removal_required: true, removal_m2: 20, insulation_present: true, source_role: "installer", raw_snapshot: { photo_quote: { underR2: true, removeM2: 20, installM2: 84.5, product: "Bradford Gold R5" }, batch_id: "B1" } });
  expect(ev("mitti_product_recorded")).toHaveLength(1);
  expect(ev("mitti_product_recorded")[0]!["details"]).toMatchObject({ ready: true, product: { option: "Bradford Gold R5" }, source: "photo_quote" });
  expect(ev("ready_check_form_eligible")).toHaveLength(1);
  expect(ev("ready_check_form_eligible")[0]!["details"]).toMatchObject({ basis: "photo_quote", audit_id: "photo:B1" });
  expect(ev("photo_quote_submitted")).toHaveLength(1);
  expect(calls.trans).toEqual(["ready_check_complete", "measured_estimate_ready"]);
  expect(stage).toBe("measured_estimate_ready");
  expect(calls.gen).toBe(1); expect(calls.forms).toBe(1);
  expect(calls.send).toHaveLength(1); expect(calls.send[0]).toMatchObject({ formCompleted: true });
});
test("submitPhotoQuote is idempotent on a repeat: same answers → ok:true, no new rows, no second quote", async () => {
  await submitPhotoQuote("j", "boss", good, deps());
  const before = { events: t.workflow_events!.length, ms: t.ceiling_measurements!.length };
  expect((await submitPhotoQuote("j", "boss", { ...good, installM2: 84.49 }, deps())).ok).toBe(true); // 84.49 → 84.5
  expect([t.workflow_events!.length, t.ceiling_measurements!.length]).toEqual([before.events, before.ms]);
  expect(calls.gen).toBe(1);
});
test("a different submit after the quote is drafted → the quote has gone", async () => {
  await submitPhotoQuote("j", "boss", good, deps());
  expect(await submitPhotoQuote("j", "boss", { ...good, installM2: 90 }, deps())).toEqual({ ok: false, message: "The quote has gone. Email us if something's wrong." });
});
test("hand-back after a drafted quote is refused; before any quote it is allowed", async () => {
  const db = memoryPostgrest(t) as never;
  // photoQuoteHandBackBlocker reads the give itself: seed a From photos give.
  t.workflow_events!.push({ id: "m", job_id: "j", event_type: "in_house_quote_method", created_at: "2026-11-05T22:59:00Z", details: { batch_id: "B1", business_id: "nogap" } },
    { id: "s", job_id: "j", event_type: "in_house_batch_sent", created_at: "2026-11-05T23:00:00Z", details: { batch_id: "B1", business_id: "nogap" } });
  t.job_assignments = [{ job_id: "j", role: "installer", active: true, business_id: "nogap" }];
  expect(await photoQuoteHandBackBlocker("j", db)).toBeNull();
  t.quotes!.push({ id: "q1", job_id: "j", kind: "installation", status: "draft" });
  expect(await photoQuoteHandBackBlocker("j", db)).toBe("The quote has gone. Email us if something's wrong.");
  const pulled: string[] = [];
  const hb = { bookingTeam: async () => null, stillConfirmedBookings: async () => [], pullBackInHouseJob: async () => { pulled.push("x"); }, finishInHouseHandback: async () => null, cancelBookingsAfterHandBack: async () => [], requireEscWithdrawal: null, queueVisitCancelledOwnerEmail: async () => "", logEvent: async () => null,
    photoQuoteLock: (jobId: string) => photoQuoteHandBackBlocker(jobId, db) };
  await expect(handBackJob("j", "boss", "Photos not clear enough", hb as never)).rejects.toThrow("The quote has gone");
  expect(pulled).toEqual([]);
});
test("stage blockers → ok:false with them; the measurement is kept for the office", async () => {
  blockers = ["Verified eligibility not recorded as eligible by the office for the current Ready Check."];
  const r = await submitPhotoQuote("j", "boss", good, deps());
  expect(r).toEqual({ ok: false, message: blockers[0] });
  expect(t.ceiling_measurements!.filter((m) => m["is_current"] && m["external_source"] === "photo_quote")).toHaveLength(1);
  expect(calls.held).toHaveLength(1); expect(calls.gen).toBe(0);
});
test("a form failure is logged and never blocks the quote", async () => {
  const r = await submitPhotoQuote("j", "boss", good, deps({ ensureForms: async () => { throw new Error("Mitti down"); } }));
  expect(r.ok).toBe(true); expect(calls.gen).toBe(1); expect(ev("in_house_form_sync_failed")).toHaveLength(1);
});
