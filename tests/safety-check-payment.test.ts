import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import {
  evaluatePaymentGate,
  refundOutcome,
  safetyCheckBlocker,
  splitForOption,
  piesaRequestBlockers,
} from "../src/lib/payment-gate.core";
import {
  GATE_DOCS,
  PAYMENT_TERMS_BODY,
  PAYMENT_TERMS_VERSION,
  answerVars,
  paymentTermsMoney,
  paymentTermsText,
} from "../src/lib/owner-gates.core";
import { paymentPlan } from "../src/lib/payments.core";

const rd = (f: string) =>
  readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const base = {
  enabled: true,
  route: "hiv_lead" as const,
  currentQuote: { id: "q", customer_total_inc_gst: 3728 },
  plan: null,
  overrideCount: 0,
};
const inv = (paid: number) => ({ quote_id: "q", total_inc_gst: 3728, total_paid: paid });

describe("Pre Insulation Electrical Safety Assessment (PIESA) payment (Jo 7 Oct)", () => {
  test("PIESA blocked until $349 paid; one cent short blocks", () => {
    const r = evaluatePaymentGate({ ...base, invoice: inv(348.99) });
    expect(r).toEqual({ cleared: false, blocker: safetyCheckBlocker(349) });
    expect(evaluatePaymentGate({ ...base, invoice: inv(349) })).toEqual({
      cleared: true,
      option: "safety_check_paid",
    });
    expect(evaluatePaymentGate({ ...base, invoice: inv(3728) })).toEqual({
      cleared: true,
      option: "paid_in_full",
    });
    expect(
      piesaRequestBlockers({
        readyCheckComplete: true,
        verifiedEligible: true,
        currentQuoteApproved: true,
        payment: r,
      }),
    ).toEqual([safetyCheckBlocker(349)]);
  });
  test("fee comes from the setting", () => {
    expect(evaluatePaymentGate({ ...base, invoice: inv(349), safetyFeeIncGst: 400 }).cleared).toBe(
      false,
    );
    expect(splitForOption(3728, 400).deposit).toBe(400);
  });
  test("gate OFF still blocks", () => {
    expect(evaluatePaymentGate({ ...base, enabled: false, invoice: inv(3728) }).cleared).toBe(
      false,
    );
  });
  test("PIESA fee + balance add up, odd cents (no halves — Jo 26 Oct)", () => {
    for (const t of [3728, 3728.01, 1000.03, 349, 200]) {
      const b = splitForOption(t, 349);
      expect(Math.round((b.deposit + b.balance) * 100)).toBe(Math.round(t * 100));
    }
  });
  test("refund outcomes", () => {
    expect(
      refundOutcome({
        paidCents: 34900,
        safetyFeeCents: 34900,
        checkDone: false,
        checkNeverHappening: true,
        canProceed: false,
      }),
    ).toEqual({ outcome: "refund_all", refundCents: 34900 });
    expect(
      refundOutcome({
        paidCents: 372800,
        safetyFeeCents: 34900,
        checkDone: true,
        checkNeverHappening: false,
        canProceed: false,
      }),
    ).toEqual({ outcome: "refund_except_safety_fee", refundCents: 337900 });
    expect(
      refundOutcome({
        paidCents: 34900,
        safetyFeeCents: 34900,
        checkDone: true,
        checkNeverHappening: false,
        canProceed: false,
      }).outcome,
    ).toBe("keep_safety_fee");
  });
  test("decision 365: Step B payment is ONE statement of the paymentPlan() steps — no 50/50 option; amounts never from owner answers", () => {
    const d = GATE_DOCS.find((x) => x.key === "payment_terms")!;
    expect(d.version).toBe(PAYMENT_TERMS_VERSION);
    expect(d.version).not.toBe("jo-2026-10-21");
    expect(d.approvalNote).toBeUndefined(); // new wording: unapproved until Jo's approval row exists
    expect(d.body.startsWith("DRAFT")).toBe(false); // approvable through Settings › Owner paperwork
    const plan = paymentPlan({ quoteTotalCents: 372_800, safetyCheckCents: 34_900 });
    const m = paymentTermsMoney(plan);
    expect(m).toEqual({
      fee: "$349.00",
      deposit: "$337.90",
      remaining: "$3,379.00",
      balance: "$3,041.10",
      total: "$3,728.00",
    });
    const text = paymentTermsText(m);
    expect(text).toContain(
      "$349.00 for the Pre Insulation Electrical Safety Assessment (PIESA), now that I accept, by card or bank transfer",
    );
    expect(text).toContain("non-refundable once the PIESA is done");
    expect(text).toContain("only if the electrician finds they're needed");
    expect(text).toContain(
      "$337.90 (10% of the remaining $3,379.00) to book my install day, by card, bank transfer or PayID",
    );
    expect(text).toContain("$3,041.10 on install day, by bank transfer or PayID");
    expect(text).toContain("no card fee");
    expect(text).not.toMatch(/instalment|half|\{/i);
    // the draft file Jo approves holds exactly this wording
    expect(
      readFileSync(
        new URL(
          `../docs/templates/owner/owner-payment-terms-${PAYMENT_TERMS_VERSION}.md`,
          import.meta.url,
        ),
        "utf8",
      ),
    ).toContain(PAYMENT_TERMS_BODY);
    const v = answerVars({ payment_option: "pay_in_full", total: "$1.00", deposit: "$0.01" }, m);
    expect(v["total"]).toBe("$3,728.00");
    expect(v["deposit"]).toBe("$337.90");
    expect(v["payment_option"]).toBeUndefined();
  });
  test("decision 365: no option choice anywhere — signing needs no payment_option and the owner screen has no radio group", () => {
    const server = readFileSync(
      new URL("../src/lib/owner-gates.server.ts", import.meta.url),
      "utf8",
    );
    const ui = readFileSync(
      new URL("../src/components/owner/OwnerPaperwork.tsx", import.meta.url),
      "utf8",
    );
    expect(server).not.toMatch(/two_instalments|pay_in_full|paymentOptions|balanceSplit/);
    expect(ui).not.toMatch(/payment-options|payment_option|radiogroup/);
  });
  test("practice database: setting added with default 349, mirror uses it, undo removes it", async () => {
    const db = new PGlite();
    await db.exec(`CREATE TABLE public.workflow_settings (id int primary key, payment_option_gate_enabled boolean default false); INSERT INTO public.workflow_settings (id) VALUES (1);
      CREATE TABLE public.jobs (id uuid primary key, channel text); CREATE TABLE public.invoices (id uuid primary key, job_id uuid, total_inc_gst numeric, total_paid numeric);
      CREATE TABLE public.payment_overrides (invoice_id uuid, gate text); CREATE FUNCTION public.can_access_job(uuid) RETURNS boolean LANGUAGE sql AS 'select true';`);
    await db.exec(rd("0130_safety_check_payment.sql"));
    await db.exec(rd("0131_safety_check_gate_mirror.sql"));
    expect(
      (
        await db.query<{ v: string }>(
          "select safety_check_payment_inc_gst::text v from workflow_settings",
        )
      ).rows[0]!.v,
    ).toBe("349");
    await db.exec(`UPDATE workflow_settings SET payment_option_gate_enabled = true; INSERT INTO jobs VALUES ('00000000-0000-4000-8000-000000000001','hivic_sourced');
      INSERT INTO invoices VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',3728,348.99);`);
    const q = async () =>
      (
        await db.query<{ c: boolean }>(
          "select public.invoice_deposit_cleared('00000000-0000-4000-8000-000000000002') c",
        )
      ).rows[0]!.c;
    expect(await q()).toBe(false);
    await db.exec("UPDATE invoices SET total_paid = 349");
    expect(await q()).toBe(true);
    await db.exec(rd("0130_safety_check_payment.undo.sql"));
    expect(
      (
        await db.query(
          "select 1 from information_schema.columns where column_name='safety_check_payment_inc_gst'",
        )
      ).rows.length,
    ).toBe(0);
  });
});
