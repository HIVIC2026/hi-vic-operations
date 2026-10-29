// A6 (installer pages part 1, Jo 29 Oct 2026): Add a job saves owner, property, job, assignment, consent and events in ONE
// transaction keyed by the phone's request key, so "Try again" finishes the same job and a failure leaves nothing behind.
// Runs the pending SQL (docs/pending-migrations/add-installer-job-atomic.sql) and its undo on PGlite — throwaway
// in-memory Postgres, fake TEST rows only. Tables mirror the columns/constraints the function touches (drizzle 0000,
// 0004, 0023, 0028, 0059, 0136) with the real append-only triggers on workflow_events and owner_contact_consents and the
// still-live owners_email_uq index.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { addInstallerJobPayload, type AddInstallerJobPayload } from "../src/lib/add-installer-job.core";
import { READY_CHECK_FORM_COMING } from "../src/lib/onsite-ready-check.core";
import { electricianChoiceRecord, electricianChoiceSummary } from "../src/lib/electrician-choice.core";

const SQL = readFileSync("docs/pending-migrations/add-installer-job-atomic.sql", "utf8");
const UNDO_SQL = readFileSync("docs/pending-migrations/add-installer-job-atomic.undo.sql", "utf8");
const BIZ = "30000000-0000-4000-8000-0000000a0601", OTHER_BIZ = "30000000-0000-4000-8000-0000000a0602", USER = "40000000-0000-4000-8000-0000000a0601";

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  CREATE TYPE public.job_stage AS ENUM ('new_enquiry','ready_check_ready_to_schedule');
  CREATE TYPE public.assignment_role AS ENUM ('installer','electrician');
  CREATE TABLE public.owners (id uuid primary key default gen_random_uuid(), user_id uuid, full_name text not null, email text, phone text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  CREATE UNIQUE INDEX owners_email_uq ON public.owners (lower(email)) WHERE email IS NOT NULL;
  CREATE TABLE public.properties (id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.owners(id) on delete restrict,
    address_line text not null, suburb text, state text not null default 'VIC', postcode text, created_at timestamptz not null default now());
  CREATE SEQUENCE public.job_number_seq START 1001;
  CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid(), job_number text not null unique default ('HV-' || nextval('public.job_number_seq')::text),
    property_id uuid not null references public.properties(id) on delete restrict, owner_id uuid not null references public.owners(id) on delete restrict,
    stage public.job_stage not null default 'new_enquiry', source text not null default 'base44', external_enquiry_id text unique, next_action text,
    business_unit text, installer_led boolean not null default false, channel text, originating_installer_business_id uuid, originating_installer_user_id uuid,
    customer_relationship_owner text not null default 'hivic' check (customer_relationship_owner in ('hivic','installer')),
    electrician_choice text check (electrician_choice is null or electrician_choice in ('preferred','approved_other','nominated','hivic_organise')),
    installer_site_check text check (installer_site_check is null or installer_site_check in ('yes','no')), installer_site_check_date date, installer_quoted text,
    last_activity_at timestamptz not null default now(), created_at timestamptz not null default now());
  CREATE TABLE public.job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade, user_id uuid not null,
    role public.assignment_role not null, business_id uuid, active boolean not null default true, assigned_by uuid, assigned_at timestamptz not null default now(), first_response_at timestamptz);
  CREATE UNIQUE INDEX job_assignments_active_uq ON public.job_assignments(job_id, role) WHERE active;
  CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade, actor_id uuid,
    event_type text not null, from_stage public.job_stage, to_stage public.job_stage, summary text not null, details jsonb not null default '{}'::jsonb,
    internal boolean not null default false, created_at timestamptz not null default now());
  CREATE FUNCTION public.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workflow_events is append-only'; END $$;
  CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON public.workflow_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();
  CREATE TABLE public.owner_contact_consents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
    owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE RESTRICT, source text NOT NULL DEFAULT 'base44',
    consent_status text NOT NULL CHECK (consent_status IN ('granted','not_granted','unknown')), contact_consent boolean, consent_version text, consented_at timestamptz,
    consent_key text NOT NULL, snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (job_id, source, consent_key));
  CREATE FUNCTION public.guard_immutable_row() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ begin raise exception '% rows are permanent and immutable', tg_table_name; end $$;
  CREATE TRIGGER owner_contact_consents_immutable BEFORE UPDATE OR DELETE ON public.owner_contact_consents FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_row();
