// PR A fix round 1 (launch QA 7 Nov 2026) on PGlite — throwaway in-memory Postgres, fake TEST rows only.
// One card payment sends checkout.session.completed AND payment_intent.succeeded at nearly the same time. Whatever way the
// two deliveries overlap, the installer gets ONE "Owner accepted" email and the owner ONE O22 "You're in" email.
// Real: stripe.server, payments.server, owner-email-triggers.server (onSafetyCheckPaid → fireOwnerEmailOnce) and
// installer-accepted-email.server (the once-guards under test). Faked: only the final senders (counted), auto-advance,
// the Xero paid-amount mirror and in-house suppression (none).
// A read barrier makes the worst interleaving happen every time: both follow-ups read "not sent yet" before either
// claims or records — the defect the review found.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { embedShim } from "./helpers/pglite-embed-shim";

const JOB = "00000000-0000-4000-8000-0000000b0601", INV = "00000000-0000-4000-8000-0000000b0602", QUOTE = "00000000-0000-4000-8000-0000000b0603";
const OWNER = "00000000-0000-4000-8000-0000000b0604", PROP = "00000000-0000-4000-8000-0000000b0605", BIZ = "00000000-0000-4000-8000-0000000b0606", USER = "00000000-0000-4000-8000-0000000b0607";

const db = new PGlite();
await db.exec(`
  CREATE TABLE public.owners (id uuid primary key, full_name text, email text);
  CREATE TABLE public.properties (id uuid primary key, address_line text, suburb text, postcode text);
  CREATE TABLE public.jobs (id uuid primary key, job_number text, stage text, source text, business_unit text, last_activity_at timestamptz, installation_completed_at timestamptz,
    deleted_at timestamptz, channel text, originating_installer_business_id uuid, owner_id uuid, property_id uuid, next_action text);
  CREATE TABLE public.quotes (id uuid primary key, job_id uuid, kind text default 'installation', status text default 'accepted', accepted_at timestamptz, customer_total_inc_gst numeric, veec_discount_inc_gst numeric, version int default 1, created_at timestamptz default now());
  CREATE TABLE public.invoices (id uuid primary key, job_id uuid, quote_id uuid, kind text default 'installation', total_inc_gst numeric, total_paid numeric default 0, deposit_amount numeric default 0,
    xero_invoice_number text, xero_reference text, xero_online_url text, xero_invoice_id text, balance_due_date date, created_at timestamptz default now(), repeat_key text);
  CREATE TABLE public.piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid, outcome text, section_c_signed_at timestamptz, is_current boolean default true);
  CREATE TABLE public.workflow_settings (id int primary key, safety_check_payment_inc_gst numeric);
  CREATE TABLE public.bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, created_at timestamptz default now(), scheduled_start timestamptz);
  CREATE TABLE public.payment_overrides (id uuid primary key default gen_random_uuid(), invoice_id uuid, gate text);
  CREATE TABLE public.quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, code text, line_total_inc_gst numeric);
  CREATE TABLE public.profiles (id uuid primary key, full_name text, email text);
  CREATE TABLE public.businesses (id uuid primary key, name text, trading_name text, onboarding_notes text);
  CREATE TABLE public.job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, user_id uuid, business_id uuid, role text, active boolean default true);
  CREATE TABLE public.workflow_events (
    id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id) on delete cascade, actor_id uuid,
    event_type text not null, from_stage text, to_stage text, summary text not null, details jsonb not null default '{}'::jsonb,
    internal boolean not null default false, created_at timestamptz not null default clock_timestamp());
  -- drizzle 0036 + 0039: the once-only send reservation (idempotency_key is globally UNIQUE).
  CREATE TABLE public.customer_email_sends (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id), estimate_link_id uuid, purpose text not null,
    idempotency_key text not null unique, status text not null default 'sending' check (status in ('sending','sent','failed','delivered_unrecorded')),
    provider text, provider_message_id text, communication_id uuid, error text, created_at timestamptz not null default now(), sent_at timestamptz);
  CREATE FUNCTION public.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workflow_events is append-only'; END $$;
  CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON public.workflow_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();
`);
await db.exec(readFileSync(new URL("../docs/pending-migrations/payment-receipt-once.sql", import.meta.url), "utf8"));

