import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as advance from "../src/lib/autoadvance.core";
import * as inHouse from "../src/lib/in-house.core";
import * as upgradesBilling from "../src/lib/upgrades-billing.core";

// Actual fact reader, billing resolver and planner; no hosted reads or providers.
function fixture(in_house: boolean, billing = "partner", fail = false, stage = "piesa_complete", open = 1) {
  let dispatchReads = 0;
  const errors: unknown[] = [];
  const admin = { from(table: string) {
    let kind = "", single = false;
    const q: any = { select: () => q, eq: (k: string, value: string) => { if (k === "kind") kind = value; return q; }, not: () => q, in: () => q,
      single: () => { single = true; return q; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null,
        data: table === "jobs" ? { stage, channel: "hivic_sourced" } : single && table === "job_assignments" ? { businesses: { in_house, rectification_billed_by: billing } } : null,
        count: table === "rectification_items" ? open : table === "quotes" && kind === "installation" ? 1 : 0 }).then(resolve) };
    return q;
  } };
  const deps: Record<string, any> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "./workflow.server": { agreementSigned: async () => true, paymentOptionCleared: async () => true },
    "./quotes.server": {}, "./eligibility.core": { eligibilityConfirmedFor: () => true }, "./eligibility.server": { todayMelbourne: () => "2026-10-30" },
    "./autoadvance.core": advance, "./in-house.core": inHouse, "./upgrades-billing.core": upgradesBilling,
    "./electrical-clearance.server": { onsiteStartOnlyFor: async () => false },
    "./fixes-quote-current.server": { currentFixesQuote: async () => null },
    "./in-house-suppression.server": { readInHouseDispatchState: async () => { dispatchReads++; return { failed: fail, held: new Set(in_house ? ["j"] : []) }; } },
  };
  function load(name: string): any {
    const output = {};
    new Function("exports", "require", "console", ts.transpile(readFileSync(`src/lib/${name}.ts`, "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(output,
      (path: string) => { if (path in deps) return deps[path]; if (path === "./in-house-rectification.server") return load("in-house-rectification.server"); throw new Error(`Unexpected dependency ${path}`); },
      { error: (...args: unknown[]) => errors.push(args) });
    return output;
  }
  return { api: load("autoadvance.server"), reads: () => dispatchReads, errors };
}

// Part 3 Task 1 (Jo 2 Nov 2026): the electrician bills the upgrades on EVERY job, so the in-house "partner books the
// rectification" advance is now every job's advance: PIESA complete with open upgrades → rectification_scheduling, with
// no partner read and no dependence on in_house / rectification_billed_by.
test("real advance facts unlock the upgrades scheduling for every job with open items", async () => {
  for (const [held, billing] of [[true,"partner"], [true,"hivic"], [false,"partner"], [false,"hivic"]] as const) {
    const f = fixture(held, billing);
    const facts = await f.api.loadAdvanceFacts("j");
    expect(facts.partnerBilledRectification).toBe(true);
    expect(advance.planStep("piesa_complete", facts)).toMatchObject({ kind: "transition", to: "rectification_scheduling" });
    expect(f.reads()).toBe(0);
    expect(f.errors).toHaveLength(0);
  }
});

test("a failed partner read can no longer hold the job (nothing is read); unrelated stages/items never read partner billing", async () => {
  const f = fixture(true, "partner", true);
  expect(advance.planStep("piesa_complete", await f.api.loadAdvanceFacts("j"))).toMatchObject({ kind: "transition", to: "rectification_scheduling" });
  expect(f.errors).toHaveLength(0);
  for (const [stage, open] of [["installation_scheduling",1], ["piesa_complete",0]] as const) {
    const lazy = fixture(true, "partner", false, stage, open);
    const facts = await lazy.api.loadAdvanceFacts("j");
    expect(lazy.reads()).toBe(0);
    if (open === 0) expect(advance.planStep("piesa_complete", facts)).toMatchObject({ kind: "transition", to: "installation_scheduling" });
  }
});
