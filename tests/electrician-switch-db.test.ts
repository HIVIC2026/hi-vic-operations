// Jo 28 Oct 2026 (spec rule 3, Task 3): the installer's business owner can switch a job stuck on "electrician hasn't
// finished signing up" to Home Insulation Victoria's electrician ($349). One `electrician_choice_set` event
// (source installer_switch), the owner's quote rebuilt in the same request with the $349 line, nothing sent. Final:
// a second call is refused. Everyone else, sent/accepted quotes and jobs that don't need it are refused.
// Real switch + real draftInstallerQuoteFromReadyCheck on PGlite (fake TEST rows only); Mitti is a fake form.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, electrician_choice text, ap_fee_override_inc_gst numeric, properties jsonb, stage text DEFAULT 'measured_estimate_ready',
  deleted_at timestamptz, qa_archived_at timestamptz, source text DEFAULT 'qa_test', job_number text DEFAULT 'HV-3129', last_activity_at timestamptz);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, measured_area_m2 numeric, verified_area_m2 numeric, removal_required boolean, external_source text, external_id text, status text);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text, option_label text, option_code text,
  sent_at timestamptz, subtotal_inc_gst numeric, gst_amount numeric, veec_discount_inc_gst numeric, discount_note text, customer_total_inc_gst numeric, created_by uuid, created_at timestamptz default clock_timestamp(),
  manually_adjusted boolean NOT NULL DEFAULT false);
