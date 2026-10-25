// Decision 282 (Jo 25 Oct 2026) proven on a practice Postgres (PGlite), never the live database:
// - docs/pending-migrations/owners-email-not-unique.sql drops the baseline unique email index (drizzle 0000), is
//   idempotent, and its rollback refuses while two owners share an email;
// - before it, a second owner row with a known email cannot be saved and the installer gets the neutral line
//   (never "customer who isn't yours"); after it, the same email twice makes two owners and two jobs;
// - the only duplicate rule: an OPEN job at the same normalised address is found and flagged once; a closed job at
//   the address is not; practice (qa_test) and real jobs never match each other.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
  create table public.businesses(id uuid primary key default gen_random_uuid(), name text);
  create table public.owners(id uuid primary key default gen_random_uuid(), user_id uuid, full_name text not null, email text, phone text, created_at timestamptz not null default now());
  create unique index owners_email_uq on public.owners (lower(email)) where email is not null; -- drizzle 0000 baseline
  create table public.properties(id uuid primary key default gen_random_uuid(), owner_id uuid references public.owners(id), address_line text not null, suburb text, postcode text, state text default 'VIC');
  create table public.jobs(id uuid primary key default gen_random_uuid(), job_number text, owner_id uuid references public.owners(id), property_id uuid references public.properties(id),
    stage text not null default 'new_enquiry', source text not null default 'portal', channel text not null default 'hivic_sourced', originating_installer_business_id uuid,
    deleted_at timestamptz, created_at timestamptz not null default now(), last_activity_at timestamptz);
  create table public.workflow_events(id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), actor_id uuid, event_type text not null, summary text not null,
    details jsonb not null default '{}'::jsonb, from_stage text, to_stage text, internal boolean not null default false, created_at timestamptz not null default now());
  create function public.prevent_mutation() returns trigger language plpgsql as $$ begin raise exception 'workflow_events is append-only'; end $$;
  create trigger workflow_events_immutable before update or delete on public.workflow_events for each row execute function public.prevent_mutation();
  insert into public.businesses(id, name) values ('00000000-0000-4000-8000-0000000000b1', 'TEST Installer One'), ('00000000-0000-4000-8000-0000000000b2', 'TEST Installer Two');
