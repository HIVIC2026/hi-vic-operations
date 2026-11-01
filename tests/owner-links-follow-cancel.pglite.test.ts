// Owner links stay working (Jo 1 Nov 2026), proven on a practice Postgres (PGlite), never the live database:
// - cancelling a job revokes its active links ('job_cancelled'); reopening restores the SAME token;
// - links revoked for any other reason stay revoked on reopen; other stage changes never touch links;
// - save_owner_insulation_details accepts an active link with an old expires_at;
// - the SQL is safe to run twice and the rollback removes the trigger and restores the date check.
import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync("docs/pending-migrations/owner-links-follow-cancel.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/owner-links-follow-cancel.rollback.sql", "utf8");
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create table public.properties(id uuid primary key, enrichment jsonb);
  create table public.jobs(id uuid primary key, stage text not null, source text not null default 'base44', property_id uuid,
    eligibility_review_required boolean not null default false, eligibility_outcome text default 'needs_onsite_confirmation',
    eligibility_set_at timestamptz, next_action text);
  create table public.customer_estimate_links(id uuid primary key default gen_random_uuid(), job_id uuid not null, owner_id uuid not null default gen_random_uuid(),
    purpose text not null default 'step3_estimate', token text not null unique, status text not null default 'active',
    created_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz, revocation_reason text,
    last_viewed_at timestamptz, view_count int not null default 0, current_estimate_id uuid);
  create unique index customer_estimate_links_one_active on public.customer_estimate_links(job_id, purpose) where status = 'active';
  create table public.workflow_events(id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean);
  create table public.owner_contact_consents(job_id uuid, consent_status text, created_at timestamptz default now());
  create table public.customer_email_optouts(job_id uuid, opted_out_at timestamptz);
  create table public.lead_campaign_responses(job_id uuid primary key, estimate_link_id uuid, campaign text, desk_check_status text, desk_check_reason text,
    opted_out_at timestamptz, spot_saved_at timestamptz, desk_checked_at timestamptz, updated_at timestamptz);
`);
afterAll(async () => { await db.close(); });

const J = "00000000-0000-4000-8000-0000000000a1";
const OLD_DATE = "2026-10-30T23:10:13Z"; // Chris Machar's link date: in the past
const links = async (job = J) => (await db.query<{ token: string; status: string; revocation_reason: string | null }>(
  "select token, status, revocation_reason from public.customer_estimate_links where job_id = $1 order by token", [job])).rows;
const stage = (s: string, job = J) => db.query("update public.jobs set stage = $1 where id = $2", [s, job]);

describe("before the SQL: cancelling leaves the link active, an old date blocks nothing yet in the table", () => {
  test("no trigger yet", async () => {
    await db.exec(`insert into public.jobs(id, stage) values ('${J}', 'preliminary_estimate_ready');
      insert into public.customer_estimate_links(job_id, token, expires_at) values ('${J}', 'tok-a', '${OLD_DATE}');`);
    await stage("cancelled");
    expect((await links())[0]!.status).toBe("active");
    await stage("preliminary_estimate_ready");
  });
});

describe("after the SQL", () => {
  test("applies twice without error", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
  });
  test("cancel revokes with reason job_cancelled", async () => {
    await stage("cancelled");
    expect(await links()).toEqual([{ token: "tok-a", status: "revoked", revocation_reason: "job_cancelled" }]);
  });
  test("reopen restores the same token", async () => {
    await stage("preliminary_estimate_ready");
    expect(await links()).toEqual([{ token: "tok-a", status: "active", revocation_reason: null }]);
  });
  test("complete and on_hold leave links alone", async () => {
    await stage("complete");
    expect((await links())[0]!.status).toBe("active");
    await stage("on_hold");
    expect((await links())[0]!.status).toBe("active");
    await stage("preliminary_estimate_ready");
  });
  test("a link revoked for another reason stays revoked on reopen", async () => {
    const K = "00000000-0000-4000-8000-0000000000a2";
    await db.exec(`insert into public.jobs(id, stage) values ('${K}', 'preliminary_estimate_ready');
      insert into public.customer_estimate_links(job_id, token, expires_at, status, revocation_reason) values ('${K}', 'tok-gate', '${OLD_DATE}', 'revoked', 'Gate 1 no longer permits a customer estimate (withheld_review)');`);
    await stage("cancelled", K);
    await stage("preliminary_estimate_ready", K);
    expect(await links(K)).toEqual([{ token: "tok-gate", status: "revoked", revocation_reason: "Gate 1 no longer permits a customer estimate (withheld_review)" }]);
  });
  test("reopen never breaks the one-active-link rule (a newer link was issued meanwhile)", async () => {
    const M = "00000000-0000-4000-8000-0000000000a3";
    await db.exec(`insert into public.jobs(id, stage) values ('${M}', 'preliminary_estimate_ready');
      insert into public.customer_estimate_links(job_id, token, expires_at) values ('${M}', 'tok-m1', '${OLD_DATE}');`);
    await stage("cancelled", M);
    await db.exec(`insert into public.customer_estimate_links(job_id, token, expires_at) values ('${M}', 'tok-m2', '9999-12-31');`);
    await stage("preliminary_estimate_ready", M);
    expect(await links(M)).toEqual([
      { token: "tok-m1", status: "revoked", revocation_reason: "job_cancelled" },
      { token: "tok-m2", status: "active", revocation_reason: null },
    ]);
  });
  test("3 questions save works on an active link with an old date (Chris Machar case)", async () => {
    const P = "00000000-0000-4000-8000-0000000000b1";
    await db.exec(`insert into public.properties(id, enrichment) values ('${P}', '{}'); update public.jobs set property_id = '${P}' where id = '${J}';
      insert into public.owner_contact_consents(job_id, consent_status) values ('${J}', 'granted');`);
    const r = await db.query<{ r: { route: string } }>(
      "select public.save_owner_insulation_details('tok-a', $1::jsonb) r",
      [JSON.stringify({ insulation_type: "batts", insulation_thickness: "hand", house_built_period: "1991_1999" })]);
    expect(r.rows[0]!.r.route).toBe("existing_save_spot");
  });
  test("3 questions save still refuses a revoked link", async () => {
    await expect(db.query("select public.save_owner_insulation_details('tok-gate', $1::jsonb)",
      [JSON.stringify({ insulation_type: "batts", insulation_thickness: "hand", house_built_period: "1991_1999" })])).rejects.toThrow("Link unavailable");
  });
});

describe("rollback", () => {
  test("removes the trigger and restores the date check", async () => {
    await db.exec(ROLLBACK);
    await stage("cancelled");
    expect((await links())[0]!.status).toBe("active");
    await stage("preliminary_estimate_ready");
    await db.exec("delete from public.lead_campaign_responses; update public.properties set enrichment = '{}'");
    await expect(db.query("select public.save_owner_insulation_details('tok-a', $1::jsonb)",
      [JSON.stringify({ insulation_type: "batts", insulation_thickness: "thin", house_built_period: "1991_1999" })])).rejects.toThrow("Link unavailable");
  });
});
