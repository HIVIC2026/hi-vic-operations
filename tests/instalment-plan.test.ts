import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyPlanAction,
  planChecklist,
  proposeBlocker,
  OWNER_PLAN_TERMS,
  type PlanContext,
  type PlanRow,
} from "../src/lib/instalment-plan.core";
import { evaluatePaymentGate, PAYMENT_RULE_EXCEPTION } from "../src/lib/payment-gate.core";
import { asUser, cleared, paymentDb, PAY_SQL, PID } from "./helpers/pglite-payment";

const base = (o: Partial<PlanRow> = {}): PlanRow => ({
  id: "p1", job_id: "j1", quote_id: "q1", invoice_id: "i1", status: "proposed", instalment_count: 3,
  office_approved_at: null, office_approved_by: null, owner_accepted_at: null, owner_accepted_by: null,
  first_instalment_amount: null, first_instalment_verified_at: null, collection_arrangement: null,
  collection_recorded_at: null, status_reason: null, ...o,
});
const ctx: PlanContext = { route: "hiv_lead", currentQuoteId: "q1", now: "2026-10-03T00:00:00Z", actorId: "u1" };
const STEPS = [
  { kind: "approve" },
  { kind: "owner_accept", confirmed: true },
  { kind: "verify_first", amount: 1000 },
  { kind: "record_collection", arrangement: "TEST direct debit" },
] as const;
const apply = (p: PlanRow, a: (typeof STEPS)[number]) => {
  const r = applyPlanAction(p, a, ctx);
  if (!r.ok) throw new Error(r.error);
  return { ...p, ...r.patch };
};
const gate = (plan: PlanRow | null, route: "hiv_lead" | "installer_supplied" = "hiv_lead", quoteId = "q1") =>
  evaluatePaymentGate({
    enabled: true, route, currentQuote: { id: quoteId, customer_total_inc_gst: 10000 },
    invoice: { quote_id: quoteId, total_inc_gst: 10000, total_paid: 0 }, plan, overrideCount: 0,
  });

describe("instalment plan → payment gate", () => {
  test("no conditions -> blocked", () => {
    expect(gate(base()).cleared).toBe(false);
    expect(planChecklist(base(), "q1").clearsGate).toBe(false);
  });
  test("each condition alone -> blocked", () => {
    for (const s of STEPS) {
      const p = apply(base(), s);
      expect(p.status).toBe("proposed");
      expect(gate(p).cleared).toBe(false);
    }
  });
  test.skip("RETIRED (Jo 7 Oct safety check payment) – conditions added one at a time stay blocked until all four", () => {
    let p = base();
    STEPS.forEach((s, i) => {
      p = apply(p, s);
      expect(gate(p).cleared).toBe(i === STEPS.length - 1);
    });
    expect(p.status).toBe("active");
    expect(gate(p)).toEqual({ cleared: true, option: "instalment_plan_active" });
  });
  test("any order still needs all four", () => {
    let p = base();
    for (const s of [...STEPS].reverse()) p = apply(p, s);
    expect(p.status).toBe("active");
  });
  const full = () => STEPS.reduce(apply, base());
  test("failed / overdue / cancelled / superseded -> blocked and frozen", () => {
    for (const status of ["failed", "overdue", "cancelled", "superseded"] as const) {
      const r = applyPlanAction(full(), { kind: "mark", status, reason: "TEST reason" }, ctx);
      expect(r.ok).toBe(true);
      const p = { ...full(), ...(r.ok ? r.patch : {}) };
      expect(gate(p).cleared).toBe(false);
      expect(applyPlanAction(p, { kind: "approve" }, ctx).ok).toBe(false);
    }
  });
  test("mark needs a reason", () => {
    expect(applyPlanAction(base(), { kind: "mark", status: "failed", reason: " " }, ctx).ok).toBe(false);
  });
  test("plan attached to old quote -> blocked, and cannot progress", () => {
    expect(gate(full(), "hiv_lead", "q2").cleared).toBe(false);
    expect(planChecklist(full(), "q2").clearsGate).toBe(false);
    expect(applyPlanAction(base(), { kind: "approve" }, { ...ctx, currentQuoteId: "q2" }).ok).toBe(false);
  });
  test("installer-supplied customer: gate follows the safety-check rule (Jo 24 Oct); the retired instalment plan stays refused", () => {
    expect(gate(full(), "installer_supplied")).not.toEqual({ cleared: false, blocker: PAYMENT_RULE_EXCEPTION });
    expect(proposeBlocker({ route: "installer_supplied", currentQuoteId: "q1", invoiceQuoteId: "q1", openPlanExists: false })).toContain("Payment rule exception");
    expect(applyPlanAction(base(), { kind: "approve" }, { ...ctx, route: "installer_supplied" }).ok).toBe(false);
  });
  test("propose needs current quote + its invoice, one open plan only", () => {
    expect(proposeBlocker({ route: "hiv_lead", currentQuoteId: null, invoiceQuoteId: null, openPlanExists: false })).not.toBeNull();
    expect(proposeBlocker({ route: "hiv_lead", currentQuoteId: "q1", invoiceQuoteId: "q0", openPlanExists: false })).not.toBeNull();
    expect(proposeBlocker({ route: "hiv_lead", currentQuoteId: "q1", invoiceQuoteId: "q1", openPlanExists: true })).not.toBeNull();
    expect(proposeBlocker({ route: "hiv_lead", currentQuoteId: "q1", invoiceQuoteId: "q1", openPlanExists: false })).toBeNull();
  });
  test("owner acceptance requires the tick box", () => {
    expect(applyPlanAction(base(), { kind: "owner_accept", confirmed: false }, ctx).ok).toBe(false);
  });
  test("owner wording is the approved text", () => {
    expect(OWNER_PLAN_TERMS).toHaveLength(7);
  });
});

