// Real server quote generation + payer change on PGlite (Jo, 9 Oct 2026): the drafted quote_items follow the CURRENT
// recorded electrician payer (own = no HIV PIESA line, HIV = standard $349, undecided = held, no quote).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { FEE_AWARENESS_HIV_REC, FEE_AWARENESS_OWN_REC } from "../src/lib/installer-intake.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, installer_site_check text, installer_site_check_date date, installer_quoted text, installer_quoted_price_inc_gst numeric,
  installer_price_includes text, electrician_choice text, estimated_area_m2 numeric, estimated_area_unknown boolean, measure_up_responsibility text,
  ap_fee_override_inc_gst numeric, properties jsonb, next_action text, stage text DEFAULT 'new_enquiry', deleted_at timestamptz, qa_archived_at timestamptz);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, provenance text, measured_area_m2 numeric, verified_area_m2 numeric, supplied_area_m2 numeric, removal_required boolean, existing_r_value numeric, zones jsonb not null default '[]'::jsonb);
CREATE TABLE job_imports (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, files jsonb, created_at timestamptz default now());
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text, option_label text, option_code text,
  sent_at timestamptz, subtotal_inc_gst numeric, gst_amount numeric, veec_discount_inc_gst numeric, discount_note text, customer_total_inc_gst numeric, created_by uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, code text, description text, quantity numeric, unit text, unit_price_inc_gst numeric, line_total_inc_gst numeric, is_other boolean, explanation text, sort int);
