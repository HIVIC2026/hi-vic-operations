// Supplying installer completes a BEFORE-QUOTE job later, through the real installerUpdateIntake on PGlite (Jo, 8 Oct).
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
const { installerUpdateIntake, installerIntakeState } = await import("../src/lib/installer-intake.server");

const JOB = "00000000-0000-0000-0000-00000000e001", BIZ = "00000000-0000-0000-0000-00000000b001", OTHER = "00000000-0000-0000-0000-00000000b002", U = "00000000-0000-0000-0000-00000000c001";
const base = { areaM2: null, insulation: "unknown" as const, quoteStatus: "not_quoted" as const, quoteIncGst: null, includes: null, proposedR: null, files: [] };
const job = async () => (await db.query<Record<string, unknown>>("select * from jobs where id=$1", [JOB])).rows[0]!;
const ms = async () => (await db.query<Record<string, unknown>>("select * from ceiling_measurements where job_id=$1", [JOB])).rows;
const evs = async () => (await db.query<{ event_type: string }>("select event_type from workflow_events where job_id=$1 order by created_at", [JOB])).rows.map((r) => r.event_type);

beforeEach(async () => {
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from job_imports; delete from quotes;");
  // State as saved by a BEFORE VISIT + NO AREA + NOT QUOTED submit: null facts, quoted 'no'.
  await db.query("insert into jobs (id, channel, originating_installer_business_id, installer_quoted, estimated_area_unknown) values ($1,'installer_sourced',$2,'no',true)", [JOB, BIZ]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_evidence_acknowledged','{\"proposed_r_value\":null}'),($1,'installer_existing_insulation_declared','{\"existing_insulation\":\"unknown\"}')", [JOB]);
  await db.query("insert into job_imports (job_id, business_id, files) values ($1,$2,'[]')", [JOB, BIZ]);
});

describe("BEFORE QUOTE job creation payload", () => {
  test("not quoted + no area submits null facts, never zero or quoted:'yes'", () => {
    expect(intakeProblems({ area: "", amount: "", includes: "", proposedR: "", insulation: null, quoteStatus: "not_quoted", quoteFileCount: 0, evidenceAck: true })).toEqual([]);
    expect(intakeArea("")).toBeNull();
    // Jo 20 Oct: proposed product is a site fact, kept when not quoted; only commercial facts clear.
    expect(intakeQuotePayload({ quoteStatus: "not_quoted", amount: "3450", includes: "batts", proposedR: "5" })).toEqual({ quoted: "no", quoted_price_inc_gst: null, price_includes: null, proposed_r_value: 5 });
  });
  test("invalid entered values are rejected", () => {
    const p = intakeProblems({ area: "0", amount: "-5", includes: "", proposedR: "", insulation: null, quoteStatus: "have_quote", quoteFileCount: 0, evidenceAck: true });
    expect(p.some((x) => /ceiling area/.test(x))).toBe(true);
    expect(p.some((x) => /quote amount/.test(x))).toBe(true);
  });
  test("file-only quote keeps quoted unknown (no invented amount)", () => {
    expect(intakeQuotePayload({ quoteStatus: "have_quote", amount: "", includes: "", proposedR: "" }).quoted).toBeNull();
  });
});

describe("installer edits the same received job (persistence boundary)", () => {
  test("removal yes/zero persists and reopen reads it; No clears it without adding to total", async () => {
    const p = { ...base, areaM2: 120, insulation: "below_r2" as const, quoteStatus: "have_quote" as const, quoteIncGst: 3450, includes: "Removal included", proposedR: 5, removalQuote: { answer: "yes" as const, areaM2: 120, chargeIncGst: 0 } };
    const first = await installerUpdateIntake(JOB, U, BIZ, p);
    expect(first.state.removalQuote).toEqual(p.removalQuote);
    expect(Number((await job()).installer_quoted_price_inc_gst)).toBe(3450);
    await installerUpdateIntake(JOB, U, BIZ, { ...p, removalQuote: { answer: "yes", areaM2: 120, chargeIncGst: 500 } });
    expect(Number((await job()).installer_quoted_price_inc_gst)).toBe(3450);
    const last = await installerUpdateIntake(JOB, U, BIZ, { ...p, removalQuote: { answer: "no", areaM2: null, chargeIncGst: null } });
    expect(last.state.removalQuote).toEqual({ answer: "no", areaM2: null, chargeIncGst: null });
    expect((await db.query("select count(*)::int n from jobs")).rows[0]).toEqual({ n: 1 });
  });
  test("adds area + manual quote later on the SAME job; provisional measurement only", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, attended: "attended", areaM2: 142, insulation: "none", quoteStatus: "have_quote", quoteIncGst: 3450, includes: "R5.0 batts supply and install", proposedR: 5 });
    const j = await job();
    expect(Number(j.installer_quoted_price_inc_gst)).toBe(3450);
    expect(j.installer_quoted).toBe("yes");
    expect(Number(j.estimated_area_m2)).toBe(142);
    const m = await ms();
    expect(m.length).toBe(1);
    expect(m[0]!.provenance).toBe("installer_supplied_provisional");
    expect(Number(m[0]!.supplied_area_m2)).toBe(142);
    expect(await evs()).toContain("installer_intake_corrected"); // insulation changed unknown -> none
    expect((await db.query("select count(*)::int n from jobs")).rows[0]).toEqual({ n: 1 });
  });

  test("quote upload only: file appended to original import, quoted stays unknown", async () => {
    const f = { path: `partners/${BIZ}/imports/q.pdf`, name: "q.pdf", type: "application/pdf" };
    await installerUpdateIntake(JOB, U, BIZ, { ...base, quoteStatus: "have_quote", files: [f] });
    const imp = (await db.query<{ files: unknown[] }>("select files from job_imports where job_id=$1", [JOB])).rows[0]!;
    expect(imp.files).toEqual([f]);
    expect((await job()).installer_quoted).toBeNull();
    expect(await evs()).toContain("installer_quote_file_added");
  });

  test("unknown insulation still saves an area and stays unknown", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, attended: "attended", areaM2: 90 });
    expect(Number((await job()).estimated_area_m2)).toBe(90);
    expect(await evs()).not.toContain("installer_intake_corrected");
  });

  test("unknown/not-attended area is a preliminary estimate only: no measurement, restored on reopen", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, areaM2: 110 });
    expect((await ms()).length).toBe(0);
    expect(await evs()).toContain("installer_preliminary_estimate");
    const st = await installerIntakeState(JOB);
    expect(st.areaM2).toBeNull(); expect(st.preliminaryAreaM2).toBe(110);
    expect(st.readiness.blockers).toContain("Site visit not recorded — confirm the property was attended and assessed");
    await installerUpdateIntake(JOB, U, BIZ, { ...base, attended: "not_attended", areaM2: 110 });
    expect((await installerIntakeState(JOB)).readiness.blockers.some((b) => /preliminary until the onsite Ready Check/.test(b))).toBe(true);
  });

  test("another business's files or another installer are refused", async () => {
    await expect(installerUpdateIntake(JOB, U, OTHER, base)).rejects.toThrow("supplied this job");
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, files: [{ path: `partners/${OTHER}/imports/x.pdf`, name: "x", type: "" }] })).rejects.toThrow("isn't one of your uploads");
  });

  test("an already accepted office measurement can't be overwritten by the installer", async () => {
    await db.query("insert into ceiling_measurements (job_id, is_current, provenance, supplied_area_m2) values ($1,true,'electrician_measured',100)", [JOB]);
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, areaM2: 150 })).rejects.toThrow("already been measured");
  });

  test("no change = no stale quotes; a material change flags an accepted quote for owner reconfirmation", async () => {
    await db.query("insert into quotes (job_id, kind, status) values ($1,'installation','accepted')", [JOB]);
    await installerUpdateIntake(JOB, U, BIZ, base);
    expect(await evs()).not.toContain("installer_quote_reconfirmation_required");
    await installerUpdateIntake(JOB, U, BIZ, { ...base, quoteStatus: "have_quote", quoteIncGst: 4000, includes: "R6 batts" });
    expect(await evs()).toContain("installer_quote_reconfirmation_required");
    expect((await db.query<{ status: string }>("select status from quotes where job_id=$1", [JOB])).rows[0]!.status).toBe("accepted");
  });

  test("switching back to Not quoted yet clears stale quote facts to null", () => {
    const ch = pickIntakeChanges({ areaM2: 100, insulation: "none", quoted: "yes", quoteIncGst: 3000, includes: "x", proposedR: 5 }, { ...base, insulation: "none", files: [] });
    expect(ch.quote).toEqual({ quoted: "no", quoteIncGst: null, includes: null });
    expect(ch.area).toBeUndefined(); // blank area never clears a known area
  });
});

