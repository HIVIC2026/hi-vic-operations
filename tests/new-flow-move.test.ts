import { expect, test } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { newFlowMoveBlockers, type NewFlowMoveFacts } from "../src/lib/new-flow-move.core";

const clear: NewFlowMoveFacts = { inHouse: false, officePhone: "03 9000 0000", email: "office@x.com.au", electricians: 1, piesaRateIncGst: 350, oldStepJobs: [] };

test("all clear gives no blockers", () => expect(newFlowMoveBlockers(clear)).toEqual([]));
test("each blocker on its own", () => {
  expect(newFlowMoveBlockers({ ...clear, inHouse: true })).toEqual(["Already on the new flow"]);
  expect(newFlowMoveBlockers({ ...clear, officePhone: null })).toEqual(["No office phone"]);
  expect(newFlowMoveBlockers({ ...clear, officePhone: "  " })).toEqual(["No office phone"]);
  expect(newFlowMoveBlockers({ ...clear, email: null })).toEqual(["No business email"]);
  expect(newFlowMoveBlockers({ ...clear, electricians: 0 })).toEqual(["No electrician in Team"]);
  expect(newFlowMoveBlockers({ ...clear, piesaRateIncGst: null })).toEqual(["No PIESA rate on the rate card"]);
  expect(newFlowMoveBlockers({ ...clear, piesaRateIncGst: 0 })).toEqual(["No PIESA rate on the rate card"]);
});
test("one line per old step that still has real jobs", () => {
  expect(newFlowMoveBlockers({ ...clear, oldStepJobs: [{ step: "owner picking Ready Check times", count: 2 }, { step: "owner confirming a run window", count: 1 }, { step: "x", count: 0 }] }))
    .toEqual(["2 real jobs still at: owner picking Ready Check times", "1 real job still at: owner confirming a run window"]);
});