CREATE TABLE owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, consent_status text, created_at timestamptz default now());
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, label text, required boolean, status text, gate text);
CREATE TABLE veu_location_variables (postcode text, metropolitan_or_regional text, climate_region text);
CREATE TABLE retail_estimator_settings (is_current boolean, ap_management_inc_gst numeric, piesa_assessment_inc_gst numeric, indicative_veec_value numeric, minimum_customer_copayment_inc_gst numeric);
CREATE TABLE workflow_settings (id int, auto_send_quote boolean, customer_comms_enabled boolean, installer_quote_min_inc_gst_per_m2 numeric, installer_quote_max_inc_gst_per_m2 numeric);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, role text, user_id uuid, business_id uuid, active boolean);
CREATE TABLE business_members (business_id uuid, user_id uuid, member_role text, active boolean);
CREATE TABLE electrician_nominations (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, nominating_business_id uuid, nominated_by uuid, nominated_for text, contact_name text, business_name text, email text, phone text, status text, licence_number text, rec_number text, ended_at timestamptz, updated_at timestamptz, created_at timestamptz default now());
CREATE TABLE partner_relationships (installer_business_id uuid, electrician_business_id uuid, active boolean);
CREATE TABLE businesses (id uuid, name text, trading_name text, email text, phone text, in_house boolean default false, pays_own_electricians boolean default false, business_type text, capabilities text[], rec_number text, onboarding_status text, is_active boolean);
CREATE TABLE rate_cards (id uuid primary key default gen_random_uuid(), business_id uuid, kind text, version int default 1, is_active boolean default true, effective_from date default '2026-01-01');
CREATE TABLE rate_card_items (id uuid primary key default gen_random_uuid(), rate_card_id uuid, code text, unit_price_ex_gst numeric, unit text);
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, trade_role text, approval_status text, licence_number text, removed_at timestamptz);
CREATE TABLE electrician_rates (id uuid primary key default gen_random_uuid(), business_id uuid, service_type text, rate_inc_gst numeric, status text, effective_from date, effective_to date);
CREATE TABLE invoices (id uuid primary key default gen_random_uuid(), quote_id uuid);
CREATE TABLE profiles (id uuid, full_name text, email text);
ALTER TABLE jobs ADD COLUMN source text DEFAULT 'qa_test';
ALTER TABLE jobs ADD COLUMN job_number text DEFAULT 'HV-TEST';
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());`);

// Thin adapter over the shared shim: embedded properties(postcode), array inserts and non-head exact counts.
const shim = postgrestShim(db);
/** `rate_card_items … rate_cards!inner(business_id)` (installer-paid-electricians.server): the one embedded-join read the
 *  own-customer PIESA rate needs (Jo 4 Nov 2026) — answered with a real join on PGlite. */
let rateReadFails = false; // J3 (2): the rate READ fails (not "no rate")
function rateCardItemsJoin() {
  const where: string[] = []; const vals: unknown[] = [];
  const b = {
    in(c: string, v: unknown[]) { where.push(`rc."${c.replace("rate_cards.", "")}" = ANY($${vals.push(v)})`); return b; },
    eq(c: string, v: unknown) { where.push(`rc."${c.replace("rate_cards.", "")}" = $${vals.push(v)}`); return b; },
    lte(c: string, v: unknown) { where.push(`rc."${c.replace("rate_cards.", "")}" <= $${vals.push(v)}`); return b; },
    ilike(c: string, v: string) { where.push(`i."${c}" ILIKE $${vals.push(v)}`); return b; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      if (rateReadFails) return Promise.resolve(res({ data: null, error: { message: "rate_card_items read failed (test)" } })).then(undefined, rej);
      return db.query(`select i.rate_card_id, i.code, i.unit_price_ex_gst, json_build_object('business_id', rc.business_id) as rate_cards from rate_card_items i join rate_cards rc on rc.id = i.rate_card_id${where.length ? " where " + where.join(" and ") : ""}`, vals)
        .then((r) => res({ data: r.rows, error: null }), (e) => res({ data: null, error: { message: (e as Error).message } })).then(undefined, rej);
    },
  };
  return b;
}
/** J3 (4): `rate_cards … rate_card_items(code, unit_price_ex_gst)` (installerSafetyCheckPrice): the one embedded read the
 *  single-business PIESA rate makes — answered with a real join on PGlite. */
function rateCardsEmbed() {
  const where: string[] = []; const vals: unknown[] = [];
  const b = {
    eq(c: string, v: unknown) { where.push(`rc."${c}" = $${vals.push(v)}`); return b; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      if (rateReadFails) return Promise.resolve(res({ data: null, error: { message: "rate_cards read failed (test)" } })).then(undefined, rej);
      return db.query(`select rc.id, rc.business_id, rc.version, rc.effective_from, coalesce((select json_agg(json_build_object('code', i.code, 'unit_price_ex_gst', i.unit_price_ex_gst)) from rate_card_items i where i.rate_card_id = rc.id), '[]'::json) as rate_card_items from rate_cards rc${where.length ? " where " + where.join(" and ") : ""}`, vals)
        .then((r) => res({ data: r.rows, error: null }), (e) => res({ data: null, error: { message: (e as Error).message } })).then(undefined, rej);
    },
  };
  return b;
}
const admin = {
  ...shim,
  from(t: string) {
    if (t === "rate_cards") {
      return { select: (c: string) => (c.includes("rate_card_items(") ? rateCardsEmbed() : (shim.from(t) as { select: (c: string) => unknown }).select(c)) };
    }
    if (t === "rate_card_items") {
      return { select: (c: string) => (c.includes("rate_cards!inner") ? rateCardItemsJoin() : (shim.from(t) as { select: (c: string) => unknown }).select(c)) };
    }
    const b = shim.from(t) as Record<string, (...a: unknown[]) => unknown> & { then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise<unknown> };
    const sel = b.select!, ins = b.insert!, then = b.then.bind(b);
    let wantCount = false;
    b.select = (c?: unknown, o?: unknown) => { const oo = o as { count?: string; head?: boolean } | undefined; if (oo?.count && !oo.head) wantCount = true; return sel(typeof c === "string" ? c.replace("properties(postcode)", "properties") : c, o); };
    b.insert = (p: unknown) => {
      if (!Array.isArray(p)) return ins(p);
      return { then: async (r: (v: unknown) => unknown) => { for (const row of p) { const x = (await shim.from(t).insert(row)) as { error: unknown }; if (x.error) return r(x); } return r({ data: null, error: null }); } };
    };
    b.then = (r, j) => then((v: unknown) => { const x = v as { data: unknown }; return r(wantCount && Array.isArray(x.data) ? { ...x, count: x.data.length } : v); }, j);
    return b;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const { installerUpdateIntake, draftQuoteFromIntake, installerIntakeState, recordOfficeFeeAwareness } = await import("../src/lib/installer-intake.server");
const { draftInstallerQuoteFromReadyCheck, quoteBillingBlocker } = await import("../src/lib/installer-quote.server");

const JOB = "00000000-0000-0000-0000-00000000e101", BIZ = "00000000-0000-0000-0000-00000000b101", EL = "00000000-0000-0000-0000-00000000b201", U = "00000000-0000-0000-0000-00000000c101", RATE_CARD = "00000000-0000-0000-0000-00000000d101";
const base = { areaM2: 142, insulation: "none" as const, quoteStatus: "have_quote" as const, quoteIncGst: 3450, includes: "R5.0 batts supply and install", proposedR: 5, files: [] };
const quotes = async () => (await db.query<{ id: string; status: string; subtotal_inc_gst: string; discount_note: string | null }>("select id, status, subtotal_inc_gst, discount_note from quotes where job_id=$1 order by created_at", [JOB])).rows;
const items = async (qid: string) => (await db.query<{ code: string; line_total_inc_gst: string }>("select code, line_total_inc_gst from quote_items where quote_id=$1 order by sort", [qid])).rows.map((r) => `${r.code}:${Number(r.line_total_inc_gst)}`);
const current = async () => (await quotes()).filter((q) => q.status === "draft");
const evs = async () => (await db.query<{ event_type: string }>("select event_type from workflow_events where job_id=$1 order by created_at", [JOB])).rows.map((r) => r.event_type);

async function seed(choice: string | null) {
  await db.exec("delete from admin_config_events");
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from job_imports; delete from quotes; delete from quote_items; delete from owner_contact_consents; delete from job_assignments; delete from business_members; delete from electrician_nominations; delete from partner_relationships; delete from businesses; delete from invoices; delete from veu_location_variables; delete from retail_estimator_settings; delete from workflow_settings; delete from rate_cards; delete from rate_card_items; delete from partner_workers; delete from electrician_rates;");
  await db.query("insert into jobs (id, channel, originating_installer_business_id, installer_site_check, installer_quoted, installer_quoted_price_inc_gst, installer_price_includes, electrician_choice, properties) values ($1,'installer_sourced',$2,'yes','yes',3450,'R5.0 batts supply and install',$3,'{\"postcode\":\"3000\"}')", [JOB, BIZ, choice]);
  await db.query("insert into ceiling_measurements (job_id, is_current, provenance, supplied_area_m2) values ($1,true,'installer_supplied_provisional',142)", [JOB]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_evidence_acknowledged','{\"proposed_r_value\":5}')", [JOB]);
  // Jo 20 Oct: quoted intake jobs record the price basis/GST explicitly before any owner quote.
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_quote_commercial_declared',$2)", [JOB, JSON.stringify({ commercial: { basis: "before_discount", gst: "inc_gst", inclusions: null, exclusions: null, originalStatus: null, removalPricing: null, removalAmountIncGst: null, extras: [] } })]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_existing_insulation_declared','{\"value\":\"none\"}')", [JOB]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_commercial_eligibility','{\"outcome\":\"eligible\"}')", [JOB]);
  await db.query("insert into job_imports (job_id, business_id, files) values ($1,$2,'[]')", [JOB, BIZ]);
  await db.query("insert into owner_contact_consents (job_id, consent_status) values ($1,'granted')", [JOB]);
  await db.query("insert into veu_location_variables values ('3000','Metropolitan','Mild')");
  await db.query("insert into retail_estimator_settings values (true, 349, 349, 40, 200)");
  await db.query("insert into workflow_settings values (1, false, false, null, null)");
  await db.query("insert into job_assignments (job_id, role, user_id, business_id, active) values ($1,'installer',$2,$3,true)", [JOB, U, BIZ]);
  await db.query("insert into business_members values ($1,$2,'business_admin',true)", [BIZ, U]);
  await db.query("insert into partner_relationships values ($1,$2,true)", [BIZ, EL]);
  await db.query("insert into businesses (id, name, business_type, capabilities, rec_number, onboarding_status, is_active) values ($1,'Sample Electrical','rec','{electrician}','REC-SAMPLE','approved',true)", [EL]);
  // Jo 4 Nov 2026: the installer's own PIESA rate (rate card PIESA line, ex GST $250 → $275 inc) prices the owner's PIESA line.
  await db.query("insert into businesses (id, name, business_type, capabilities, onboarding_status, is_active) values ($1,'Sample Installer','eec_installer','{installer}','approved',true)", [BIZ]);
  await db.query("insert into rate_cards (id, business_id, kind) values ($1,$2,'installer')", [RATE_CARD, BIZ]);
  await db.query("insert into rate_card_items (rate_card_id, code, unit_price_ex_gst, unit) values ($1,'PIESA',250,'flat')", [RATE_CARD]);
}

// Jo 22 Oct's three Mitti electrician options, re-pinned to the rules that replaced them: decision 303 (25 Oct: only an
// approved REC may be quoted; a free-text "different electrician" holds "Electrician not onboarded"), Jo 2–3 Nov (no Home
// Insulation Victoria electrician on installer jobs; installers pick their own) and Jo 4 Nov 2026 (two boxes — final: the
// own-customer PIESA line is the INSTALLER's own rate-card PIESA price — $275 here — never the REC's rate or a fixed $349).
describe("Mitti electrician answers on an installer's own job, on practice Postgres", () => {
  const WORKER = "00000000-0000-0000-0000-00000000f201";
  beforeEach(async () => {
    await seed("hivic_organise");
    await db.query("update ceiling_measurements set measured_area_m2=142 where job_id=$1", [JOB]);
    // Sample Electrical is an approved REC: an approved electrician worker (licence TEST-PROFILE-LIC) and an active onboarded PIESA rate ($220).
    await db.query("insert into partner_workers (id, business_id, trade_role, approval_status, licence_number) values ($1,$2,'electrician','approved','TEST-PROFILE-LIC')", [WORKER, EL]);
    await db.query("insert into electrician_rates (business_id, service_type, rate_inc_gst, status, effective_from) values ($1,'piesa',220,'active','2026-01-01')", [EL]);
  });
  const entries = (choice: string) => [
    { label: "What's included in your quote?", value: "R5.0 supply and install" },
    { label: "Total quoted price (inc GST)", value: "3450" },
    { label: "Insulation product", value: "Bradford Gold R5" },
    { label: "Who is doing the electrical safety check?", value: choice },
    { label: "Electrician name", value: "TEST Form REC" },
    { label: "Electrician licence number", value: "TEST-FORM-LIC" },
    { label: "Electrician price (inc GST)", value: "$450.50" },
  ];
  const held = async () => (await db.query<{ details: { blockers: string[] } }>("select details from workflow_events where job_id=$1 and event_type='installer_quote_held' order by created_at desc limit 1", [JOB])).rows[0]?.details.blockers ?? [];
  test("legacy 'Home Insulation Victoria electrician' answer with no usual electrician saved: no quote — the arrangement is not decided (Jo 2–3 Nov 2026: installers pick their own electrician)", async () => {
    await draftInstallerQuoteFromReadyCheck(JOB, U, entries("Home Insulation Victoria electrician"), "audit_test");
    expect(await current()).toEqual([]);
    expect(await held()).toContain("Electrician arrangement is not decided");
    expect(await held()).not.toContain("Installer business has no PIESA rate on its rate card"); // the rate is there; it is the electrician that is missing
  });
  test("usual profile that resolves to an approved REC: quote drafted with the INSTALLER's $275 PIESA (never the REC's $220 or $349), identity saved, repeat does not duplicate, profile change holds", async () => {
    await db.query("insert into admin_config_events(event_type,details) values ('installer_usual_electrician_saved',$1)", [JSON.stringify({business_id: BIZ, electrician: {name: "TEST Profile REC", licence: "TEST-PROFILE-LIC"}})]);
    await draftInstallerQuoteFromReadyCheck(JOB, U, entries("My usual electrician"), "audit_test");
    const q = (await current())[0]; expect(q).toBeDefined(); if (!q) return;
    expect(await items(q.id)).toEqual(["INSTALLER_PRICE:3450", "AP_FEE:349", "PIESA:275"]);
    expect(Number(q.subtotal_inc_gst)).toBe(4074); expect(await quoteBillingBlocker(q.id)).toBeNull();
    const facts = (await db.query<{details: {name: string; licence: string; source: string; priceIncGst: number; recBusinessId: string}}>("select details from workflow_events where event_type='mitti_electrician_recorded'", [])).rows[0]?.details;
    expect(facts).toMatchObject({name: "TEST Profile REC", licence: "TEST-PROFILE-LIC", source: "approved_rec", priceIncGst: 275, recBusinessId: EL});
    await draftInstallerQuoteFromReadyCheck(JOB, U, entries("My usual electrician"), "audit_test");
    expect((await current()).length).toBe(1);
    expect((await db.query("select id from workflow_events where event_type='mitti_electrician_recorded'", [])).rows.length).toBe(1);
    await db.query("insert into admin_config_events(event_type,details) values ('installer_usual_electrician_saved',$1)", [JSON.stringify({business_id: BIZ, electrician: {name: "TEST Other REC", licence: "TEST-OTHER-LIC"}})]);
    expect(await quoteBillingBlocker(q.id)).toContain("profile changed");
  });
  test("the installer's PIESA rate changes after the draft: the old draft holds 'does not match' and is never sent at the old amount (Jo 4 Nov 2026)", async () => {
    await db.query("insert into admin_config_events(event_type,details) values ('installer_usual_electrician_saved',$1)", [JSON.stringify({business_id: BIZ, electrician: {name: "TEST Profile REC", licence: "TEST-PROFILE-LIC"}})]);
    await draftInstallerQuoteFromReadyCheck(JOB, U, entries("My usual electrician"), "audit_test");
    const q = (await current())[0]; expect(q).toBeDefined(); if (!q) return;
    await db.query("update rate_card_items set unit_price_ex_gst = 300"); // $330 inc now
    await draftInstallerQuoteFromReadyCheck(JOB, U, entries("My usual electrician"), "audit_test"); // re-records the resolution at $330
    expect(await quoteBillingBlocker(q.id)).toBe("Ready Check electrician details changed or are incomplete — prepare a new quote");
  });
  test("fix wave J1 (1): a rate change AFTER the quote went out never blocks the owner — an issued (or accepted) quote is not re-priced", async () => {
    await db.query("insert into admin_config_events(event_type,details) values ('installer_usual_electrician_saved',$1)", [JSON.stringify({business_id: BIZ, electrician: {name: "TEST Profile REC", licence: "TEST-PROFILE-LIC"}})]);
    await draftInstallerQuoteFromReadyCheck(JOB, U, entries("My usual electrician"), "audit_test");
    const q = (await current())[0]; expect(q).toBeDefined(); if (!q) return;
    await db.query("update quotes set status='issued', sent_at=now(), release_state='released' where id=$1", [q.id]);
    await db.query("update rate_card_items set unit_price_ex_gst = 300"); // $330 inc now; the owner's quote still says $275
    await db.query("delete from rate_card_items"); // and even with NO rate at all (lapsed card)
    expect(await quoteBillingBlocker(q.id)).toBeNull();
    expect(await items(q.id)).toEqual(["INSTALLER_PRICE:3450", "AP_FEE:349", "PIESA:275"]); // never re-priced
    // Acceptance (portal.functions respondToQuoteImpl) asks only this blocker before accepting an installer quote.
    const src = (await import("node:fs")).readFileSync("src/lib/portal.functions.ts", "utf8");
    expect(src).toContain('const bb = await (await import("./installer-quote.server")).quoteBillingBlocker(q.id);');
    await db.query("update quotes set status='accepted' where id=$1", [q.id]);
    expect(await quoteBillingBlocker(q.id)).toBeNull();
  });
  test("free-text 'A different electrician' (retired form answer) holds 'Electrician not onboarded' — decision 303; the $450.50 typed price is never used", async () => {
    await draftInstallerQuoteFromReadyCheck(JOB, U, entries("A different electrician"), "audit_test");
    expect(await current()).toEqual([]);
    expect(await held()).toContain("Electrician not onboarded: TEST Form REC");
    const facts = (await db.query<{details: {name: string; licence: string; priceIncGst: number | null}}>("select details from workflow_events where event_type='mitti_electrician_recorded'", [])).rows[0]?.details;
    expect(facts).toMatchObject({name: "TEST Form REC", licence: "TEST-FORM-LIC", priceIncGst: null});
    expect(await evs()).toContain("electrician_onboarding_needed");
  });
  test("missing usual profile: no quote, exact Office reason, reminder OFF, no duplicate office item", async () => {
    for (let i=0; i<2; i++) await draftInstallerQuoteFromReadyCheck(JOB, U, entries("My usual electrician"), "audit_test");
    expect(await current()).toEqual([]);
    const rows = (await db.query<{details: {reasons: string[]}}>("select details from workflow_events where event_type='ready_check_needs_office'", [])).rows;
    expect(rows.length).toBe(1); expect(rows[0]?.details.reasons).toEqual(["Installer has no usual electrician saved"]);
  });
});

describe("server-drafted owner quote follows the CURRENT electrician payer", () => {
  beforeEach(() => seed(null));

  // Part 10 (Jo 2 Nov 2026) + Jo 4 Nov 2026 (final): own customers always carry the $349 fee + the installer's OWN PIESA
  // rate ($275 from the rate card above), in the approved order, whatever the choice.
  test("legacy 'HIV arranges' choice: real quote_items carry Insulation · $349 fee · the installer's $275 PIESA", async () => {
    await db.query("update jobs set electrician_choice='hivic_organise'");
    await draftQuoteFromIntake(JOB, U);
    const [q] = await current();
    expect(await items(q!.id)).toEqual(["INSTALLER_PRICE:3450", "AP_FEE:349", "PIESA:275"]);
    expect(Number(q!.subtotal_inc_gst)).toBe(4074);
    const labels = (await db.query<{ description: string }>("select description from quote_items where quote_id=$1 and code in ('AP_FEE','PIESA') order by sort", [q!.id])).rows.map((r) => r.description);
    expect(labels).toEqual(["Home Insulation Victoria AP management fee", "Electrical safety check (PIESA) — charged by Home Insulation Victoria"]);
  });

  test("own electrician: the same $275 PIESA line (the installer's rate, billed through us and paid through), AP fee kept", async () => {
    await db.query("update jobs set electrician_choice='preferred'");
    await draftQuoteFromIntake(JOB, U);
    const [q] = await current();
    expect(await items(q!.id)).toEqual(["INSTALLER_PRICE:3450", "AP_FEE:349", "PIESA:275"]);
    expect(Number(q!.subtotal_inc_gst)).toBe(4074);
  });

  test("no PIESA rate on the installer's rate card: no quote drafted (held with the one reason), never a guessed $349", async () => {
    await db.query("update jobs set electrician_choice='preferred'");
    await db.query("delete from rate_card_items");
    await draftQuoteFromIntake(JOB, U);
    expect(await quotes()).toEqual([]);
    const held = (await db.query<{ details: { blockers: string[] } }>("select details from workflow_events where job_id=$1 and event_type='installer_quote_held' order by created_at desc limit 1", [JOB])).rows[0];
    expect(held?.details.blockers).toContain("Installer business has no PIESA rate on its rate card");
  });

  test("J3 (2): the rate READ fails → held with 'We couldn't check your PIESA price just now…', never the 'no PIESA rate' hold, nothing drafted", async () => {
    await db.query("update jobs set electrician_choice='preferred'");
    rateReadFails = true;
    try { await draftQuoteFromIntake(JOB, U); } finally { rateReadFails = false; }
    expect(await quotes()).toEqual([]);
    const held = (await db.query<{ details: { blockers: string[] } }>("select details from workflow_events where job_id=$1 and event_type='installer_quote_held' order by created_at desc limit 1", [JOB])).rows[0];
    const { PIESA_PRICE_CHECK_FAILED, PIESA_PRICE_NOT_SET } = await import("../src/lib/own-customer-price.core");
    expect(held?.details.blockers).toContain(PIESA_PRICE_CHECK_FAILED);
    expect(held?.details.blockers).not.toContain("Installer business has no PIESA rate on its rate card");
    expect(held?.details.blockers).not.toContain(PIESA_PRICE_NOT_SET);
    // the read works again → the next draft prices the $275 PIESA line
    await draftQuoteFromIntake(JOB, U);
    const [q] = await current();
    expect(await items(q!.id)).toEqual(["INSTALLER_PRICE:3450", "AP_FEE:349", "PIESA:275"]);
  });

  test("undecided: no quote drafted (held), never a guessed $349", async () => {
    await draftQuoteFromIntake(JOB, U);
    expect(await quotes()).toEqual([]);
    expect(await evs()).toContain("installer_quote_held");
  });
});

describe("installer changes the payer later on the same job", () => {
  beforeEach(() => seed("hivic_organise"));

  test("HIV -> own: old draft superseded, fresh draft keeps the installer's $275 PIESA line, old declaration stops counting", async () => {
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_owner_fee_awareness',$2)", [JOB, JSON.stringify({ by: "installer", payer: "hivic", wording: FEE_AWARENESS_HIV_REC })]);
    await draftQuoteFromIntake(JOB, U);
    const before = (await current())[0]!;
    expect(await items(before.id)).toContain("PIESA:275");
    await installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "own", electrician: { mode: "mine", business_id: EL } });
    const all = await quotes();
    expect(all.find((q) => q.id === before.id)!.status).toBe("superseded");
    const now = await current();
    expect(now.length).toBe(1);
    expect(await items(now[0]!.id)).toEqual(["INSTALLER_PRICE:3450", "AP_FEE:349", "PIESA:275"]);
    const st = await installerIntakeState(JOB);
    expect(st.electricianPayer).toBe("own");
    expect(st.releaseBlockers.some((b) => /fee awareness/i.test(b))).toBe(true);
    expect(await evs()).toContain("installer_owner_fee_awareness_invalidated");
  });

  test("fee declaration for the OLD payer is rejected BEFORE any write (no partial save)", async () => {
    const err = await installerUpdateIntake(JOB, U, BIZ, { ...base, areaM2: 160, electricianPayer: "own", electrician: { mode: "mine", business_id: EL }, feeAwareness: { payer: "hivic", text: FEE_AWARENESS_HIV_REC } }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const j = (await db.query<{ electrician_choice: string; m: string }>("select electrician_choice, (select supplied_area_m2 from ceiling_measurements limit 1) m from jobs")).rows[0]!;
    expect(j.electrician_choice).toBe("hivic_organise");
    expect(Number(j.m)).toBe(142);
    expect(await evs()).not.toContain("installer_electrician_payer_changed");
  });

  test("new payer + matching declaration saved together; release no longer fee-blocked", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "own", electrician: { mode: "mine", business_id: EL }, feeAwareness: { payer: "own", text: FEE_AWARENESS_OWN_REC } });
    const st = await installerIntakeState(JOB);
    expect(st.releaseBlockers).toEqual([]);
    expect(st.feeRecord?.payer).toBe("own");
    expect(st.feeRecord?.wording).toBe(FEE_AWARENESS_OWN_REC);
  });

  // BLOCKED (9 Oct): conflicts with the 8 Oct source letting the installer company admin change the payer before acceptance; policy code left unchanged; the hard lock after acceptance is still tested below.
  test.skip("own -> to be arranged by installer is refused (office changes a chosen own electrician)", async () => {
    await db.query("update jobs set electrician_choice='preferred'");
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "undecided" })).rejects.toThrow(/ask the office/);
  });

  test("HIV -> to be arranged: draft withdrawn and no new quote", async () => {
    await draftQuoteFromIntake(JOB, U);
    await installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "undecided" });
    expect(await current()).toEqual([]);
    expect((await installerIntakeState(JOB)).releaseBlockers.some((b) => /Electrician not decided/.test(b))).toBe(true);
  });

  test("invoice already raised on an accepted quote locks the payer change", async () => {
    const { rows } = await db.query<{ id: string }>("insert into quotes (job_id, kind, status, option_code) values ($1,'installation','accepted','INSTALLER_A1') returning id", [JOB]);
    await db.query("insert into invoices (quote_id) values ($1)", [rows[0]!.id]);
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "own", electrician: { mode: "mine", business_id: EL } })).rejects.toThrow(/invoice has already been raised/);
  });

  test("accepted quote (no invoice) is flagged for owner reconfirmation, never repriced", async () => {
    const { rows } = await db.query<{ id: string }>("insert into quotes (job_id, kind, status, option_code, subtotal_inc_gst) values ($1,'installation','accepted','INSTALLER_A1',4148) returning id", [JOB]);
    await installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "own", electrician: { mode: "mine", business_id: EL } });
    const acc = (await quotes()).find((q) => q.id === rows[0]!.id)!;
    expect(acc.status).toBe("accepted");
    expect(Number(acc.subtotal_inc_gst)).toBe(4148);
    expect(await evs()).toContain("installer_quote_reconfirmation_required");
  });
});

describe("office fee records are explicit about the payer", () => {
  test("legacy office record (no payer) never clears an own-electrician job", async () => {
    await seed("preferred");
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_owner_fee_awareness','{\"by\":\"office\",\"note\":\"phoned\"}')", [JOB]);
    expect((await installerIntakeState(JOB)).releaseBlockers.some((b) => /different electrician arrangement/.test(b))).toBe(true);
  });
  test("new office record uses the current payer's exact wording", async () => {
    await seed("preferred");
    await recordOfficeFeeAwareness(JOB, U, "Phoned owner 9 Oct");
    const st = await installerIntakeState(JOB);
    expect(st.feeRecord?.by).toBe("office");
    expect(st.feeRecord?.payer).toBe("own");
    expect(st.feeRecord?.wording).toBe(FEE_AWARENESS_OWN_REC);
    expect(st.releaseBlockers).toEqual([]);
  });
  test("office cannot record fees while the electrician is undecided", async () => {
    await seed(null);
    await expect(recordOfficeFeeAwareness(JOB, U, "x")).rejects.toThrow(/who arranges the electrician/);
  });
});