CREATE TABLE quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, code text, description text, quantity numeric, unit text, unit_price_inc_gst numeric, line_total_inc_gst numeric, is_other boolean, explanation text, sort int);
CREATE TABLE veu_location_variables (postcode text, metropolitan_or_regional text, climate_region text);
CREATE TABLE retail_estimator_settings (is_current boolean, ap_management_inc_gst numeric, piesa_assessment_inc_gst numeric, indicative_veec_value numeric, minimum_customer_copayment_inc_gst numeric);
CREATE TABLE workflow_settings (id int, auto_send_quote boolean, customer_comms_enabled boolean);
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE profiles (id uuid primary key, business_id uuid);
CREATE TABLE business_members (business_id uuid, user_id uuid, member_role text, active boolean);`);

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
const sent: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
// Approved REC candidates (empty = nobody onboarded). The "onboarded electrician" test sets one.
let recCandidates: unknown[] = [];
mock.module("../src/lib/rec-onboarded.server", () => ({ loadApprovedRecCandidates: async () => recCandidates }));
mock.module("../src/lib/usual-electrician-reminder.server", () => ({ maybeRemindUsualElectrician: async () => { sent.push("reminder"); } }));
mock.module("../src/lib/auto-quote-send.server", () => ({ maybeAutoSendInstallerQuote: async () => { sent.push("auto-send"); } }));
// The job's Mitti Ready Check form (read-only fake). Same answers the Task 2 HV-3129 test uses.
let mittiReads = 0;
let mittiDown = false;
const FORM = [
  ["Homeowner agrees to be contacted by Home Insulation Victoria", "Yes"],
  ["What insulation product will you be using on this job?", "Bradford Gold R5"],
  ["What's included in your quote?", "Ceiling insulation - supply & install"],
  ["Total quoted price (inc GST)", "4201.25"],
] as const;
mock.module("../src/lib/mitti.server", () => ({
  realMittiCall: async (method: string, path: string) => {
    mittiReads++;
    if (mittiDown) throw new Error("TEST: Mitti is down");
    if (method !== "GET" || !path.startsWith("/audits/")) { sent.push(`mitti ${method} ${path}`); return {}; }
    return { audit_id: "audit_3129", items: FORM.map(([label, value], i) => ({ item_id: `i${i}`, label, type: "text", responses: { text: value } })) };
  },
}));

const { draftInstallerQuoteFromReadyCheck } = await import("../src/lib/installer-quote.server");
const { switchToHivicElectricianFor, SWITCH_REFUSED } = await import("../src/lib/electrician-switch.server");
const { loadInstallerQuote, loadInstallerQuotes } = await import("../src/lib/installer-quote-status.server");
const { installerQuoteLine, quoteLineYours, quoteLineTab, QUOTE_HELD_LINE } = await import("../src/lib/installer-quote-status.core");

const JOB = "00000000-0000-0000-0000-000000003129", BIZ = "00000000-0000-0000-0000-00000000b129", BIZ2 = "00000000-0000-0000-0000-00000000b200";
const OWNER = "00000000-0000-0000-0000-00000000c129", WORKER = "00000000-0000-0000-0000-00000000c130", OTHER = "00000000-0000-0000-0000-00000000c200", OFFICE = "00000000-0000-0000-0000-00000000a001";
const entries = FORM.map(([label, value]) => ({ label, value }));
const quotes = async () => (await db.query<{ id: string; status: string; sent_at: string | null; release_hold_reason: string | null }>("select id, status, sent_at, release_hold_reason from quotes where job_id=$1 order by created_at", [JOB])).rows;
const line = async (qid: string, code: string) => (await db.query<{ line_total_inc_gst: string }>("select line_total_inc_gst from quote_items where quote_id=$1 and code=$2", [qid, code])).rows.map((r) => Number(r.line_total_inc_gst));
const switches = async () => (await db.query<{ details: { choice: string; source: string } }>("select details from workflow_events where job_id=$1 and event_type='electrician_choice_set' and details->>'source'='installer_switch'", [JOB])).rows;
const choiceEvents = async () => (await db.query("select id from workflow_events where job_id=$1 and event_type='electrician_choice_set'", [JOB])).rows;

beforeEach(async () => {
  sent.length = 0; mittiReads = 0; mittiDown = false; recCandidates = [];
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from quotes; delete from quote_items; delete from veu_location_variables; delete from retail_estimator_settings; delete from workflow_settings; delete from admin_config_events; delete from profiles; delete from business_members;");
  await db.query("insert into jobs (id, channel, originating_installer_business_id, electrician_choice, properties) values ($1,'installer_sourced',$2,'hivic_organise','{\"postcode\":\"3000\"}')", [JOB, BIZ]);
  await db.query("insert into ceiling_measurements (job_id, is_current, measured_area_m2, removal_required, external_source, external_id, status) values ($1,true,120,false,'mitti','audit_3129','complete')", [JOB]);
  await db.query("insert into veu_location_variables values ('3000','Metropolitan','Mild')");
  await db.query("insert into retail_estimator_settings values (true, 349, 349, 40, 200)");
  await db.query("insert into workflow_settings values (1, false, false)");
  await db.query("insert into business_members values ($1,$2,'business_admin',true), ($1,$3,'member',true), ($4,$5,'business_admin',true)", [BIZ, OWNER, WORKER, BIZ2, OTHER]);
  await db.query("insert into profiles values ($1, null)", [OFFICE]);
  // HV-3129: the installer pressed Complete in Mitti (latest ready_check_basics).
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'ready_check_basics','{\"completed\":true}')", [JOB]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_price_set',$2)", [JOB, JSON.stringify({ price_inc_gst: 2500, included: ["Ceiling insulation - supply & install"], included_other: null })]);
});

/** HV-3129: usual electrician "TEST Sparky" is not onboarded → held, no draft, the installer sees the note. */
async function stuckJob() {
  await db.query("insert into admin_config_events (event_type, details) values ('installer_usual_electrician_saved',$1)", [JSON.stringify({ business_id: BIZ, electrician: { name: "TEST Sparky", licence: "TEST-LIC-3129" } })]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'electrician_choice_set',$2)", [JOB, JSON.stringify({ choice: "usual", source: "add_job" })]);
  await draftInstallerQuoteFromReadyCheck(JOB, OWNER, entries, "audit_3129");
  expect((await loadInstallerQuote(JOB)).electricianNotOnboarded).toEqual({ name: "TEST Sparky" });
  expect((await quotes()).filter((q) => q.status === "draft")).toEqual([]);
  mittiReads = 0;
}

describe("the job's installer business owner switches a stuck job", () => {
  test("one installer_switch event, the quote rebuilt with the $349 electrician line, nothing sent", async () => {
    await stuckJob();
    const r = await switchToHivicElectricianFor(JOB, OWNER);
    expect(r).toEqual({ ok: true });
    expect((await switches()).map((e) => ({ choice: e.details.choice, source: e.details.source }))).toEqual([{ choice: "hivic", source: "installer_switch" }]);
    const drafts = (await quotes()).filter((q) => q.status === "draft");
    expect(drafts).toHaveLength(1);
    expect(await line(drafts[0]!.id, "PIESA")).toEqual([349]);
    expect(await line(drafts[0]!.id, "INSTALLER_PRICE")).toEqual([2500]);
    expect((await quotes()).every((q) => q.sent_at === null)).toBe(true);
    expect(sent).toEqual([]);
    expect(mittiReads).toBe(1);
    // The note is gone and the job leaves Action needed.
    const after = await loadInstallerQuote(JOB);
    expect(after.electricianNotOnboarded).toBeNull();
    expect(installerQuoteLine(after)).toBe(QUOTE_HELD_LINE);
    expect(quoteLineYours(installerQuoteLine(after))).toBe(false);
  });

  test("before the switch the stuck job is the installer's move (Action needed)", async () => {
    await stuckJob();
    expect(quoteLineYours(installerQuoteLine(await loadInstallerQuote(JOB)))).toBe(true);
  });

  test("double tap: the second call is refused — no second event, no second draft", async () => {
    await stuckJob();
    expect((await switchToHivicElectricianFor(JOB, OWNER)).ok).toBe(true);
    const before = await quotes();
    const second = await switchToHivicElectricianFor(JOB, OWNER);
    expect(second).toEqual({ ok: false, reason: SWITCH_REFUSED.alreadyOurs });
    expect(await switches()).toHaveLength(1);
    expect(await quotes()).toEqual(before);
    expect(mittiReads).toBe(1);
    expect(sent).toEqual([]);
  });

  test("Mitti is down during the switch: the choice is kept, and the note, button and Action needed all go", async () => {
    await stuckJob();
    mittiDown = true;
    expect(await switchToHivicElectricianFor(JOB, OWNER)).toEqual({ ok: true });
    expect(await switches()).toHaveLength(1);
    expect((await quotes()).filter((q) => q.status === "draft")).toEqual([]); // no rebuild yet; the 15-minute tick does it
    expect((await loadInstallerQuote(JOB)).electricianNotOnboarded).toBeNull();
    const batch = (await loadInstallerQuotes([JOB])).get(JOB)!;
    expect(batch.electricianNotOnboarded).toBeNull();
    // Job list tab (trade-view tradeHome): only applying quotes give a line; this one is not the installer's move.
    const lineOf = batch.applies ? installerQuoteLine(batch) : null;
    expect(quoteLineTab("progress", lineOf)).toBe("progress");
    expect(sent).toEqual([]);
  });
});

describe("job list tab (trade-view tradeHome, batch loader)", () => {
  const tabOf = async () => { const q = (await loadInstallerQuotes([JOB])).get(JOB)!; return quoteLineTab("progress", q.applies ? installerQuoteLine(q) : null); };
  test("a stuck job sits under Action needed; after the switch it doesn't", async () => {
    await stuckJob();
    expect(await tabOf()).toBe("action");
    expect((await switchToHivicElectricianFor(JOB, OWNER)).ok).toBe(true);
    expect(await tabOf()).toBe("progress");
  });
  test("a done job stays done", async () => {
    await stuckJob();
    const q = (await loadInstallerQuotes([JOB])).get(JOB)!;
    expect(quoteLineTab("done", installerQuoteLine(q))).toBe("done");
  });
});

describe("refused", () => {
  const refusedUnchanged = async (r: { ok: boolean; reason?: string }, reason?: string) => {
    expect(r.ok).toBe(false);
    if (reason) expect((r as { reason: string }).reason).toBe(reason);
    else expect(typeof (r as { reason: string }).reason).toBe("string");
    expect(await switches()).toEqual([]);
    expect(mittiReads).toBe(0);
  };
  test("an office or admin user (not in the business)", async () => {
    await stuckJob();
    await refusedUnchanged(await switchToHivicElectricianFor(JOB, OFFICE));
  });
  test("a worker in the business who is not the owner", async () => {
    await stuckJob();
    await refusedUnchanged(await switchToHivicElectricianFor(JOB, WORKER), "Only your business admin can do this.");
  });
  test("another installer business's owner", async () => {
    await stuckJob();
    await refusedUnchanged(await switchToHivicElectricianFor(JOB, OTHER));
  });
  for (const [status, sentAt] of [["issued", "2026-10-23T01:00:00Z"], ["accepted", "2026-10-23T01:00:00Z"]] as const) {
    test(`a job whose quote is ${status === "issued" ? "sent" : "accepted"} — the quote is unchanged`, async () => {
      await stuckJob();
      const { rows: [q] } = await db.query<{ id: string }>("insert into quotes (job_id, kind, status, release_state, release_hold_reason, option_code, sent_at, subtotal_inc_gst) values ($1,'installation',$2,'held','Electrician not onboarded: TEST Sparky','INSTALLER_A1',$3,4899.25) returning id", [JOB, status, sentAt]);
      const before = await quotes();
      await refusedUnchanged(await switchToHivicElectricianFor(JOB, OWNER), SWITCH_REFUSED.quoteSent);
      expect(await quotes()).toEqual(before);
      expect(before.find((x) => x.id === q!.id)?.status).toBe(status);
    });
  }
  test("a job whose electrician is already ours", async () => {
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'electrician_choice_set',$2)", [JOB, JSON.stringify({ choice: "hivic", source: "add_job" })]);
    await refusedUnchanged(await switchToHivicElectricianFor(JOB, OWNER), SWITCH_REFUSED.alreadyOurs);
    expect(await choiceEvents()).toHaveLength(1);
  });
  test("a job whose usual electrician IS onboarded (approved REC with a rate)", async () => {
    await db.query("insert into admin_config_events (event_type, details) values ('installer_usual_electrician_saved',$1)", [JSON.stringify({ business_id: BIZ, electrician: { name: "TEST Sparky", licence: "TEST-LIC-3129" } })]);
    recCandidates = [{ business_id: "00000000-0000-0000-0000-00000000e129", name: "TEST Sparky", trading_name: "TEST Sparky", rec_number: null, worker_licences: ["TEST-LIC-3129"], blocker: null,
      onboarding_status: "approved", is_active: true, approved_electricians: 1, piesa_rate: { id: "00000000-0000-0000-0000-00000000f129", rate_inc_gst: 299 } }];
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'electrician_choice_set',$2)", [JOB, JSON.stringify({ choice: "usual", source: "add_job" })]);
    await draftInstallerQuoteFromReadyCheck(JOB, OWNER, entries, "audit_3129");
    const drafts = (await quotes()).filter((q) => q.status === "draft");
    expect(drafts).toHaveLength(1);
    expect(await line(drafts[0]!.id, "PIESA")).toEqual([299]); // the onboarded rate, not held
    expect((await loadInstallerQuote(JOB)).electricianNotOnboarded).toBeNull();
    const before = await quotes();
    await refusedUnchanged(await switchToHivicElectricianFor(JOB, OWNER), SWITCH_REFUSED.notStuck);
    expect(await choiceEvents()).toHaveLength(1);
    expect(await quotes()).toEqual(before);
  });
});
