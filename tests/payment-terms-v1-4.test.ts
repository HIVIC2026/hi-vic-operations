import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  GATE_DOCS,
  PAYMENT_TERMS_BODY,
  PAYMENT_TERMS_VERSION,
  paymentTermsMoney,
  paymentTermsText,
} from "../src/lib/owner-gates.core";
import { CUSTOMER_AGREEMENT_V1_4, paymentTermsPart } from "../src/lib/customer-agreement.core";

const money = paymentTermsMoney({
  quoteTotalCents: 218_800,
  safetyCheckCents: 34_900,
  installDepositCents: 18_390,
  balanceCents: 165_510,
});

describe("payment terms = the approved payment terms page of Customer Agreement v1.3", () => {
  test("payment terms carry the approved text, not the old fixes line", () => {
    expect(PAYMENT_TERMS_BODY).not.toMatch(/Electrical fixes|on their own invoice/);
    expect(PAYMENT_TERMS_BODY).toContain("If you need electrical upgrades, you pay your electrician directly. They're not part of our price.");
    expect(PAYMENT_TERMS_BODY).toContain("We'll remind you 1, 3 and 7 days after install day. After 7 days, your balance is overdue and we may pass it to a debt collector.");
    expect(PAYMENT_TERMS_VERSION).toBe("customer-agreement-1.4");
    expect(GATE_DOCS.find((d) => d.key === "payment_terms")!.version).toBe(PAYMENT_TERMS_VERSION);
  });
  test("plain owner text: no agreement markup, no literal \\n, nothing unfilled, no 'lawyer'", () => {
    const text = paymentTermsText(money);
    expect(text).not.toContain("{");
    expect(text).not.toContain("\\n");
    expect(text).not.toMatch(/^(#|>|\$ )/m);
    expect(text).not.toContain(" | ");
    expect(text).not.toMatch(/lawyer/i);
    expect(PAYMENT_TERMS_BODY).not.toMatch(/lawyer/i);
    expect(text).toContain("Electrical safety check (PIESA): $349.00");
    expect(text).toContain("Deposit to book your install day: $183.90");
    expect(text).not.toMatch(/\d+ ?% (?:deposit|to book)/); // Jo 6 Nov 2026: no percentage in any deposit wording
    expect(text).toContain("The rest: $1,655.10");
    expect(text).toContain("Your price (incl. GST): $2,188.00");
  });
  test("every approved sentence of the page survives", () => {
    const text = paymentTermsText(money);
    for (const s of [
      "By card or bank transfer. No fees. Each payment has its own link in our email, and we email you a receipt each time.",
      "If your balance is overdue, we charge interest at the Victorian penalty interest rate (currently 10% a year), worked out daily from the day it becomes overdue until it's paid. We don't charge collection costs. If we have to take you to court or VCAT to recover an overdue balance, you may have to pay the legal costs the court or VCAT orders.",
      "- $349: refunded if you cancel before your electrical safety check is done.",
      "- Deposit: refunded if you cancel at least 2 business days before your install day.",
      "1. When you accept your quote",
      "2. Once you're clear to install",
      "3. On install day",
    ])
      expect(text).toContain(s);
    // every word of the agreement's payment page is in the owner text (placeholders aside)
    const words = paymentTermsPart(CUSTOMER_AGREEMENT_V1_4)
      .replace(/\{\w+\}|\\n|^Job .*$/gm, " ")
      .replace(/[#>$|✓!⚡↩]/g, " ")
      .split(/\s+/)
      .filter((w) => /[a-z]/i.test(w));
    for (const w of words) expect(text).toContain(w);
  });
  test("stored terms on a new acceptance use the same text", () => {
    const src = readFileSync("src/lib/assignment.server.ts", "utf8");
    expect(src).toMatch(/payment_terms:\s*paymentTermsText\(/);
    expect(src).not.toMatch(/7 days after recorded install completion/);
  });
});
