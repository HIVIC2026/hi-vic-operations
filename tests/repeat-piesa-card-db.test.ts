// Spec "Checking" (repeat safety check payment, Jo 29 Oct): a card payment for the repeat step records it paid ONCE (a
// second webhook delivery does nothing) and not at all when the amount is short. Batch 3b: the card row names the repeat's
// OWN invoice, and that invoice is paid in full. REAL repeatPaidByCard on PGlite.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean not null default false, created_at timestamptz default clock_timestamp());`); // live columns (types.ts)
await db.exec(`CREATE TABLE invoices (id uuid primary key, job_id uuid, kind text, repeat_key text, total_inc_gst numeric);`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
// No install-day facts: the lapse is read from the office choice's deadline (as after the job leaves installation_scheduling).
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => null }));
const allocations: string[] = [];
mock.module("../src/lib/allocation.server", () => ({ startPiesaAllocation: async (jobId: string) => { allocations.push(jobId); } }));

const { repeatPaidByCard } = await import("../src/lib/repeat-piesa.server");
const { PAYMENT_EVENT } = await import("../src/lib/payment-ledger.server");

const JOB = "00000000-0000-0000-0000-0000000f0301", INV = "00000000-0000-0000-0000-0000000f0401";
const D = "2026-11-20";
const ev = (type: string, details: unknown) => db.query("insert into workflow_events (job_id, event_type, summary, details) values ($1,$2,'x',$3)", [JOB, type, JSON.stringify(details)]);
const paidCount = async () => (await db.query<{ n: number }>("select count(*)::int as n from workflow_events where job_id=$1 and event_type='repeat_piesa_paid'", [JOB])).rows[0]!.n;

beforeEach(async () => {
  await db.exec("delete from workflow_events; delete from invoices"); allocations.length = 0;
  await db.query("insert into invoices (id, job_id, kind, repeat_key, total_inc_gst) values ($1,$2,'repeat_safety_check',$3,349)", [INV, JOB, D]);
  await ev("repeat_piesa_payer_chosen", { deadline: D, payer: "owner", price_inc_gst: 349 });
  await ev("repeat_piesa_accepted", { deadline: D, payer: "owner", owner_charge_inc_gst: 349, paid_before_cents: 34_900 });
});

describe("repeat safety check paid by card (spec Checking)", () => {
  test("full card payment → recorded paid once; a second webhook delivery does nothing", async () => {
    await ev(PAYMENT_EVENT, { invoice_id: INV, amount_cents: 34_900, source: "card", step: "repeat_safety_check" });
    expect(await repeatPaidByCard(JOB, INV, 34_900)).toBe(true);
    expect(await repeatPaidByCard(JOB, INV, 34_900)).toBe(false);
    expect(await paidCount()).toBe(1);
    expect(allocations).toEqual([JOB]); // the normal PIESA offer started once
  });
  test("short card amount → not recorded paid, no offer", async () => {
    await ev(PAYMENT_EVENT, { invoice_id: INV, amount_cents: 20_000, source: "card", step: "repeat_safety_check" });
    expect(await repeatPaidByCard(JOB, INV, 20_000)).toBe(false);
    expect(await paidCount()).toBe(0);
    expect(allocations).toEqual([]);
  });
});
