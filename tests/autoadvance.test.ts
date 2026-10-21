import { describe, expect, test } from "bun:test";
import { runAutoAdvance, planStep, type AdvanceFacts, type AdvanceDeps } from "../src/lib/autoadvance.core";
import { PIPELINE_PHASES, phaseForStage, STAGE_ORDER, EXCEPTION_STAGES, waitingOn, type Stage } from "../src/lib/workflow";

const base: AdvanceFacts = { eligibilityConfirmed: false, electricianAssigned: false, assessmentBookingConfirmed: false, openRectItems: 0, rectQuoteIssued: false, rectQuoteAccepted: false, installQuotesIssued: false, installQuoteAccepted: false, consumerSigned: false, invoiceExists: false, depositCleared: false, rectBookingConfirmed: false, installBookingConfirmed: false, installationCompleted: false, installerDeclarationSigned: false, veecLodged: false };

function fake(start: Stage, facts: Partial<AdvanceFacts>, o: { blockers?: (to: Stage) => string[]; gen?: () => void; site?: boolean } = {}) {
  let stage = start; const f = { ...base, ...facts }; const log: string[] = []; let genCalls = 0;
  const deps: AdvanceDeps = {
    getStage: async () => stage,
    facts: async () => f,
    blockers: async (to) => {
      const b = o.blockers?.(to) ?? [];
      if (to === "awaiting_quote_acceptance" && !f.installQuotesIssued) b.push("No installation quotes issued.");
      return b;
    },
    transition: async (to, s) => { log.push(`${stage}->${to}:${s}`); stage = to; },
    generateQuotes: async () => { genCalls++; o.gen?.(); f.installQuotesIssued = true; },
    completeSite: async () => { if (!o.site) return false; stage = "ready_for_installer_quotes"; return true; },
  };
  return { deps, log, f, gens: () => genCalls };
}

describe("pipeline phases", () => {
  test("every detailed stage maps to exactly one visible phase", () => {
    for (const s of STAGE_ORDER) expect(PIPELINE_PHASES.filter((p) => p.stages.includes(s)).length).toBe(1);
    for (const s of EXCEPTION_STAGES) expect(phaseForStage(s)).toBe("exceptions");
  });
  test("specific mappings", () => {
    expect(phaseForStage("eligibility_review")).toBe("enquiries");
    expect(phaseForStage("assessment_booked")).toBe("site_assessment");
    expect(phaseForStage("awaiting_quote_acceptance")).toBe("quote_approval");
    expect(phaseForStage("assessment_complete")).toBe("quote_approval");
    expect(phaseForStage("awaiting_deposit_payment")).toBe("deposit");
    expect(phaseForStage("rectification_booked")).toBe("rectification");
    expect(phaseForStage("installation_booked")).toBe("installation");
    expect(phaseForStage("ap_review")).toBe("evidence_ap_veec");
    expect(phaseForStage("complete")).toBe("complete");
  });
  test("waiting-on signal", () => {
    expect(waitingOn("awaiting_quote_acceptance")).toBe("Owner");
    expect(waitingOn("awaiting_deposit_payment")).toBe("Payment / Xero");
    expect(waitingOn("ap_review")).toBe("AP");
    expect(waitingOn("complete")).toBeNull();
  });
});

