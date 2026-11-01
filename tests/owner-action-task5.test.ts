import { describe, expect, test } from "bun:test";
import { resolveOwnerScreen } from "../src/lib/owner-myjob.core";
import { evaluateOwnerGates, RETIRED_DOC_KEYS, piesaCopyReceiptBlocker, GATE_DOCS } from "../src/lib/owner-gates.core";

describe("Task 5 owner action-only pages", () => {
  for (const screen of [undefined, "home"] as const) {
    test(`${screen ?? "no screen"} opens the quote action, never home`, () => {
      expect(resolveOwnerScreen(screen, { action: { button: { screen: "quote" } } })).toBe("quote");
    });
    test(`${screen ?? "no screen"} with no action opens all-set`, () => {
      expect(resolveOwnerScreen(screen, { action: { button: null }, spotSaved: true })).toBe("all_set");
    });
  }
  test("payment, PIESA and VEEC have dedicated screens", () => {
    expect(resolveOwnerScreen(undefined, { payment: { dueNow: 349 } })).toBe("pay");
    expect(resolveOwnerScreen(undefined, { piesaConfirm: { confirmed: null } })).toBe("piesa");
    expect(resolveOwnerScreen(undefined, { veecAssignment: {} })).toBe("veec");
  });
  test("explicit current action is retained", () => {
    expect(resolveOwnerScreen("review", {})).toBe("review");
  });
});

describe("Task 5 receipt retirement", () => {
  const facts = { isTest: false, signed: [], approved: {}, tenant: false, lifeSupport: false, visitedByInstaller: false,
    hasQuote: true, agreementSigned: true, agreementWordingApproved: true, escConsentSigned: true,
    piesaCopyDelivered: true, piesaDeclarationMappingApproved: false, assignmentEffective: false };
  test("copy receipt is retired but its historical catalogue remains", () => {
    expect(RETIRED_DOC_KEYS.has("piesa_copy_receipt")).toBe(true);
    expect(GATE_DOCS.some(d => d.key === "piesa_copy_receipt")).toBe(true);
  });
  test("no unsigned receipt blocks Gate C or prestart", () => {
    expect(evaluateOwnerGates(facts).find(g => g.gate === "C")?.items.some(i => i.key === "piesa_copy_receipt")).toBe(false);
    expect(piesaCopyReceiptBlocker(facts)).toBeNull();
  });
});