// Read barrier on the once-checks: while armed, a read of the given event type waits (up to 400 ms) until a second
// read of it has finished, so two follow-ups both read "not sent yet" before either claims. Faults: forced read errors.
const ONCE_TYPES = ["owner_email_triggered", "installer_accepted_email"] as const;
const gate = { on: false, reads: {} as Record<string, number>, waiters: {} as Record<string, (() => void)[]>, fail: null as string | null };
const arrive = async (type: string) => {
  gate.reads[type] = (gate.reads[type] ?? 0) + 1;
  if (gate.reads[type]! >= 2) { for (const w of gate.waiters[type] ?? []) w(); gate.waiters[type] = []; return; }
  await new Promise<void>((r) => { (gate.waiters[type] ??= []).push(r); setTimeout(r, 400); });
};
const base = embedShim(db, {
  invoices: { jobs: { table: "jobs", fk: "job_id", on: "base" }, quotes: { table: "quotes", fk: "quote_id", on: "base" } },
  jobs: { owners: { table: "owners", fk: "owner_id", on: "base" }, properties: { table: "properties", fk: "property_id", on: "base" } },
  job_assignments: { profiles: { table: "profiles", fk: "user_id", on: "base" }, businesses: { table: "businesses", fk: "business_id", on: "base" } },
});
const admin = {
  from(table: string) {
    const b = base.from(table) as Record<string, unknown> & { run: () => Promise<{ error: unknown }> };
    let onceRead: string | null = null, isSelect = false;
    const origEq = b["eq"] as (c: string, v: unknown) => unknown, origSelect = b["select"] as (...a: unknown[]) => unknown;
    b["select"] = (...a: unknown[]) => { isSelect = true; return origSelect(...a); };
    b["eq"] = (c: string, v: unknown) => { if (table === "workflow_events" && c === "event_type" && (ONCE_TYPES as readonly string[]).includes(String(v))) onceRead = String(v); return origEq(c, v); };
    b["then"] = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => (async () => {
      const read = isSelect && !!onceRead;
      if (read && gate.fail === onceRead) return { data: null, count: null, error: { message: "connection reset" } };
      const out = await b.run();
      if (read && gate.on) await arrive(onceRead!);
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
mock.module("../src/lib/xero.server", () => ({ applyPaidAmount: async (_inv: string, paid: number) => { await db.query("update invoices set total_paid=$1 where id=$2", [paid, INV]); } }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => {} }));
mock.module("../src/lib/in-house-suppression.server", () => ({ inHouseDispatchSkip: async () => null, readInHouseDispatchState: async () => ({ failed: false, held: new Set() }) }));
mock.module("../src/lib/receipt-pdf.server", () => ({ fileReceiptPdf: async () => { throw new Error("no PDFs in this test"); } }));
// The final senders, counted. A small await so the two follow-ups really overlap inside the send.
const sent = { owner: [] as string[], installer: [] as string[], officeResult: { status: "sent", detail: "ok" } };
const tick = () => new Promise((r) => setTimeout(r, 15));
mock.module("../src/lib/approved-owner-emails.server", () => ({ emailOwnerYoureIn: async (_job: string, quoteId: string) => { await tick(); sent.owner.push(quoteId); return "sent: ok"; } }));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async (ctx: { label: string }) => { await tick(); sent.installer.push(ctx.label); return { status: "sent", detail: "test inbox" }; } }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { label: string }) => { await tick(); sent.installer.push(p.label); return sent.officeResult; } }));

const { recordStripePayment } = await import("../src/lib/stripe.server");
const { emailInstallerQuoteAccepted } = await import("../src/lib/installer-accepted-email.server");
const { fireOwnerEmailOnce } = await import("../src/lib/owner-email-triggers.server");
const { parseStripeEvent } = await import("../src/lib/stripe.core");
const { TRADE_MESSAGES_PAUSED_REASON } = await import("../src/lib/trade-pause.core");