describe("autoAdvance", () => {
  test("blockers stop progression", async () => {
    const x = fake("awaiting_deposit_payment", { depositCleared: true }, { blockers: () => ["PIESA 30-day window expired"] });
    const r = await runAutoAdvance(x.deps);
    expect(r.to).toBe("awaiting_deposit_payment");
    expect(r.stoppedBecause).toContain("PIESA");
  });
  test("retired assessment_booked never auto-advances, even with complete site requirements", async () => {
    const x = fake("assessment_booked", {}, { site: true });
    const r = await runAutoAdvance(x.deps);
    expect(r.to).toBe("assessment_booked");
    expect(x.gens()).toBe(0);
    expect(r.stoppedBecause).toContain("Retired legacy stage");
  });
  test("missing rate-card config stops safely at ready_for_installer_quotes", async () => {
    const x = fake("ready_for_installer_quotes", {}, { gen: () => { throw new Error("No active installer rate card"); } });
    const r = await runAutoAdvance(x.deps);
    expect(r.to).toBe("ready_for_installer_quotes");
    expect(r.stoppedBecause).toContain("rate card");
  });
  test("pre-generation blockers prevent quote generation", async () => {
    const x = fake("ready_for_installer_quotes", {}, { blockers: () => ["No current PIESA record."] });
    const r = await runAutoAdvance(x.deps);
    expect(x.gens()).toBe(0);
    expect(r.to).toBe("ready_for_installer_quotes");
  });
  test("deposit cleared routes to rectification or installation", async () => {
    const a = fake("awaiting_deposit_payment", { depositCleared: true, openRectItems: 2 });
    expect((await runAutoAdvance(a.deps)).to).toBe("rectification_scheduling");
    const b = fake("awaiting_deposit_payment", { depositCleared: true });
    expect((await runAutoAdvance(b.deps)).to).toBe("installation_scheduling");
    const c = fake("awaiting_deposit_payment", {});
    expect((await runAutoAdvance(c.deps)).to).toBe("awaiting_deposit_payment");
  });
  test("evidence + declarations -> ap_review but never ready_for_veec automatically", async () => {
    const x = fake("evidence_outstanding", { installationCompleted: true, installerDeclarationSigned: true });
    const r = await runAutoAdvance(x.deps);
    expect(r.to).toBe("ap_review");
    expect(r.stoppedBecause).toContain("Final check");
  });
  test("missing evidence keeps job in evidence_outstanding", async () => {
    const x = fake("evidence_outstanding", { installationCompleted: true, installerDeclarationSigned: true }, { blockers: (to) => to === "ap_review" ? ["Evidence missing: Completed installation"] : [] });
    expect((await runAutoAdvance(x.deps)).to).toBe("evidence_outstanding");
  });
  test("compliance actions never move a job out of AP review", async () => {
    const x = fake("ap_review", {});
    expect((await runAutoAdvance(x.deps)).to).toBe("ap_review"); // final approval only in the AP queue
    const y = fake("ap_review", {}, { blockers: () => ["Compliance not passed: Eligibility"] });
    expect((await runAutoAdvance(y.deps)).to).toBe("ap_review");
  });
  test("VEEC submitted -> complete", async () => {
    const x = fake("ready_for_veec", { veecLodged: true });
    expect((await runAutoAdvance(x.deps)).to).toBe("complete");
  });
  test("on_hold / cancelled / complete never progress", async () => {
    for (const s of ["on_hold", "cancelled", "complete"] as Stage[]) {
      const x = fake(s, { ...base, depositCleared: true, veecLodged: true, eligibilityConfirmed: true });
      const r = await runAutoAdvance(x.deps);
      expect(r.to).toBe(s); expect(x.log).toHaveLength(0);
    }
  });
  test("human decisions are never automated", () => {
    expect(planStep("eligibility_review", base).kind).toBe("stop");
    expect(planStep("awaiting_electrician", base).kind).toBe("stop");
    expect(planStep("awaiting_quote_acceptance", { ...base, installQuoteAccepted: true }).kind).toBe("stop"); // not signed
    expect(planStep("awaiting_owner_rectification_approval", base).kind).toBe("stop");
    expect(planStep("ap_review", base).kind).toBe("stop");
  });
  test("idempotent: second run does nothing", async () => {
    const x = fake("awaiting_deposit_payment", { depositCleared: true });
    await runAutoAdvance(x.deps);
    const n = x.log.length;
    const r = await runAutoAdvance(x.deps);
    expect(x.log.length).toBe(n); expect(r.steps).toHaveLength(0);
  });
});

import { evaluateGate1, type Gate1Facts } from "../src/lib/eligibility.core";
const g: Gate1Facts = { state: "VIC", postcode: "3056", occupancy: "owner_occupied", isResidential: true, yearBuilt: 1990, yearBuiltVerified: true, minBuildingAgeYears: 5, lifeSupportStatus: "no", previousCeilingUpgrade: false, flatRoofOrAccessConcern: false, preliminaryOutcome: null, currentYear: 2026, declaredInsulation: "none" };
describe("Gate 1 auto-decision", () => {
  test("clear facts auto-pass", () => expect(evaluateGate1(g).outcome).toBe("likely_eligible"));
  test("hard rules auto-fail", () => {
    expect(evaluateGate1({ ...g, state: "NSW" }).outcome).toBe("does_not_appear_eligible");
    expect(evaluateGate1({ ...g, postcode: "2000" }).outcome).toBe("does_not_appear_eligible");
    expect(evaluateGate1({ ...g, isResidential: false }).outcome).toBe("does_not_appear_eligible");
    expect(evaluateGate1({ ...g, yearBuilt: 2025 }).outcome).toBe("does_not_appear_eligible");
  });
  test.skip("RETIRED (simple Gate 1, 4 Oct 2026) – ambiguous facts -> human review", () => {
    for (const f of [{ isResidential: null }, { yearBuiltVerified: false }, { state: null }])
      expect(evaluateGate1({ ...g, ...f } as Gate1Facts).outcome).toBeNull();
  });
  test.skip("RETIRED (simple Gate 1, 4 Oct 2026) – unverified young building is review, not fail", () => expect(evaluateGate1({ ...g, yearBuilt: 2025, yearBuiltVerified: false }).outcome).toBeNull());
  test.skip("RETIRED (simple Gate 1, 4 Oct 2026) – preliminary alone never passes; conflicting preliminary -> review", () => {
    expect(evaluateGate1({ ...g, isResidential: null, yearBuilt: null, yearBuiltVerified: false, preliminaryOutcome: "likely_eligible" }).outcome).toBeNull();
    expect(evaluateGate1({ ...g, preliminaryOutcome: "needs_onsite_confirmation" }).rules.find((r) => r.key === "preliminary")?.result).toBe("info");
  });
  test("auto-pass waits for the owner to save their spot (Jo, 8 Oct)", async () => {
    const x = fake("new_enquiry", { eligibilityConfirmed: true, electricianAssigned: false });
    expect((await runAutoAdvance(x.deps)).to).toBe("preliminary_estimate_ready");
  });
});
