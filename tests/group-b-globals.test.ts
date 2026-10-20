// Group B automatic invitation obeys both global switches; unreadable settings = off; no provider call.
import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";

let settings: { w: unknown; we: unknown; d: unknown; de: unknown } = { w: null, we: null, d: null, de: null };
let reads = 0;
const chain = (table: string) => {
  const res = () => { reads++; return table === "workflow_settings" ? { data: settings.w, error: settings.we } : table === "customer_delivery_settings" ? { data: settings.d, error: settings.de } : { data: null, error: { message: "unexpected read" } }; };
  const c: Record<string, unknown> = {};
  for (const k of ["select", "eq", "limit", "in", "order", "is"]) c[k] = () => c;
  c["maybeSingle"] = async () => res();
  return c;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: chain } }));
const fetchCalls: string[] = [];
globalThis.fetch = (async (u: unknown) => { fetchCalls.push(String(u)); return new Response("{}"); }) as typeof fetch;

const { groupBGlobalsOn, sendAutomaticInsulationDetails, GROUP_B_GLOBALS_OFF } = await import("../src/lib/hot-leads-send.server");
const J = "00000000-0000-0000-0000-0000000000b1";

test("both switches off -> blocked before anything else, zero provider calls", async () => {
  settings = { w: { customer_comms_enabled: false }, we: null, d: { enabled: false }, de: null };
  const r = await sendAutomaticInsulationDetails(J);
  expect(r.outcome).toBe("blocked"); expect(r.detail).toBe(GROUP_B_GLOBALS_OFF); expect(fetchCalls).toEqual([]);
});
test("only one switch on still blocks", async () => {
  settings = { w: { customer_comms_enabled: true }, we: null, d: { enabled: false }, de: null }; expect(await groupBGlobalsOn()).toBe(false);
  settings = { w: { customer_comms_enabled: false }, we: null, d: { enabled: true }, de: null }; expect(await groupBGlobalsOn()).toBe(false);
});
test("either settings read failing blocks", async () => {
  settings = { w: null, we: { message: "down" }, d: { enabled: true }, de: null }; expect(await groupBGlobalsOn()).toBe(false);
  settings = { w: { customer_comms_enabled: true }, we: null, d: null, de: { message: "down" } }; expect(await groupBGlobalsOn()).toBe(false);
  settings = { w: null, we: null, d: null, de: null }; expect(await groupBGlobalsOn()).toBe(false);
  expect((await sendAutomaticInsulationDetails(J)).outcome).toBe("blocked"); expect(fetchCalls).toEqual([]);
});
test("both on reads as on (route then continues to its other guards)", async () => {
  settings = { w: { customer_comms_enabled: true }, we: null, d: { enabled: true }, de: null }; expect(await groupBGlobalsOn()).toBe(true);
});
test("sender re-checks Group B globals after reservation and before the provider; other guards kept", () => {
  const s = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
  const g = s.indexOf('sendGroup === "onsite" && !followup && !(await groupBGlobalsOn())');
  expect(g).toBeGreaterThan(-1);
  expect(g).toBeLessThan(s.indexOf("await resendSend(to"));
  expect(g).toBeLessThan(s.indexOf("jobDeletedBlocker(jobId)"));
  expect(s).toContain("const initial = groupBInitialAction(await groupBMediaForJob(jobId))");
  for (const k of ["onsiteInitialBlocker", "initialResponseHistoryBlocker", "NO_SIZE_REAL_SEND_HELD", "customer_email_optouts", "INSULATION_DETAILS_REAL_SEND_APPROVED"]) expect(s).toContain(k);
});
