// Source-confirmed bypass (Jo, 9 Oct 2026): the legacy electrician switch must not change an Add job payer, every
// payer path shares one lock, and send/accept re-check that the quote lines match the CURRENT payer (real PGlite rows).
// Join 4 Nov 2026: two later rulings supersede the 9 Oct line pins — main Part 2 (Jo, 2 Nov 2026, a6aa0a66): an
// installer's own customer never uses Home Insulation Victoria's electrician ("Use one of your own electricians.", every
// path), and Jo 4 Nov 2026 (decision 431, CROSS-PART-NOTES): the owner's PIESA line is the installer's OWN rate-card PIESA
// price (never a fixed $349; no rate → held), with the $349 Home Insulation Victoria fee, whatever the recorded choice.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { FEE_AWARENESS_HIV_REC, FEE_AWARENESS_OWN_REC } from "../src/lib/installer-intake.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, installer_site_check text, installer_site_check_date date, installer_quoted text, installer_quoted_price_inc_gst numeric,
  installer_price_includes text, electrician_choice text, estimated_area_m2 numeric, estimated_area_unknown boolean, measure_up_responsibility text,
  ap_fee_override_inc_gst numeric, properties jsonb, next_action text, stage text DEFAULT 'new_enquiry', deleted_at timestamptz, qa_archived_at timestamptz, source text DEFAULT 'qa_test', job_number text DEFAULT 'HV-TEST');
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, provenance text, measured_area_m2 numeric, verified_area_m2 numeric, supplied_area_m2 numeric, removal_required boolean, existing_r_value numeric);
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
CREATE TABLE profiles (id uuid, full_name text, email text);`);

// Thin adapter over the shared shim: embedded properties(postcode), array inserts and non-head exact counts.
const shim = postgrestShim(db);
/** `rate_card_items … rate_cards!inner(business_id)` (installer-paid-electricians.server): the one embedded-join read the
 *  own-customer PIESA rate needs (Jo 4 Nov 2026) — answered with a real join on PGlite. */
function rateCardItemsJoin() {
  const where: string[] = []; const vals: unknown[] = [];
  const b = {
    in(c: string, v: unknown[]) { where.push(`rc."${c.replace("rate_cards.", "")}" = ANY($${vals.push(v)})`); return b; },
    eq(c: string, v: unknown) { where.push(`rc."${c.replace("rate_cards.", "")}" = $${vals.push(v)}`); return b; },
    lte(c: string, v: unknown) { where.push(`rc."${c.replace("rate_cards.", "")}" <= $${vals.push(v)}`); return b; },
    ilike(c: string, v: string) { where.push(`i."${c}" ILIKE $${vals.push(v)}`); return b; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return db.query(`select i.rate_card_id, i.code, i.unit_price_ex_gst, json_build_object('business_id', rc.business_id) as rate_cards from rate_card_items i join rate_cards rc on rc.id = i.rate_card_id${where.length ? " where " + where.join(" and ") : ""}`, vals)
        .then((r) => res({ data: r.rows, error: null }), (e) => res({ data: null, error: { message: (e as Error).message } })).then(undefined, rej);
    },
  };
  return b;
}
/** J3 (4): `rate_cards … rate_card_items(code, unit_price_ex_gst)` (installerSafetyCheckPrice) — a real join on PGlite. */
function rateCardsEmbed() {
  const where: string[] = []; const vals: unknown[] = [];
  const b = {
    eq(c: string, v: unknown) { where.push(`rc."${c}" = $${vals.push(v)}`); return b; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
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
const { installerUpdateIntake, draftQuoteFromIntake } = await import("../src/lib/installer-intake.server");
const { switchJobToHivic, payerChangeBlocker } = await import("../src/lib/job-electrician.server");
const { quoteBillingBlocker } = await import("../src/lib/installer-quote.server");

const JOB = "00000000-0000-0000-0000-00000000e101", BIZ = "00000000-0000-0000-0000-00000000b101", EL = "00000000-0000-0000-0000-00000000b201", U = "00000000-0000-0000-0000-00000000c101", RATE_CARD = "00000000-0000-0000-0000-00000000d101";
/** The own-customer owner lines (Jo 4 Nov 2026): the installer's price, the $349 Home Insulation Victoria fee, the installer's own PIESA ($250 ex → $275 inc). */
const OWN_LINES = ["INSTALLER_PRICE:3450", "AP_FEE:349", "PIESA:275"];
const base = { areaM2: 142, insulation: "none" as const, quoteStatus: "have_quote" as const, quoteIncGst: 3450, includes: "R5.0 batts supply and install", proposedR: 5, files: [] };
const quotes = async () => (await db.query<{ id: string; status: string; subtotal_inc_gst: string; discount_note: string | null }>("select id, status, subtotal_inc_gst, discount_note from quotes where job_id=$1 order by created_at", [JOB])).rows;
const items = async (qid: string) => (await db.query<{ code: string; line_total_inc_gst: string }>("select code, line_total_inc_gst from quote_items where quote_id=$1 order by sort", [qid])).rows.map((r) => `${r.code}:${Number(r.line_total_inc_gst)}`);
const current = async () => (await quotes()).filter((q) => q.status === "draft");
const evs = async () => (await db.query<{ event_type: string }>("select event_type from workflow_events where job_id=$1 order by created_at", [JOB])).rows.map((r) => r.event_type);

async function seed(choice: string | null) {
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
  await db.query("insert into business_members values ($1,$2,'owner',true)", [BIZ, U]);
  await db.query("insert into partner_relationships values ($1,$2,true)", [BIZ, EL]);
  await db.query("insert into businesses (id, name, business_type, capabilities, rec_number, onboarding_status, is_active) values ($1,'Sample Electrical','rec','{electrician}','REC-SAMPLE','approved',true)", [EL]);
  // Jo 4 Nov 2026: the installer's own PIESA rate (rate card PIESA line, ex GST $250 → $275 inc) prices the owner's PIESA line.
  await db.query("insert into businesses (id, name, business_type, capabilities, onboarding_status, is_active) values ($1,'Sample Installer','eec_installer','{installer}','approved',true)", [BIZ]);
  await db.query("insert into rate_cards (id, business_id, kind) values ($1,$2,'installer')", [RATE_CARD, BIZ]);
  await db.query("insert into rate_card_items (rate_card_id, code, unit_price_ex_gst, unit) values ($1,'PIESA',250,'flat')", [RATE_CARD]);
}

const choice = async () => (await db.query<{ electrician_choice: string | null }>("select electrician_choice from jobs where id=$1", [JOB])).rows[0]!.electrician_choice;
const err = (p: Promise<unknown>) => p.then(() => "accepted", (e) => (e as Error).message);

describe("legacy job-card switch can no longer bypass the Add job rules", () => {
  beforeEach(() => seed("preferred"));

  test("own -> HIV through the old switch is refused on an Add job job; payer, nominations and quote untouched", async () => {
    await db.query("insert into electrician_nominations (job_id, business_id, contact_name) values ($1,$2,'Sample')", [JOB, EL]);
    await draftQuoteFromIntake(JOB, U);
    const before = await current();
    const r = await err(switchJobToHivic(JOB, U));
    expect(r).toMatch(/job's details/);
    expect(await choice()).toBe("preferred");
    expect((await db.query("select id from electrician_nominations where ended_at is null")).rows.length).toBe(1);
    expect((await current()).map((q) => q.id)).toEqual(before.map((q) => q.id));
    expect(await evs()).not.toContain("electrician_choice_changed");
  });

  test("non-Add-job installer job: old switch blocked once the quote is accepted, and once the invoice is raised", async () => {
    await db.query("delete from workflow_events where event_type='installer_evidence_acknowledged'");
    const q = (await db.query<{ id: string }>("insert into quotes (job_id, kind, status, option_code) values ($1,'installation','accepted','INSTALLER_A1') returning id", [JOB])).rows[0]!.id;
    expect(await err(switchJobToHivic(JOB, U))).toMatch(/already accepted the quote/);
    await db.query("insert into invoices (quote_id) values ($1)", [q]);
    expect(await payerChangeBlocker(JOB)).toMatch(/invoice has already been raised/);
    expect(await err(switchJobToHivic(JOB, U))).toMatch(/invoice has already been raised/);
    expect(await choice()).toBe("preferred");
  });

  // Main Part 2 (Jo 2 Nov 2026, a6aa0a66) supersedes the 9 Oct "legacy path kept": an installer's own customer never switches
  // to Home Insulation Victoria's electrician, quote or no quote. Nothing changes on refusal.
  test("non-Add-job job with no quote: the old switch is refused too (own electricians only); payer and nomination untouched", async () => {
    await db.query("delete from workflow_events where event_type='installer_evidence_acknowledged'");
    await db.query("insert into electrician_nominations (job_id, business_id, contact_name) values ($1,$2,'Sample')", [JOB, EL]);
    expect(await err(switchJobToHivic(JOB, U))).toBe("Use one of your own electricians.");
    expect(await choice()).toBe("preferred");
    expect((await db.query("select id from electrician_nominations where ended_at is null")).rows.length).toBe(1);
    expect(await evs()).not.toContain("electrician_choice_changed");
  });
});

describe("send/accept re-check quote lines against the CURRENT payer (any path)", () => {
  beforeEach(() => seed("preferred"));

  // Jo 4 Nov 2026 (decision 431): the own-customer lines are the same whatever the recorded choice — the installer's price,
  // the $349 fee and the installer's OWN PIESA rate — so a payer flipped by another writer neither blocks the quote nor
  // changes the lines; an identical re-draft reuses the one draft. (The 9 Oct "own quote has no PIESA line" is history.)
  test("own quote carries the installer's own PIESA line; a legacy payer flip by another writer changes nothing (one draft, still sendable)", async () => {
    await draftQuoteFromIntake(JOB, U);
    const own = (await current())[0]!;
    expect(await items(own.id)).toEqual(OWN_LINES);
    expect(await quoteBillingBlocker(own.id)).toBeNull();
    await db.query("update jobs set electrician_choice='hivic_organise'"); // simulated alternate writer (retired arrangement)
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_owner_fee_awareness',$2)", [JOB, JSON.stringify({ by: "installer", payer: "hivic", wording: FEE_AWARENESS_HIV_REC })]);
    expect(await quoteBillingBlocker(own.id)).toBeNull();
    await draftQuoteFromIntake(JOB, U);
    expect((await current()).map((q) => q.id)).toEqual([own.id]);
    expect(await items(own.id)).toEqual(OWN_LINES);
  });

  test("a draft made under the legacy choice keeps the same lines once the payer is own; undecided blocks; accepted quotes are frozen (never re-checked)", async () => {
    await db.query("update jobs set electrician_choice='hivic_organise'");
    await draftQuoteFromIntake(JOB, U);
    const q = (await current())[0]!;
    await db.query("update jobs set electrician_choice='preferred'");
    // Jo 26 Oct 2026: an own electrician is billed through us too, so a quote with a PIESA line is not blocked.
    expect(await quoteBillingBlocker(q.id)).toBeNull();
    await db.query("update jobs set electrician_choice=null");
    expect(await quoteBillingBlocker(q.id)).toMatch(/not decided/);
    await db.query("update quotes set status='accepted' where id=$1", [q.id]);
    expect(await quoteBillingBlocker(q.id)).toBeNull();
    expect(await items(q.id)).toEqual(OWN_LINES);
  });
  test("a stale draft priced at a fixed $349 PIESA (Part 10) holds until a fresh draft carries the installer's own rate", async () => {
    await draftQuoteFromIntake(JOB, U);
    const q = (await current())[0]!;
    await db.query("update quote_items set unit_price_inc_gst=349, line_total_inc_gst=349 where quote_id=$1 and code='PIESA'", [q.id]);
    expect(await quoteBillingBlocker(q.id)).toMatch(/\$349\.00, not the installer's PIESA price \$275\.00/);
    await db.query("delete from rate_card_items");
    expect(await quoteBillingBlocker(q.id)).toBe("Installer business has no PIESA rate on its rate card");
  });

  test("accepted quote + invoice: payer change via the editor refused BEFORE any write; facts and quote unchanged", async () => {
    await db.query("update jobs set electrician_choice='hivic_organise'");
    const q = (await db.query<{ id: string }>("insert into quotes (job_id, kind, status, option_code) values ($1,'installation','accepted','INSTALLER_A1') returning id", [JOB])).rows[0]!.id;
    await db.query("insert into invoices (quote_id) values ($1)", [q]);
    const r = await err(installerUpdateIntake(JOB, U, BIZ, { ...base, areaM2: 150, electricianPayer: "own", electrician: { mode: "mine", business_id: EL } }));
    expect(r).toMatch(/invoice has already been raised/);
    expect(await choice()).toBe("hivic_organise");
    expect(Number((await db.query<{ supplied_area_m2: string }>("select supplied_area_m2 from ceiling_measurements")).rows[0]!.supplied_area_m2)).toBe(142);
    expect((await quotes()).map((x) => x.status)).toEqual(["accepted"]);
  });
});

describe("draft reuse compares full scope, not just code + amount", () => {
  beforeEach(() => seed("hivic_organise"));
  test("same amount, changed inclusions -> new draft (old superseded)", async () => {
    await draftQuoteFromIntake(JOB, U);
    const a = (await current())[0]!;
    await db.query("update jobs set installer_price_includes='R6.0 batts supply and install, old insulation removed'");
    await draftQuoteFromIntake(JOB, U);
    const b = (await current())[0]!;
    expect(b.id).not.toBe(a.id);
    expect((await quotes()).find((x) => x.id === a.id)!.status).toBe("superseded");
  });
  test("identical facts -> same draft reused (no duplicate)", async () => {
    await draftQuoteFromIntake(JOB, U);
    await draftQuoteFromIntake(JOB, U);
    expect((await quotes()).length).toBe(1);
  });
});

describe("own electrician changes through the guarded editor", () => {
  beforeEach(async () => { await seed("preferred"); await db.exec("update business_members set member_role='business_admin'"); });

  // Main Part 2 (Jo 2 Nov 2026): the editor refuses the Home Insulation Victoria arrangement BEFORE any write — the
  // nomination, the fee declaration and the held draft (which already carries the installer's own PIESA line) all stay.
  test("own -> HIV is refused before any write: nomination kept, fee declaration kept, the one held draft untouched", async () => {
    await db.query("insert into electrician_nominations (job_id, business_id, contact_name) values ($1,$2,'Sample')", [JOB, EL]);
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_owner_fee_awareness',$2)", [JOB, JSON.stringify({ by: "installer", payer: "own", wording: FEE_AWARENESS_OWN_REC })]);
    await draftQuoteFromIntake(JOB, U);
    const before = (await current())[0]!;
    expect(await items(before.id)).toEqual(OWN_LINES);
    const evBefore = (await evs()).length;
    expect(await err(installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "hivic" } as never))).toBe("Use one of your own electricians.");
    expect(await choice()).toBe("preferred");
    expect((await db.query("select id from electrician_nominations where ended_at is null")).rows.length).toBe(1);
    expect(await evs()).not.toContain("installer_owner_fee_awareness_invalidated");
    expect((await evs()).length).toBe(evBefore);
    expect((await current()).map((q) => q.id)).toEqual([before.id]);
    expect((await db.query<{ release_state: string }>("select release_state from quotes where id=$1", [before.id])).rows[0]!.release_state).toBe("held");
  });

  test("committed own (accepted owner quote) stays locked with no mutation", async () => {
    await db.query("insert into electrician_nominations (job_id, business_id, contact_name) values ($1,$2,'Sample')", [JOB, EL]);
    await db.query("insert into quotes (job_id, kind, status, release_state) values ($1,'installation','accepted','released')", [JOB]);
    const evBefore = (await evs()).length;
    const r = await err(installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "undecided" } as never));
    expect(r).toMatch(/accepted a quote with your own electrician/);
    expect(await choice()).toBe("preferred");
    expect((await db.query("select id from electrician_nominations where ended_at is null")).rows.length).toBe(1);
    expect((await evs()).length).toBe(evBefore);
  });

  test("staff member cannot change an own choice", async () => {
    await db.exec("update business_members set member_role='member'");
    expect(await err(installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "undecided" } as never))).toMatch(/business owner/);
    expect(await choice()).toBe("preferred");
  });
});
