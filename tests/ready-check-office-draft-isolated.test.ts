import { beforeEach, expect, mock, test } from "bun:test";
let channel = "hivic_sourced", existing: { id: string; status: string }[] = [], prior: unknown = null, generated = 0, notifications = 0, stops = false;
const events: { type: string; details: unknown }[] = [];
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  let type: unknown;
  const q: any = { select() { return q; }, eq(k: string, v: unknown) { if (k === "event_type") type = v; return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
    maybeSingle() { return Promise.resolve(result()); }, then(a: any, b: any) { return Promise.resolve(result()).then(a,b); } };
  function result() {
    return { data: table === "jobs" ? { channel, life_support_status: stops ? "yes" : "no", properties: { enrichment: { base44: { declared: { over_five_years: "yes" } } } } } : table === "quotes" ? existing : type === "mitti_a2_quote_drafted" ? prior ? { details: prior } : null : null, error: null };
  }
  return q;
} } }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: unknown, _a: unknown, type: string, _m: unknown, details: unknown) => { events.push({ type, details }); } }));
mock.module("../src/lib/quotes.server", () => ({ generateInstallerQuotes: async (_j: string, _a: unknown, opts: { mittiDraft?: boolean }) => { expect(opts.mittiDraft).toBe(true); generated++; return ["draft"]; } }));
mock.module("../src/lib/quote-ready-notify.server", () => ({ notifyOwnerQuoteReady: async () => { notifications++; } }));
const { draftHivReadyCheckQuote } = await import("../src/lib/ready-check-quote.server");
beforeEach(() => { channel="hivic_sourced"; existing=[]; prior=null; generated=0; notifications=0; stops=false; events.length=0; });
test("A2 completed sync prepares owner-rate draft only", async () => {
  await draftHivReadyCheckQuote("job",null,"audit","2026-10-23",[]);
  expect(generated).toBe(1); expect(events[0]?.type).toBe("mitti_a2_quote_drafted"); expect(notifications).toBe(0);
});
test("unchanged A2 sync preserves existing draft", async () => {
  existing=[{id:"draft",status:"draft"}]; prior={audit_id:"audit",modified_at:"2026-10-23"};
  await draftHivReadyCheckQuote("job",null,"audit","2026-10-23",[]);
  expect(generated).toBe(0);
});
test("sent quotes stay untouched", async () => {
  existing=[{id:"sent",status:"issued"}];
  await draftHivReadyCheckQuote("job",null,"audit","2026-10-23",[]);
  expect(generated).toBe(0);
});
test("A1 pickup keeps its installer draft path", async () => {
  channel="installer_sourced";
  await draftHivReadyCheckQuote("job",null,"audit","2026-10-23",[]);
  expect(generated).toBe(0);
});
test("website life support stop prevents A2 quote and records Office reason only", async () => {
  stops=true;
  await draftHivReadyCheckQuote("job",null,"audit","2026-10-23",[]);
  expect(generated).toBe(0); expect(events[0]?.details).toMatchObject({reasons:["Life support at property – office to check"]}); expect(notifications).toBe(0);
});