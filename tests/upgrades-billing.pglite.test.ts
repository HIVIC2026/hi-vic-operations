// Part 3 Task 1 (Jo 2 Nov 2026): electricians quote, book and bill the electrical upgrades on EVERY job. Real rows in
// PGlite through the real server paths; the in-house lookup, the comms switches and the owner email are stubbed at
// their seams. Three jobs: an HIV lead, an installer's own job (both PIESA complete with upgrades needed and an A3
// price on the form) and a TEST job that already has an upgrades quote from before the rule.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { embedShim, type Rels } from "./helpers/pglite-embed-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, job_number text, channel text, stage text, source text, deleted_at timestamptz, qa_archived_at timestamptz, updated_at timestamptz default now(), created_at timestamptz default now());
CREATE TABLE properties (id uuid primary key, address_line text, suburb text);
CREATE TABLE businesses (id uuid primary key, name text, in_house boolean default false, rectification_billed_by text default 'hivic', signer_mobile text, phone text, onboarding_notes text);
CREATE TABLE profiles (id uuid primary key, full_name text, phone text);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, role text, business_id uuid, user_id uuid, active boolean default true);
CREATE TABLE assessments (id uuid primary key default gen_random_uuid(), job_id uuid, status text, external_mitti_id text, mitti_completed boolean, mitti_raw_snapshot jsonb, piesa_outcome text);
CREATE TABLE rectification_items (id uuid primary key default gen_random_uuid(), job_id uuid, status text, rate_code text, description text, quantity numeric, is_other boolean default false, needs_office_pricing boolean default false, other_unit_price_inc_gst numeric, explanation text);
CREATE TABLE piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, is_current boolean, outcome text, completed_date date, signed_off_by text, rectification_completed_at timestamptz, section_c_signed_at timestamptz, created_at timestamptz default clock_timestamp());
-- The live one-current-record-per-job index (drizzle/migrations/0000_hivic_core_schema.sql:176).
create unique index if not exists piesa_current_uq on piesa_records(job_id) where is_current;
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, version int default 1, option_label text, customer_total_inc_gst numeric, sent_at timestamptz, office_reviewed_at timestamptz, office_reviewed_by uuid, release_state text, release_hold_reason text, rect_estimated_hours numeric, accepted_at timestamptz, accepted_by uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, code text, description text, quantity numeric, unit text, unit_price_inc_gst numeric, line_total_inc_gst numeric, is_other boolean, explanation text, sort int);
CREATE TABLE quote_internals (quote_id uuid primary key, cost_ex_gst numeric, calc_snapshot jsonb);
CREATE TABLE appointment_proposals (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, electrician_window boolean, starts_at timestamptz, ends_at timestamptz, status text, responded_at timestamptz, responded_by uuid, response_note text);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, created_at timestamptz default clock_timestamp());
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE workflow_settings (id int primary key, auto_send_quote boolean, customer_comms_enabled boolean);
CREATE TABLE pricing_settings (id uuid primary key default gen_random_uuid(), is_current boolean, gst_rate numeric);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const LEAD = id(1), OWN = id(2), TEST = id(3);
const INSTALLER = id(11), ELEC = id(12), ELEC_USER = id(21), TEST_QUOTE = id(31);
// The stored A3 snapshot: upgrades needed, not done today, electrician priced them at $880 (the pre-2-Nov quote path).
const { A3_REPAIR_NEEDED_LABEL, FIXES_PRICE_LABEL, FIXES_WORK_LABEL, FIXES_WORK_OPTIONS, shortAnswersFromEntries } = await import("../src/lib/official-short.core");
const a3Entries = [
  { label: A3_REPAIR_NEEDED_LABEL, value: "Yes" },
  { label: FIXES_WORK_LABEL, value: FIXES_WORK_OPTIONS[3] },
  { label: FIXES_PRICE_LABEL, value: "880" },
];
const a3 = JSON.stringify(a3Entries);

await db.query("insert into workflow_settings (id, auto_send_quote, customer_comms_enabled) values (1, true, true)");
await db.query("insert into pricing_settings (is_current, gst_rate) values (true, 0.1)");
await db.query("insert into businesses (id, name, in_house, rectification_billed_by, phone) values ($1,'Installer Co',false,'hivic','0400000001'), ($2,'Sparky Co',false,'hivic','0400000002')", [INSTALLER, ELEC]);
await db.query("insert into profiles (id, full_name, phone) values ($1,'Sam Sparky','0400000003')", [ELEC_USER]);
await db.query(`insert into jobs (id, job_number, channel, stage, source) values
  ($1,'HV-9001','hivic_sourced','piesa_complete','base44'), ($2,'HV-9002','installer_sourced','piesa_complete','installer_portal'), ($3,'HV-9003','hivic_sourced','piesa_complete','qa_test')`, [LEAD, OWN, TEST]);
