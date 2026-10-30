import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as pricing from "../src/lib/installer-paid-electricians.core";
import * as rec from "../src/lib/rec-onboarded.core";
import * as usual from "../src/lib/usual-electrician.core";

// Evaluate the actual server code against local read fixtures. No hosted clients or delivery imports.
function moduleAt(path: string, dependencies: Record<string, unknown>) {
  const code = ts.transpile(readFileSync(path, "utf8"), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
  const exports = {};
  new Function("exports", "require", code)(exports, (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  });
  return exports as Record<string, (...args: any[]) => Promise<any>>;
}
function reads(rows: Record<string, unknown[]>, failedTable?: string) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  return { calls, admin: { from(table: string) {
    const call = { table, filters: [] as unknown[][] }; calls.push(call);
    const q: any = { then(resolve: (x: unknown) => unknown) { return Promise.resolve({ data: rows[table] ?? [], error: failedTable === table ? { message: "read failed" } : null }).then(resolve); } };
    for (const name of ["select", "in", "eq", "lte", "order", "ilike", "is", "contains", "limit"]) q[name] = (...args: unknown[]) => { call.filters.push([name, ...args]); return q; };
    q.maybeSingle = q.single = async () => ({ data: rows[table]?.[0] ?? null, error: failedTable === table ? { message: "read failed" } : null });
    return q;
  } } };
}
function priceModule(fixture: ReturnType<typeof reads>) {
  return moduleAt("src/lib/installer-paid-electricians.server.ts", {
    "@/integrations/supabase/client.server": { supabaseAdmin: fixture.admin },
    "./installer-paid-electricians.core": pricing, "./melbourne-time.core": { melbourneToday: () => "2026-10-30" },
  });
}
test("in-house batch uses three reads for many businesses and filters enabled, active effective electrical cards", async () => {
  const f = reads({ businesses: [{ id: "a", name: "A", in_house: true }, { id: "b", name: "B", in_house: true }], rate_cards: [{ id: "ca", business_id: "a" }, { id: "cb", business_id: "b" }], rate_card_items: [{ rate_card_id: "ca", unit_price_ex_gst: 100 }, { rate_card_id: "cb", unit_price_ex_gst: 200 }] });
  const result = await priceModule(f).inHouseBusinessesFor(["a", "b", "ordinary"]);
  expect(result.get("a").piesaIncGst).toBe(110);
  expect(result.get("b").piesaIncGst).toBe(220);
  expect(f.calls.map(c => c.table)).toEqual(["businesses", "rate_cards", "rate_card_items"]);
  expect(f.calls[0]?.filters).toContainEqual(["eq", "in_house", true]);
  expect(f.calls[1]?.filters).toContainEqual(["eq", "kind", "electrical"]);
  expect(f.calls[1]?.filters).toContainEqual(["eq", "is_active", true]);
  expect(f.calls[1]?.filters).toContainEqual(["lte", "effective_from", "2026-10-30"]);
});
test("non-in-house read costs only one businesses read", async () => {
  const f = reads({});
  expect(await priceModule(f).readInstallerPaidElectricians("ordinary")).toBeNull();
  expect(f.calls.map(c => c.table)).toEqual(["businesses"]);
});
test("each configuration read failure propagates, including the safety-check money path", async () => {
  for (const table of ["businesses", "rate_cards", "rate_card_items"]) {
    const f = reads({ businesses: [{ id: "a", name: "A", in_house: true }], rate_cards: [{ id: "ca", business_id: "a" }] }, table);
    await expect(priceModule(f).readInstallerPaidElectricians("a")).rejects.toThrow("Could not read");
    await expect(priceModule(f).safetyCheckPayeesFor([{ id: "j", originating_installer_business_id: "a" }])).rejects.toThrow("Could not read");
  }
});
function usualModule(priceRead: () => Promise<unknown>, candidates: rec.ApprovedRecCandidate[] = []) {
  const f = reads({ jobs: [{ channel: "installer_sourced", originating_installer_business_id: "a" }], admin_config_events: [{ id: "revision", details: { electrician: { name: "REC", licence: "A1" } } }] });
  return moduleAt("src/lib/usual-electrician.server.ts", {
    "@/integrations/supabase/client.server": { supabaseAdmin: f.admin }, "./usual-electrician.core": usual,
    "./mitti.core": { contactAnswersFromEntries: () => ({}) }, "./workflow.server": { logEvent: async () => {} },
    "./electrician-choice.core": { resolveElectricianChoice: () => "usual" }, "./electrician-choice.server": { readElectricianChoice: async () => "usual" },
    "./rec-onboarded.core": rec, "./rec-onboarded.server": { loadApprovedRecCandidates: async () => candidates },
    "./installer-paid-electricians.server": { readInstallerPaidElectricians: priceRead },
  });
}
test("usual-electrician refuses a failed configuration read instead of pricing", async () => {
  const m = usualModule(async () => { throw new Error("configuration unavailable"); });
  await expect(m.mittiElectricianForJob("j", null, [], "audit")).rejects.toThrow("configuration unavailable");
  await expect(m.readUsualElectricianStatus("a")).rejects.toThrow("configuration unavailable");
});
test("missing in-house PIESA rate reaches quote resolution with the exact hold, not REC fallback", async () => {
  const candidates = [{ business_id: "rec", name: "REC", rec_number: "A1", worker_licences: [], onboarding_status: "approved", is_active: true, approved_electricians: 1, piesa_rate: { id: "rate", rate_inc_gst: 999 } }];
  const m = usualModule(async () => pricing.installerPaysOwnElectricians({ id: "a", name: "A", in_house: true, piesaIncGst: null }), candidates);
  const result = await m.mittiElectricianForJob("j", null, [], "audit");
  expect(result.ready).toBe(false);
  expect(result.priceIncGst).toBeNull();
  expect(result.reasons).toEqual(["In-house partner has no PIESA rate on its rate card"]);
  expect((await m.readUsualElectricianStatus("a")).onboarded).toBe(false);
});
test("valid in-house line still prices flat while non-in-house uses the REC rate", async () => {
  const candidates = [{ business_id: "rec", name: "REC", rec_number: "A1", worker_licences: [], onboarding_status: "approved", is_active: true, approved_electricians: 1, piesa_rate: { id: "rate", rate_inc_gst: 999 } }];
  const flat = usualModule(async () => pricing.installerPaysOwnElectricians({ id: "a", name: "A", in_house: true, piesaIncGst: 350 }), candidates);
  expect(await flat.mittiElectricianForJob("j", null, [], "audit")).toMatchObject({ ready: true, priceIncGst: 350, reasons: [] });
  const ordinary = usualModule(async () => null, candidates);
  expect(await ordinary.mittiElectricianForJob("j", null, [], "audit")).toMatchObject({ ready: true, priceIncGst: 999, reasons: [] });
});
test("safety-check payout refuses a missing PIESA line, but keeps HIV electrician direct", async () => {
  const f = reads({ businesses: [{ id: "a", name: "A", in_house: true }], workflow_events: [{ job_id: "j", details: { choice: "usual" } }] });
  await expect(priceModule(f).safetyCheckPayeesFor([{ id: "j", originating_installer_business_id: "a" }])).rejects.toThrow("In-house partner has no PIESA rate on its rate card");
  const direct = reads({ businesses: [{ id: "a", name: "A", in_house: true }], workflow_events: [{ job_id: "j", details: { choice: "hivic" } }] });
  expect((await priceModule(direct).safetyCheckPayeesFor([{ id: "j", originating_installer_business_id: "a" }])).get("j")).toBeNull();
});
test("quote builder persists the exact missing-rate hold on an existing draft", async () => {
  const source = readFileSync("src/lib/installer-quote.server.ts", "utf8");
  const start = source.indexOf("  if (!draft.ready) {");
  const end = source.indexOf("  const installerPrice =", start);
  const code = ts.transpile(`async function run() {${source.slice(start, end)}}; exports.run=run;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
  const reason = "In-house partner has no PIESA rate on its rate card";
  const draft = { ready: false, blockers: [reason] };
  const updates: unknown[] = [];
  const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }), update: (patch: unknown) => { updates.push(patch); return { eq: () => ({ eq: async () => ({ error: null }) }) }; } }) };
  const exports: any = {};
  new Function("exports", "require", "draft", "mittiProduct", "mittiElectrician", "admin", "jobId", "actorId", "auditId", "logEvent", "open", "INSTALLER_QUOTE_CODE", "IN_HOUSE_PIESA_HOLD_REASON", code)(exports, () => { throw new Error("Unexpected import"); }, draft, null, { ready: false, reasons: [reason], needsProfile: false, notOnboarded: null }, admin, "j", null, "audit", async () => {}, [{ id: "q", status: "draft", option_code: "INSTALLER_A1" }], "INSTALLER_A1", reason);
  expect(await exports.run()).toEqual(draft);
  expect(updates).toEqual([{ release_state: "held", release_hold_reason: reason }]);
});
test("teaming propagates the configuration error before saving application or accepting", async () => {
  const source = readFileSync("src/lib/teaming.functions.ts", "utf8");
  const body = source.split("export const respondTeamInvite =")[1]?.split(".handler(async ({ data }) => {")[1]?.split("\n  });")[0];
  if (!body) throw new Error("Invite handler missing");
  const code = ts.transpile(`async function run(data) {${body}}; exports.run=run;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
  const writes: unknown[] = [];
  const d = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "app", status: "draft", data: {} } }) }) }) }), update: (value: unknown) => { writes.push(value); throw new Error("Unexpected save"); } }) };
  const exports: any = {};
  new Function("exports", "require", "byInvite", "inviteUsable", "sha256", "recData", code)(exports, () => ({ readInstallerPaidElectricians: async () => { throw new Error("configuration unavailable"); } }), async () => ({ d, n: { contact_name: "TEST", nominating_business_id: "a" } }), () => ({ ok: true }), async () => "hash", { parse: (x: unknown) => x });
  await expect(exports.run({ invite: "test", accept: true, recToken: "test" })).rejects.toThrow("configuration unavailable");
  expect(writes).toEqual([]);
});
test("trade money display survives both in-house reads throwing and matches non-in-house result", async () => {
  const source = readFileSync("src/lib/trade-view.server.ts", "utf8");
  const body = source.slice(source.indexOf("async function tradeMoneyRows("), source.indexOf("export async function partnerPayStates"));
  const code = ts.transpile(`${body}; exports.run=tradeMoneyRows;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
  const run = (throwRead: boolean, errors: unknown[]) => {
    const f = reads({ bookings: [{ id: "book", job_id: "j", kind: "installation", status: "completed", scheduled_start: "2026-10-30", jobs: { job_number: "HV-TEST", source: "qa_test", channel: "installer_sourced", owners: { full_name: "TEST Owner" }, properties: { suburb: "TEST" } } }] });
    const exports: any = {};
    const dependencies: Record<string, unknown> = {
      "./installer-paid-electricians.server": { readInstallerPaidElectricians: async () => { if (throwRead) throw new Error("read failed"); return null; }, safetyCheckPayeesFor: async () => { if (throwRead) throw new Error("read failed"); return new Map(); } },
      "./installer-led.core": { electricalBillingSource: () => "hivic" },
      "./trade-payout-gate.server": { payoutGateFacts: async () => new Map(), safetyVisitFacts: async () => new Map() },
      "./trade-payout-gate.core": { tradePayoutBlockers: () => [], safetyVisitPaidAt: () => null, visitGateFacts: () => null },
      "./trade-view.core": { ownerPaidInFullAt: () => null },
    };
    new Function("exports", "require", "admin", "console", "payState", "installerPayHeldReasons", "VISIT", "surname", code)(exports, (name: string) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; }, f.admin, { error: (...x: unknown[]) => errors.push(x) }, () => ({ kind: "checking" }), () => [], { installation: "Install" }, () => "Owner");
    return exports.run("a", "installer", true);
  };
  const errors: unknown[] = [];
  const normal = await run(false, []);
  expect(normal).toHaveLength(1);
  expect(await run(true, errors)).toEqual(normal);
  expect(errors).toHaveLength(2);
});