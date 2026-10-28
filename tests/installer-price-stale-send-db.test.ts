// Jo 28 Oct 2026 (final review Imp 1): an installer quote is never sent with an older installer price.
// - A draft whose INSTALLER_PRICE line is not the latest saved price (`installer_price_set`, latest wins) is refused by
//   the office Send and by the automatic send (both go through officeQuoteBlockers).
// - After the rebuild the draft carries the new price and the price check passes.
// - When the rebuild after Save price fails, the stale draft is held with the plain reason.
// Real installer-quote / office-quote-review / auto-quote-send / installer-price-set on PGlite (fake TEST rows only).
// Run on its own: bun test tests/installer-price-stale-send-db.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, electrician_choice text, ap_fee_override_inc_gst numeric, properties jsonb, stage text DEFAULT 'measured_estimate_ready',
  deleted_at timestamptz, qa_archived_at timestamptz, source text DEFAULT 'qa_test', job_number text DEFAULT 'HV-3197');
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, measured_area_m2 numeric, verified_area_m2 numeric, removal_required boolean, removal_m2 numeric, access_difficulty text, external_source text, external_id text, status text, raw_snapshot jsonb);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text, option_label text, option_code text,
  sent_at timestamptz, subtotal_inc_gst numeric, gst_amount numeric, veec_discount_inc_gst numeric, discount_note text, customer_total_inc_gst numeric, created_by uuid, created_at timestamptz default clock_timestamp(),
  manually_adjusted boolean NOT NULL DEFAULT false);
