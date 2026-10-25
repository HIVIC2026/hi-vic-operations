// Audit F01 on PGlite: the REAL payments.server ledger functions — a Stripe $349 later reconciled into Xero counts once,
// a Xero payment deleted after it was recorded is reversed once, and a re-sync with the same Xero list writes nothing.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean not null default false, created_at timestamptz default clock_timestamp());`); // live columns (types.ts)
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  paymentGateActiveForJob: async () => true,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const { PAYMENT_EVENT, paymentLedger, rawPaymentLedger, reconciledInvoicePaidCents, recordXeroPayments } = await import("../src/lib/payments.server");
const { cumulativePaidCents } = await import("../src/lib/payments.core");

const JOB = "00000000-0000-0000-0000-0000000f0101", INV = "00000000-0000-0000-0000-0000000f0201";
const T0 = "2026-10-20T01:00:00.000Z";
const card = () => db.query("insert into workflow_events (job_id, event_type, summary, details) values ($1,$2,'card',$3)", [JOB, PAYMENT_EVENT, JSON.stringify({ invoice_id: INV, amount_cents: 34_900, source: "card", paid_at: T0, note: "stripe:pi_3TestAbc123", stripe_payment_intent: "pi_3TestAbc123" })]);
const types = async () => (await db.query<{ event_type: string }>("select event_type from workflow_events where job_id=$1 order by created_at", [JOB])).rows.map((r) => r.event_type);

beforeEach(async () => { await db.exec("delete from workflow_events"); });

describe("payment ledger (audit F01)", () => {
  test("Stripe $349, then the same $349 arrives in Xero → counted once, before and after the ledger records it", async () => {
    await card();
    const xero = [{ PaymentID: "xp-1", Amount: 349, Date: "2026-10-23T00:00:00", Reference: "Stripe pi_3TestAbc123" }];
    expect(await reconciledInvoicePaidCents(JOB, INV, { xeroPayments: xero, xeroAmountPaid: 349 })).toBe(34_900);
    expect(await recordXeroPayments(INV, JOB, xero, null, { fullList: true })).toBe(1);
    expect(await reconciledInvoicePaidCents(JOB, INV, { xeroPayments: xero, xeroAmountPaid: 349 })).toBe(34_900);
    expect(await reconciledInvoicePaidCents(JOB, INV, { totalPaid: 698 })).toBe(34_900); // the old inflated mirror no longer wins
    expect(cumulativePaidCents(await paymentLedger(JOB, INV))).toBe(34_900);
    expect((await rawPaymentLedger(JOB, INV)).length).toBe(2); // both rows kept as history
  });
  test("idempotent re-sync: same Xero list → nothing written", async () => {
    const xero = [{ PaymentID: "xp-1", Amount: 349, Date: "2026-10-23T00:00:00" }];
    expect(await recordXeroPayments(INV, JOB, xero, null, { fullList: true })).toBe(1);
    expect(await recordXeroPayments(INV, JOB, xero, null, { fullList: true })).toBe(0);
    expect(await types()).toEqual([PAYMENT_EVENT]);
  });
  test("a recorded Xero payment later DELETED → one reversal, total goes down to 0; never reversed twice", async () => {
    await recordXeroPayments(INV, JOB, [{ PaymentID: "xp-1", Amount: 349, Date: "2026-10-23T00:00:00" }], null, { fullList: true });
    const after = [{ PaymentID: "xp-1", Amount: 349, Date: "2026-10-23T00:00:00", Status: "DELETED" }];
    expect(await recordXeroPayments(INV, JOB, after, null, { fullList: true })).toBe(1);
    expect(await recordXeroPayments(INV, JOB, after, null, { fullList: true })).toBe(0);
    expect(await types()).toEqual([PAYMENT_EVENT, "owner_payment_reversed"]);
    expect(await reconciledInvoicePaidCents(JOB, INV, { xeroPayments: after, xeroAmountPaid: 0 })).toBe(0);
    expect(await reconciledInvoicePaidCents(JOB, INV, { totalPaid: 349 })).toBe(0);
    expect(await paymentLedger(JOB, INV)).toEqual([]);
  });
  test("a partial Xero list (fullList false) never reverses", async () => {
    await recordXeroPayments(INV, JOB, [{ PaymentID: "xp-1", Amount: 349, Date: "2026-10-23T00:00:00" }], null, { fullList: true });
    expect(await recordXeroPayments(INV, JOB, [], null, { fullList: false })).toBe(0);
    expect(await types()).toEqual([PAYMENT_EVENT]);
  });
  test("invoice paid before the ledger existed: Xero's mirrored total counts once (never added to a card row)", async () => {
    expect(await reconciledInvoicePaidCents(JOB, INV, { totalPaid: 349 })).toBe(34_900);
    await card();
    expect(await reconciledInvoicePaidCents(JOB, INV, { totalPaid: 349 })).toBe(34_900);
  });
});
