import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { balanceSplit, evaluatePaymentGate, refundOutcome, safetyCheckBlocker, splitForOption, piesaRequestBlockers } from "../src/lib/payment-gate.core";
import { GATE_DOCS, answerVars, paymentChoices } from "../src/lib/owner-gates.core";

const rd = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const base = { enabled: true, route: "hiv_lead" as const, currentQuote: { id: "q", customer_total_inc_gst: 3728 }, plan: null, overrideCount: 0 };
const inv = (paid: number) => ({ quote_id: "q", total_inc_gst: 3728, total_paid: paid });

describe("Pre Insulation Electrical Safety Assessment (PIESA) payment (Jo 7 Oct)", () => {
  test("PIESA blocked until $349 paid; one cent short blocks", () => {
    const r = evaluatePaymentGate({ ...base, invoice: inv(348.99) });
    expect(r).toEqual({ cleared: false, blocker: safetyCheckBlocker(349) });
    expect(evaluatePaymentGate({ ...base, invoice: inv(349) })).toEqual({ cleared: true, option: "safety_check_paid" });
    expect(evaluatePaymentGate({ ...base, invoice: inv(3728) })).toEqual({ cleared: true, option: "paid_in_full" });
    expect(piesaRequestBlockers({ readyCheckComplete: true, verifiedEligible: true, currentQuoteApproved: true, payment: r })).toEqual([safetyCheckBlocker(349)]);
  });
  test("fee comes from the setting", () => {
    expect(evaluatePaymentGate({ ...base, invoice: inv(349), safetyFeeIncGst: 400 }).cleared).toBe(false);
    expect(splitForOption(3728, 400).deposit).toBe(400);
  });
  test("gate OFF still blocks", () => {
    expect(evaluatePaymentGate({ ...base, enabled: false, invoice: inv(3728) }).cleared).toBe(false);
  });
  test("halves always add up, odd cents", () => {
    for (const t of [3728, 3728.01, 1000.03, 349, 200]) {
      const b = balanceSplit(t, 349);
      expect(Math.round((b.fee + b.firstHalf + b.secondHalf) * 100)).toBe(Math.round(t * 100));
      expect(b.secondHalf - b.firstHalf).toBeLessThanOrEqual(0.011);
    }
    expect(balanceSplit(3728, 349)).toEqual({ total: 3728, fee: 349, balance: 3379, firstHalf: 1689.5, secondHalf: 1689.5 });
  });
  test("refund outcomes", () => {
    expect(refundOutcome({ paidCents: 34900, safetyFeeCents: 34900, checkDone: false, checkNeverHappening: true, canProceed: false })).toEqual({ outcome: "refund_all", refundCents: 34900 });
    expect(refundOutcome({ paidCents: 372800, safetyFeeCents: 34900, checkDone: true, checkNeverHappening: false, canProceed: false })).toEqual({ outcome: "refund_except_safety_fee", refundCents: 337900 });
    expect(refundOutcome({ paidCents: 34900, safetyFeeCents: 34900, checkDone: true, checkNeverHappening: false, canProceed: false }).outcome).toBe("keep_safety_fee");
  });
  test("Step B wording is DRAFT and amounts never come from owner answers", () => {
    const d = GATE_DOCS.find((x) => x.key === "payment_terms")!;
    expect(d.version).toBe("jo-2026-10-21"); expect(d.draftNote).toBeUndefined();
    const m = { fee: "$349.00", balance: "$3,379.00", half: "$1,689.50", half2: "$1,689.50", total: "$3,728.00" };
    const c = paymentChoices(m);
    expect(c.safetyFee).toBe("I'll pay the $349.00 Pre Insulation Electrical Safety Assessment (PIESA) fee now. I understand it's non-refundable once the PIESA is done, even if it finds the job can't go ahead.");
    expect(c.options.map((o) => o.text)).toEqual(["Pay the balance of $3,379.00 in two instalments: $1,689.50 when my install is booked and $1,689.50 on install day.", "Pay the full $3,728.00 now."]);
    const v = answerVars({ payment_option: "pay_in_full", total: "$1.00" }, m);
    expect(v["payment_option_text"]).toBe("Pay the full $3,728.00 now.");
  });
  test("practice database: setting added with default 349, mirror uses it, undo removes it", async () => {
    const db = new PGlite();
    await db.exec(`CREATE TABLE public.workflow_settings (id int primary key, payment_option_gate_enabled boolean default false); INSERT INTO public.workflow_settings (id) VALUES (1);
      CREATE TABLE public.jobs (id uuid primary key, channel text); CREATE TABLE public.invoices (id uuid primary key, job_id uuid, total_inc_gst numeric, total_paid numeric);
      CREATE TABLE public.payment_overrides (invoice_id uuid, gate text); CREATE FUNCTION public.can_access_job(uuid) RETURNS boolean LANGUAGE sql AS 'select true';`);
    await db.exec(rd("0130_safety_check_payment.sql")); await db.exec(rd("0131_safety_check_gate_mirror.sql"));
    expect((await db.query<{ v: string }>("select safety_check_payment_inc_gst::text v from workflow_settings")).rows[0]!.v).toBe("349");
    await db.exec(`UPDATE workflow_settings SET payment_option_gate_enabled = true; INSERT INTO jobs VALUES ('00000000-0000-4000-8000-000000000001','hivic_sourced');
      INSERT INTO invoices VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',3728,348.99);`);
    const q = async () => (await db.query<{ c: boolean }>("select public.invoice_deposit_cleared('00000000-0000-4000-8000-000000000002') c")).rows[0]!.c;
    expect(await q()).toBe(false);
    await db.exec("UPDATE invoices SET total_paid = 349"); expect(await q()).toBe(true);
    await db.exec(rd("0130_safety_check_payment.undo.sql"));
    expect((await db.query("select 1 from information_schema.columns where column_name='safety_check_payment_inc_gst'")).rows.length).toBe(0);
  });
});
