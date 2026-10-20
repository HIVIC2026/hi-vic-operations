// Installer own-quote commercial facts through the REAL installerUpdateIntake/installerIntakeState/draftQuoteFromIntake on PGlite (Jo 20 Oct).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { intakeArea, intakeProblems, intakeQuotePayload, pickIntakeChanges } from "../src/lib/installer-intake.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, installer_site_check text, installer_site_check_date date, installer_quoted text, installer_quoted_price_inc_gst numeric,
  installer_price_includes text, electrician_choice text, estimated_area_m2 numeric, estimated_area_unknown boolean, measure_up_responsibility text);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, role text, active boolean, user_id uuid, business_id uuid);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, created_by uuid, raw_snapshot jsonb,
  source_role text, external_source text, external_id text, provenance text, measured_area_m2 numeric, removal_required boolean, removal_m2 numeric, existing_r_value numeric,
  insulation_present boolean, supplied_area_m2 numeric, supplied_removal_m2 numeric, supplied_snapshot jsonb, measurement_method text, measurement_purpose text,
  measured_by_name text, measured_by_role text, measured_by_business_id uuid, measured_on date, gross_area_m2 numeric, excluded_area_m2 numeric, confidence text,
  review_flags jsonb, evidence_notes text, status text, verified_area_m2 numeric);
