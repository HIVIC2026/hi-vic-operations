// Batch 3a task 3: card is allowed for the 10% install deposit (balance stays bank transfer / PayID). Pure. Run: bun test tests/batch3a-card-deposit.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  bankDetailLines,
  cardAllowedFor,
  howYouPayLines,
  payableNow,
  paymentLine,
  paymentMethodsFor,
  paymentPlan,
  paymentSteps,
  payNowBlock,
} from "../src/lib/payments.core";
import { checkoutSessionParams, stripeBlocker, stripeCardAllowed } from "../src/lib/stripe.core";
import {
  GATE_DOCS,
  PAYMENT_TERMS_BODY,
  PAYMENT_TERMS_VERSION,
  paymentTermsMoney,
  paymentTermsText,
} from "../src/lib/owner-gates.core";
import { acceptancePaymentTerms } from "../src/lib/assignment.core";
import { renderInstallBookedEmail } from "../src/lib/install-booked-email.core";
import { renderDepositReleasedEmail } from "../src/lib/deposit-release-notice.core";

const DEPOSIT_PHRASE = "card, bank transfer or payid";
const NOW = "2026-10-29T00:00:00.000Z";
const plan = paymentPlan({ quoteTotalCents: 400_000 });
const paidSafety = { install: plan.safetyCheckCents, fixes: 0, repeat: 0 };
const steps = paymentSteps(
  plan,
  paidSafety,
  { safety_check: { requestedAt: NOW }, install_deposit: { requestedAt: NOW } },
  NOW,
);
const bank = {
  configured: true,
  accountName: "HIV",
  bsb: "123456",
  accountNumber: "12345678",
  payId: "pay@hiv.test",
} as Parameters<typeof bankDetailLines>[0];

describe("rules: card for the install deposit only", () => {
  test("deposit = card + bank; balance = bank only", () => {
    expect(paymentMethodsFor("install_deposit")).toEqual(["card", "bank"]);
    expect(cardAllowedFor("install_deposit")).toBe(true);
    expect(paymentMethodsFor("balance")).toEqual(["bank"]);
    expect(cardAllowedFor("balance")).toBe(false);
    expect(stripeCardAllowed("install_deposit")).toBe(true);
    expect(stripeCardAllowed("balance")).toBe(false);
  });
  test("Stripe no longer blocks the deposit; balance still blocked", () => {
    const f = { enabled: true, secretKey: "sk_live_x", jobSource: "web", amountCents: 100 };
    expect(stripeBlocker({ ...f, step: "install_deposit" })).toBeNull();
    expect(stripeBlocker({ ...f, step: "balance" })).toContain("balance");
  });
  test("Checkout for the deposit charges exactly the deposit due now", () => {
    const due = payableNow(plan, steps, paidSafety);
    expect(due.step?.key).toBe("install_deposit");
    expect(due.dueNowCents).toBe(plan.installDepositCents);
    expect(due.cardAvailable).toBe(true);
    const { form } = checkoutSessionParams({
      jobId: "j",
      invoiceId: "i",
      step: "install_deposit",
      amountCents: due.dueNowCents,
      jobNumber: "HV-1",
      description: "d",
      successUrl: "s",
      cancelUrl: "c",
      customerEmail: null,
      jobSource: "web",
    });
    expect(form["line_items[0][price_data][unit_amount]"]).toBe(String(plan.installDepositCents));
    expect(form["metadata[step]"]).toBe("install_deposit");
  });
  test("a part-paid deposit charges only what is left", () => {
    const part = plan.safetyCheckCents + 10_000;
    const s = paymentSteps(
      plan,
      { install: part, fixes: 0, repeat: 0 },
      { safety_check: { requestedAt: NOW }, install_deposit: { requestedAt: NOW } },
      NOW,
    );
    expect(payableNow(plan, s, { install: part, fixes: 0, repeat: 0 }).dueNowCents).toBe(
      plan.installDepositCents - 10_000,
    );
  });
});

