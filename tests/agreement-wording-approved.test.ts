// Jo 1 Nov 2026: the agreement wording the owner signs is the lawyer-approved quote_acceptance gate doc; only an
// approved + active consumer_rights template is needed. No customer_agreement template must not block real jobs.
import { describe, expect, test } from "bun:test";
import { agreementWordingApprovedFrom, evaluateOwnerGates, type GateFacts } from "../src/lib/owner-gates.core";

const facts = (agreementWordingApproved: boolean): GateFacts => ({
  isTest: false, signed: [], approved: {}, tenant: false, lifeSupport: false, visitedByInstaller: false,
  hasQuote: true, agreementSigned: true, agreementWordingApproved, escConsentSigned: false,
  piesaCopyDelivered: false, piesaDeclarationMappingApproved: false, assignmentEffective: false,
});
const item = (f: GateFacts) => evaluateOwnerGates(f).find((g) => g.gate === "B")!.items.find((i) => i.key === "customer_agreement")!;
const draftBlocker = (f: GateFacts) => evaluateOwnerGates(f).find((g) => g.gate === "B")!.blockers.some((b) => b.includes("DRAFT wording"));

describe("agreement wording approval", () => {
  test("approved+active consumer_rights and no customer_agreement template → not draft", () => {
    const ok = agreementWordingApprovedFrom(["consumer_rights"]);
    expect(ok).toBe(true);
    expect(item(facts(ok)).draft).toBe(false);
    expect(draftBlocker(facts(ok))).toBe(false);
  });
  test("no approved consumer_rights → stays draft", () => {
    const ok = agreementWordingApprovedFrom([]);
    expect(ok).toBe(false);
    expect(item(facts(ok)).draft).toBe(true);
    expect(draftBlocker(facts(ok))).toBe(true);
    expect(agreementWordingApprovedFrom(["customer_agreement"])).toBe(false);
  });
});