// ---- server ----
type Row = Record<string, any>;
function load(deps: Record<string, unknown>) {
  const api: any = {};
  new Function("exports", "require", ts.transpile(readFileSync("src/lib/new-flow-move.server.ts", "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => {
    if (p === "./new-flow-move.core") return require("../src/lib/new-flow-move.core");
    if (p === "./in-house.core") return require("../src/lib/in-house.core");
    if (!(p in deps)) throw Error(`Unmocked ${p}`);
    return deps[p];
  });
  return api;
}
function fixture(o: { admin?: boolean; inHouse?: boolean; oldJobs?: number; phone?: string | null; mittiInvited?: boolean } = {}) {
  const rpcCalls: any[] = []; const events: Row[] = [];
  const biz = { id: "b1", name: "INSolation", in_house: o.inHouse ?? false, phone: o.phone === undefined ? "03 9000 0000" : o.phone, email: "o@x.com.au" };
  const admin: any = {
    rpc: async (name: string, args: any) => {
      if (name === "has_role") return { data: o.admin ?? true, error: null };
      rpcCalls.push({ name, args }); return { error: null };
    },
    from: (t: string) => {
      if (t === "businesses") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: biz, error: null }) }) }) };
      if (t === "rate_cards") return { select: () => ({ eq: () => ({ eq: () => ({ lte: () => ({ order: () => ({ range: async () => ({ data: [{ id: "c1" }], error: null }) }) }) }) }) }) };
      if (t === "rate_card_items") return { select: () => ({ in: () => ({ ilike: () => ({ order: () => ({ range: async () => ({ data: [{ unit_price_ex_gst: 318.18 }], error: null }) }) }) }) }) };
      if (t === "admin_config_events") return { insert: async (r: Row) => { events.push(r); return { error: null }; } };
      throw Error("unexpected table " + t);
    },
  };
  const deps = {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "./workflow.server": { WorkflowError: class extends Error {} },
    "./installer-paid-electricians.server": { inHouseFactsFor: async () => ({ approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 1, mittiAccountInvited: o.mittiInvited ?? true }) },
    "./old-flow-inflight.server": { oldStepJobs: async (id: string) => { expect(id).toBe("b1"); return [{ step: "owner picking Ready Check times", count: o.oldJobs ?? 0, jobNumbers: [] }, { step: "owner confirming a run window", count: 0, jobNumbers: [] }]; } },
    "@/lib/melbourne-time.core": {}, "./melbourne-time.core": { melbourneToday: () => "2026-11-03" },
  };
  return { api: load(deps), rpcCalls, events };
}
test("a clear business is moved once, with one history row", async () => {
  const f = fixture();
  expect(await f.api.moveInstallerToNewFlow("b1", "u1")).toEqual({ moved: true });
  expect(f.rpcCalls).toEqual([{ name: "save_in_house_partner", args: { p_business_id: "b1", p_in_house: true, p_rectification_billed_by: null, p_actor_id: "u1" } }]);
  expect(f.events).toHaveLength(1);
  expect(f.events[0]).toMatchObject({ actor_id: "u1", event_type: "new_flow_moved" });
});
test("already moved: refused, no second call", async () => {
  const f = fixture({ inHouse: true });
  expect(await f.api.moveInstallerToNewFlow("b1", "u1")).toEqual({ moved: false, blockers: ["Already on the new flow"] });
  expect(f.rpcCalls).toHaveLength(0); expect(f.events).toHaveLength(0);
});
test("real jobs at an old step: refused with the line", async () => {
  const f = fixture({ oldJobs: 2 });
  expect(await f.api.moveInstallerToNewFlow("b1", "u1")).toEqual({ moved: false, blockers: ["2 real jobs still at: owner picking Ready Check times"] });
  expect(f.rpcCalls).toHaveLength(0);
});
test("non-admin throws and does nothing", async () => {
  const f = fixture({ admin: false });
  await expect(f.api.moveInstallerToNewFlow("b1", "u1")).rejects.toThrow("Only the office can change this.");
  expect(f.rpcCalls).toHaveLength(0);
});
test("preview (dry run) reads the same facts and never writes", async () => {
  const f = fixture({ phone: null });
  const r = await f.api.previewNewFlowMove("b1");
  expect(r.blockers).toEqual(["No office phone"]);
  expect(r.name).toBe("INSolation");
  expect(f.rpcCalls).toHaveLength(0); expect(f.events).toHaveLength(0);
});
test("the existing set-up checks (Mitti etc.) also block the move", async () => {
  const f = fixture({ mittiInvited: false });
  const r = await f.api.moveInstallerToNewFlow("b1", "u1");
  expect(r).toEqual({ moved: false, blockers: ["Mitti account not invited"] });
  expect(f.rpcCalls).toHaveLength(0);
});

test("the move script is a dry run unless --apply, and the office button lists blockers", () => {
  const script = readFileSync("scripts/move-installer-to-new-flow.ts", "utf8");
  expect(script).toContain('process.argv.includes("--apply")');
  expect(script.indexOf("DRY RUN")).toBeLessThan(script.indexOf("moveInstallerToNewFlow(businessId"));
  const page = readFileSync("src/routes/_authenticated/admin.partners_.business.$businessId.tsx", "utf8");
  expect(page).toContain("Move to the new flow");
  expect(page).toContain("data-new-flow-move-blockers");
  expect(readFileSync("src/lib/owner-link.functions.ts", "utf8")).not.toContain("ownerChangeReadyCheckFn");
});
test("server function is a literal chain with the auth middleware", () => {
  const f = readFileSync("src/lib/new-flow-move.functions.ts", "utf8");
  expect(f).toMatch(/moveInstallerToNewFlowFn = createServerFn\(\{ method: "POST" \}\)\s*\.middleware\(\[requireSupabaseAuth\]\)\s*\.inputValidator/);
  expect(f).not.toContain("@tanstack/react-start/server");
});
