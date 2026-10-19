// Brief X — regression: the PIESA stage move must never strand offers, and a stranded allocation must
// self-heal when the electrician accepts. Pure rules + source invariants only: no network, no DB, no providers.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gatesForStage, ownerGateBlockers, ownerStageGateBlockers, type GateResult } from "../src/lib/owner-gates.core";

// Resolve source paths from THIS test file, not the process cwd: bun may be invoked from a parent directory.
const srcText = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const gate = (g: "A" | "B" | "C" | "D", complete: boolean, blockers: string[] = []): GateResult =>
  ({ gate: g, label: g, items: [], complete, blockers });

const STAGE = "piesa_and_install_window_pending";

describe("Brief X — qa_test owner-paperwork exemption", () => {
  test("the PIESA stage requires owner paperwork A and B (the rule the qa_test job tripped over)", () => {
    expect(gatesForStage(STAGE).sort()).toEqual(["A", "B"]);
  });

  test("a real job with Gate B unfinished is still blocked, with the gate's own wording", () => {
    const gates = [gate("A", true), gate("B", false, ["Owner paperwork B: The agreement not signed yet."])];
    expect(ownerStageGateBlockers(gates, STAGE, false)).toEqual(["Owner paperwork B: The agreement not signed yet."]);
  });

  test("a synthetic qa_test job is not blocked by owner paperwork", () => {
    const gates = [gate("A", true), gate("B", false, ["Owner paperwork B: The agreement not signed yet."])];
    expect(ownerStageGateBlockers(gates, STAGE, true)).toEqual([]);
  });

  test("for real jobs the wrapper is exactly the base rule — nothing is silently relaxed", () => {
    const gates = [gate("A", false, ["a"]), gate("B", false, ["b"]), gate("C", false, ["c"])];
    expect(ownerStageGateBlockers(gates, STAGE, false)).toEqual(ownerGateBlockers(gates, STAGE));
  });

  test("a complete real job yields no owner-paperwork blockers", () => {
    const gates = [gate("A", true), gate("B", true)];
    expect(ownerStageGateBlockers(gates, STAGE, false)).toEqual([]);
  });
});

describe("Brief X — the PIESA stage move never strands offers", () => {
  const src = srcText("../src/lib/allocation.server.ts");

  test("startPiesaAllocation withdraws the offers it just made when the stage move fails", () => {
    const fn = src.split("export async function startPiesaAllocation")[1]!.split("async function offerNextBatch")[0]!;
    expect(fn).toMatch(/catch\s*\(e\)/);
    expect(fn).toMatch(/status:\s*"withdrawn"/);
    expect(fn).toMatch(/throw e;/);
    // the withdrawal runs before the error leaves the function (i.e. it is inside the catch, not dead code)
    expect(fn.indexOf('throw e;')).toBeGreaterThan(fn.indexOf('status: "withdrawn"'));
  });

  test("accepting an offer self-heals a job stranded at measured_quote_accepted, before the accept RPC", () => {
    const fn = src.split("export async function respondToRecOffer")[1]!.split("/** Contacts for the caller")[0]!;
    const healStage = fn.indexOf('"measured_quote_accepted"');
    const targetStage = fn.indexOf('"piesa_and_install_window_pending"');
    const acceptRpc = fn.indexOf('admin.rpc("accept_partner_offer"');
    expect(healStage).toBeGreaterThan(-1);
    expect(targetStage).toBeGreaterThan(healStage);
    expect(acceptRpc).toBeGreaterThan(targetStage);
    // the self-heal goes through the guarded transition (never a raw jobs.update of stage)
    expect(fn.slice(healStage, acceptRpc)).toContain("transition(");
    expect(fn.slice(healStage, acceptRpc)).not.toMatch(/update\(\{[^}]*\bstage\s*:/);
  });
});

describe("Brief X — the exemption lives in exactly one place", () => {
  test("the server wrapper delegates to the pure rule instead of re-implementing it", () => {
    const src = srcText("../src/lib/owner-gates.server.ts");
    expect(src).toContain("ownerStageGateBlockers(gates, to, facts.isTest)");
    expect(src).not.toContain("ownerGateBlockers(gates, to)");
  });
});
