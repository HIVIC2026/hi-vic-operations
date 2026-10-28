// Audits R06 + R02 (external review 25 Oct 2026) on PGlite — throwaway in-memory Postgres, fake TEST rows only.
// R06: pending migration payment-receipt-once.sql makes the ledger's receipt identity unique, so two CONCURRENT Stripe
//      deliveries for one PaymentIntent (checkout.session.completed + payment_intent.succeeded) write ONE ledger row,
//      apply the money once and run the downstream payment steps once — exercised through the REAL stripe.server /
//      payments.server code with both callbacks forced to read an empty ledger before either inserts.
// R02: a $349 card payment and a separate $349 bank payment credit $698 (and are raised once for the office); the same
//      card receipt later in Xero (Stripe id in the Reference) credits $349 once; repeats, reversals and refunds keep the
//      right net amount.
// Fixture mirrors drizzle 0000 workflow_events (+ the append-only trigger); job_id is nullable as in the live types.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { embedShim } from "./helpers/pglite-embed-shim";

const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");
const MIGRATION = "payment-receipt-once.sql", UNDO = "payment-receipt-once.undo.sql";
const JOB = "00000000-0000-4000-8000-0000000a0601", INV = "00000000-0000-4000-8000-0000000a0602", QUOTE = "00000000-0000-4000-8000-0000000a0603";

const db = new PGlite();
await db.exec(`
  CREATE TABLE public.jobs (id uuid primary key, job_number text, stage text, source text, business_unit text, last_activity_at timestamptz);
  CREATE TABLE public.quotes (id uuid primary key, job_id uuid, kind text default 'installation', status text default 'accepted', accepted_at timestamptz, customer_total_inc_gst numeric);
  CREATE TABLE public.invoices (id uuid primary key, job_id uuid, quote_id uuid, kind text default 'installation', total_inc_gst numeric, total_paid numeric default 0, deposit_amount numeric default 0,
    xero_invoice_number text, xero_reference text, xero_online_url text, xero_invoice_id text, balance_due_date date, created_at timestamptz default now());
  CREATE TABLE public.workflow_settings (id int primary key, safety_check_payment_inc_gst numeric);
  CREATE TABLE public.bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, created_at timestamptz default now(), scheduled_start timestamptz);
  CREATE TABLE public.payment_overrides (id uuid primary key default gen_random_uuid(), invoice_id uuid, gate text);
  CREATE TABLE public.quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, code text, line_total_inc_gst numeric);
  CREATE TABLE public.workflow_events (
    id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id) on delete cascade, actor_id uuid,
    event_type text not null, from_stage text, to_stage text, summary text not null, details jsonb not null default '{}'::jsonb,
    internal boolean not null default false, created_at timestamptz not null default clock_timestamp());
  CREATE FUNCTION public.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workflow_events is append-only'; END $$;
  CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON public.workflow_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();
`);

// Barrier: while `race.on`, a ledger insert waits until two ledger reads have finished — the exact interleaving the
// review describes (both callbacks read an empty ledger, then both insert).
const race = { on: false, reads: 0, release: () => {}, bothRead: Promise.resolve() };
const arm = () => { race.on = true; race.reads = 0; race.bothRead = new Promise<void>((r) => { race.release = r; }); };
const base = embedShim(db, { invoices: { jobs: { table: "jobs", fk: "job_id", on: "base" }, quotes: { table: "quotes", fk: "quote_id", on: "base" } } });
const admin = {
  from(table: string) {
    const b = base.from(table) as Record<string, unknown> & { run: () => Promise<unknown> };
    if (table !== "workflow_events") return b;
    let ledgerRead = false, ledgerInsert = false;
    const origIn = b["in"] as (c: string, v: unknown[]) => unknown, origInsert = b["insert"] as (p: Record<string, unknown>) => unknown;
    b["in"] = (c: string, v: unknown[]) => { if (c === "event_type" && v.includes("owner_payment_recorded")) ledgerRead = true; return origIn(c, v); };
    b["insert"] = (p: Record<string, unknown>) => { ledgerInsert = ["owner_payment_recorded", "owner_payment_reversed"].includes(String(p["event_type"])); return origInsert(p); };
    b["then"] = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => (async () => {
      if (race.on && ledgerInsert) await race.bothRead;
      const out = await b.run();
      if (race.on && ledgerRead && ++race.reads >= 2) race.release();
      return out;
    })().then(res, rej);
    return b;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  paymentGateActiveForJob: async () => true,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown, opts?: { internal?: boolean }) => {
    await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,$6)", [job, actor, type, summary, JSON.stringify(details ?? {}), opts?.internal ?? false]);
  },
}));
// Downstream effects, counted: money applied to the invoice mirror, the safety-check email trigger, auto-advance.
const calls = { applyPaid: [] as number[], safetyPaid: 0, advance: 0 };
mock.module("../src/lib/xero.server", () => ({ applyPaidAmount: async (_inv: string, paid: number) => { calls.applyPaid.push(paid); await db.query("update invoices set total_paid=$1 where id=$2", [paid, INV]); } }));
mock.module("../src/lib/owner-email-triggers.server", () => ({ onSafetyCheckPaid: async () => { calls.safetyPaid++; } }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => { calls.advance++; } }));

