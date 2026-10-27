// Jo 27 Oct 2026 (HV-3129): a held owner quote never keeps showing an older price.
// - Electrician's price known (held only for other reasons): the held draft is rebuilt with the latest figures, still held.
// - Electrician's price NOT known (not onboarded / no agreed price / undecided): the old open draft is withdrawn
//   (superseded) and no new draft is made (decision 113), so the installer sees only their own price.
// - Issued quotes are never touched. Nothing is sent.
// Real draftInstallerQuoteFromReadyCheck on PGlite (fake TEST rows only).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, electrician_choice text, ap_fee_override_inc_gst numeric, properties jsonb, stage text DEFAULT 'measured_estimate_ready',
  deleted_at timestamptz, qa_archived_at timestamptz, source text DEFAULT 'qa_test', job_number text DEFAULT 'HV-3129');
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, measured_area_m2 numeric, verified_area_m2 numeric, removal_required boolean, external_source text, external_id text);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text, option_label text, option_code text,
  sent_at timestamptz, subtotal_inc_gst numeric, gst_amount numeric, veec_discount_inc_gst numeric, discount_note text, customer_total_inc_gst numeric, created_by uuid, created_at timestamptz default clock_timestamp());
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
    // The status loader's embedded quote_items(...) is not needed here (the HV-3129 shape has no quote).
    b.select = (c?: unknown, o?: unknown) => sel(typeof c === "string" ? c.replace("properties(postcode)", "properties").replace(/,\s*quote_items\([^)]*\)/, "") : c, o);
    b.insert = (p: unknown) => {
      if (!Array.isArray(p)) return ins(p);
      return { then: async (r: (v: unknown) => unknown) => { for (const row of p) { const x = (await shim.from(t).insert(row)) as { error: unknown }; if (x.error) return r(x); } return r({ data: null, error: null }); } };
    };
    return b;
  },
};
const sent: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
// No approved RECs on this practice database (the shim can't run the live `cs` filter): "TEST Sparky" is not onboarded.
mock.module("../src/lib/rec-onboarded.server", () => ({ loadApprovedRecCandidates: async () => [] }));
mock.module("../src/lib/usual-electrician-reminder.server", () => ({ maybeRemindUsualElectrician: async () => { sent.push("reminder"); } }));
const { draftInstallerQuoteFromReadyCheck, INSTALLER_QUOTE_CODE, heldDraftHoldReason } = await import("../src/lib/installer-quote.server");

const JOB = "00000000-0000-0000-0000-000000003129", BIZ = "00000000-0000-0000-0000-00000000b129", U = "00000000-0000-0000-0000-00000000c129";
const form = (product: string | null) => [
  { label: "Homeowner agrees to be contacted by Home Insulation Victoria", value: "Yes" },
  { label: "What insulation product will you be using on this job?", value: product },
  { label: "What's included in your quote?", value: "Ceiling insulation - supply & install" },
  { label: "Total quoted price (inc GST)", value: "4201.25" },
];
const quotes = async () => (await db.query<{ id: string; status: string; release_state: string | null; release_hold_reason: string | null; sent_at: string | null; subtotal_inc_gst: string }>("select id, status, release_state, release_hold_reason, sent_at, subtotal_inc_gst from quotes where job_id=$1 order by created_at", [JOB])).rows;
const installerLine = async (qid: string) => Number((await db.query<{ line_total_inc_gst: string }>("select line_total_inc_gst from quote_items where quote_id=$1 and code='INSTALLER_PRICE'", [qid])).rows[0]?.line_total_inc_gst);
const events = async (type: string) => (await db.query("select id from workflow_events where job_id=$1 and event_type=$2", [JOB, type])).rows;
const setCardPrice = (price: number) => db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_price_set',$2)", [JOB, JSON.stringify({ price_inc_gst: price, included: ["Ceiling insulation - supply & install"], included_other: null })]);
/** The 23 Oct draft the installer page still showed: installer line $4,201.25. */
async function oldDraft(status = "draft", sentAt: string | null = null) {
  const { rows: [q] } = await db.query<{ id: string }>("insert into quotes (job_id, kind, status, release_state, release_hold_reason, option_label, option_code, sent_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst) values ($1,'installation',$2,'held','Waiting for office review before sending','Installer''s quote (from Ready Check)',$3,$4,4899.25,0,4899.25) returning id", [JOB, status, INSTALLER_QUOTE_CODE, sentAt]);
  await db.query("insert into quote_items (quote_id, code, description, quantity, unit, unit_price_inc_gst, line_total_inc_gst, is_other, sort) values ($1,'INSTALLER_PRICE','Insulation works by your installer',1,'flat',4201.25,4201.25,false,0)", [q!.id]);
  return q!.id;
}

