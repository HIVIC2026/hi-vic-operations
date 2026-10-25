// Decision 400 (Jo 26 Oct 2026, "Keep the earlier answer"): a repeat website enquiry with a blank or missing insulation
// answer never wipes an earlier real answer; a new real answer still updates. Pure rule + the REAL upsertEnquiry
// (enquiry.server) on PGlite resending the same enquiry. The estimate reads its insulation_declared from the same stored
// answer snapshot (estimate.server: declaredExtras(enrichment.base44.raw.answers)), so it is checked through that reader.
// Faked boundaries only: workflow logEvent, post-intake queue, background runner, consent/media, address provider.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { keepEarlierInsulationAnswers } from "../src/lib/insulation-answer-keep.core";
import { declaredExtras, declaredInsulationDetail } from "../src/lib/enquiry.core";
import { normaliseInsulation } from "../src/lib/eligibility.core";

describe("pure rule", () => {
  const declared = (a: Record<string, unknown> | null) => normaliseInsulation(declaredExtras(a).existing_insulation);
  test("blank, empty or missing never overwrites an earlier real answer", () => {
    for (const before of [{ insulation: "No" }, { insulation: "Yes - some batts" }, { existing_insulation: "none" }]) {
      const was = declared(before);
      for (const next of [null, {}, { insulation: "" }, { insulation: "   " }, { insulation: null }, { property_type: "house" }])
        expect(declared(keepEarlierInsulationAnswers(before, next as Record<string, unknown> | null))).toBe(was);
    }
  });
  test("other new answers are kept as sent", () => {
    expect(keepEarlierInsulationAnswers({ insulation: "No", top_floor: "no" }, { insulation: "", top_floor: "yes", property_type: "house" })).toEqual({ insulation: "No", top_floor: "yes", property_type: "house" });
  });
  test("a new real answer still updates (both ways)", () => {
    expect(declared(keepEarlierInsulationAnswers({ insulation: "No" }, { insulation: "Yes" }))).toBe("present");
    expect(declared(keepEarlierInsulationAnswers({ insulation: "Yes" }, { insulation: "No" }))).toBe("none");
    expect(declared(keepEarlierInsulationAnswers({ existing_insulation: "none" }, { insulation: "Yes - thin" }))).toBe("present");
  });
  test("'Not sure' never replaces an earlier real answer; it stands over nothing or over an earlier 'not sure'", () => {
    expect(declared(keepEarlierInsulationAnswers({ insulation: "No" }, { insulation: "Not sure" }))).toBe("none");
    expect(declared(keepEarlierInsulationAnswers({ existing_insulation: "Yes" }, { insulation: "Not sure" }))).toBe("present");
    expect(declared(keepEarlierInsulationAnswers({}, { insulation: "Not sure" }))).toBe("unknown");
    expect(declared(keepEarlierInsulationAnswers({ insulation: "unsure" }, { insulation: "Not sure" }))).toBe("unknown");
    expect(declared(keepEarlierInsulationAnswers({ insulation: "unsure" }, {}))).toBe("unknown"); // blank never overwrites
  });
  test("the three detail answers stay with a kept 'present' answer; a new 'none' does not carry them", () => {
    const before = { insulation: "Yes", insulation_type: "batts", insulation_thickness: "thin", insulation_coverage: "partial" };
    expect(declaredInsulationDetail(keepEarlierInsulationAnswers(before, { insulation: "" }))).toEqual({ insulation_type: "batts", insulation_thickness: "thin", insulation_coverage: "partial" });
    expect(declaredInsulationDetail(keepEarlierInsulationAnswers(before, { insulation: "Yes", insulation_thickness: "thicker" }))).toEqual({ insulation_type: "batts", insulation_thickness: "thicker", insulation_coverage: "partial" });
    expect(keepEarlierInsulationAnswers(before, { insulation: "No" })).toEqual({ insulation: "No" });
  });
  test("nothing earlier → the new snapshot is stored unchanged", () => {
    const next = { insulation: "" };
    expect(keepEarlierInsulationAnswers(null, next)).toBe(next);
    expect(keepEarlierInsulationAnswers({ property_type: "house" }, next)).toBe(next);
  });
});

