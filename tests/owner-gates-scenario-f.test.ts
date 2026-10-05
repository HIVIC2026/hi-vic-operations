// Scenario F: every journey must pass owner paperwork gates A–D with signed records. Pure evaluator, same rule the server uses.
import { describe, expect, test } from "bun:test";
import { evaluateOwnerGates, ownerGateBlockers, gatesForStage, type GateFacts, type GateDocKey } from "../src/lib/owner-gates.core";

const base = (o: Partial<GateFacts> = {}): GateFacts => ({ isTest: true, signed: [], approved: {}, tenant: false, lifeSupport: false, visitedByInstaller: false, hasQuote: false,
  agreementSigned: false, agreementWordingApproved: true, escConsentSigned: false, piesaCopyDelivered: false, piesaDeclarationMappingApproved: false, assignmentEffective: false, ...o });
const sign = (...k: GateDocKey[]) => k.map((key) => ({ key, version: "draft-1", draft: true }));
const A = ["contact_privacy", "trade_contact_share", "details_confirmation", "life_support_answer"] as GateDocKey[];
const blocked = (f: GateFacts, stage: string) => ownerGateBlockers(evaluateOwnerGates(f), stage);

const JOURNEYS: { name: string; f: Partial<GateFacts>; extraA: GateDocKey[]; firstVisit: string }[] = [
  { name: "Web lead", f: {}, extraA: [], firstVisit: "ready_check_scheduled" },
  { name: "Installer single job", f: {}, extraA: [], firstVisit: "ready_check_scheduled" },
  { name: "Bulk Journey 1 (not visited)", f: {}, extraA: [], firstVisit: "ready_check_scheduled" },
  { name: "Bulk Journey 2 (visited/quoted)", f: { visitedByInstaller: true }, extraA: ["visit_permission"], firstVisit: "piesa_scheduled" },
  { name: "Tenant with landlord", f: { tenant: true }, extraA: ["tenancy_details", "landlord_consent"], firstVisit: "ready_check_scheduled" },
  { name: "Life support", f: { lifeSupport: true }, extraA: [], firstVisit: "ready_check_scheduled" },
];

describe("Scenario F — owner paperwork gates", () => {
  for (const j of JOURNEYS) {
    test(`${j.name}: blocked at every gate until each record is signed`, () => {
      // Gate A
      expect(blocked(base(j.f), j.firstVisit).length).toBeGreaterThan(0);
      for (const missing of [...A, ...j.extraA]) expect(blocked(base({ ...j.f, signed: sign(...[...A, ...j.extraA].filter((k) => k !== missing)) }), j.firstVisit).some((b) => b.includes("Owner paperwork A"))).toBe(true);
      const aDone = sign(...A, ...j.extraA);
      expect(blocked(base({ ...j.f, signed: aDone }), "ready_check_scheduled")).toEqual([]);
      // Gate B
      const bStage = "awaiting_deposit_payment";
      expect(blocked(base({ ...j.f, signed: aDone, hasQuote: true }), bStage).length).toBe(3);
      expect(blocked(base({ ...j.f, signed: [...aDone, ...sign("cooling_off_notice", "payment_terms")], hasQuote: true }), bStage)).toEqual(["Owner paperwork B: Customer agreement + consumer rights not signed yet."]);
      const bDone = { ...j.f, signed: [...aDone, ...sign("cooling_off_notice", "payment_terms")], hasQuote: true, agreementSigned: true };
      expect(blocked(base(bDone), bStage)).toEqual([]);
      // Gate C
      const cStage = "evidence_outstanding";
      expect(blocked(base(bDone), cStage).length).toBe(j.f.lifeSupport ? 3 : 2);
      const cDone = { ...bDone, escConsentSigned: true, piesaCopyDelivered: true, signed: [...bDone.signed, ...sign("life_support_plan")] };
      expect(blocked(base(cDone), cStage)).toEqual([]);
      // Gate D
      expect(blocked(base(cDone), "ready_for_veec")).toEqual(["Owner paperwork D: Final VEEC assignment not signed yet."]);
      expect(blocked(base({ ...cDone, assignmentEffective: true }), "ready_for_veec")).toEqual([]);
    });
  }
  test("Life support plan only required when life support applies", () => {
    expect(evaluateOwnerGates(base()).find((g) => g.gate === "C")!.items.some((i) => i.key === "life_support_plan")).toBe(false);
    expect(evaluateOwnerGates(base({ lifeSupport: true })).find((g) => g.gate === "C")!.items.some((i) => i.key === "life_support_plan")).toBe(true);
  });
  test("DRAFT wording: allowed on TEST jobs, blocks real jobs even when signed", () => {
    const f = { signed: sign(...A) };
    expect(blocked(base({ ...f, isTest: true }), "ready_check_scheduled")).toEqual([]);
    expect(blocked(base({ ...f, isTest: false }), "ready_check_scheduled").every((b) => b.includes("DRAFT"))).toBe(true);
    expect(blocked(base({ ...f, isTest: false, approved: Object.fromEntries(A.map((k) => [k, "draft-1"])), signed: A.map((key) => ({ key, version: "draft-1", draft: false })) }), "ready_check_scheduled")).toEqual([]);
  });
  test("PIESA owner declaration only joins Gate C once the Mitti mapping is approved", () => {
    expect(evaluateOwnerGates(base({ piesaDeclarationMappingApproved: true })).find((g) => g.gate === "C")!.items.some((i) => i.key === "piesa_owner_declaration")).toBe(true);
  });
  test("every visit and booking stage requires Gate A", () => {
    for (const s of ["ready_check_scheduled", "assessment_booked", "piesa_scheduled", "rectification_booked", "installation_booked", "evidence_outstanding"]) expect(gatesForStage(s)).toContain("A");
  });
});
