import { describe, expect, test } from "bun:test";
import {
  evaluatePaymentGate,
  instalmentPlanActive,
  paymentRouteFor,
  piesaRequestBlockers,
  requiredDepositCents,
  splitForOption,
  PAYMENT_RULE_EXCEPTION,
  PAYMENT_RULE_PENDING,
  type InstalmentPlan,
  type PaymentGateInput,
} from "../src/lib/payment-gate.core";
import {
  PAY_ROLLBACK_SQL,
  PAY_SQL,
  PID,
  asUser,
  cleared,
  paymentDb,
} from "./helpers/pglite-payment";

const q = (total: number) => ({ id: "q1", customer_total_inc_gst: total });
const inv = (total: number, paid: number) => ({
  quote_id: "q1",
  total_inc_gst: total,
  total_paid: paid,
});
const plan = (o: Partial<InstalmentPlan> = {}): InstalmentPlan => ({
  quote_id: "q1",
  status: "active",
  instalment_count: 3,
  office_approved_at: "t",
  owner_accepted_at: "t",
  first_instalment_verified_at: "t",
  collection_recorded_at: "t",
  ...o,
});
const gate = (o: Partial<PaymentGateInput>) =>
  evaluatePaymentGate({
    enabled: true,
    route: "hiv_lead",
    currentQuote: q(10_000),
    invoice: inv(10_000, 0),
    plan: null,
    overrideCount: 0,
    ...o,
  });

describe("approved payment-option gate (pure)", () => {
  test.skip("RETIRED (Jo 7 Oct safety check payment) – 10% under $20,000; 5% at/over", () => {
    expect(requiredDepositCents(10_000)).toBe(100_000);
    expect(requiredDepositCents(19_999.99)).toBe(200_000); // 1,999.999 rounded UP
    expect(requiredDepositCents(20_000)).toBe(100_000);
    expect(requiredDepositCents(25_000)).toBe(125_000);
    expect(splitForOption(10_000)).toEqual({ depositPct: 0.1, deposit: 1000, balance: 9000 });
    expect(splitForOption(20_000)).toEqual({ depositPct: 0.05, deposit: 1000, balance: 19000 });
  });
  test.skip("RETIRED (Jo 7 Oct safety check payment) – 10% deposit paid clears; one cent short does not; overpaying counts", () => {
    expect(gate({ invoice: inv(10_000, 1000) })).toEqual({ cleared: true, option: "deposit_paid" });
    expect(gate({ invoice: inv(10_000, 999.99) }).cleared).toBe(false);
    expect(gate({ invoice: inv(10_000, 4000) })).toEqual({ cleared: true, option: "deposit_paid" });
  });
  test.skip("RETIRED (Jo 7 Oct safety check payment) – 5% deposit at $20,000+ clears; one cent short does not", () => {
    expect(gate({ currentQuote: q(25_000), invoice: inv(25_000, 1250) })).toEqual({
      cleared: true,
      option: "deposit_paid",
    });
    expect(gate({ currentQuote: q(25_000), invoice: inv(25_000, 1249.99) }).cleared).toBe(false);
    expect(gate({ currentQuote: q(20_000), invoice: inv(20_000, 999.99) }).cleared).toBe(false);
  });
  test.skip("RETIRED (Jo 7 Oct safety check payment) – paid in full clears; one cent short of full falls back to deposit check", () => {
    expect(gate({ invoice: inv(10_000, 10_000) })).toEqual({
      cleared: true,
      option: "paid_in_full",
    });
    expect(gate({ invoice: inv(10_000, 9999.99) })).toEqual({
      cleared: true,
      option: "deposit_paid",
    });
  });
  test.skip("RETIRED (Jo 7 Oct safety check payment) – instalment plan: active only when every condition holds", () => {
    expect(gate({ plan: plan() })).toEqual({ cleared: true, option: "instalment_plan_active" });
    for (const k of [
      "office_approved_at",
      "owner_accepted_at",
      "first_instalment_verified_at",
      "collection_recorded_at",
    ] as const)
      expect(instalmentPlanActive(plan({ [k]: null }), "q1")).toBe(false);
    expect(
      instalmentPlanActive(
        plan({
          owner_accepted_at: null,
          first_instalment_verified_at: null,
          collection_recorded_at: null,
        }),
        "q1",
      ),
    ).toBe(false); // office approval alone
    for (const status of ["proposed", "cancelled", "failed", "overdue", "superseded"])
      expect(instalmentPlanActive(plan({ status }), "q1")).toBe(false);
    expect(instalmentPlanActive(plan({ quote_id: "old" }), "q1")).toBe(false);
  });
  test("route-aware (Jo 24 Oct): installer-supplied jobs follow the same safety-check rule; unknown sources stay blocked", () => {
    expect(paymentRouteFor("hivic_sourced")).toBe("hiv_lead");
    expect(paymentRouteFor("installer_sourced")).toBe("installer_supplied");
    expect(paymentRouteFor(null)).toBe("unknown");
    expect(gate({ route: "installer_supplied", invoice: inv(10_000, 10_000) })).toEqual({ cleared: true, option: "paid_in_full" });
    expect(gate({ route: "installer_supplied", invoice: inv(10_000, 349) })).toEqual({ cleared: true, option: "safety_check_paid" });
    expect(gate({ route: "installer_supplied", invoice: inv(10_000, 348.99) })).toMatchObject({ cleared: false });
    expect((gate({ route: "installer_supplied", invoice: inv(10_000, 0) }) as { blocker: string }).blocker).not.toBe(PAYMENT_RULE_EXCEPTION);
    expect(gate({ route: "unknown", invoice: inv(10_000, 10_000) })).toEqual({
      cleared: false,
      blocker: PAYMENT_RULE_EXCEPTION,
    });
  });
  test("switch off blocks everything with 'payment rule pending activation' (no 50% fallback)", () => {
    expect(gate({ enabled: false, invoice: inv(10_000, 10_000) })).toEqual({
      cleared: false,
      blocker: PAYMENT_RULE_PENDING,
    });
    expect(gate({ enabled: false, invoice: inv(10_000, 5000) })).toEqual({
      cleared: false,
      blocker: PAYMENT_RULE_PENDING,
    });
  });
  test("invoice must belong to the current approved quote; override counts", () => {
    expect(gate({ currentQuote: null }).cleared).toBe(false);
    expect(gate({ invoice: { ...inv(10_000, 10_000), quote_id: "old" } }).cleared).toBe(false);
    expect(gate({ overrideCount: 1 })).toEqual({ cleared: true, option: "office_override" });
  });
});