const NOW = Math.floor(Date.now() / 1000) - 3600; // paid an hour ago: O22 is due (within 7 days)
const meta = { job_id: JOB, invoice_id: INV, step: "safety_check" };
const checkoutEvent = () => JSON.stringify({ id: "evt_cs_1", type: "checkout.session.completed", livemode: false, created: NOW, data: { object: { id: "cs_test_1", payment_status: "paid", amount_total: 34_900, payment_intent: "pi_FIX1", metadata: meta } } });
const intentEvent = () => JSON.stringify({ id: "evt_pi_1", type: "payment_intent.succeeded", livemode: false, created: NOW + 1, data: { object: { id: "pi_FIX1", amount_received: 34_900, latest_charge: "ch_FIX1", metadata: meta } } });
const fact = (body: string) => parseStripeEvent(body)!.fact!;
const count = async (type: string) => Number((await db.query<{ n: number }>("select count(*)::int n from workflow_events where event_type=$1", [type])).rows[0]!.n);
const sends = async () => (await db.query<{ purpose: string; status: string; idempotency_key: string }>("select purpose, status, idempotency_key from customer_email_sends order by created_at")).rows;

async function reset(source = "qa_test") {
  await db.exec(`ALTER TABLE public.workflow_events DISABLE TRIGGER workflow_events_immutable; DELETE FROM public.workflow_events; ALTER TABLE public.workflow_events ENABLE TRIGGER workflow_events_immutable;
    DELETE FROM public.customer_email_sends; DELETE FROM public.job_assignments; DELETE FROM public.invoices; DELETE FROM public.quotes; DELETE FROM public.jobs; DELETE FROM public.workflow_settings;
    DELETE FROM public.owners; DELETE FROM public.properties; DELETE FROM public.profiles; DELETE FROM public.businesses;
    INSERT INTO public.owners VALUES ('${OWNER}', 'Sarah Lee', 'owner@example.test');
    INSERT INTO public.properties VALUES ('${PROP}', '1 Example St', 'Sampletown', '3000');
    INSERT INTO public.jobs (id, job_number, stage, source, channel, owner_id, property_id) VALUES ('${JOB}', 'TEST-FIX1', 'quote_accepted', '${source}', 'hivic_sourced', '${OWNER}', '${PROP}');
    INSERT INTO public.quotes (id, job_id, accepted_at, customer_total_inc_gst) VALUES ('${QUOTE}', '${JOB}', now() - interval '1 day', 4000);
    INSERT INTO public.invoices (id, job_id, quote_id, total_inc_gst) VALUES ('${INV}', '${JOB}', '${QUOTE}', 4000);
    INSERT INTO public.workflow_settings (id, safety_check_payment_inc_gst) VALUES (1, 349);
    INSERT INTO public.profiles VALUES ('${USER}', 'Deep Installer', 'deep@example.test');
    INSERT INTO public.businesses VALUES ('${BIZ}', 'Deep Insulation', null, null);
    INSERT INTO public.job_assignments (job_id, user_id, business_id, role) VALUES ('${JOB}', '${USER}', '${BIZ}', 'installer');`);
  gate.on = false; gate.reads = {}; gate.waiters = {}; gate.fail = null;
  sent.owner = []; sent.installer = []; sent.officeResult = { status: "sent", detail: "ok" };
}

describe("one card payment, two Stripe deliveries → one installer email and one O22", () => {
  beforeEach(() => reset());
  test("both deliveries at once (both read an empty ledger): one ledger row, one installer_accepted_email send, one O22 send", async () => {
    gate.on = true;
    const outcomes = await Promise.all([recordStripePayment(fact(checkoutEvent())), recordStripePayment(fact(intentEvent()))]);
    expect(outcomes.sort()).toEqual(["duplicate", "recorded"]);
    expect(await count("owner_payment_recorded")).toBe(1);
    expect(sent.owner).toEqual([QUOTE]);
    expect(sent.installer).toEqual([`installer_accepted:${QUOTE}`]);
    expect(await count("owner_email_triggered")).toBe(1);
    expect(await count("installer_accepted_email")).toBe(1);
  });
  test("second delivery lands while the first is still sending (fast-path duplicate, both follow-ups overlap): still one of each", async () => {
    gate.on = true;
    const first = recordStripePayment(fact(checkoutEvent()));
    // Wait for the first delivery's ledger row, then deliver the second: it sees the row and re-runs the follow-up.
    for (let i = 0; i < 200 && (await count("owner_payment_recorded")) === 0; i++) await new Promise((r) => setTimeout(r, 2));
    const second = recordStripePayment(fact(intentEvent()));
    expect((await Promise.all([first, second])).sort()).toEqual(["duplicate", "recorded"]);
    expect(await count("owner_payment_recorded")).toBe(1);
    expect(sent.owner).toEqual([QUOTE]);
    expect(sent.installer).toEqual([`installer_accepted:${QUOTE}`]);
    expect(await count("owner_email_triggered")).toBe(1);
    expect(await count("installer_accepted_email")).toBe(1);
    // A later Stripe retry of either event: nothing new is sent.
    gate.on = false;
    expect(await recordStripePayment(fact(intentEvent()))).toBe("duplicate");
    expect(await recordStripePayment(fact(checkoutEvent()))).toBe("duplicate");
    expect(sent.owner).toEqual([QUOTE]);
    expect(sent.installer).toEqual([`installer_accepted:${QUOTE}`]);
  });
});

