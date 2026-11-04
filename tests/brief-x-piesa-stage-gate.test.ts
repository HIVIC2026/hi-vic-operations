// Brief X — regression: the PIESA stage move must never strand offers, and a stranded allocation must
// self-heal when the electrician accepts. Pure rules + source invariants only: no network, no DB, no providers.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gateItemBlocker, gatesForStage, ownerGateBlockers, type GateResult } from "../src/lib/owner-gates.core";

// Resolve source paths from THIS test file, not the process cwd: bun may be invoked from a parent directory.
const srcText = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const gate = (g: "A" | "B" | "C" | "D", complete: boolean, blockers: string[] = []): GateResult =>
  ({ gate: g, label: g, items: [], complete, blockers });

const STAGE = "piesa_and_install_window_pending";

// The qa_test owner-paperwork STAGE exemption (main #123, `ownerStageGateBlockers`) was superseded on the joined branch
// (join ruling J4 G4, 4 Nov 2026): a TEST job signs the same paperwork as a real one through the TEST business; the only
// TEST allowance is at item level (`gateItemBlocker`: a draft template is accepted on a qa_test job). Those pins are gone;
// the stage rule stays exactly the base rule for every job.
describe("Brief X — owner paperwork gates for the PIESA stage (no TEST stage bypass since the join)", () => {
  test("the PIESA stage requires owner paperwork B (Gate A has no required items since Jo 21 Oct 2026)", () => {
    expect(gatesForStage(STAGE).sort()).toEqual(["B"]);
  });

  test("a job with Gate B unfinished is blocked, with the gate's own wording; a complete job yields none", () => {
    const gates = [gate("A", true), gate("B", false, ["Owner paperwork B: The agreement not signed yet."])];
    expect(ownerGateBlockers(gates, STAGE)).toEqual(["Owner paperwork B: The agreement not signed yet."]);
    expect(ownerGateBlockers([gate("A", true), gate("B", true)], STAGE)).toEqual([]);
  });

  test("a qa_test job's only allowance is a DRAFT template at item level — a signed item is still needed", () => {
    expect(gateItemBlocker("B", { key: "x", label: "The agreement", done: false, draft: false, note: null } as never, true)).toMatch(/not signed yet/);
    expect(gateItemBlocker("B", { key: "x", label: "The agreement", done: true, draft: true, note: null } as never, true)).toBeNull();
    expect(gateItemBlocker("B", { key: "x", label: "The agreement", done: true, draft: true, note: null } as never, false)).not.toBeNull();
  });
});

describe("Brief X — the PIESA stage move never strands offers", () => {
  const src = srcText("../src/lib/allocation.server.ts");

  test("startPiesaAllocation checks the job can ENTER the PIESA stage before any offer goes out (nothing to withdraw afterwards)", () => {
    const fn = src.split("export async function startPiesaAllocation")[1]!.split("async function offerNextBatch")[0]!;
    const entryCheck = fn.indexOf('stageEntryBlockers(jobId, "piesa_and_install_window_pending"');
    const offers = fn.indexOf("await offerNextBatch(");
    expect(entryCheck).toBeGreaterThan(-1);
    expect(offers).toBeGreaterThan(entryCheck);
    expect(fn.slice(entryCheck, offers)).toMatch(/if \(entry\.length\) throw new WorkflowError/);
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

describe("Brief X — the stage rule lives in exactly one place", () => {
  test("the server wrapper delegates to the pure rule instead of re-implementing it", () => {
    const src = srcText("../src/lib/owner-gates.server.ts");
    expect(src).toContain("ownerGateBlockers((await ownerGates(jobId)).gates, to)");
    expect(src).not.toContain("ownerStageGateBlockers");
  });
});
