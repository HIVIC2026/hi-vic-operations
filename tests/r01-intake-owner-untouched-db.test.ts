// R01 (external review 25 Oct 2026): a rejected installer intake must leave every existing owner row byte-for-byte
// unchanged, and no installer intake may change an existing owner's contact. Runs the REAL upsertEnquiry
// (enquiry.server), the REAL duplicate-address lookup/flag and the REAL createInstallerOwner on PGlite. Faked
// boundaries only: workflow logEvent (writes workflow_events), post-intake queue, background runner, consent/media
// storage and the address provider. Nothing is sent and no live database is touched.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE owners (id uuid primary key default gen_random_uuid(), full_name text, email text, phone text, user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
CREATE TABLE profiles (id uuid primary key, email text);
CREATE TABLE user_roles (user_id uuid, role text, unique (user_id, role));
CREATE TABLE businesses (id uuid primary key, name text);
CREATE TABLE properties (id uuid primary key default gen_random_uuid(), owner_id uuid, address_line text, suburb text, postcode text, occupancy text, state text, enrichment jsonb);
CREATE SEQUENCE job_no START 5000;
CREATE TABLE jobs (id uuid primary key default gen_random_uuid(), job_number text default ('HV-' || nextval('job_no')), owner_id uuid, property_id uuid, stage text default 'new_enquiry',
  source text, channel text, external_enquiry_id text, next_action text, business_unit text, originating_installer_business_id uuid, originating_installer_user_id uuid,
  commercial_model text, estimated_area_m2 numeric, estimated_area_unknown boolean, life_support boolean, life_support_status text, deleted_at timestamptz, created_at timestamptz default clock_timestamp());
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
-- A job save that fails for one test address, to prove the request's own new owner row is cleaned up.
CREATE FUNCTION fail_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (SELECT address_line FROM properties WHERE id = NEW.property_id) = '99 Fail St' THEN RAISE EXCEPTION 'job insert failed'; END IF; RETURN NEW; END $$;
CREATE TRIGGER fail_job BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION fail_job();`);

const shim = postgrestShim(db);
// The website repeat lookup uses an embedded select the shim does not speak; it finds nothing here (no repeat case).
const empty: any = new Proxy({}, { get: (_t, k) => (k === "then" ? (res: (v: unknown) => unknown) => res({ data: [], error: null }) : () => empty) });
const admin = {
  ...shim,
  from(table: string) {
    const b = shim.from(table) as any;
    const sel = b.select.bind(b);
    b.select = (c?: string, o?: unknown) => (typeof c === "string" && c.includes("(") ? empty : sel(c, o));
    return b;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => {
    await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]);
  },
}));
mock.module("../src/lib/postintake.server", () => ({ enqueueInitialGate1: async () => "none", processPostIntakeWork: async () => ({}) }));
mock.module("../src/lib/background.server", () => ({ runAfterResponse: () => "queue_only", requestContext: { getStore: () => undefined } }));
mock.module("../src/lib/intake.server", () => ({ recordContactConsent: async () => {}, importBase44Media: async () => ({ copied: 0 }) }));
mock.module("../src/lib/address-complete.server", () => ({ completeJobAddress: async () => ({}) }));

const { upsertEnquiry } = await import("../src/lib/enquiry.server");
const { duplicateAddressMessage, DUPLICATE_ADDRESS_EVENT } = await import("../src/lib/duplicate-address.core");

const BIZ_A = "00000000-0000-4000-8000-0000000000a1", BIZ_B = "00000000-0000-4000-8000-0000000000b1";
const USER_A = "00000000-0000-4000-8000-0000000000a2", USER_B = "00000000-0000-4000-8000-0000000000b2";
const PROFILE = "00000000-0000-4000-8000-0000000000c1";
const installerB = { channel: "installer_sourced" as const, businessId: BIZ_B, userId: USER_B };

const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;
/** The whole owner row as Postgres text: any changed byte (name, phone, email, user_id, updated_at) shows. */
const ownerBytes = async (id: string) => (await q<{ t: string }>("select o::text as t from owners o where id = $1", [id]))[0]?.t;
const count = async (t: string) => Number((await q<{ n: number }>(`select count(*)::int as n from ${t}`))[0]!.n);

async function seedJob(o: { name: string; email: string | null; phone: string; address: string; suburb: string; postcode: string; channel: "hivic_sourced" | "installer_sourced"; business?: string; source?: string; stage?: string; userId?: string | null }) {
  const [owner] = await q<{ id: string }>("insert into owners (full_name, email, phone, user_id) values ($1,$2,$3,$4) returning id", [o.name, o.email, o.phone, o.userId ?? null]);
  const [prop] = await q<{ id: string }>("insert into properties (owner_id, address_line, suburb, postcode, state) values ($1,$2,$3,$4,'VIC') returning id", [owner!.id, o.address, o.suburb, o.postcode]);
  const [job] = await q<{ id: string; job_number: string }>("insert into jobs (owner_id, property_id, source, channel, originating_installer_business_id, stage) values ($1,$2,$3,$4,$5,$6) returning id, job_number",
    [owner!.id, prop!.id, o.source ?? (o.channel === "installer_sourced" ? "installer_import" : "base44"), o.channel, o.business ?? null, o.stage ?? "new_enquiry"]);
  return { ownerId: owner!.id, propertyId: prop!.id, jobId: job!.id, jobNumber: job!.job_number };
}
const request = (over: Record<string, unknown> = {}) => ({ full_name: "J Imposter", email: "jane@example.com", phone: "0499 999 999", address_line: "12 Smith Street", suburb: "Bundoora", postcode: "3083", estimated_area_m2: 120, ...over }) as never;

beforeEach(async () => {
  await db.exec("truncate owners, profiles, user_roles, businesses, properties, jobs, workflow_events");
  await db.query("insert into businesses (id, name) values ($1,'Alpha Insulation'), ($2,'Bravo Insulation')", [BIZ_A, BIZ_B]);
});

describe("R01: a rejected installer intake leaves the existing owner untouched", () => {
  test("installer B submits the email + address of an existing job with a different name and phone → refused, office flagged, owner row byte-for-byte unchanged", async () => {
    const existing = await seedJob({ name: "Jane Citizen", email: "jane@example.com", phone: "0411 111 111", address: "12 Smith St", suburb: "Bundoora", postcode: "3083", channel: "hivic_sourced" });
    const before = await ownerBytes(existing.ownerId);
    const counts = { owners: await count("owners"), properties: await count("properties"), jobs: await count("jobs") };

    await expect(upsertEnquiry(request(), "installer_import", USER_B, installerB)).rejects.toThrow(duplicateAddressMessage(existing.jobNumber));

    expect(await ownerBytes(existing.ownerId)).toBe(before);
    expect({ owners: await count("owners"), properties: await count("properties"), jobs: await count("jobs") }).toEqual(counts);
    const flags = await q<{ job_id: string; details: { business_id: string; needs_office: boolean; from: string; request: { phone: string } } }>("select job_id, details from workflow_events where event_type = $1", [DUPLICATE_ADDRESS_EVENT]);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.job_id).toBe(existing.jobId);
    expect(flags[0]!.details).toMatchObject({ business_id: BIZ_B, needs_office: true, from: "installer_intake", request: { phone: "0499 999 999" } });
  });

  test("the same holds when the existing job is ANOTHER installer's (shared customer), and for a Mitti pickup with no email", async () => {
    const a = await seedJob({ name: "Sam Shared", email: "sam@example.com", phone: "0422 222 222", address: "7 Oak Ave", suburb: "Reservoir", postcode: "3073", channel: "installer_sourced", business: BIZ_A });
    const before = await ownerBytes(a.ownerId);
    await expect(upsertEnquiry(request({ email: "sam@example.com", address_line: "7 Oak Avenue", suburb: "Reservoir", postcode: "3073", full_name: "Someone Else", phone: "0400 000 000" }), "installer_import", USER_B, installerB)).rejects.toThrow(duplicateAddressMessage(a.jobNumber));
    await expect(upsertEnquiry(request({ email: null, address_line: "7 Oak Ave", suburb: "Reservoir", postcode: "3073", estimated_area_m2: null }), "installer_mitti", null, installerB)).rejects.toThrow(duplicateAddressMessage(a.jobNumber));
    expect(await ownerBytes(a.ownerId)).toBe(before);
    expect(await count("owners")).toBe(1);
  });
});

describe("R01: an ACCEPTED installer intake never changes an existing owner's contact", () => {
  test("another business's customer email at a new address → a new job on its OWN owner row; the other row unchanged", async () => {
    const a = await seedJob({ name: "Sam Shared", email: "sam@example.com", phone: "0422 222 222", address: "7 Oak Ave", suburb: "Reservoir", postcode: "3073", channel: "installer_sourced", business: BIZ_A });
    const before = await ownerBytes(a.ownerId);
    const res = await upsertEnquiry(request({ email: "SAM@example.com", full_name: "Sam S", phone: "0400 000 000" }), "installer_import", USER_B, installerB);
    expect(res.created).toBe(true);
    const [job] = await q<{ owner_id: string; originating_installer_business_id: string }>("select owner_id, originating_installer_business_id from jobs where id = $1", [res.job_id]);
    expect(job!.owner_id).not.toBe(a.ownerId);
    expect(job!.originating_installer_business_id).toBe(BIZ_B);
    expect(await ownerBytes(a.ownerId)).toBe(before);
    const [mine] = await q<{ full_name: string; email: string; phone: string; user_id: string | null }>("select full_name, email, phone, user_id from owners where id = $1", [job!.owner_id]);
    expect(mine).toEqual({ full_name: "Sam S", email: "sam@example.com", phone: "0400 000 000", user_id: null });
  });

  test("a website owner's email at a new address → own owner row, never linked to that owner's portal login from an installer-typed email", async () => {
    const w = await seedJob({ name: "Wendy Web", email: "wendy@example.com", phone: "0433 333 333", address: "3 Elm Rd", suburb: "Preston", postcode: "3072", channel: "hivic_sourced", userId: PROFILE });
    await db.query("insert into profiles (id, email) values ($1, 'wendy@example.com')", [PROFILE]);
    const before = await ownerBytes(w.ownerId);
    const res = await upsertEnquiry(request({ email: "wendy@example.com", full_name: "W", phone: "0400 111 222" }), "installer_portal", USER_B, installerB);
    const [job] = await q<{ owner_id: string }>("select owner_id from jobs where id = $1", [res.job_id]);
    expect(job!.owner_id).not.toBe(w.ownerId);
    expect(await ownerBytes(w.ownerId)).toBe(before);
    expect((await q<{ user_id: string | null }>("select user_id from owners where id = $1", [job!.owner_id]))[0]!.user_id).toBeNull();
    expect(await count("user_roles")).toBe(0);
  });

  test("a job save that fails removes only the owner row this request made", async () => {
    const a = await seedJob({ name: "Sam Shared", email: "sam@example.com", phone: "0422 222 222", address: "7 Oak Ave", suburb: "Reservoir", postcode: "3073", channel: "installer_sourced", business: BIZ_A });
    const before = await ownerBytes(a.ownerId);
    await expect(upsertEnquiry(request({ email: "sam@example.com", address_line: "99 Fail St" }), "installer_import", USER_B, installerB)).rejects.toThrow(/job insert failed/);
    expect(await count("owners")).toBe(1);
    expect(await count("properties")).toBe(1);
    expect(await ownerBytes(a.ownerId)).toBe(before);
  });

  test("an installer request reference that belongs to another business's job is refused before anything is written", async () => {
    const a = await seedJob({ name: "Sam Shared", email: "sam@example.com", phone: "0422 222 222", address: "7 Oak Ave", suburb: "Reservoir", postcode: "3073", channel: "installer_sourced", business: BIZ_A });
    await db.query("update jobs set external_enquiry_id = 'ref-1' where id = $1", [a.jobId]);
    const before = await ownerBytes(a.ownerId);
    await expect(upsertEnquiry(request({ external_enquiry_id: "ref-1", email: "sam@example.com" }), "installer_import", USER_B, installerB)).rejects.toThrow(/already in use/);
    expect(await ownerBytes(a.ownerId)).toBe(before);
    expect(await count("owners")).toBe(1);
  });
});

describe("R01: the other paths through the same helper", () => {
  test("website duplicate at an open job's address → that job back with the office flag, owner untouched (contact was overwritten before the fix)", async () => {
    const i = await seedJob({ name: "Sam Shared", email: "sam@example.com", phone: "0422 222 222", address: "7 Oak Ave", suburb: "Reservoir", postcode: "3073", channel: "installer_sourced", business: BIZ_A });
    const before = await ownerBytes(i.ownerId);
    const res = await upsertEnquiry(request({ email: "sam@example.com", address_line: "7 Oak Ave", suburb: "Reservoir", postcode: "3073", external_enquiry_id: "b44-1" }), "base44", null);
    expect(res).toMatchObject({ job_id: i.jobId, created: false, duplicate_address: true });
    expect(await ownerBytes(i.ownerId)).toBe(before);
    expect(await count("owners")).toBe(1);
    expect((await q("select 1 from workflow_events where event_type = $1 and job_id = $2", [DUPLICATE_ADDRESS_EVENT, i.jobId]))).toHaveLength(1);
  });

  test("office (Add enquiry) duplicate → that job back, owner untouched", async () => {
    const w = await seedJob({ name: "Wendy Web", email: "wendy@example.com", phone: "0433 333 333", address: "3 Elm Rd", suburb: "Preston", postcode: "3072", channel: "hivic_sourced" });
    const before = await ownerBytes(w.ownerId);
    const res = await upsertEnquiry(request({ email: "wendy@example.com", full_name: "Changed", phone: "0400 000 999", address_line: "3 Elm Road", suburb: "Preston", postcode: "3072" }), "portal", USER_A);
    expect(res).toMatchObject({ job_id: w.jobId, duplicate_address: true });
    expect(await ownerBytes(w.ownerId)).toBe(before);
  });

  test("website owner at a new address keeps the by-email owner row and its latest name/phone (unchanged behaviour)", async () => {
    const w = await seedJob({ name: "Wendy Web", email: "wendy@example.com", phone: "0433 333 333", address: "3 Elm Rd", suburb: "Preston", postcode: "3072", channel: "hivic_sourced" });
    const res = await upsertEnquiry(request({ email: "wendy@example.com", full_name: "wendy web", phone: "0433 000 000", address_line: "8 Pine St", suburb: "Thornbury", postcode: "3071", external_enquiry_id: "b44-2" }), "base44", null);
    expect(res.created).toBe(true);
    const [job] = await q<{ owner_id: string }>("select owner_id from jobs where id = $1", [res.job_id]);
    expect(job!.owner_id).toBe(w.ownerId);
    expect((await q<{ phone: string }>("select phone from owners where id = $1", [w.ownerId]))[0]!.phone).toBe("0433 000 000");
    expect(await count("owners")).toBe(1);
  });

  test("a website enquiry never rewrites an installer's customer row: it gets its own owner row", async () => {
    const i = await seedJob({ name: "Sam Shared", email: "sam@example.com", phone: "0422 222 222", address: "7 Oak Ave", suburb: "Reservoir", postcode: "3073", channel: "installer_sourced", business: BIZ_A });
    const before = await ownerBytes(i.ownerId);
    const res = await upsertEnquiry(request({ email: "sam@example.com", full_name: "Sam Web", phone: "0400 222 333", address_line: "8 Pine St", suburb: "Thornbury", postcode: "3071", external_enquiry_id: "b44-3" }), "base44", null);
    const [job] = await q<{ owner_id: string }>("select owner_id from jobs where id = $1", [res.job_id]);
    expect(job!.owner_id).not.toBe(i.ownerId);
    expect(await ownerBytes(i.ownerId)).toBe(before);
  });

  test("Upload jobs and Add a job check the address before creating their own owner row and never update an owner", () => {
    for (const f of ["src/lib/bulk-import.server.ts", "src/lib/onsite-ready-check.server.ts"]) {
      const src = readFileSync(f, "utf8");
      const dup = src.indexOf("findOpenJobAtAddress(");
      expect(dup).toBeGreaterThan(-1);
      expect(dup).toBeLessThan(src.indexOf("createInstallerOwner(admin"));
      expect(src).not.toMatch(/from\("owners"\)\.update/);
    }
    const enquiry = readFileSync("src/lib/enquiry.server.ts", "utf8");
    // In upsertEnquiry the duplicate check precedes the first owner write/lookup.
    const inner = enquiry.slice(enquiry.indexOf("async function upsertEnquiryInner"));
    expect(inner.indexOf("findOpenJobAtAddress(")).toBeLessThan(inner.indexOf("createInstallerOwner("));
    expect(inner.indexOf("findOpenJobAtAddress(")).toBeLessThan(inner.indexOf("hivicOwner(email"));
  });
});