const { recordStripePayment, recordStripeRefund } = await import("../src/lib/stripe.server");
const { flagUnclearPaymentMatches, paymentLedger, rawPaymentLedger, reconciledInvoicePaidCents, recordXeroPayments } = await import("../src/lib/payments.server");
const { cumulativePaidCents } = await import("../src/lib/payments.core");
const { parseStripeEvent } = await import("../src/lib/stripe.core");
const { mittiOfficeItems } = await import("../src/lib/ready-check-chase.core");
const { NEEDS_TEXT } = await import("../src/lib/allocation.core");
/** The Needs me rows these events raise (same pure rule list needs.server reads). */
const officeRows = async () => {
  const ev = (await db.query<{ job_id: string; event_type: string; created_at: Date; details: Record<string, unknown>; summary: string }>("select job_id, event_type, created_at, details, summary from workflow_events order by created_at")).rows;
  const items = mittiOfficeItems(ev.map((e) => ({ ...e, created_at: e.created_at.toISOString() })), new Date());
  for (const i of items) expect(NEEDS_TEXT[i.code].next).toMatch(/Stripe id/);
  return items;
};

const T0 = 1_792_713_600; // 2026-10-23T00:00Z, seconds
const meta = { job_id: JOB, invoice_id: INV, step: "safety_check" };
const checkoutEvent = (pi = "pi_3R06Race0001") => JSON.stringify({ id: "evt_cs_1", type: "checkout.session.completed", livemode: false, created: T0, data: { object: { id: "cs_test_1", payment_status: "paid", amount_total: 34_900, payment_intent: pi, metadata: meta } } });
const intentEvent = (pi = "pi_3R06Race0001") => JSON.stringify({ id: "evt_pi_1", type: "payment_intent.succeeded", livemode: false, created: T0 + 1, data: { object: { id: pi, amount_received: 34_900, latest_charge: "ch_3R06Race0001", metadata: meta } } });
const refundEvent = (refunded: number, id = "evt_rf_1", pi = "pi_3R06Race0001") => JSON.stringify({ id, type: "charge.refunded", livemode: false, created: T0 + 86_400, data: { object: { id: "ch_3R06Race0001", payment_intent: pi, amount_refunded: refunded } } });
const fact = (body: string) => parseStripeEvent(body)!.fact!;
const refund = (body: string) => parseStripeEvent(body)!.refund!;
const count = async (type: string) => Number((await db.query<{ n: number }>("select count(*)::int n from workflow_events where event_type=$1", [type])).rows[0]!.n);
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "error");
const ins = (type: string, details: Record<string, unknown>) => db.query("insert into workflow_events (job_id, event_type, summary, details) values ($1,$2,'s',$3::jsonb)", [JOB, type, JSON.stringify(details)]);

