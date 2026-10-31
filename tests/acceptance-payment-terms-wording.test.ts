import { describe, expect, test } from "bun:test";
import { acceptancePaymentTerms } from "../src/lib/assignment.core";
import {
  evaluateOwnerGates,
  PAYMENT_TERMS_VERSION,
  type GateFacts,
} from "../src/lib/owner-gates.core";

const items = [
  { code: "install", line_total_inc_gst: 5500 },
  { code: "PIESA", line_total_inc_gst: 349 },
  { code: "AP_FEE", line_total_inc_gst: 349 },
];

describe("acceptance payment terms", () => {
  test("formats the accepted total and safety check as dollars", () => {
    const text = acceptancePaymentTerms(items, 5988);
    expect(text).toContain("$5,988.00");
    expect(text).toContain("$349.00");
    // Ignore entire valid dollar amounts: the requested regex otherwise matches the tail of "$5,988.00".
    const withoutDollarAmounts = text.replace(/\$\d{1,3}(?:,\d{3})*\.\d{2}\b/g, "");
    expect(withoutDollarAmounts).not.toMatch(/(?<!\$)\b\d{3,}\.\d{2}\b/);
  });

  test("uses current separate-invoice payment steps without retired wording", () => {
    const text = acceptancePaymentTerms(items, 5988);
    expect(text).not.toContain("One Xero invoice");
    expect(text).not.toMatch(/\bfixes\b/i);
    expect(text).toContain("Electrical upgrades");
    expect(text).toContain("pay for the electrical upgrades in full then, on their own invoice");
    expect(text).toContain("$563.90");
    expect(text).toContain("$5,075.10");
  });

  test("a quote without a PIESA line has valid payment amounts", () => {
    const text = acceptancePaymentTerms(
      items.filter((item) => item.code !== "PIESA"),
      5639,
    );
    expect(text).not.toMatch(/NaN|undefined/);
    expect(text).toContain("$5,639.00");
  });

  test("new wording cannot inherit the previous version's approval", () => {
    expect(PAYMENT_TERMS_VERSION).not.toBe("steps-2026-10-29b");
    const facts: GateFacts = {
      isTest: false,
      signed: [],
      approved: { payment_terms: "steps-2026-10-29b" },
      tenant: false,
      lifeSupport: false,
      visitedByInstaller: false,
      hasQuote: true,
      agreementSigned: false,
      agreementWordingApproved: true,
      escConsentSigned: false,
      piesaCopyDelivered: false,
      piesaDeclarationMappingApproved: false,
      assignmentEffective: false,
    };
    const payment = evaluateOwnerGates(facts)
      .find((gate) => gate.gate === "B")
      ?.items.find((item) => item.key === "payment_terms");
    expect(payment?.draft).toBe(true);
    expect(payment?.done).toBe(false);
  });
});