for (const j of [LEAD, OWN, TEST]) {
  await db.query("insert into properties (id, address_line, suburb) values ($1,'1 Test St','Testville')", [j]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'installer',$2,$3), ($1,'electrician',$4,$5)", [j, INSTALLER, id(22), ELEC, ELEC_USER]);
  await db.query("insert into assessments (job_id, status, external_mitti_id, mitti_completed, mitti_raw_snapshot, piesa_outcome) values ($1,'complete',$3,true,$2::jsonb,'fail')", [j, a3, `audit-${j}`]);
  await db.query("insert into rectification_items (job_id, status, rate_code, description, quantity) values ($1,'required','DOWNLIGHT','Downlight covers',4)", [j]);
  await db.query("insert into piesa_records (job_id, kind, is_current, outcome, completed_date, signed_off_by) values ($1,'initial',true,'fail','2026-11-02','Sam Sparky')", [j]);
}
// The TEST job's quote from before the rule: an office-reviewed draft the office could once Send.
await db.query("insert into quotes (id, job_id, kind, status, option_label, customer_total_inc_gst, office_reviewed_at) values ($1,$2,'rectification','draft','electrical fixes',980,'2026-11-01')", [TEST_QUOTE, TEST]);
await db.query("insert into quote_items (quote_id, code, description, quantity, unit, unit_price_inc_gst, line_total_inc_gst, is_other, sort) values ($1,null,'Electrical repair work',1,'flat',980,980,false,0)", [TEST_QUOTE]);
await db.query("insert into quote_internals (quote_id, cost_ex_gst, calc_snapshot) values ($1, 800, '{\"pricing_source\":\"a4_electrician_price\"}')", [TEST_QUOTE]);

const rels: Rels = {
  quotes: { quote_items: { table: "quote_items", fk: "quote_id", on: "rel" }, quote_internals: { table: "quote_internals", fk: "quote_id", on: "rel" } },
  job_assignments: { businesses: { table: "businesses", fk: "business_id", on: "base" }, profiles: { table: "profiles", fk: "user_id", on: "base" } },
  jobs: { properties: { table: "properties", fk: "id", on: "base" } },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: embedShim(db, rels) }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true, hasCurrentOwnerContactConsent: async () => true }));
const realSuppression = await import("../src/lib/in-house-suppression.server");
mock.module("../src/lib/in-house-suppression.server", () => ({ ...realSuppression, readInHouseDispatchState: async () => ({ held: new Set<string>(), failed: false }), inHouseDispatchSkip: async () => null }));
const o29: string[] = [];
mock.module("../src/lib/owner-email-triggers.server", () => ({ onFixesQuoteIssued: async (jobId: string) => { o29.push(jobId); } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown, o?: { internal?: boolean }) => {
    await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,$6)", [job, actor, type, summary, JSON.stringify(details ?? {}), !!o?.internal]); },
}));

const { generateRectificationQuote } = await import("../src/lib/quotes.server");
const { maybeAutoSendFixesQuote, sweepAutoFixesQuotes } = await import("../src/lib/auto-fixes-quote-send.server");
const { textFixesTimesLink } = await import("../src/lib/fixes-times-link.server");
const { clearanceFacts } = await import("../src/lib/electrical-clearance.server");
const { partnerBilledRectificationFor } = await import("../src/lib/in-house-rectification.server");
const { electricalClearance } = await import("../src/lib/allocation.core");
const { ownerFixesState } = await import("../src/lib/owner-fixes.server");
const { releaseFixesQuote } = await import("../src/lib/fixes-quote-release.server");
const { ELECTRICIAN_BILLS_SKIP, UPGRADES_BILLED_BY_ELECTRICIAN, UPGRADES_QUOTE_SEND_BLOCKER } = await import("../src/lib/upgrades-billing.core");
const { AUTO_FIXES_QUOTE_HELD_EVENT } = await import("../src/lib/auto-fixes-quote-send.core");
const { FIXES_TIMES_LINK_EVENT } = await import("../src/lib/fixes-times.core");

const n = async (sql: string, vals: unknown[] = []) => Number((await db.query<{ n: number }>(sql, vals)).rows[0]!.n);
const quotesOn = (job: string) => n("select count(*)::int n from quotes where job_id=$1", [job]);
const eventsOn = (job: string, type: string) => n("select count(*)::int n from workflow_events where job_id=$1 and event_type=$2", [job, type]);
const short = shortAnswersFromEntries("piesa", a3Entries);
const { fixesPriceSource } = await import("../src/lib/fixes-price.core");
const { fixesTimesNeeded } = await import("../src/lib/fixes-times.core");