describe("PIESA request blocked/unblocked", () => {
  const ok = {
    readyCheckComplete: true,
    verifiedEligible: true,
    currentQuoteApproved: true,
    payment: { cleared: true as const, option: "deposit_paid" as const },
  };
  test("all four met → unblocked", () => expect(piesaRequestBlockers(ok)).toEqual([]));
  test("each missing condition blocks", () => {
    expect(piesaRequestBlockers({ ...ok, readyCheckComplete: false })).toEqual([
      "Ready Check not complete.",
    ]);
    expect(piesaRequestBlockers({ ...ok, verifiedEligible: false })[0]).toContain(
      "Verified eligibility",
    );
    expect(piesaRequestBlockers({ ...ok, currentQuoteApproved: false })[0]).toContain(
      "current confirmed insulation quote",
    );
    expect(
      piesaRequestBlockers({ ...ok, payment: { cleared: false, blocker: PAYMENT_RULE_PENDING } }),
    ).toEqual([PAYMENT_RULE_PENDING]);
  });
});

describe("practice database (PGlite, in-process, TEST rows only)", () => {
  const setPaid = (db: Awaited<ReturnType<typeof paymentDb>>, id: string, paid: number) =>
    db.exec(`UPDATE public.invoices SET total_paid = ${paid} WHERE id = '${id}'`);
  test("migration applies; switch defaults OFF; nothing clears while off", async () => {
    const db = await paymentDb();
    await db.exec(PAY_SQL);
    expect(
      (
        await db.query<{ v: boolean }>(
          "SELECT payment_option_gate_enabled AS v FROM public.workflow_settings",
        )
      ).rows[0].v,
    ).toBe(false);
    await setPaid(db, PID.hivInv, 10_000);
    expect(await cleared(db, PID.hivInv)).toBe(false);
  });
  test("10% / 5% / paid in full / plan / one cent short, route-aware, in SQL", async () => {
    const db = await paymentDb(10_000);
    await db.exec(PAY_SQL);
    await db.exec("UPDATE public.workflow_settings SET payment_option_gate_enabled = true");
    await setPaid(db, PID.hivInv, 999.99);
    expect(await cleared(db, PID.hivInv)).toBe(false);
    await setPaid(db, PID.hivInv, 1000);
    expect(await cleared(db, PID.hivInv)).toBe(true);
    await setPaid(db, PID.instInv, 10_000);
    expect(await cleared(db, PID.instInv)).toBe(false); // installer-supplied: exception
    const big = await paymentDb(25_000);
    await big.exec(PAY_SQL);
    await big.exec("UPDATE public.workflow_settings SET payment_option_gate_enabled = true");
    await setPaid(big, PID.hivInv, 1249.99);
    expect(await cleared(big, PID.hivInv)).toBe(false);
    await setPaid(big, PID.hivInv, 1250);
    expect(await cleared(big, PID.hivInv)).toBe(true);
    await setPaid(big, PID.hivInv, 25_000);
    expect(await cleared(big, PID.hivInv)).toBe(true);
    expect(
      (await big.query<{ a: string }>("SELECT public.required_deposit_amount(19999.99)::text AS a"))
        .rows[0].a,
    ).toBe("2000.00");
    // instalment plan
    await setPaid(db, PID.hivInv, 0);
    await db.exec(
      `INSERT INTO public.instalment_plans (job_id, quote_id, invoice_id, status, office_approved_at) VALUES ('${PID.hivJob}', '${PID.hivQuote}', '${PID.hivInv}', 'active', now())`,
    );
    expect(await cleared(db, PID.hivInv)).toBe(false); // office approval alone
    await db.exec(
      `UPDATE public.instalment_plans SET owner_accepted_at = now(), first_instalment_verified_at = now(), collection_recorded_at = now()`,
    );
    expect(await cleared(db, PID.hivInv)).toBe(true);
    await db.exec(`UPDATE public.instalment_plans SET status = 'overdue'`);
    expect(await cleared(db, PID.hivInv)).toBe(false);
  });
  test("access: owner reads own plan; stranger sees nothing and cannot write", async () => {
    const db = await paymentDb();
    await db.exec(PAY_SQL);
    await db.exec(
      `INSERT INTO public.instalment_plans (job_id, quote_id, invoice_id) VALUES ('${PID.hivJob}', '${PID.hivQuote}', '${PID.hivInv}')`,
    );
    expect(
      await asUser(
        db,
        PID.owner,
        async () => (await db.query("SELECT id FROM public.instalment_plans")).rows.length,
      ),
    ).toBe(1);
    expect(
      await asUser(
        db,
        PID.stranger,
        async () => (await db.query("SELECT id FROM public.instalment_plans")).rows.length,
      ),
    ).toBe(0);
    await expect(
      asUser(db, PID.owner, () => db.exec(`UPDATE public.instalment_plans SET status = 'active'`)),
    ).rejects.toThrow();
  });
  test("view uses the new rule; rollback restores old behaviour; re-apply is clean; no existing rows changed", async () => {
    const db = await paymentDb();
    const before = (await db.query("SELECT * FROM public.invoices ORDER BY id")).rows;
    await db.exec(PAY_SQL);
    await db.exec("UPDATE public.workflow_settings SET payment_option_gate_enabled = true");
    expect(
      (await db.query("SELECT * FROM public.invoices ORDER BY id")).rows.map((r) => {
        const { payment_option: _p, ...x } = r as Record<string, unknown>;
        return x;
      }),
    ).toEqual(before);
    await setPaid(db, PID.hivInv, 1000);
    expect(
      await asUser(
        db,
        PID.office,
        async () =>
          (
            await db.query<{ s: string }>(
              `SELECT effective_status AS s FROM public.invoice_status WHERE id = '${PID.hivInv}'`,
            )
          ).rows[0].s,
      ),
    ).toBe("deposit_paid");
    await db.exec(PAY_ROLLBACK_SQL);
    expect((await db.query("SELECT to_regclass('public.instalment_plans') AS t")).rows[0]).toEqual({
      t: null,
    });
    expect(await cleared(db, PID.hivInv)).toBe(false); // old rule needs deposit_paid_at
    await db.exec(PAY_SQL);
    expect(
      (
        await db.query<{ v: boolean }>(
          "SELECT payment_option_gate_enabled AS v FROM public.workflow_settings",
        )
      ).rows[0].v,
    ).toBe(false);
  });
});