beforeEach(async () => {
  sent.length = 0;
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from quotes; delete from quote_items; delete from veu_location_variables; delete from retail_estimator_settings; delete from workflow_settings; delete from admin_config_events;");
  await db.query("insert into jobs (id, channel, originating_installer_business_id, electrician_choice, properties) values ($1,'installer_sourced',$2,'hivic_organise','{\"postcode\":\"3000\"}')", [JOB, BIZ]);
  await db.query("insert into ceiling_measurements (job_id, is_current, measured_area_m2, removal_required) values ($1,true,120,false)", [JOB]);
  await db.query("insert into veu_location_variables values ('3000','Metropolitan','Mild')");
  await db.query("insert into retail_estimator_settings values (true, 349, 349, 40, 200)");
  await db.query("insert into workflow_settings values (1, false, false)");
});

/** HV-3129: the owner's usual electrician "TEST Sparky" is not an onboarded REC and has no agreed price. */
async function notOnboardedElectrician() {
  await db.query("insert into admin_config_events (event_type, details) values ('installer_usual_electrician_saved',$1)", [JSON.stringify({ business_id: BIZ, electrician: { name: "TEST Sparky", licence: "TEST-LIC-3129" } })]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'electrician_choice_set',$2)", [JOB, JSON.stringify({ choice: "usual", source: "add_job" })]);
}

describe("held, electrician's price NOT known (HV-3129)", () => {
  test("not onboarded, old draft $4,201.25, price now $2,500 → old draft superseded, no new draft, nothing sent", async () => {
    await notOnboardedElectrician();
    const old = await oldDraft();
    await setCardPrice(2500);
    const draft = await draftInstallerQuoteFromReadyCheck(JOB, U, form("Bradford Gold R5"), "audit_3129");
    expect(draft?.ready).toBe(false);
    const all = await quotes();
    expect(all.find((q) => q.id === old)?.status).toBe("superseded");
    expect(all.filter((q) => q.status === "draft")).toEqual([]);
    // The installer's owner-quote preview reads the latest draft/issued/accepted/declined quote: there is none now.
    expect(all.filter((q) => ["draft", "issued", "accepted", "declined"].includes(q.status))).toEqual([]);
    expect(all.every((q) => q.sent_at === null)).toBe(true);
    expect(await events("installer_quote_drafted")).toHaveLength(0);
    expect(await events("installer_quote_held")).toHaveLength(1);
    // A second run changes nothing and writes no duplicate hold.
    await draftInstallerQuoteFromReadyCheck(JOB, U, form("Bradford Gold R5"), "audit_3129");
    expect((await quotes()).length).toBe(1);
    expect(await events("installer_quote_held")).toHaveLength(1);
  });
});

describe("held for another reason, electrician's price known", () => {
  test("HIV electrician, product not confirmed → held draft rebuilt at $2,500; a second identical run adds nothing", async () => {
    const old = await oldDraft();
    await setCardPrice(2500);
    const draft = await draftInstallerQuoteFromReadyCheck(JOB, U, form(null), "audit_held");
    expect(draft?.ready).toBe(false);
    const all = await quotes();
    expect(all.find((q) => q.id === old)?.status).toBe("superseded");
    const drafts = all.filter((q) => q.status === "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.release_state).toBe("held");
    expect(drafts[0]!.sent_at).toBeNull();
    expect(drafts[0]!.release_hold_reason).toContain("confirm insulation product");
    expect(drafts[0]!.release_hold_reason).toContain("Waiting for office review before sending");
    expect(await installerLine(drafts[0]!.id)).toBe(2500);
    expect(await events("installer_quote_drafted")).toHaveLength(1);
    expect(await events("mitti_quote_electrician_snapshot")).toHaveLength(1);

    await draftInstallerQuoteFromReadyCheck(JOB, U, form(null), "audit_held");
    const again = await quotes();
    expect(again.length).toBe(2);
    expect(again.filter((q) => q.status === "draft").map((q) => q.id)).toEqual([drafts[0]!.id]);
    expect(await events("installer_quote_drafted")).toHaveLength(1);
    expect(await events("mitti_quote_electrician_snapshot")).toHaveLength(1);
  });
});

describe("an issued quote is never touched", () => {
  test("issued $4,201.25 quote + held run at $2,500 → unchanged, no new draft", async () => {
    await notOnboardedElectrician();
    const issued = await oldDraft("issued", "2026-10-23T01:00:00Z");
    await setCardPrice(2500);
    await draftInstallerQuoteFromReadyCheck(JOB, U, form("Bradford Gold R5"), "audit_issued");
    const all = await quotes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: issued, status: "issued", release_hold_reason: "Waiting for office review before sending" });
    expect(await installerLine(issued)).toBe(4201.25);
  });
  test("issued quote + held run with a known electrician price → unchanged, no new draft", async () => {
    const issued = await oldDraft("issued", "2026-10-23T01:00:00Z");
    await setCardPrice(2500);
    await draftInstallerQuoteFromReadyCheck(JOB, U, form(null), "audit_issued");
    const all = await quotes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: issued, status: "issued" });
  });
});