`);
await db.exec(SQL);

const TEXT = "The owner has given Home Insulation Victoria permission to contact them.";
const payload = (k: string, over: { email?: string; business?: string } = {}): AddInstallerJobPayload => addInstallerJobPayload({
  requestKey: k, businessId: over.business ?? BIZ, userId: USER, source: "qa_test",
  owner: { full_name: " Test Owner ", email: over.email ?? `owner-${k}@hivic-test.example`, phone: " 0400 000 001 " },
  property: { address_line: ` ${k} Test Street `, suburb: "Frankston", postcode: "3199" },
  consent: { key: "installer_confirmed", by: "installer", text: TEXT, sha256: "ab".repeat(32) },
  electricianChoice: electricianChoiceRecord("hivic", null, "add_job"), leadOrigin: "owner_contacted", visitRequested: false, flagEvent: null,
});
type Row = { job_id: string; job_number: string; created: boolean };
const call = async (p: unknown): Promise<Row> => (await db.query<Row>("select * from public.add_installer_job($1::jsonb)", [JSON.stringify(p)])).rows[0]!;
const one = async (sql: string) => Object.values((await db.query<Record<string, unknown>>(sql)).rows[0]!)[0];
const count = async (t: string) => one(`select count(*)::int from public.${t}`);
const TABLES = ["owners", "properties", "jobs", "job_assignments", "owner_contact_consents", "workflow_events"];
const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await count(t)] as const)));
const events = async (job: string) => (await db.query<{ event_type: string }>("select event_type from workflow_events where job_id=$1 order by created_at, id", [job])).rows.map((r) => r.event_type);
const detail = async (job: string, type: string) => (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type=$2", [job, type])).rows[0]!.details;

describe("A6: add_installer_job — one transaction, keyed by the phone's request key", () => {
  test("all rows in one go", async () => {
    const r = await call(payload("k1"));
    expect(r.created).toBe(true);
    expect(await count("owners")).toBe(1); expect(await count("properties")).toBe(1); expect(await count("job_assignments")).toBe(1);
    expect(await one("select external_enquiry_id from jobs")).toBe("onsite:k1");
    expect(await events(r.job_id)).toEqual(["electrician_choice_set", "installer_job_added", "installer_contact_permission"]);
    expect((await detail(r.job_id, "installer_job_added")).lead_origin).toBe("owner_contacted");
  });
  test("the rows match today's step-by-step save", async () => {
    const [j] = (await db.query<Record<string, unknown>>("select * from jobs where external_enquiry_id='onsite:k1'")).rows;
    expect(j).toMatchObject({ stage: "ready_check_ready_to_schedule", source: "qa_test", business_unit: "hivic", installer_led: true, channel: "installer_sourced", originating_installer_business_id: BIZ,
      originating_installer_user_id: USER, customer_relationship_owner: "installer", installer_site_check: "no", installer_site_check_date: null, installer_quoted: "no", next_action: READY_CHECK_FORM_COMING, electrician_choice: "hivic_organise" });
    expect((await db.query("select full_name, email, phone from owners")).rows[0]).toEqual({ full_name: "Test Owner", email: "owner-k1@hivic-test.example", phone: "0400 000 001" });
    expect((await db.query("select address_line, suburb, postcode, state from properties")).rows[0]).toEqual({ address_line: "k1 Test Street", suburb: "Frankston", postcode: "3199", state: "VIC" });
    expect((await db.query("select user_id, role, business_id, assigned_by, active, (first_response_at is not null) responded from job_assignments")).rows[0]).toEqual({ user_id: USER, role: "installer", business_id: BIZ, assigned_by: USER, active: true, responded: true });
    expect((await db.query("select source, consent_key, consent_status, contact_consent, snapshot, sha256 from owner_contact_consents")).rows[0]).toEqual({ source: "onsite_ready_check", consent_key: "installer_confirmed", consent_status: "granted", contact_consent: true, snapshot: { by: "installer", text: TEXT, recorded_by: USER }, sha256: "ab".repeat(32) });
    const ev = (await db.query<{ event_type: string; summary: string; details: Record<string, unknown>; internal: boolean; actor_id: string }>("select event_type, summary, details, internal, actor_id from workflow_events order by created_at, id")).rows;
    const rec = electricianChoiceRecord("hivic", null, "add_job");
    expect(ev[0]).toEqual({ event_type: "electrician_choice_set", summary: electricianChoiceSummary(rec), details: { ...rec, business_id: BIZ, declared_not_verified: true }, internal: true, actor_id: USER });
    expect(ev[1]).toEqual({ event_type: "installer_job_added", summary: "Installer added this customer (Add a job: name, address, mobile, email, contact permission); the Mitti Ready Check form is created next", details: { business_id: BIZ, visit_requested: false, lead_origin: "owner_contacted" }, internal: false, actor_id: USER });
    expect(ev[2]).toEqual({ event_type: "installer_contact_permission", summary: "Installer confirmed the owner gave consent", details: { wording: TEXT, by: "installer" }, internal: true, actor_id: USER });
  });
  test("same request key again → same job, nothing new", async () => {
    const a = await call(payload("k2")), b = await call(payload("k2"));
    expect(b).toEqual({ ...a, created: false }); expect(await count("jobs")).toBe(2);
  });
  test("a failure on the last write leaves nothing behind", async () => {
    await db.exec(`create function boom() returns trigger language plpgsql as $$ begin if new.event_type='installer_contact_permission' then raise exception 'boom'; end if; return new; end $$;
      create trigger t_boom before insert on workflow_events for each row execute function boom();`);
    const before = await counts();
    await expect(call(payload("k3"))).rejects.toThrow("boom");
    expect(await counts()).toEqual(before);
    await db.exec("drop trigger t_boom on workflow_events");
    expect((await call(payload("k3"))).created).toBe(true); // Try again works
  });
  test("HIV-lead clash flag lands on the new job", async () => {
    const r = await call({ ...payload("k4"), flag_event: { summary: "x", details: { needs_office: true } } });
    expect(await events(r.job_id)).toContain("duplicate_address_linked");
    expect(await events(r.job_id)).toEqual(["electrician_choice_set", "duplicate_address_linked", "installer_job_added", "installer_contact_permission"]);
    expect((await db.query("select summary, details, internal from workflow_events where job_id=$1 and event_type='duplicate_address_linked'", [r.job_id])).rows[0]).toEqual({ summary: "x", details: { needs_office: true }, internal: true });
  });
  test("owner ticked on the phone: owner wording; usual electrician named", async () => {
    const p = { ...payload("k5"), consent: { key: "owner_ticked", by: "owner", text: "Privacy text", sha256: "cd".repeat(32) }, electrician_choice: electricianChoiceRecord("usual", { name: "Sam Sparks", licence: "A1" } as never, "add_job") };
    const r = await call(p);
    expect((await db.query("select summary from workflow_events where job_id=$1 and event_type='installer_contact_permission'", [r.job_id])).rows[0]).toEqual({ summary: "Owner ticked contact and privacy consent on the installer's phone" });
    expect((await db.query("select summary from workflow_events where job_id=$1 and event_type='electrician_choice_set'", [r.job_id])).rows[0]).toEqual({ summary: electricianChoiceSummary(p.electrician_choice) });
  });
  test("a known email (old unique index still live) reuses this business's own customer only; never another business's", async () => {
    const mine = await call(payload("k6", { email: "OWNER-k1@hivic-test.example" }));
    expect(await one(`select owner_id::text from jobs where id='${mine.job_id}'`)).toBe(await one("select owner_id::text from jobs where external_enquiry_id='onsite:k1'"));
    const before = await counts();
    await expect(call(payload("k7", { email: "owner-k1@hivic-test.example", business: OTHER_BIZ }))).rejects.toThrow("The customer could not be saved");
    expect(await counts()).toEqual(before);
  });
  test("refuses door-knock/cold-call leads and another business's request key", async () => {
    const before = await counts();
    await expect(call({ ...payload("k8"), lead_origin: "door_knock" })).rejects.toThrow("door-knocking");
    await expect(call({ ...payload("k1"), business_id: OTHER_BIZ })).rejects.toThrow("another business");
    expect(await counts()).toEqual(before);
  });
  test("only the service role may run it; undo drops it", async () => {
    expect(await one("select has_function_privilege('authenticated','public.add_installer_job(jsonb)','execute')")).toBe(false);
    expect(await one("select has_function_privilege('anon','public.add_installer_job(jsonb)','execute')")).toBe(false);
    expect(await one("select has_function_privilege('service_role','public.add_installer_job(jsonb)','execute')")).toBe(true);
    await db.exec(UNDO_SQL); expect(await one("select count(*)::int from pg_proc where proname='add_installer_job'")).toBe(0);
  });
});
