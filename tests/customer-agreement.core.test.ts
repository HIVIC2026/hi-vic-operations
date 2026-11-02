import { expect, test } from "bun:test";
import { CUSTOMER_AGREEMENT_V1_3 as B, fillAgreement, parseAgreement, paymentTermsPart, type AgreementFacts } from "../src/lib/customer-agreement.core";
const FACTS: AgreementFacts = {
  owner_name: "Sarah Brown", address: "12 Example St, Box Hill VIC 3128", job_number: "HV-1234",
  installer_name: "Rapid Insulation", installer_phone: "03 9000 0000", installer_email: "office@rapid.example",
  product: "Bradford Gold R4.0", area_m2: "120", price_before_rebate: "$3,000", rebate: "$1,200",
  your_price: "$1,800", valid_until: "2 Dec 2026", safety_check: "$349", deposit: "$180", rest: "$1,271",
};
test("v1.3 carries the approved lines verbatim", () => {
  expect(B).toContain("Install: booked once your deposit is paid, and done within 30 days of the electrical safety check (PIESA). Your installer will confirm the day with you. Most installs are finished on the day they start.");
  expect(B).toContain("If your balance is overdue, we charge interest at the Victorian penalty interest rate (currently 10% a year), worked out daily from the day it becomes overdue until it's paid. We don't charge collection costs. If we have to take you to court or VCAT to recover an overdue balance, you may have to pay the legal costs the court or VCAT orders.");
  expect(B).toContain("Cooling-off: no cooling-off period applies. You asked for a quote and accepted it online in your own time.");
  expect(B).not.toMatch(/We don't charge interest/);
  expect(paymentTermsPart(B)).toContain("If you need electrical upgrades, you pay your electrician directly. They're not part of our price.");
});
test("nothing the owner sees mentions a lawyer", () => {
  expect(B).not.toMatch(/lawyer/i);
  expect(fillAgreement(B, FACTS, "1.3")).not.toMatch(/lawyer/i);
});
test("a missing detail fails closed", () => {
  expect(() => fillAgreement(B, { owner_name: "Sarah Brown" } as never, "1.3")).toThrow(/Missing agreement detail/);
  expect(() => fillAgreement(B, { ...FACTS, rest: "" }, "1.3")).toThrow(/Missing agreement detail: rest/);
  expect(() => fillAgreement("Hi {nope}", FACTS, "1.3")).toThrow(/Missing agreement detail: nope/);
});
test("filled agreement has no placeholders and parses into blocks", () => {
  const f = fillAgreement(B, FACTS, "1.3");
  expect(f).not.toMatch(/\{[a-z_0-9]+\}/);
  expect(f).toContain("Version 1.3");
  const blocks = parseAgreement(f);
  expect(blocks.some((b) => b.kind === "header")).toBe(true);
  expect(blocks.filter((b) => b.kind === "pageBreak")).toHaveLength(1);
  const secs = blocks.filter((b) => b.kind === "section");
  expect(secs.length).toBeGreaterThanOrEqual(14);
  expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
});