CREATE TABLE job_imports (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, files jsonb, created_at timestamptz default now());
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text);
CREATE TABLE owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, consent_status text, created_at timestamptz default now());
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, label text, required boolean, status text, gate text);`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const drafted: unknown[] = [];
mock.module("../src/lib/installer-quote.server", () => ({ draftInstallerQuoteFromReadyCheck: async (...a: unknown[]) => { drafted.push(a[4]); return { ready: true }; } }));
const { installerUpdateIntake, installerIntakeState, draftQuoteFromIntake, intakeSendBlockers } = await import("../src/lib/installer-intake.server");
const { buildInstallerQuoteDraft, piesaChargeIncGst } = await import("../src/lib/installer-led.core");
const { melbourneToday, visitDateProblem } = await import("../src/lib/installer-intake.core");

const JOB = "00000000-0000-0000-0000-00000000e001", BIZ = "00000000-0000-0000-0000-00000000b001", U = "00000000-0000-0000-0000-00000000c001";
const base = { areaM2: 120, insulation: "below_r2" as const, quoteStatus: "have_quote" as const, quoteIncGst: 3000, includes: "R5.0 batts supply and install", proposedR: 5, files: [], attended: "attended" as const };
const good = { basis: "before_discount" as const, gst: "inc_gst" as const, inclusions: "R5.0 batts supply and install", exclusions: null, originalStatus: "sent" as const, removalPricing: null, removalAmountIncGst: null, extras: [] as { description: string; pricing: "included" | "additional" | "not_priced"; amountIncGst: number | null }[] };
const evs = async (t: string) => (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type=$2 order by created_at", [JOB, t])).rows;
const comBlockers = async () => (await installerIntakeState(JOB)).readiness.blockers.filter((b) => /VEU discount|GST|Removal is required|removal price|Extra|Clarify the installer quote/.test(b));

beforeEach(async () => {
  drafted.length = 0;
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from job_imports; delete from quotes;");
  await db.query("insert into jobs (id, channel, originating_installer_business_id, installer_quoted, estimated_area_unknown) values ($1,'installer_sourced',$2,'no',true)", [JOB, BIZ]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_evidence_acknowledged','{\"proposed_r_value\":null}'),($1,'installer_existing_insulation_declared','{\"value\":\"below_r2\"}'),($1,'installer_commercial_eligibility','{\"outcome\":\"eligible\"}')", [JOB]);
  await db.query("insert into job_imports (job_id, business_id, files) values ($1,$2,'[]')", [JOB, BIZ]);
});

describe("commercial facts: save, reload, readiness", () => {
  test("historic quote with no commercial record saves but needs clarification (never assumed gross)", async () => {
    await installerUpdateIntake(JOB, U, BIZ, base);
    expect(await comBlockers()).toEqual(["Clarify the installer quote: price basis (before VEU discount?), GST and removal pricing are not recorded"]);
    await expect(draftQuoteFromIntake(JOB, U)).rejects.toThrow(/Clarify the installer quote/);
    expect(drafted).toHaveLength(0);
  });
  test("explicit before-discount inc-GST quote clears commercial blockers and round-trips", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: good });
    const st = await installerIntakeState(JOB);
    expect(st.commercial).toEqual(good);
    expect(await comBlockers()).toEqual([]);
  });
  test("already-discounted / unsure / ex-GST amounts save for review but block any confirmed total", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: { ...good, basis: "after_discount", gst: "ex_gst" } });
    expect((await installerIntakeState(JOB)).commercial?.basis).toBe("after_discount");
    const b = await comBlockers();
    expect(b.some((x) => /already discounted/.test(x))).toBe(true);
    expect(b.some((x) => /ex GST/.test(x))).toBe(true);
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: { ...good, basis: "unsure", gst: "unsure" } });
    expect((await comBlockers()).length).toBe(2);
    // Same check is used by every send/release/approve/accept entrance.
    expect((await intakeSendBlockers(JOB)).some((x) => /before the VEU discount/.test(x))).toBe(true);
  });
});

describe("removal: physical facts vs pricing", () => {
  const rem = { answer: "yes" as const, areaM2: 60, chargeIncGst: null };
  test("required + unpriced removal blocks; included never adds a line; additional adds exactly one", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, removalQuote: rem, commercial: good });
    expect(await comBlockers()).toEqual(["Removal is required but not priced — say whether it is in the works total or an additional agreed price"]);
    expect((await installerIntakeState(JOB)).removalText).toBe("Removal required: 60 m² — not priced yet");
    await installerUpdateIntake(JOB, U, BIZ, { ...base, removalQuote: rem, commercial: { ...good, removalPricing: "included" } });
    let st = await installerIntakeState(JOB);
    expect(st.separateLines).toEqual([]);
    expect(st.removalText).toBe("Removal required: 60 m² — included in the works total");
    await installerUpdateIntake(JOB, U, BIZ, { ...base, removalQuote: rem, commercial: { ...good, removalPricing: "additional", removalAmountIncGst: 480 } });
    st = await installerIntakeState(JOB);
    expect(st.separateLines.map((l) => [l.code, l.amountIncGst])).toEqual([["INSTALLER_REMOVAL", 480]]);
  });
  test("'No' reads as NOT REQUIRED (not 'not included') and can't carry a removal price", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, removalQuote: { answer: "no", areaM2: null, chargeIncGst: null }, commercial: good });
    expect((await installerIntakeState(JOB)).removalText).toBe("Removal: not required");
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, removalQuote: { answer: "no", areaM2: null, chargeIncGst: null }, commercial: { ...good, removalPricing: "additional", removalAmountIncGst: 100 } })).rejects.toThrow(/not required/);
  });
  test("visited + not quoted: removal and area facts are saved and survive reload", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, quoteStatus: "not_quoted", quoteIncGst: null, includes: null, removalQuote: rem });
    const st = await installerIntakeState(JOB);
    expect(st.removalQuote).toEqual(rem);
    expect(st.areaM2).toBe(120);
    expect(st.attended).toBe("yes");
  });
  test("draft may save required removal with the m² still unknown; readiness then asks for it", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, removalQuote: { answer: "yes", areaM2: null, chargeIncGst: null }, commercial: { ...good, removalPricing: "included" } });
    expect((await installerIntakeState(JOB)).releaseBlockers.some((b) => /removal area/.test(b))).toBe(true);
  });
});

describe("extras and the existing quote builder", () => {
  test("extras: included adds nothing, additional adds a line, not priced blocks", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: { ...good, extras: [{ description: "Tile lift", pricing: "included", amountIncGst: null }, { description: "Metal roof access", pricing: "additional", amountIncGst: 250 }, { description: "Difficult access", pricing: "not_priced", amountIncGst: null }] } });
    const st = await installerIntakeState(JOB);
    expect(st.separateLines.map((l) => [l.description, l.amountIncGst])).toEqual([["Metal roof access", 250]]);
    expect(await comBlockers()).toEqual(['Extra "Difficult access" is not priced yet']);
  });
  test("ready job hands the builder works total + only separate lines", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, removalQuote: { answer: "yes", areaM2: 60, chargeIncGst: null }, commercial: { ...good, removalPricing: "additional", removalAmountIncGst: 480 } });
    await db.query("update ceiling_measurements set verified_area_m2 = 120 where job_id=$1", [JOB]);
    const st = await installerIntakeState(JOB);
    expect(st.readiness.blockers).toEqual([]);
    await draftQuoteFromIntake(JOB, U);
    expect(drafted[0]).toMatchObject({ totalIncGst: 3000, separateLines: [{ code: "INSTALLER_REMOVAL", amountIncGst: 480 }] });
  });
  const price = (t: number) => ({ ok: true as const, issues: [], price: { included: ["Works"], otherDescription: "", totalIncGst: t, agreedWithOwner: false } });
  test("owner total = works + separate lines + AP fee + payer PIESA − discount once; own REC gets no PIESA line", () => {
    const sep = [{ code: "INSTALLER_REMOVAL", description: "Removal", amountIncGst: 480 }];
    const hivic = buildInstallerQuoteDraft({ price: price(3000), measuredM2: 120, wholeVeec: { veecs: 10, raw: 1000 }, piesaIncGst: piesaChargeIncGst("hivic_organise", 349), apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 }, separateLines: sep });
    expect(hivic.subtotal).toBe(3000 + 480 + 349 + 349);
    expect(hivic.lines.map((l) => l.code)).toEqual(["INSTALLER_PRICE", "INSTALLER_REMOVAL", "PIESA", "AP_FEE"]);
    expect(hivic.afterDiscount).toBe(hivic.subtotal - hivic.discount);
    const own = buildInstallerQuoteDraft({ price: price(3000), measuredM2: 120, wholeVeec: { veecs: 10, raw: 1000 }, piesaIncGst: piesaChargeIncGst("installer_own_direct", 349), apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 }, separateLines: sep });
    expect(own.lines.map((l) => l.code)).not.toContain("PIESA");
    expect(own.subtotal).toBe(3000 + 480 + 349);
    // Included removal is never a second charge.
    expect(buildInstallerQuoteDraft({ price: price(3000), measuredM2: 120, wholeVeec: { veecs: 10, raw: 1000 }, piesaIncGst: 349, apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 } }).subtotal).toBe(3698);
  });
});

describe("issued/accepted quotes and retries", () => {
  test("changing commercial facts after acceptance never reprices: accepted kept, reconfirmation required", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: good });
    await db.query("insert into quotes (job_id, kind, status, release_state) values ($1,'installation','accepted','released')", [JOB]);
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: { ...good, extras: [{ description: "Tile lift", pricing: "additional", amountIncGst: 300 }] } });
    expect((await db.query<{ status: string }>("select status from quotes where job_id=$1", [JOB])).rows.map((r) => r.status)).toEqual(["accepted"]);
    expect(await evs("installer_quote_reconfirmation_required")).toHaveLength(1);
    expect((await installerIntakeState(JOB)).reconfirmationRequired).toBe(true);
  });
  test("an issued quote is withdrawn (superseded/held), not silently edited", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: good });
    await db.query("insert into quotes (job_id, kind, status, release_state) values ($1,'installation','issued','released')", [JOB]);
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: { ...good, exclusions: "Downlight covers" } });
    expect((await db.query<{ status: string; release_state: string }>("select status, release_state from quotes where job_id=$1", [JOB])).rows[0]).toEqual({ status: "superseded", release_state: "held" });
  });
  test("retrying the same save writes no second commercial record", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: good });
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: good });
    expect(await evs("installer_quote_commercial_declared")).toHaveLength(1);
  });
  test("original customer acceptance is stored as history only", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: { ...good, originalStatus: "accepted_by_customer" } });
    const d = (await evs("installer_quote_commercial_declared"))[0]!.details;
    expect(String(d["note"])).toMatch(/history only, never Home Insulation Victoria acceptance/);
    expect(await evs("QUOTE_ACCEPTED")).toHaveLength(0);
    expect((await db.query("select count(*)::int n from quotes")).rows[0]).toEqual({ n: 0 });
  });
});

describe("dates and attendance", () => {
  test("Melbourne today is valid; impossible or future dates are refused visibly, never dropped", async () => {
    expect(visitDateProblem(melbourneToday(), melbourneToday())).toBeNull();
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, attendedOn: "2026-02-30" })).rejects.toThrow(/Check the visit date/);
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, attendedOn: "2999-01-01" })).rejects.toThrow(/future/);
    await installerUpdateIntake(JOB, U, BIZ, { ...base, attendedOn: melbourneToday() });
    expect(String((await db.query<{ d: string }>("select installer_site_check_date::text d from jobs where id=$1", [JOB])).rows[0]!.d)).toBe(melbourneToday());
  });
  test("unknown historical attendance stays unknown when the installer only saves quote facts", async () => {
    const { attended: _a, ...noAtt } = base;
    await installerUpdateIntake(JOB, U, BIZ, { ...noAtt, commercial: good });
    expect((await installerIntakeState(JOB)).attended).toBeNull();
  });
});