describe("access paths (server code)", () => {
  const fns = readFileSync(new URL("../src/lib/instalment-plan.functions.ts", import.meta.url), "utf8");
  const srv = readFileSync(new URL("../src/lib/instalment-plan.server.ts", import.meta.url), "utf8");
  test("every office function checks office role", () => {
    for (const name of ["getOfficeInstalmentPlans", "proposeInstalmentPlan", "officeInstalmentAction"]) {
      const body = fns.split(`export const ${name}`)[1].split("export const")[0];
      expect(body).toContain("requireAdmin(context.supabase)");
    }
  });
  test("office action schema cannot carry owner acceptance; owner fn only accepts", () => {
    const office = fns.split("const officeAction")[1].split("]);")[0];
    expect(office).not.toContain("owner_accept");
    const owner = fns.split("export const acceptInstalmentPlan")[1];
    expect(owner).toContain('kind: "owner_accept"');
    expect(owner).toContain("true)");
  });
  test("owner path checks job ownership and blocks other actions", () => {
    expect(srv).toContain('throw new WorkflowError("Owners can only accept plan terms.")');
    expect(srv).toContain("await assertOwner(plan.job_id, actorId)");
    expect(srv).toContain('throw new WorkflowError("Only the owner can accept the plan terms.")');
  });
  test("no sending, Xero, PIESA, booking, quote, invoice or stage writes", () => {
    for (const bad of [/from\("(bookings|quotes|invoices|messages|job_communications|piesa_records|external_action_outbox)"\)\.(insert|update|upsert)/, /commit_guarded_stage|transitionJob|xero\.server|mitti|sendEmail|\.update\(\{\s*stage/]) {
      expect(srv).not.toMatch(bad);
    }
  });
});

describe("practice database (PGlite)", () => {
  test("only office and the owner can read; nobody can write directly", async () => {
    const db = await paymentDb();
    await db.exec(PAY_SQL);
    await db.exec(`INSERT INTO public.instalment_plans (job_id, quote_id, invoice_id) VALUES ('${PID.hivJob}', '${PID.hivQuote}', '${PID.hivInv}')`);
    const count = (u: string) => asUser(db, u, async () => (await db.query("SELECT id FROM public.instalment_plans")).rows.length);
    expect(await count(PID.office)).toBe(1);
    expect(await count(PID.owner)).toBe(1);
    expect(await count(PID.stranger)).toBe(0);
    for (const sql of [
      `UPDATE public.instalment_plans SET office_approved_at = now()`,
      `UPDATE public.instalment_plans SET first_instalment_verified_at = now(), collection_recorded_at = now()`,
      `INSERT INTO public.instalment_plans (job_id, quote_id, invoice_id) VALUES ('${PID.hivJob}', '${PID.hivQuote}', '${PID.hivInv}')`,
    ]) {
      await expect(asUser(db, PID.owner, () => db.exec(sql))).rejects.toThrow();
      await expect(asUser(db, PID.stranger, () => db.exec(sql))).rejects.toThrow();
    }
    // Gate stays blocked with the switch off even when every condition holds.
    await db.exec(`UPDATE public.instalment_plans SET status='active', office_approved_at=now(), owner_accepted_at=now(), first_instalment_verified_at=now(), collection_recorded_at=now()`);
    expect(await cleared(db, PID.hivInv)).toBe(false);
  });
});