`);
const shim = postgrestShim(db, { jsonColumns: { workflow_events: ["details"] } });
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: shim }));
const { createInstallerOwner, OWNER_SAVE_FAILED } = await import("../src/lib/installer-owner.server");
const { findOpenJobAtAddress, flagDuplicateAddress } = await import("../src/lib/duplicate-address.server");
const { DUPLICATE_ADDRESS_EVENT } = await import("../src/lib/duplicate-address.core");

const B1 = "00000000-0000-4000-8000-0000000000b1", B2 = "00000000-0000-4000-8000-0000000000b2";
const MIGRATION = readFileSync("docs/pending-migrations/owners-email-not-unique.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/owners-email-not-unique.rollback.sql", "utf8");
const owner = { full_name: "Test Owner", email: "Shared.Owner@example.test", phone: "0412345678" };
const uniqueIndexExists = async () => (await db.query<{ n: number }>("select count(*)::int n from pg_indexes where schemaname='public' and tablename='owners' and indexname='owners_email_uq'")).rows[0]!.n === 1;

async function jobAt(ownerId: string, a: { address_line: string; suburb: string; postcode: string }, o: { stage?: string; source?: string; job_number: string; business?: string | null }) {
  const p = (await db.query<{ id: string }>("insert into public.properties(owner_id, address_line, suburb, postcode) values ($1,$2,$3,$4) returning id", [ownerId, a.address_line, a.suburb, a.postcode])).rows[0]!.id;
  const j = (await db.query<{ id: string }>("insert into public.jobs(job_number, owner_id, property_id, stage, source, channel, originating_installer_business_id) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [o.job_number, ownerId, p, o.stage ?? "ready_check_ready_to_schedule", o.source ?? "installer_onsite", o.business ? "installer_sourced" : "hivic_sourced", o.business ?? null])).rows[0]!.id;
  return { jobId: j, propertyId: p };
}

describe("before the migration (live baseline): the unique email index still bites, the message stays neutral", () => {
  test("first owner saves; the second with the same email (any case) fails 23505 and the installer gets the neutral line", async () => {
    expect(await uniqueIndexExists()).toBe(true);
    const first = await createInstallerOwner(shim, B1, owner);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(db.query("insert into public.owners(full_name, email) values ('Other', 'shared.owner@EXAMPLE.test')")).rejects.toThrow(/owners_email_uq/);
    const err = await createInstallerOwner(shim, B2, owner).catch((e: Error) => e.message);
    expect(typeof err).toBe("string");
    expect(err).not.toMatch(/isn't yours|another installer|our leads/);
    expect(err === OWNER_SAVE_FAILED || /couldn't check/.test(err as string)).toBe(true); // the practice shim cannot embed owners!inner; live = neutral line
    expect((await db.query<{ n: number }>("select count(*)::int n from public.owners")).rows[0]!.n).toBe(1);
  });
});

describe("pending migration owners-email-not-unique.sql on PGlite", () => {
  test("drops the unique index, adds the plain one, idempotent", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect(await uniqueIndexExists()).toBe(false);
    expect((await db.query<{ n: number }>("select count(*)::int n from pg_indexes where tablename='owners' and indexname='owners_email_idx'")).rows[0]!.n).toBe(1);
  });
  test("same email twice → two owner rows, two jobs (different installers, different homes)", async () => {
    const a = await createInstallerOwner(shim, B1, owner);
    const b = await createInstallerOwner(shim, B2, owner);
    expect(a.id).not.toBe(b.id);
    const ja = await jobAt(a.id, { address_line: "5 Smith St", suburb: "Bundoora", postcode: "3083" }, { job_number: "HV-5001", business: B1 });
    const jb = await jobAt(b.id, { address_line: "9 Oak Court", suburb: "Reservoir", postcode: "3073" }, { job_number: "HV-5002", business: B2 });
    expect(ja.jobId).not.toBe(jb.jobId);
    const rows = (await db.query<{ email: string; n: number }>("select lower(email) email, count(*)::int n from public.owners group by lower(email)")).rows;
    expect(rows).toEqual([{ email: "shared.owner@example.test", n: 3 }]);
  });
});

describe("the one duplicate rule on the practice database", () => {
  test("same address, job open → found (abbreviations/unit style/case ignored) and flagged ONCE per request", async () => {
    const hit = await findOpenJobAtAddress({ address_line: "5 SMITH STREET", suburb: "bundoora", postcode: "3083", source: "installer_onsite" });
    expect(hit?.job_number).toBe("HV-5001");
    expect(await findOpenJobAtAddress({ address_line: "5 Smith St, Bundoora VIC 3083", suburb: null, postcode: null, source: "bulk_import" })).toMatchObject({ job_number: "HV-5001" });
    expect(await findOpenJobAtAddress({ address_line: "1/5 Smith St", suburb: "Bundoora", postcode: "3083", source: "installer_onsite" })).toBeNull(); // unit 1 is not the house
    const req = { from: "upload_jobs" as const, business_id: B2, business_name: "TEST Installer Two", request_key: "bulk:row-1", full_name: "Second Person", email: "x@example.test", phone: "0400000000", address_line: "5 Smith Street", suburb: "Bundoora", postcode: "3083" };
    await flagDuplicateAddress(hit!, null, req);
    await flagDuplicateAddress(hit!, null, req); // retry of the same row: no second flag
    await flagDuplicateAddress(hit!, null, { ...req, request_key: "bulk:row-2" });
    const ev = (await db.query<{ job_id: string; summary: string; details: { needs_office: boolean; from: string; request: { email: string } }; internal: boolean }>("select job_id, summary, details, internal from public.workflow_events where event_type = $1 order by created_at", [DUPLICATE_ADDRESS_EVENT])).rows;
    expect(ev).toHaveLength(2);
    expect(ev[0]!.job_id).toBe(hit!.id);
    expect(ev[0]!.summary).toBe("Another request for this address came in from an installer's Upload jobs (TEST Installer Two) — linked here, no new job made; office to check");
    expect(ev[0]!.internal).toBe(true);
    expect(ev[0]!.details).toMatchObject({ needs_office: true, from: "upload_jobs", request: { email: "x@example.test" } });
  });
  test("same address but the job is closed (cancelled/complete) or deleted → nothing found, so a new job is created", async () => {
    const o = (await db.query<{ id: string }>("select id from public.owners limit 1")).rows[0]!.id;
    await jobAt(o, { address_line: "12 Done Rd", suburb: "Preston", postcode: "3072" }, { job_number: "HV-5003", stage: "complete" });
    await jobAt(o, { address_line: "12 Done Road", suburb: "Preston", postcode: "3072" }, { job_number: "HV-5004", stage: "cancelled" });
    const gone = await jobAt(o, { address_line: "12 Done Road", suburb: "Preston", postcode: "3072" }, { job_number: "HV-5005" });
    await db.query("update public.jobs set deleted_at = now() where id = $1", [gone.jobId]);
    expect(await findOpenJobAtAddress({ address_line: "12 Done Road", suburb: "Preston", postcode: "3072", source: "installer_onsite" })).toBeNull();
    await jobAt(o, { address_line: "12 Done Road", suburb: "Preston", postcode: "3072" }, { job_number: "HV-5006" });
    expect((await findOpenJobAtAddress({ address_line: "12 Done Rd", suburb: "Preston", postcode: "3072", source: "installer_onsite" }))?.job_number).toBe("HV-5006");
  });
  test("practice jobs never link to real ones and the other way round", async () => {
    const o = (await db.query<{ id: string }>("select id from public.owners limit 1")).rows[0]!.id;
    await jobAt(o, { address_line: "3 Practice Pl", suburb: "Frankston", postcode: "3199" }, { job_number: "HV-5007", source: "qa_test" });
    expect(await findOpenJobAtAddress({ address_line: "3 Practice Place", suburb: "Frankston", postcode: "3199", source: "installer_onsite" })).toBeNull();
    expect((await findOpenJobAtAddress({ address_line: "3 Practice Place", suburb: "Frankston", postcode: "3199", source: "qa_test" }))?.job_number).toBe("HV-5007");
    expect(await findOpenJobAtAddress({ address_line: "5 Smith St", suburb: "Bundoora", postcode: "3083", source: "qa_test" })).toBeNull();
  });
});

describe("rollback", () => {
  test("refuses while owners share an email; restores the unique index once they do not", async () => {
    await expect(db.exec(ROLLBACK)).rejects.toThrow(/owners share an email/);
    expect(await uniqueIndexExists()).toBe(false);
    await db.exec("update public.owners set email = email || '.' || substr(id::text, 1, 8)");
    await db.exec(ROLLBACK);
    expect(await uniqueIndexExists()).toBe(true);
  });
});