// Review fix (27 Oct 2026): a held preview never shows without the rebate. No measured area, or a VEU discount that
// can't be worked out → the "not buildable" branch: the open draft is withdrawn and no new one is made.
describe("held, rebate can't be worked out", () => {
  test("missing measured area → old draft superseded, no new held draft", async () => {
    await db.exec("delete from ceiling_measurements");
    const old = await oldDraft();
    await setCardPrice(2500);
    const draft = await draftInstallerQuoteFromReadyCheck(JOB, U, form(null), "audit_no_area");
    expect(draft?.ready).toBe(false);
    expect(draft?.blockers).toContain("Measured ceiling area is missing.");
    const all = await quotes();
    expect(all.find((q) => q.id === old)?.status).toBe("superseded");
    expect(all.filter((q) => q.status === "draft")).toEqual([]);
    expect(await events("installer_quote_drafted")).toHaveLength(0);
  });
  test("VEU discount can't be worked out (postcode not listed) → old draft superseded, no new held draft", async () => {
    await db.exec("delete from veu_location_variables");
    const old = await oldDraft();
    await setCardPrice(2500);
    const draft = await draftInstallerQuoteFromReadyCheck(JOB, U, form(null), "audit_no_veu");
    expect(draft?.ready).toBe(false);
    expect(draft?.blockers.some((b) => b.startsWith("VEU discount can't be worked out"))).toBe(true);
    const all = await quotes();
    expect(all.find((q) => q.id === old)?.status).toBe("superseded");
    expect(all.filter((q) => q.status === "draft")).toEqual([]);
    expect(await events("installer_quote_drafted")).toHaveLength(0);
  });
});

// Review fix (27 Oct 2026): with the not-known branch there is no draft, so the installer's status must take the
// not-onboarded flag from the latest installer_quote_held event — never the generic line.
describe("installer status with no draft (HV-3129 shape)", () => {
  test("electrician not onboarded, no draft → 'Your electrician needs to finish onboarding'", async () => {
    await notOnboardedElectrician();
    await oldDraft();
    await setCardPrice(2500);
    await draftInstallerQuoteFromReadyCheck(JOB, U, form("Bradford Gold R5"), "audit_3129");
    expect((await quotes()).filter((q) => q.status === "draft")).toEqual([]);
    const { loadInstallerQuote, loadInstallerQuotes } = await import("../src/lib/installer-quote-status.server");
    const { installerQuoteLine, QUOTE_ELECTRICIAN_NOT_ONBOARDED_LINE } = await import("../src/lib/installer-quote-status.core");
    const one = await loadInstallerQuote(JOB);
    expect(one.quote).toBeNull();
    expect(one.applies).toBe(true);
    expect(installerQuoteLine(one)).toBe(QUOTE_ELECTRICIAN_NOT_ONBOARDED_LINE);
    const many = (await loadInstallerQuotes([JOB])).get(JOB)!;
    expect(many.quote).toBeNull();
    expect(many.applies).toBe(true);
    expect(installerQuoteLine(many)).toBe(QUOTE_ELECTRICIAN_NOT_ONBOARDED_LINE);
  });
  test("no draft and no not-onboarded hold → still nothing to show", async () => {
    const { loadInstallerQuote, loadInstallerQuotes } = await import("../src/lib/installer-quote-status.server");
    expect((await loadInstallerQuote(JOB)).applies).toBe(false);
    expect((await loadInstallerQuotes([JOB])).get(JOB)!.applies).toBe(false);
  });
});

// Review fix (27 Oct 2026): a held draft always carries a reason, so it can never look sendable.
describe("held draft hold reason", () => {
  test("no blockers → the generic hold reason, never just the office-review suffix", () => {
    expect(heldDraftHoldReason([])).toBe("Quote held for office review · Waiting for office review before sending");
  });
  test("blockers → joined, then the office-review suffix", () => {
    expect(heldDraftHoldReason(["A", "B"])).toBe("A · B · Waiting for office review before sending");
  });
});
