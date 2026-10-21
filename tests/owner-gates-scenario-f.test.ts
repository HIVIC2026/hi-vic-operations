// Scenario F: every journey must pass owner paperwork gates A–D with signed records. Pure evaluator, same rule the server uses.
import { describe, expect, test } from "bun:test";
import { evaluateOwnerGates, ownerGateBlockers, gatesForStage, type GateFacts, type GateDocKey } from "../src/lib/owner-gates.core";

const base = (o: Partial<GateFacts> = {}): GateFacts => ({ isTest: true, signed: [], approved: {}, tenant: false, lifeSupport: false, visitedByInstaller: false, hasQuote: false,
  agreementSigned: false, agreementWordingApproved: true, escConsentSigned: false, piesaCopyDelivered: false, piesaDeclarationMappingApproved: false, assignmentEffective: false, ...o });
const sign = (...k: GateDocKey[]) => k.map((key) => ({ key, version: "draft-1", draft: true }));
const A: GateDocKey[] = [];
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
      // Jo 21 Oct: no paperwork before any visit (Gate A retired).
      expect(blocked(base(j.f), j.firstVisit)).toEqual([]);
      const aDone = sign(...j.extraA);
      // Gate B
      const bStage = "awaiting_deposit_payment";
      expect(blocked(base({ ...j.f, signed: aDone, hasQuote: true }), bStage).length).toBe(4);
      expect(blocked(base({ ...j.f, signed: [...aDone, ...sign("quote_acceptance", "veec_assignment_consent", "payment_terms")], hasQuote: true }), bStage)).toEqual(["Owner paperwork B: Customer agreement + consumer rights not signed yet."]);
      const bDone = { ...j.f, signed: [...aDone, ...sign("quote_acceptance", "veec_assignment_consent", "payment_terms")], hasQuote: true, agreementSigned: true };
      expect(blocked(base(bDone), bStage)).toEqual([]);
      // Gate C
      const cStage = "evidence_outstanding";
      expect(blocked(base(bDone), cStage).length).toBe(j.f.lifeSupport ? 4 : 3);
      const cDone = { ...bDone, escConsentSigned: true, piesaCopyDelivered: true, signed: [...bDone.signed, ...sign("piesa_copy_receipt", "life_support_plan")] };
      expect(blocked(base(cDone), cStage)).toEqual([]);
      // Gate D
      expect(blocked(base(cDone), "ready_for_veec")).toEqual(["Owner paperwork D: Completed VEEC assignment form (effective after install) not signed yet."]);
      expect(blocked(base({ ...cDone, assignmentEffective: true }), "ready_for_veec")).toEqual([]);
    });
  }
  test("Gate B requires the owner's VEEC assignment at quote acceptance", () => {
    const f = base({ signed: [...sign(...A), ...sign("quote_acceptance", "payment_terms")], hasQuote: true, agreementSigned: true });
    expect(blocked(f, "awaiting_deposit_payment")).toEqual(["Owner paperwork B: Your rebate (VEEC assignment) not signed yet."]);
  });
  test("Life support plan only required when life support applies", () => {
    expect(evaluateOwnerGates(base()).find((g) => g.gate === "C")!.items.some((i) => i.key === "life_support_plan")).toBe(false);
    expect(evaluateOwnerGates(base({ lifeSupport: true })).find((g) => g.gate === "C")!.items.some((i) => i.key === "life_support_plan")).toBe(true);
  });
  test("DRAFT wording: allowed on TEST jobs, blocks real jobs even when signed", () => {
    const keys: GateDocKey[] = ["quote_acceptance", "veec_assignment_consent", "payment_terms"];
    const f = { signed: sign(...keys), hasQuote: true, agreementSigned: true };
    expect(blocked(base({ ...f, isTest: true }), "awaiting_deposit_payment")).toEqual([]);
    expect(blocked(base({ ...f, isTest: false }), "awaiting_deposit_payment").every((b) => b.includes("DRAFT"))).toBe(true);
  });
  test("PIESA owner declaration only joins Gate C once the Mitti mapping is approved", () => {
    expect(evaluateOwnerGates(base({ piesaDeclarationMappingApproved: true })).find((g) => g.gate === "C")!.items.some((i) => i.key === "piesa_owner_declaration")).toBe(true);
  });
  test("no visit or booking stage requires Gate A; tenancy and earlier visit sit in Gate B; no cooling-off item (Jo 21 Oct)", () => {
    for (const s of ["ready_check_scheduled", "assessment_booked", "piesa_scheduled", "rectification_booked", "installation_booked", "evidence_outstanding", "ready_for_veec"]) expect(gatesForStage(s)).not.toContain("A");
    const g = evaluateOwnerGates(base({ tenant: true, visitedByInstaller: true }));
    expect(g.find((x) => x.gate === "A")!.items).toEqual([]);
    expect(g.find((x) => x.gate === "B")!.items.map((i) => i.key)).toEqual(["customer_agreement", "quote_acceptance", "veec_assignment_consent", "payment_terms", "tenancy_details", "landlord_consent", "visit_permission"]);
  });
});

import { GATE_DOCS as __DOCS } from "../src/lib/owner-gates.core";
test("lawyer-approved wording (6 Oct) is versioned and noted; cooling-off stays pending", () => {
  const d = __DOCS.find((x) => x.key === "veec_assignment_consent")!;
  expect(d.version).toBe("lawyer-2026-10-06-v1");
  expect(d.approvalNote).toBe("Jo Lowe — lawyer sign-off 6 Oct 2026");
  const c = __DOCS.find((x) => x.key === "cooling_off_notice")!;
  expect(c.approvalNote).toBeUndefined();
  expect(c.body).toMatch(/^DRAFT/);
});