async function reset(withIndex: boolean) {
  await db.exec(`DROP INDEX IF EXISTS public.workflow_events_payment_receipt_once_idx;
    ALTER TABLE public.workflow_events DISABLE TRIGGER workflow_events_immutable; DELETE FROM public.workflow_events; ALTER TABLE public.workflow_events ENABLE TRIGGER workflow_events_immutable;
    DELETE FROM public.invoices; DELETE FROM public.quotes; DELETE FROM public.jobs; DELETE FROM public.workflow_settings;
    INSERT INTO public.jobs (id, job_number, stage, source) VALUES ('${JOB}', 'TEST-R06', 'quote_accepted', 'qa_test');
    INSERT INTO public.quotes (id, job_id, accepted_at, customer_total_inc_gst) VALUES ('${QUOTE}', '${JOB}', '2026-10-20T00:00:00Z', 4000);
    INSERT INTO public.invoices (id, job_id, quote_id, total_inc_gst) VALUES ('${INV}', '${JOB}', '${QUOTE}', 4000);
    INSERT INTO public.workflow_settings (id, safety_check_payment_inc_gst) VALUES (1, 349);`);
  if (withIndex) await db.exec(read(MIGRATION));
  race.on = false;
  calls.applyPaid = []; calls.safetyPaid = 0; calls.advance = 0;
}

describe("migration payment-receipt-once.sql", () => {
  beforeEach(() => reset(false));
  test("only creates the one unique index; no table, check or trigger change", () => {
    const sql = read(MIGRATION).replace(/^\s*--.*$/gm, "");
    expect(sql).toMatch(/create unique index if not exists workflow_events_payment_receipt_once_idx/);
    expect(sql).not.toMatch(/alter table|constraint|drop |trigger|update |delete /i);
    expect(read(UNDO).replace(/^\s*--.*$/gm, "").trim()).toBe("drop index if exists public.workflow_events_payment_receipt_once_idx;");
  });
  test("builds over existing history (legacy rows without a receipt_key, even duplicated) and is idempotent", async () => {
    const legacy = { invoice_id: INV, amount_cents: 34_900, source: "card", note: "stripe:pi_old" };
    await ins("owner_payment_recorded", legacy);
    await ins("owner_payment_recorded", legacy);
    await db.exec(read(MIGRATION));
    await db.exec(read(MIGRATION));
    expect(await code(ins("owner_payment_recorded", legacy))).toBeNull(); // legacy shape: never a conflict
  });
  test("before: a second row with the same receipt key is accepted; after: refused with 23505, scoped to the ledger events", async () => {
    await ins("owner_payment_recorded", { receipt_key: "stripe:pi_A" });
    expect(await code(ins("owner_payment_recorded", { receipt_key: "stripe:pi_A" }))).toBeNull();
    await reset(true);
    await ins("owner_payment_recorded", { receipt_key: "stripe:pi_A" });
    expect(await code(ins("owner_payment_recorded", { receipt_key: "stripe:pi_A" }))).toBe("23505");
    expect(await code(ins("owner_payment_reversed", { receipt_key: "stripe:pi_A" }))).toBe("23505"); // one key space
    await ins("owner_payment_reversed", { receipt_key: "xero-reversal:inv:x1" });
    expect(await code(ins("owner_payment_reversed", { receipt_key: "xero-reversal:inv:x1" }))).toBe("23505");
    await ins("owner_payment_recorded", { receipt_key: "stripe:pi_B" });
    await ins("stripe_checkout_started", { receipt_key: "stripe:pi_A" }); // other event types are never affected
    await ins("stripe_checkout_started", { receipt_key: "stripe:pi_A" });
    expect(await code(db.query("update workflow_events set summary='x'"))).not.toBeNull(); // still append-only
  });
  test("two CONCURRENT raw inserts of one receipt: exactly one wins", async () => {
    await reset(true);
    const r = await Promise.all([code(ins("owner_payment_recorded", { receipt_key: "stripe:pi_C" })), code(ins("owner_payment_recorded", { receipt_key: "stripe:pi_C" }))]);
    expect(r.sort()).toEqual([null, "23505"].sort());
    expect(await count("owner_payment_recorded")).toBe(1);
  });
  test("undo drops only that index; the server's read-then-insert check is the remaining guard", async () => {
    await reset(true);
    await db.exec(read(UNDO));
    await db.exec(read(UNDO));
    const idx = await db.query("select 1 from pg_indexes where indexname='workflow_events_payment_receipt_once_idx'");
    expect(idx.rows).toHaveLength(0);
  });
});