describe("the installer 'Owner accepted' guard claims before sending", () => {
  beforeEach(() => reset());
  test("two direct calls at once → one send", async () => {
    gate.on = true;
    await Promise.all([emailInstallerQuoteAccepted(JOB, QUOTE), emailInstallerQuoteAccepted(JOB, QUOTE)]);
    expect(sent.installer).toEqual([`installer_accepted:${QUOTE}`]);
    expect(await count("installer_accepted_email")).toBe(1);
  });
  test("a failed history read sends nothing (fails closed); the next run sends once", async () => {
    gate.fail = "installer_accepted_email";
    expect(await emailInstallerQuoteAccepted(JOB, QUOTE)).toMatch(/^skipped/);
    expect(sent.installer).toEqual([]);
    expect(await sends()).toEqual([]);
    gate.fail = null;
    expect(await emailInstallerQuoteAccepted(JOB, QUOTE)).toBe("sent");
    expect(await emailInstallerQuoteAccepted(JOB, QUOTE)).toBe("already sent");
    expect(sent.installer).toHaveLength(1);
  });
  test("an email sent before this fix (history event only, no reservation row) is never sent again", async () => {
    await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'installer_accepted_email','old',$2::jsonb,true)", [JOB, JSON.stringify({ quote_id: QUOTE, status: "sent" })]);
    expect(await emailInstallerQuoteAccepted(JOB, QUOTE)).toBe("already sent");
    expect(sent.installer).toEqual([]);
  });
  test("real installer: a 'Pause all trade messages' hold releases the claim, so the email goes once the pause lifts", async () => {
    await reset("portal");
    sent.officeResult = { status: "blocked", detail: `${TRADE_MESSAGES_PAUSED_REASON} (test)` };
    expect(await emailInstallerQuoteAccepted(JOB, QUOTE)).toMatch(/^held: /);
    expect(await sends()).toEqual([]);
    expect(await count("installer_accepted_email")).toBe(0);
    sent.officeResult = { status: "sent", detail: "ok" };
    expect(await emailInstallerQuoteAccepted(JOB, QUOTE)).toBe("sent");
    expect((await sends()).map((s) => s.status)).toEqual(["sent"]);
    expect(await emailInstallerQuoteAccepted(JOB, QUOTE)).toBe("already sent");
    expect(sent.installer).toEqual(["installer_quote_accepted", "installer_quote_accepted"]);
  });
});

describe("the owner email trigger claims before sending", () => {
  beforeEach(() => reset());
  test("two runs at once for one key → one send, one trigger event", async () => {
    gate.on = true;
    let n = 0;
    const send = async () => { await tick(); n++; return "sent"; };
    const r = await Promise.all([fireOwnerEmailOnce(JOB, "O22", "youre-in:v1:q-race", send), fireOwnerEmailOnce(JOB, "O22", "youre-in:v1:q-race", send)]);
    expect(r.sort()).toEqual(["already handled", "sent"]);
    expect(n).toBe(1);
    expect(await count("owner_email_triggered")).toBe(1);
  });
  test("a failed history read sends nothing", async () => {
    gate.fail = "owner_email_triggered";
    let n = 0;
    expect(await fireOwnerEmailOnce(JOB, "O22", "youre-in:v1:q-fail", async () => { n++; return "sent"; })).toMatch(/^skipped/);
    expect(n).toBe(0);
  });
  test("a key handled before this fix (event with a random id) is never sent again", async () => {
    await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'owner_email_triggered','old',$2::jsonb,true)", [JOB, JSON.stringify({ code: "O22", key: "youre-in:v1:q-old" })]);
    let n = 0;
    expect(await fireOwnerEmailOnce(JOB, "O22", "youre-in:v1:q-old", async () => { n++; return "sent"; })).toBe("already handled");
    expect(n).toBe(0);
  });
});