test("the fixture is the pre-2-Nov quote case: an A3 price the portal used to quote from, and fixes times were needed", () => {
  expect(fixesPriceSource(short).path).toBe("a4_price");
  expect(fixesTimesNeeded(short)).toBe(true);
});

for (const [label, job] of [["an HIV lead", LEAD], ["an installer's own job", OWN]] as const) {
  describe(`${label}: PIESA complete with upgrades needed`, () => {
    test("no upgrades quote is built — the quote builder says the electrician bills, writes nothing", async () => {
      expect(await generateRectificationQuote(job, null)).toEqual({ skipped: ELECTRICIAN_BILLS_SKIP });
      expect(await quotesOn(job)).toBe(0);
      expect(await n("select count(*)::int n from workflow_events where job_id=$1 and event_type like 'rectification_quote_%'", [job])).toBe(0);
    });
    test("the automatic send (A3 Complete trigger and the tick) is a no-op with the reason: no quote, no O29 email, no held row", async () => {
      const r = await maybeAutoSendFixesQuote(job, { actorId: null, generate: true });
      expect(r).toEqual({ jobId: job, result: "waiting", reason: ELECTRICIAN_BILLS_SKIP, quoteId: null });
      expect(await quotesOn(job)).toBe(0);
      expect(o29).toEqual([]);
      expect(await eventsOn(job, AUTO_FIXES_QUOTE_HELD_EVENT)).toBe(0);
    });
    test("the electrician is not texted the fixes-times link", async () => {
      const r = await textFixesTimesLink(job, { auditId: `audit-${job}`, completedAt: "2026-11-02T03:00:00Z", short });
      expect(r).toMatch(/^skipped: /);
      expect(await eventsOn(job, FIXES_TIMES_LINK_EVENT)).toBe(0);
    });
    test("clearance is not blocked by the missing quote — only by the upgrades themselves", async () => {
      expect(await partnerBilledRectificationFor(job)).toBe(true);
      const facts = await clearanceFacts(job);
      expect(facts).toMatchObject({ rectificationRequired: true, rectificationQuoteAccepted: false, partnerBilledRectification: true });
      const c = electricalClearance(facts);
      expect(c.cleared).toBe(false);
      expect(c.blocker).toBe("Electrical upgrades not completed yet.");
    });
    test("the owner's My job upgrades screen says the electrician arranges it directly", async () => {
      const st = await ownerFixesState(job);
      expect(st.step).toBe("none");
      expect(st.quote).toBeNull();
      expect(st.electricianBills).toBe(UPGRADES_BILLED_BY_ELECTRICIAN);
    });
  });
}

describe("the tick sweep", () => {
  test("checks nothing and sends nothing", async () => {
    expect(await sweepAutoFixesQuotes()).toEqual({ checked: 0, sent: 0, held: 0, errors: 0 });
    expect(await n("select count(*)::int n from quotes")).toBe(1);
  });
});

describe("a TEST job with an upgrades quote from before the rule", () => {
  test("keeps its quote row exactly as it was through every path above", async () => {
    const before = (await db.query("select * from quotes where id=$1", [TEST_QUOTE])).rows[0];
    expect(await generateRectificationQuote(TEST, null)).toEqual({ skipped: ELECTRICIAN_BILLS_SKIP });
    const r = await maybeAutoSendFixesQuote(TEST, { actorId: null, generate: true });
    expect(r.result).toBe("waiting");
    await textFixesTimesLink(TEST, { auditId: `audit-${TEST}`, completedAt: "2026-11-02T03:00:00Z", short });
    await clearanceFacts(TEST);
    const after = (await db.query("select * from quotes where id=$1", [TEST_QUOTE])).rows[0];
    expect(after).toEqual(before);
    expect(await quotesOn(TEST)).toBe(1);
    expect(o29).toEqual([]);
  });
  test("the office Send button is refused with the new reason and the draft stays a draft", async () => {
    await expect(releaseFixesQuote(TEST_QUOTE, null, "office")).rejects.toThrow(UPGRADES_QUOTE_SEND_BLOCKER);
    expect((await db.query<{ status: string; sent_at: string | null }>("select status, sent_at from quotes where id=$1", [TEST_QUOTE])).rows[0]).toEqual({ status: "draft", sent_at: null });
    expect(o29).toEqual([]);
  });
  test("the owner screen still shows an already-issued quote (nothing is hidden or rewritten)", async () => {
    await db.query("update quotes set status='issued', sent_at=now() where id=$1", [TEST_QUOTE]);
    const st = await ownerFixesState(TEST);
    expect(st.step).toBe("approve");
    expect(st.quote?.id).toBe(TEST_QUOTE);
    expect(st.electricianBills).toBeNull();
    await db.query("update quotes set status='draft', sent_at=null where id=$1", [TEST_QUOTE]);
  });
});
