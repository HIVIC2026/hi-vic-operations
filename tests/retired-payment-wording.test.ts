import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const RETIRED = [/3-instalment plan/i, /minimum upfront deposit/i, /deposit request in Xero/i, /requested in Xero/i, /Minimum deposit/];

describe("retired payment wording (batch 3a task 4)", () => {
  test("acceptance record uses the approved line", () => {
    const s = read("src/lib/portal.functions.ts");
    expect(s).toContain("safety check paid at acceptance; electrical fixes in full if needed; 10% install deposit to book the install; balance on installation day.");
    for (const re of RETIRED) expect(s).not.toMatch(re);
  });
  test("Xero office notes name today's steps", () => {
    const s = read("src/lib/xero.server.ts");
    for (const re of RETIRED) expect(s).not.toMatch(re);
    expect(s).toContain("Safety check payment confirmed in Xero");
  });
  test("office invoice panel: no deposit-request wording, 10% comes from the server payment plan", () => {
    const s = read("src/components/portal/panels.tsx");
    for (const re of RETIRED) expect(s).not.toMatch(re);
    expect(s).not.toMatch(/Request deposit|Deposit request must be raised/);
    expect(s).not.toMatch(/paymentPlan\(\{ quoteTotalCents: Math\.round\(Number\(i\.total_inc_gst\)/);
  });
});

describe("owner sees the After-the-PIESA row with plan figures (fix round 1)", () => {
  test("owner read is guarded to the owner's own job and returns plan figures only", () => {
    const s = read("src/lib/payments.functions.ts");
    const i = s.indexOf("export const getOwnerPaymentPlan");
    const body = s.slice(i, s.indexOf("export const refreshPayNowLink"));
    expect(body).toContain('requireJobRole(context.supabase, data.jobId, ["owner"])');
    expect(body).toContain("v.plan.installDepositCents");
    expect(body).not.toMatch(/total_inc_gst/);
  });
  test("panel shows the row to owners and office from the plan, never the invoice total", () => {
    const s = read("src/components/portal/panels.tsx");
    expect(s).toContain("<AfterSafetyCheckRow jobId={jobId} invoiceId={i.id} isAdmin={isAdmin} />");
    expect(s).not.toMatch(/paymentPlan\(/);
  });
  test("fixes (their own invoice) do not change the 10%: install price only", async () => {
    const { paymentPlan } = await import("../src/lib/payments.core");
    const quote = 500000, fixes = 120000, piesa = 34900;
    const plan = paymentPlan({ quoteTotalCents: quote, safetyCheckCents: piesa, fixesCents: fixes });
    expect(plan.installDepositCents).toBe(Math.floor((quote - piesa) * 0.1 + 0.5));
    expect(plan.installDepositCents).not.toBe(Math.floor((quote + fixes - piesa) * 0.1 + 0.5));
  });
});