describe("R06: concurrent Stripe callbacks through the real handler", () => {
  test("WITHOUT the index (control): both callbacks read an empty ledger and both record — the defect the review found", async () => {
    await reset(false);
    arm();
    await Promise.all([recordStripePayment(fact(checkoutEvent())), recordStripePayment(fact(intentEvent()))]);
    expect(await count("owner_payment_recorded")).toBe(2);
  });
  test("WITH the index: checkout.session.completed + payment_intent.succeeded → one PaymentIntent, one ledger row, one downstream progression", async () => {
    await reset(true);
    arm();
    const outcomes = await Promise.all([recordStripePayment(fact(checkoutEvent())), recordStripePayment(fact(intentEvent()))]);
    expect(race.reads).toBeGreaterThanOrEqual(2); // both read before either inserted
    expect(outcomes.sort()).toEqual(["duplicate", "recorded"]);
    expect(await count("owner_payment_recorded")).toBe(1);
    const [row] = await rawPaymentLedger(JOB, INV);
    expect(row!.stripeIds).toContain("pi_3R06Race0001");
    expect(calls.applyPaid).toEqual([349]);   // one accounting entry
    expect(calls.safetyPaid).toBe(1);          // one downstream progression
    expect(calls.advance).toBe(1);
    expect(await reconciledInvoicePaidCents(JOB, INV, { totalPaid: 349 })).toBe(34_900);
    // A later retry of either event is a plain duplicate and changes nothing.
    race.on = false;
    expect(await recordStripePayment(fact(intentEvent()))).toBe("duplicate");
    expect(await recordStripePayment(fact(checkoutEvent()))).toBe("duplicate");
    expect(calls.applyPaid).toEqual([349]);
    expect(calls.advance).toBe(1);
  });
  test("the same event delivered twice at once (Stripe retry overlap) also records once", async () => {
    await reset(true);
    arm();
    const outcomes = await Promise.all([recordStripePayment(fact(intentEvent())), recordStripePayment(fact(intentEvent()))]);
    expect(outcomes.sort()).toEqual(["duplicate", "recorded"]);
    expect(await count("owner_payment_recorded")).toBe(1);
    expect(calls.advance).toBe(1);
  });
  test("concurrent Xero syncs of one PaymentID record it once", async () => {
    await reset(true);
    arm();
    const xero = [{ PaymentID: "xp-1", Amount: 349, Date: "2026-10-23T00:00:00" }];
    const written = await Promise.all([recordXeroPayments(INV, JOB, xero, null, { fullList: true }), recordXeroPayments(INV, JOB, xero, null, { fullList: true })]);
    expect(written.sort()).toEqual([0, 1]);
    expect(await count("owner_payment_recorded")).toBe(1);
  });
});