describe("owner wording", () => {
  test("every deposit line says card, bank transfer or PayID; no balance line says card; no card fee", () => {
    expect(paymentLine("install_deposit", "INV-1").toLowerCase()).toContain(DEPOSIT_PHRASE);
    expect(paymentLine("balance", "INV-1").toLowerCase()).not.toContain("card");
    const how = howYouPayLines(plan);
    expect(how.find((l) => l.includes("deposit"))!.toLowerCase()).toContain(DEPOSIT_PHRASE);
    expect(
      how
        .filter((l) => /install day|full/.test(l) && !l.includes("deposit"))
        .some((l) => /card/i.test(l)),
    ).toBe(false);
    const block = payNowBlock({
      step: steps.find((s) => s.key === "install_deposit")!,
      cardAvailable: true,
      bank,
      reference: "INV-1",
      remainingCents: 1,
    });
    expect(block.card).toBe(true);
    expect(block.lines.join(" ").toLowerCase()).toContain(DEPOSIT_PHRASE);
  });
  test("Gate B statement: deposit line has card; balance line and pay-in-full do not; new version id", () => {
    expect(PAYMENT_TERMS_VERSION).not.toBe("steps-2026-10-25");
    expect(GATE_DOCS.find((d) => d.key === "payment_terms")!.version).toBe(PAYMENT_TERMS_VERSION);
    const text = paymentTermsText(
      paymentTermsMoney({
        quoteTotalCents: 400_000,
        safetyCheckCents: 34_900,
        installDepositCents: 36_510,
        balanceCents: 328_590,
      }),
    );
    const dep = text.split("\n\n").find((l) => l.startsWith("3. "))!;
    expect(dep.toLowerCase()).toContain(DEPOSIT_PHRASE);
    expect(
      text
        .split("\n\n")
        .find((l) => l.startsWith("4. "))!
        .toLowerCase(),
    ).not.toContain("card");
    expect(
      text
        .split("\n\n")
        .find((l) => l.startsWith("I can pay"))!
        .toLowerCase(),
    ).not.toContain("card");
    expect(PAYMENT_TERMS_BODY.match(/card fee/gi)?.length).toBe(1); // only the existing "there is no card fee"
  });
  test("install-booked and deposit-release emails say card, bank transfer or PayID", () => {
    const booked = renderInstallBookedEmail({
      firstName: "Sam",
      when: "Tuesday 27 October at 7:30am",
      address: "1 High St",
      installerName: "Reinsulate",
      installerPhone: null,
      removal: false,
      myJobUrl: "https://x.test/my-job/t",
      deposit: { amount: "$185.10", holdUntil: null, bankLines: ["Account name: HIV"] },
    } as unknown as Parameters<typeof renderInstallBookedEmail>[0]);
    expect(`${booked.html} ${booked.text}`.toLowerCase()).toContain(DEPOSIT_PHRASE);
    const rel = renderDepositReleasedEmail({
      firstName: "Sam",
      day: "Tuesday 11 November",
      link: "https://x.test",
      depositAmount: "$185.10",
      bankLines: ["Account name: HIV"],
    });
    expect(`${rel.html} ${rel.text}`.toLowerCase()).toContain(DEPOSIT_PHRASE);
  });
  test("no card fee wording on the deposit lines", () => {
    const all = [
      paymentLine("install_deposit", null),
      ...howYouPayLines(plan),
      PAYMENT_TERMS_BODY,
    ].join(" ");
    expect(/card fee|surcharge/i.test(all.replace(/there is no card fee/gi, ""))).toBe(false);
  });
});

describe("fix round 1", () => {
  const read = (f: string) => readFileSync(`src/lib/${f}`, "utf8");
  test("agreement read-more deposit line says card, bank transfer or PayID", () => {
    const s = read("assignment.server.ts");
    expect(s).toContain("payment_terms: acceptancePaymentTerms(items, total)");
    const terms = acceptancePaymentTerms([], 4000);
    expect(terms).toContain("to book my install day, by card, bank transfer or PayID");
    expect(
      terms
        .split("\n\n")
        .find((line) => line.startsWith("4. "))
        ?.toLowerCase(),
    ).not.toContain("card");
    expect(s).not.toContain("(bank transfer / PayID) and the balance");
  });
  test("email-reply deposit is card-inclusive whether or not Stripe is available", () => {
    const s = read("email-reply.core.ts");
    expect(s).toContain(
      'install_deposit: { what: "booking payment (10%)", how: "by card, bank transfer or PayID" }',
    );
    expect(s).not.toMatch(/comes through, \$\{due\.cardAvailable/);
  });
  test("office text matches", () => {
    expect(read("office-stage-cards.core.ts")).toContain("10% to book · card or bank");
    expect(read("allocation.core.ts")).toContain(
      "about the deposit (card, bank transfer or PayID)",
    );
  });
});
