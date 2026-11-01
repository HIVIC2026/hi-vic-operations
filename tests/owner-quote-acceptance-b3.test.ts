import { beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {};
let signed = 0, invoice = 0, advances = 0;
let invoiceWait: Promise<void> = Promise.resolve();
const queued: Promise<unknown>[] = [];
const admin = memoryPostgrest(tables);
const from = admin.from.bind(admin);
admin.from = (table: string) => {
  const q = from(table);
  q.upsert = async (row: Record<string, unknown>) => { (tables[table] ??= []).push(row); return { error: null }; };
  return q;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("@tanstack/react-start", () => ({ createServerFn: () => {
  const b = { middleware: () => b, inputValidator: () => b, handler: (h: unknown) => h }; return b;
} }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/request-meta", () => ({ withRequestMeta: {} }));
mock.module("../src/lib/workflow.server", () => ({
  ...Object.fromEntries(["nextStepBlockers", "stageEntryBlockers", "requireAdmin", "requireJobRole", "paymentOptionCleared"].map(n => [n, async () => null])),
  WorkflowError: Error, getStage: async () => tables.jobs?.[0]?.stage,
  commercialBlocker: async () => null, piesaStatus: async () => null,
  transition: async (_job: string, stage: string) => { const j = tables.jobs?.[0]; if (j) j.stage = stage; },
  logEvent: async (_job: string, _actor: string, type: string) => { (tables.workflow_events ??= []).push({ event_type: type }); },
}));
mock.module("../src/lib/assignment.server", () => ({
  ...Object.fromEntries(["assignmentEffective", "currentAgreement", "currentAssignment", "currentInstallerDeclaration", "loadTemplates", "prepareFinalAssignment", "raiseVariation", "reconfirmVariation", "signFinalAssignment", "signInstallerDecl"].map(n => [n, async () => null])),
  assertAgreementCanSign: async () => undefined,
  buildAcceptancePackage: async () => ({ consumer: { name: "Practice Owner" } }),
  signCustomerAgreement: async () => { signed++; },
}));
mock.module("../src/lib/installer-quote.server", () => ({ quoteBillingBlocker: async () => null }));
mock.module("../src/lib/installer-intake.server", () => ({ intakeSendBlockers: async () => [], isIntakeJob: async () => false }));
mock.module("../src/lib/invoice-after-acceptance.server", () => ({ createInvoiceAfterAcceptance: async () => { invoice++; await invoiceWait; } }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => { advances++; }, autoAdvanceOpenJobs: async () => undefined }));
// Every other static server import is unrelated to this path and must never contact a service.
const keep = new Set(["./workflow.server", "./assignment.server", "./autoadvance.server", "./background.server"]);
for (const m of readFileSync("src/lib/portal.functions.ts", "utf8").matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.\/[^" ]+(?:server|functions))"/g)) {
  const path = m[2]; if (!path || keep.has(path)) continue;
  const names = (m[1] ?? "").split(",").map(s => s.trim().split(/\s+as\s+/)[0]).filter(s => s && !s.startsWith("type "));
  mock.module(`../src/lib/${path.slice(2)}`, () => Object.fromEntries(names.map(n => [n, async () => null])));
}
const { respondToQuoteImpl } = await import("../src/lib/portal.functions");
const { requestContext } = await import("../src/lib/background.server");
const core = await import("../src/lib/owner-quote-visibility.core");
const actor = { userId: "owner-1", ip: null, userAgent: null, authorize: async (job: string) => { if (job !== "job-1") throw Error("Forbidden"); }, isOwner: async () => true };
const data = { quoteId: "quote-1", expectedVersion: 3, accept: true, consent: true, signing: { authorityType: "owner" as const, readConsumerInfo: true, acceptAgreement: true, assistance: "none" as const } };
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.quotes = [{ id: "quote-1", job_id: "job-1", kind: "installation", status: "issued", release_state: "released", version: 3, sent_at: new Date().toISOString() }];
  tables.jobs = [{ id: "job-1", stage: "measured_estimate_ready" }];
  signed = invoice = advances = 0; queued.length = 0; invoiceWait = Promise.resolve();
});
test("same accepted quote version is an authorised no-op, not another signature/event/invoice/send", async () => {
  const q = tables.quotes?.[0]; if (q) q.status = "accepted";
  expect(await respondToQuoteImpl(data, actor)).toEqual({ ok: true, outcome: "already accepted" });
  expect(signed).toBe(0); expect(invoice).toBe(0); expect(advances).toBe(0); expect(tables.workflow_events ?? []).toEqual([]);
});
test("accepted replay still rejects a different version and another owner's job", async () => {
  const q = tables.quotes?.[0]; if (q) q.status = "accepted";
  await expect(respondToQuoteImpl({ ...data, expectedVersion: 2 }, actor)).rejects.toThrow();
  await expect(respondToQuoteImpl(data, { ...actor, authorize: async () => { throw Error("Forbidden"); } })).rejects.toThrow("Forbidden");
  expect(signed + invoice + advances).toBe(0);
});
test('interrupted quote sitting after two records retries to exactly four without double recording', async () => {
  const records = new Set<string>(); let interrupt = true;
  const recoveryActor = { ...actor, signQuoteSitting: async () => {
    for (const key of ['quote_acceptance', 'payment_terms', 'esc_consent']) {
      records.add(key);
      if (records.size === 2 && interrupt) { interrupt=false; throw Error('interrupted after record 2'); }
    }
  }};
  await expect(respondToQuoteImpl(data,recoveryActor)).rejects.toThrow('interrupted after record 2');
  expect(records.size).toBe(2); expect(signed).toBe(0);
  await respondToQuoteImpl(data,recoveryActor); records.add('customer_agreement');
  expect([...records].sort()).toEqual(['customer_agreement','esc_consent','payment_terms','quote_acceptance']);
  // Also recover a committed quote whose auxiliary signing write was interrupted, rather than blindly no-op.
  records.delete('esc_consent');
  await respondToQuoteImpl(data,recoveryActor);
  expect(records.size).toBe(4); expect(invoice).toBe(1);
});
test("a stalled post-commit invoice does not hold the owner response when the request lifecycle keeps it alive", async () => {
  let release = () => {}; invoiceWait = new Promise<void>(r => { release = r; });
  const acceptance = requestContext.run({ waitUntil: p => queued.push(p) }, () => respondToQuoteImpl(data, actor));
  const result = await Promise.race([acceptance.then(() => "returned"), new Promise<string>(r => setTimeout(() => r("hung"), 40))]);
  release(); await acceptance; await Promise.all(queued);
  expect(result).toBe("returned"); expect(signed).toBe(1); expect(invoice).toBe(1); expect(advances).toBe(1);
  expect(tables.quotes?.[0]?.status).toBe("accepted");
  expect(tables.workflow_events).toEqual([{ event_type: "QUOTE_ACCEPTED" }]);
  await respondToQuoteImpl(data, actor);
  expect(signed).toBe(1); expect(invoice).toBe(1); expect(advances).toBe(1);
});
test("quote action model never permits Accept for an accepted timestamp or acknowledged exact version", () => {
  const fn = (core as Record<string, unknown>).ownerQuoteCanAccept as ((q: unknown, acknowledged?: unknown) => boolean) | undefined;
  expect(typeof fn).toBe("function");
  if (!fn) return;
  const q = { id: "q1", version: 3, status: "issued", release_state: "released" };
  expect(fn(q)).toBe(true);
  expect(fn({ ...q, status: "accepted" })).toBe(false);
  expect(fn({ ...q, accepted_at: "2026-11-01T07:00:00Z" })).toBe(false);
  expect(fn(q, { id: "q1", version: 3 })).toBe(false);
  expect(fn(q, { id: "q1", version: 2 })).toBe(true);
  expect(fn({ ...q, release_state: "held" })).toBe(false);
});
test("successful acceptance acknowledges the version before a stalled refresh and does not wait for it", async () => {
  const fn = (core as Record<string, unknown>).completeOwnerQuoteAcceptance as ((accept: () => Promise<unknown>, acknowledge: () => void, refresh: () => Promise<unknown>) => Promise<void>) | undefined;
  expect(typeof fn).toBe("function");
  if (!fn) return;
  const order: string[] = [];
  await fn(async () => { order.push("accepted"); }, () => { order.push("acknowledged"); }, () => { order.push("refresh"); return new Promise(() => {}); });
  expect(order).toEqual(["accepted", "acknowledged", "refresh"]);
  await expect(fn(async () => { throw Error("refused"); }, () => order.push("wrong"), async () => undefined)).rejects.toThrow("refused");
  expect(order).not.toContain("wrong");
});