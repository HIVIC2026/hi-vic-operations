// Jo 31 Oct: only NEW journeys from the Test Centre (createTestEnquiry) queue the automatic first work (eligibility check).
// The REAL upsertEnquiry (enquiry.server) on PGlite; set-up copied from decision-400-insulation-answer-keep.test.ts.
// Faked boundaries only: workflow logEvent, post-intake queue (records calls), background runner, consent/media, address provider.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

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
const queued: string[] = [];
mock.module("../src/lib/postintake.server", () => ({ enqueueInitialGate1: async (jobId: string) => { queued.push(jobId); return "queued"; }, processPostIntakeWork: async () => ({}) }));
mock.module("../src/lib/background.server", () => ({ runAfterResponse: () => "queue_only", requestContext: { getStore: () => undefined } }));
mock.module("../src/lib/intake.server", () => ({ recordContactConsent: async () => {}, importBase44Media: async () => ({ copied: 0 }) }));
mock.module("../src/lib/address-complete.server", () => ({ completeJobAddress: async () => ({}) }));
const { upsertEnquiry } = await import("../src/lib/enquiry.server");

// Jo 31 Oct, behaviour on the REAL upsertEnquiry (PGlite): only new Test Centre journeys queue the automatic first work.
const enquiry = (id: string) => ({ external_enquiry_id: id, full_name: "Tess Test", email: `${id}@hivic-test.example`, phone: "0400 000 401", address_line: `${id.length} Test St`, suburb: "Frankston", postcode: "3199", state: "VIC", occupancy: "owner_occupied", estimated_area_m2: 100, area_unknown: false, life_support: false, life_support_status: "no", age_confirmed: true, contact_consent: true, base44_answers: { insulation: "No", property_type: "house" } }) as never;

describe("TEST journeys and the automatic first work", () => {
  beforeEach(async () => { await db.exec("truncate owners, profiles, user_roles, properties, jobs, workflow_events"); queued.length = 0; });
  test("a new Test Centre journey queues it", async () => {
    const r = await upsertEnquiry(enquiry("qa-tc-1"), "qa_test", null, undefined, { testCentreAutoChecks: true });
    expect(r.post_intake).toBe("queued");
    expect(queued).toEqual([r.job_id]);
  });
  test("any other TEST path (journey runner, Mitti, calculator) still skips it", async () => {
    const r = await upsertEnquiry(enquiry("qa-runner-1"), "qa_test", null);
    expect(r.post_intake).toBe("none");
    expect(queued).toEqual([]);
  });
  test("a repeat enquiry on an existing TEST job never re-queues it, even from the Test Centre", async () => {
    const first = await upsertEnquiry(enquiry("qa-tc-2"), "qa_test", null);
    const again = await upsertEnquiry(enquiry("qa-tc-2"), "qa_test", null, undefined, { testCentreAutoChecks: true });
    expect(again.job_id).toBe(first.job_id);
    expect(again.post_intake).toBe("none");
    expect(queued).toEqual([]);
  });
});