describe("own electrician -> a different own electrician (no atomic swap): refused, nothing changes", () => {
  test("save is refused with the Office-change message and the saved selection/events stay unchanged", async () => {
    await db.exec("CREATE TABLE IF NOT EXISTS job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, role text, active boolean, user_id uuid, business_id uuid);");
    await db.query("update jobs set electrician_choice='preferred' where id=$1", [JOB]);
    const before = await evs();
    const { OWN_ELECTRICIAN_OFFICE_CHANGE } = await import("../src/lib/installer-intake.server");
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, electrician: { mode: "mine", business_id: "00000000-0000-0000-0000-00000000d002" } } as never)).rejects.toThrow(OWN_ELECTRICIAN_OFFICE_CHANGE);
    expect((await job())["electrician_choice"]).toBe("preferred");
    expect(await evs()).toEqual(before);
  });
});

describe("two-route attendance (Jo 20 Oct 'Ok fix')", () => {
  const ATT = { ...base, insulation: "below_r2" as const };
  test("visited + not quoted: area/product/removal survive save and reload; attendance recorded explicitly", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...ATT, attended: "attended", attendedOn: "2026-10-10", areaM2: 118, proposedR: 5, removalQuote: { answer: "yes", areaM2: 40, chargeIncGst: 500 } });
    const j = await job();
    expect(j.installer_site_check).toBe("yes"); expect(String(j.installer_site_check_date)).toContain("2026");
    expect(j.installer_quoted).toBe("no");
    expect(Number((await ms())[0]!.supplied_area_m2)).toBe(118);
    expect(await evs()).toContain("installer_attendance_answer");
    // switch quote status later: site facts preserved
    await installerUpdateIntake(JOB, U, BIZ, { ...ATT, quoteStatus: "have_quote", areaM2: null, quoteIncGst: 4200, includes: "R5 batts", proposedR: null, removalQuote: { answer: "yes", areaM2: 40, chargeIncGst: 500 } });
    expect(Number((await ms())[0]!.supplied_area_m2)).toBe(118);
    expect((await job()).installer_site_check).toBe("yes");
    await installerUpdateIntake(JOB, U, BIZ, { ...ATT, quoteStatus: "not_quoted", removalQuote: { answer: "yes", areaM2: 40, chargeIncGst: null } });
    expect(Number((await ms())[0]!.supplied_area_m2)).toBe(118);
    const { installerIntakeState } = await import("../src/lib/installer-intake.server");
    expect((await installerIntakeState(JOB)).removalQuote).toMatchObject({ answer: "yes", areaM2: 40 });
    expect((await installerIntakeState(JOB)).proposedR).toBe(5);
    expect((await job()).installer_site_check).toBe("yes");
  });
  test("unanswered attendance stays unknown; price/area/files never imply a visit", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...ATT, quoteStatus: "have_quote", areaM2: 100, quoteIncGst: 3000, includes: "batts", files: [{ path: `partners/${BIZ}/q.pdf`, name: "q.pdf", type: "application/pdf" }] });
    expect((await job()).installer_site_check).toBeNull();
    expect(await evs()).not.toContain("installer_attendance_answer");
  });
  test("future or impossible visit date is refused with a clear message, nothing saved", async () => {
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...ATT, attended: "attended", attendedOn: "2999-01-01" })).rejects.toThrow("can't be in the future");
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...ATT, attended: "attended", attendedOn: "2026-02-30" })).rejects.toThrow("Check the visit date");
    const j = await job(); expect(j.installer_site_check).toBeNull(); expect(j.installer_site_check_date).toBeNull();
  });
  test("attendance correction after a quote is material: drafts go stale", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...ATT, attended: "attended" });
    const before = (await evs()).filter((e) => e === "installer_intake_updated").length;
    await installerUpdateIntake(JOB, U, BIZ, { ...ATT, attended: "not_attended" });
    expect((await evs()).filter((e) => e === "installer_intake_updated").length).toBe(before + 1);
  });
  test("repeat identical save adds no duplicate attendance event", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...ATT, attended: "not_attended" });
    await installerUpdateIntake(JOB, U, BIZ, { ...ATT, attended: "not_attended" });
    expect((await evs()).filter((e) => e === "installer_attendance_answer").length).toBe(1);
  });
});