const db = new PGlite();
await db.exec(`
CREATE TABLE owners (id uuid primary key default gen_random_uuid(), full_name text, email text, phone text, user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
CREATE TABLE profiles (id uuid primary key, email text);
CREATE TABLE user_roles (user_id uuid, role text, unique (user_id, role));
CREATE TABLE properties (id uuid primary key default gen_random_uuid(), owner_id uuid, address_line text, suburb text, postcode text, occupancy text, state text, enrichment jsonb);
CREATE SEQUENCE job_no START 7000;
CREATE TABLE jobs (id uuid primary key default gen_random_uuid(), job_number text default ('HV-' || nextval('job_no')), owner_id uuid, property_id uuid, stage text default 'new_enquiry',
  source text, channel text, external_enquiry_id text, next_action text, business_unit text, originating_installer_business_id uuid, originating_installer_user_id uuid,
  commercial_model text, estimated_area_m2 numeric, estimated_area_unknown boolean, life_support boolean, life_support_status text, deleted_at timestamptz, created_at timestamptz default clock_timestamp());
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());`);
const shim = postgrestShim(db);
// Embedded selects (the website repeat lookup) are not spoken by the shim: the resend matches on its enquiry id instead.
const empty: any = new Proxy({}, { get: (_t, k) => (k === "then" ? (res: (v: unknown) => unknown) => res({ data: [], error: null }) : () => empty) });
const admin = { ...shim, from(table: string) { const b = shim.from(table) as any; const sel = b.select.bind(b); b.select = (c?: string, o?: unknown) => (typeof c === "string" && c.includes("(") ? empty : sel(c, o)); return b; } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
mock.module("../src/lib/postintake.server", () => ({ enqueueInitialGate1: async () => "none", processPostIntakeWork: async () => ({}) }));
mock.module("../src/lib/background.server", () => ({ runAfterResponse: () => "queue_only", requestContext: { getStore: () => undefined } }));
mock.module("../src/lib/intake.server", () => ({ recordContactConsent: async () => {}, importBase44Media: async () => ({ copied: 0 }) }));
mock.module("../src/lib/address-complete.server", () => ({ completeJobAddress: async () => ({}) }));
const { upsertEnquiry } = await import("../src/lib/enquiry.server");

const enquiry = (answers: Record<string, unknown> | undefined) => ({ external_enquiry_id: "qa-d400", full_name: "Ada Answer", email: "ada@example.com", phone: "0400 000 400", address_line: "4 Answer Street", suburb: "Frankston", postcode: "3199", estimated_area_m2: 120, ...(answers ? { base44_answers: answers } : {}) }) as never;
/** What the estimate (estimate.server refreshIndicativeEstimate) would record as insulation_declared. */
const stored = async (jobId: string) => {
  const r = (await db.query<{ e: { base44?: { raw?: { answers?: Record<string, unknown> } } } }>("select p.enrichment as e from jobs j join properties p on p.id = j.property_id where j.id = $1", [jobId])).rows[0]!;
  const answers = r.e?.base44?.raw?.answers ?? null;
  return { declared: normaliseInsulation(declaredExtras(answers).existing_insulation), answers };
};

describe("upsertEnquiry: a repeat enquiry never wipes the earlier answer", () => {
  beforeEach(async () => { await db.exec("truncate owners, profiles, user_roles, properties, jobs, workflow_events"); });
  test("blank / missing insulation on the repeat keeps 'No insulation'; other answers update; still one job", async () => {
    const first = await upsertEnquiry(enquiry({ insulation: "No", property_type: "house" }), "qa_test", null);
    expect((await stored(first.job_id)).declared).toBe("none");
    const blank = await upsertEnquiry(enquiry({ insulation: "", property_type: "townhouse" }), "qa_test", null);
    expect(blank.job_id).toBe(first.job_id);
    expect(await stored(first.job_id)).toMatchObject({ declared: "none", answers: { insulation: "No", property_type: "townhouse" } });
    await upsertEnquiry(enquiry(undefined), "qa_test", null); // no questionnaire at all
    expect((await stored(first.job_id)).declared).toBe("none");
    expect((await db.query("select id from jobs")).rows).toHaveLength(1);
  });
  test("a new real answer still updates", async () => {
    const first = await upsertEnquiry(enquiry({ insulation: "No" }), "qa_test", null);
    await upsertEnquiry(enquiry({ insulation: "Yes", insulation_type: "batts" }), "qa_test", null);
    expect(await stored(first.job_id)).toMatchObject({ declared: "present", answers: { insulation: "Yes", insulation_type: "batts" } });
    await upsertEnquiry(enquiry({ insulation: "" }), "qa_test", null);
    expect(await stored(first.job_id)).toMatchObject({ declared: "present", answers: { insulation: "Yes", insulation_type: "batts" } });
  });
});
