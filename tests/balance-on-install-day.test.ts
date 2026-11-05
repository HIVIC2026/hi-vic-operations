import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderInstallDepositOwnerEmail } from "../src/lib/deposit-request-email.core";
import { renderYoureInEmail } from "../src/lib/acceptance-email.core";
import { PAYMENT_STEP_LABEL, paymentPlan } from "../src/lib/payments.core";
import { BALANCE_DUE_DAYS, balanceDueAt, balanceDueDay } from "../src/lib/balance-q21.core";
import { REST_DUE_SENTENCE } from "../src/lib/owner-wording.core";
const OLD = /7 days after (?:your |the )?install(?:ation)? (?:is )?recorded complete|7 days after recorded install completion|due 7 days after install(?:ation)? completion/;
const FILES = ["src/lib/acceptance-email.core.ts", "src/lib/deposit-request-email.core.ts", "src/lib/install-booked-email.core.ts", "src/lib/install-days-email.core.ts", "src/lib/completion-emails.core.ts", "src/lib/payments.core.ts", "src/lib/ai-answers.core.ts", "src/lib/invoice-dates.server.ts", "src/components/portal/office-job.tsx", "src/components/portal/panels.tsx", "src/config/workflow-decisions.ts", "src/routes/_authenticated/admin.money.tsx"];

describe("balance due on install day", () => {
  test("no source still states the 7-day rule", () => { for (const f of FILES) expect(readFileSync(f, "utf8")).not.toMatch(OLD); });
  test("deposit = 50% of the price after the $349 (Jo 5 Nov 2026; was 10%)", () => {
    const p = paymentPlan({ quoteTotalCents: 218800, safetyCheckCents: 34900 });
    expect([p.installDepositCents, p.balanceCents]).toEqual([91950, 91950]);
  });
  test("You're in! still-to-pay line", () => {
    const e = renderYoureInEmail({ firstName: "Sarah", rebate: 1610, totalIncGst: 2188, payment: { amount: 349, paidOn: "8 Nov" }, installerName: "Rapid Insulation", myJobUrl: "x" } as any);
    expect(e.text).toContain("Still to pay: $1,839.00 (50% to book your install day, the rest on install day)");
  });
  test("deposit emails say the rest is due on install day", () => {
    const f = { name: "Sarah", installer: "Rapid Insulation", jobNumber: "HV-1", address: "1 A St", ownerPhone: null, deadline: "2026-12-01", amountCents: 18390, link: "https://x.test", bank: { accountName: "A", bsb: "000-000", accountNumber: "1", payId: null } as any, reference: "HV-1", card: true };
    for (const step of ["request", "paid"] as const) expect(renderInstallDepositOwnerEmail(f, step).text).toContain(REST_DUE_SENTENCE);
    expect(REST_DUE_SENTENCE).toBe("The rest of your payment is due on install day.");
  });
  test("staff label", () => { expect(PAYMENT_STEP_LABEL.balance).toBe("Balance (due on install day)"); });
  test("AI answers no longer rewrite the right wording", () => {
    const src = readFileSync("src/lib/ai-answers.core.ts", "utf8");
    expect(src).not.toMatch(/replace\(\/the rest on install day\/gi/);
    expect(src).toContain("The balance is due on install day");
  });
  test("owner due date = install day; overdue clock unchanged", () => {
    expect(BALANCE_DUE_DAYS).toBe(7);
    expect(balanceDueDay("2026-11-13T03:00:00Z")).toBe("2026-11-13");
    expect(balanceDueAt("2026-11-13T03:00:00Z")!.startsWith("2026-11-20")).toBe(true);
  });
});