CREATE TABLE quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, code text, description text, quantity numeric, unit text, unit_price_inc_gst numeric, line_total_inc_gst numeric, is_other boolean, explanation text, sort int);
CREATE TABLE veu_location_variables (postcode text, metropolitan_or_regional text, climate_region text);
CREATE TABLE retail_estimator_settings (is_current boolean, ap_management_inc_gst numeric, piesa_assessment_inc_gst numeric, indicative_veec_value numeric, minimum_customer_copayment_inc_gst numeric);
CREATE TABLE workflow_settings (id int, auto_send_quote boolean, customer_comms_enabled boolean);
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());`);

const shim = postgrestShim(db);
const admin = {
  ...shim,
  from(t: string) {
    const b = shim.from(t) as Record<string, (...a: unknown[]) => unknown>;
    const sel = b.select!, ins = b.insert!;
    b.select = (c?: unknown, o?: unknown) => sel(typeof c === "string" ? c.replace("properties(postcode)", "properties").replace(/,\s*quote_items\([^)]*\)/, "") : c, o);
    b.insert = (p: unknown) => {
      if (!Array.isArray(p)) return ins(p);
      return { then: async (r: (v: unknown) => unknown) => { for (const row of p) { const x = (await shim.from(t).insert(row)) as { error: unknown }; if (x.error) return r(x); } return r({ data: null, error: null }); } };
    };
    return b;
  },
};
class WorkflowError extends Error {}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
// Checks that are not about the price: passed, so only the price decides here.
mock.module("../src/lib/installer-intake.server", () => ({ intakeSendBlockers: async () => [], reconfirmationOpen: async () => false, isIntakeJob: async () => false }));
mock.module("../src/lib/install-evidence.server", () => ({ jobProductProblems: async () => [] }));
mock.module("../src/lib/rec-onboarded.server", () => ({ loadApprovedRecCandidates: async () => [] }));
mock.module("../src/lib/usual-electrician-reminder.server", () => ({ maybeRemindUsualElectrician: async () => undefined }));
mock.module("../src/lib/pilot.server", () => ({ requireMember: async () => undefined, myBusinesses: async () => new Map() }));
let syncFails = true;
mock.module("../src/lib/mitti.server", () => ({ syncMittiAssessment: async () => { if (syncFails) throw new Error("Mitti is down"); }, realMittiCall: async () => { throw new Error("no Mitti in tests"); } }));

const { draftInstallerQuoteFromReadyCheck, INSTALLER_QUOTE_CODE, installerPriceStaleBlocker } = await import("../src/lib/installer-quote.server");
const { officeQuoteBlockers, releaseQuoteToOwner } = await import("../src/lib/office-quote-review.server");
const { maybeAutoSendInstallerQuote } = await import("../src/lib/auto-quote-send.server");
const { setInstallerPrice } = await import("../src/lib/installer-price-set.server");
const { INSTALLER_PRICE_STALE, INSTALLER_PRICE_REBUILD_FAILED, installerPriceStale } = await import("../src/lib/installer-price.core");

const JOB = "00000000-0000-0000-0000-000000003197", BIZ = "00000000-0000-0000-0000-00000000b197", U = "00000000-0000-0000-0000-00000000c197";
const form = [
  { label: "Homeowner agrees to be contacted by Home Insulation Victoria", value: "Yes" },
  { label: "What insulation product will you be using on this job?", value: null },
  { label: "What's included in your quote?", value: "Ceiling insulation - supply & install" },
];
const setCardPrice = (price: number, at: string) => db.query("insert into workflow_events (job_id, event_type, details, created_at) values ($1,'installer_price_set',$2,$3)", [JOB, JSON.stringify({ price_inc_gst: price, included: ["Ceiling insulation - supply & install"], included_other: null }), at]);
const drafts = async () => (await db.query<{ id: string; release_state: string; release_hold_reason: string | null; created_at: string }>("select id, release_state, release_hold_reason, created_at from quotes where job_id=$1 and status='draft' order by created_at", [JOB])).rows;
/** The draft the installer page still showed: $20 installer line (HV-3197), not office-edited. */
async function draftAt(price: number, opts: { holdReason?: string } = {}) {
  const { rows: [q] } = await db.query<{ id: string; created_at: string }>("insert into quotes (job_id, kind, status, release_state, release_hold_reason, option_label, option_code, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, created_at) values ($1,'installation','draft','held',$2,'Installer''s quote (from Ready Check)',$3,$4,0,$4,'2026-10-28T01:00:00Z') returning id, created_at", [JOB, opts.holdReason ?? "Waiting for office review before sending", INSTALLER_QUOTE_CODE, price + 698]);
  await db.query("insert into quote_items (quote_id, code, description, quantity, unit, unit_price_inc_gst, line_total_inc_gst, is_other, sort) values ($1,'INSTALLER_PRICE','Insulation works by your installer',1,'flat',$2,$2,false,0), ($1,'PIESA','PIESA',1,'flat',349,349,false,1), ($1,'AP_FEE','AP fee',1,'flat',349,349,false,2)", [q!.id, price]);
  return q!.id;
}
const quote = async (id: string) => (await db.query<{ id: string; created_at: string; release_hold_reason: string | null; option_code: string }>("select id, created_at, release_hold_reason, option_code from quotes where id=$1", [id])).rows[0]!;

beforeEach(async () => {
  syncFails = true;
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from quotes; delete from quote_items; delete from veu_location_variables; delete from retail_estimator_settings; delete from workflow_settings; delete from admin_config_events;");
  await db.query("insert into jobs (id, channel, originating_installer_business_id, electrician_choice, properties) values ($1,'installer_sourced',$2,'hivic_organise','{\"postcode\":\"3000\"}')", [JOB, BIZ]);
  await db.query("insert into ceiling_measurements (job_id, is_current, measured_area_m2, removal_required) values ($1,true,120,false)", [JOB]);
  await db.query("insert into veu_location_variables values ('3000','Metropolitan','Mild')");
  await db.query("insert into retail_estimator_settings values (true, 349, 349, 40, 200)");
  await db.query("insert into workflow_settings values (1, false, false)");
});

describe("the rule (pure)", () => {
  const latest = { priceIncGst: 3000, setAt: "2026-10-28T02:00:00Z" };
  test("line ≠ latest price → stale; equal (any number form) → not stale; no saved price → nothing to compare", () => {
    expect(installerPriceStale({ lineIncGst: 20, latest, editedAt: null })).toBe(true);
    expect(installerPriceStale({ lineIncGst: "3000.00", latest, editedAt: null })).toBe(false);
    expect(installerPriceStale({ lineIncGst: null, latest, editedAt: null })).toBe(true);
    expect(installerPriceStale({ lineIncGst: 20, latest: null, editedAt: null })).toBe(false);
  });
  test("an office edit after the price was saved stands; an edit before it does not", () => {
    expect(installerPriceStale({ lineIncGst: 2900, latest, editedAt: "2026-10-28T03:00:00Z" })).toBe(false);
    expect(installerPriceStale({ lineIncGst: 2900, latest, editedAt: "2026-10-28T01:30:00Z" })).toBe(true);
  });
});

describe("stale draft → office Send and auto-send refused", () => {
  test("draft $20, price now $3,000 → both refused with the plain reason; nothing sent", async () => {
    const id = await draftAt(20);
    await setCardPrice(3000, "2026-10-28T02:00:00Z");
    expect(await installerPriceStaleBlocker(id)).toBe(INSTALLER_PRICE_STALE);
    expect(await officeQuoteBlockers(JOB, await quote(id))).toContain(INSTALLER_PRICE_STALE);
    await expect(releaseQuoteToOwner(JOB, id, U, "office")).rejects.toThrow(INSTALLER_PRICE_STALE);
    const auto = await maybeAutoSendInstallerQuote(JOB, { formCompleted: true, formModifiedAt: null, enabled: true, entries: form });
    expect(auto.sent).toBe(false);
    expect(auto.reasons).toContain(INSTALLER_PRICE_STALE);
    const sent = (await db.query("select id from quotes where job_id=$1 and (status<>'draft' or sent_at is not null)", [JOB])).rows;
    expect(sent).toEqual([]);
  });
  test("no saved price (old form) and a matching price → no price blocker", async () => {
    const id = await draftAt(3000);
    expect(await installerPriceStaleBlocker(id)).toBeNull();
    await setCardPrice(3000, "2026-10-28T02:00:00Z");
    expect(await installerPriceStaleBlocker(id)).toBeNull();
    expect(await officeQuoteBlockers(JOB, await quote(id))).not.toContain(INSTALLER_PRICE_STALE);
  });
});

describe("after the rebuild → allowed", () => {
  test("rebuild from the latest price → new draft at $3,000, the price check passes on Send and auto-send", async () => {
    const old = await draftAt(20);
    await setCardPrice(3000, "2026-10-28T02:00:00Z");
    await draftInstallerQuoteFromReadyCheck(JOB, U, form, "audit_3197");
    const [d] = await drafts();
    expect(d!.id).not.toBe(old);
    expect(Number((await db.query<{ line_total_inc_gst: string }>("select line_total_inc_gst from quote_items where quote_id=$1 and code='INSTALLER_PRICE'", [d!.id])).rows[0]!.line_total_inc_gst)).toBe(3000);
    expect(await installerPriceStaleBlocker(d!.id)).toBeNull();
    expect(await officeQuoteBlockers(JOB, await quote(d!.id))).not.toContain(INSTALLER_PRICE_STALE);
    const auto = await maybeAutoSendInstallerQuote(JOB, { formCompleted: true, formModifiedAt: null, enabled: true, entries: form });
    expect(auto.reasons).not.toContain(INSTALLER_PRICE_STALE);
  });
});

describe("failed rebuild after Save price → held", () => {
  test("Mitti sync fails → the stale draft is held with the plain reason and Send refuses it", async () => {
    const id = await draftAt(20);
    await setInstallerPrice(JOB, U, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] });
    const [d] = await drafts();
    expect(d!.id).toBe(id);
    expect(d!.release_state).toBe("held");
    expect(d!.release_hold_reason!.split(" · ")[0]).toBe(INSTALLER_PRICE_REBUILD_FAILED);
    expect(d!.release_hold_reason).toContain("Waiting for office review before sending");
    expect(await installerPriceStaleBlocker(id)).toBe(INSTALLER_PRICE_REBUILD_FAILED);
    await expect(releaseQuoteToOwner(JOB, id, U, "office")).rejects.toThrow(INSTALLER_PRICE_REBUILD_FAILED);
    // A second failed save does not repeat the reason.
    await setInstallerPrice(JOB, U, { priceIncGst: 3100, included: ["Ceiling insulation - supply & install"] });
    expect((await drafts())[0]!.release_hold_reason!.split(" · ").filter((r) => r === INSTALLER_PRICE_REBUILD_FAILED)).toHaveLength(1);
  });
  test("rebuild fails but the draft already has the saved price → not held", async () => {
    const id = await draftAt(3000);
    await setInstallerPrice(JOB, U, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] });
    expect((await drafts()).find((q) => q.id === id)!.release_hold_reason).toBe("Waiting for office review before sending");
  });
  test("a later successful rebuild replaces the held draft, clearing the reason", async () => {
    await draftAt(20);
    await setInstallerPrice(JOB, U, { priceIncGst: 3000, included: ["Ceiling insulation - supply & install"] });
    await draftInstallerQuoteFromReadyCheck(JOB, U, form, "audit_3197");
    const [d] = await drafts();
    expect(d!.release_hold_reason).not.toContain(INSTALLER_PRICE_REBUILD_FAILED);
    expect(await installerPriceStaleBlocker(d!.id)).toBeNull();
  });
});