describe("R02: separate payments count separately; one receipt counts once", () => {
  beforeEach(() => reset(true));
  test("$349 card + separate $349 bank transfer (no Stripe id in Xero) → counted once ($349), still raised once for the office", async () => {
    await recordStripePayment(fact(intentEvent()));
    const xero = [{ PaymentID: "xp-bank", Amount: 349, Date: "2026-10-25T00:00:00", Reference: "TEST-R06" }];
    await recordXeroPayments(INV, JOB, xero, null, { fullList: true });
    expect(await reconciledInvoicePaidCents(JOB, INV, { xeroPayments: xero, xeroAmountPaid: 349 })).toBe(34_900);
    expect(await reconciledInvoicePaidCents(JOB, INV)).toBe(34_900);
    expect(cumulativePaidCents(await paymentLedger(JOB, INV))).toBe(34_900);
    expect(await flagUnclearPaymentMatches(JOB, INV, xero)).toBe(1);
    expect(await flagUnclearPaymentMatches(JOB, INV, xero)).toBe(0); // once per pair
    expect(await count("owner_payment_match_unclear")).toBe(1);
  });
  test("the same card receipt later in Xero (charge id in the Reference) → $349 once; the office row clears", async () => {
    await recordStripePayment(fact(intentEvent()));
    // First the bookkeeper applied it without the id (unclear → raised), then re-applied it with the Stripe charge id.
    const noId = [{ PaymentID: "xp-1", Amount: 349, Date: "2026-10-24T00:00:00" }];
    await recordXeroPayments(INV, JOB, noId, null, { fullList: true });
    expect(await flagUnclearPaymentMatches(JOB, INV, noId)).toBe(1);
    expect((await officeRows()).map((i) => i.code)).toEqual(["payment_match_unclear"]);
    const withId = [{ PaymentID: "xp-1", Amount: 349, Date: "2026-10-24T00:00:00", Status: "DELETED" }, { PaymentID: "xp-2", Amount: 349, Date: "2026-10-24T00:00:00", Reference: "Stripe ch_3R06Race0001" }];
    await recordXeroPayments(INV, JOB, withId, null, { fullList: true });
    expect(await reconciledInvoicePaidCents(JOB, INV, { xeroPayments: withId, xeroAmountPaid: 349 })).toBe(34_900);
    expect(await reconciledInvoicePaidCents(JOB, INV)).toBe(34_900);
    expect(cumulativePaidCents(await paymentLedger(JOB, INV))).toBe(34_900);
    expect(await flagUnclearPaymentMatches(JOB, INV, withId)).toBe(0);
    expect(await count("owner_payment_match_resolved")).toBe(1);
    expect(await officeRows()).toEqual([]);
    // Repeat delivery of the Xero list and of the Stripe event: nothing new, same amount.
    expect(await recordXeroPayments(INV, JOB, withId, null, { fullList: true })).toBe(0);
    expect(await recordStripePayment(fact(checkoutEvent()))).toBe("duplicate");
    expect(await reconciledInvoicePaidCents(JOB, INV)).toBe(34_900);
  });
  test("reversal: the matched Xero payment deleted later → the card receipt still counts once ($349), never $0 or $698", async () => {
    await recordStripePayment(fact(intentEvent()));
    await recordXeroPayments(INV, JOB, [{ PaymentID: "xp-2", Amount: 349, Date: "2026-10-24T00:00:00", Reference: "pi_3R06Race0001" }], null, { fullList: true });
    const after = [{ PaymentID: "xp-2", Amount: 349, Date: "2026-10-24T00:00:00", Reference: "pi_3R06Race0001", Status: "DELETED" }];
    expect(await recordXeroPayments(INV, JOB, after, null, { fullList: true })).toBe(1);
    expect(await recordXeroPayments(INV, JOB, after, null, { fullList: true })).toBe(0);
    expect(await reconciledInvoicePaidCents(JOB, INV)).toBe(34_900);
  });
  test("refund: a Stripe refund lowers the card receipt by the refunded amount, once per refund state, also when delivered concurrently", async () => {
    await recordStripePayment(fact(intentEvent()));
    expect(await recordStripeRefund(refund(refundEvent(10_000)))).toBe("recorded");
    expect(await reconciledInvoicePaidCents(JOB, INV)).toBe(24_900);
    arm();
    const r = await Promise.all([recordStripeRefund(refund(refundEvent(34_900, "evt_rf_2"))), recordStripeRefund(refund(refundEvent(34_900, "evt_rf_2")))]);
    race.on = false;
    expect(r.sort()).toEqual(["duplicate", "recorded"]);
    expect(await count("owner_payment_reversed")).toBe(2);
    expect(await reconciledInvoicePaidCents(JOB, INV)).toBe(0);
    expect(await recordStripeRefund(refund(refundEvent(34_900, "evt_rf_3")))).toBe("duplicate"); // repeat delivery
    expect(await recordStripeRefund(refund(refundEvent(10_000, "evt_rf_old")))).toBe("duplicate"); // late older state
    expect(await reconciledInvoicePaidCents(JOB, INV)).toBe(0);
    expect(await recordStripeRefund(refund(refundEvent(34_900, "evt_x", "pi_unknown")))).toBe("unknown_payment");
  });
  test("refund: two DIFFERENT partial refund states delivered concurrently never add up twice (cumulative wins)", async () => {
    await recordStripePayment(fact(intentEvent()));
    arm();
    await Promise.all([recordStripeRefund(refund(refundEvent(10_000, "evt_rf_a"))), recordStripeRefund(refund(refundEvent(20_000, "evt_rf_b")))]);
    race.on = false;
    expect(await reconciledInvoicePaidCents(JOB, INV)).toBe(14_900); // $349 − $200 refunded in total
    expect(cumulativePaidCents(await paymentLedger(JOB, INV))).toBe(14_900);
  });
});
