// Practice database (PGlite) proof for 0208: one open-website-enquiry response scope, exact counts beyond 1000
// rows, provider-confirmed vs recorded-only vs uncertain, any-purpose dedupe and media review reopening.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (n: string) => readFileSync(new URL(`../docs/pending-migrations/${n}`, import.meta.url), "utf8");
const db = new PGlite();
const N = 1203; // more than the 1000-row PostgREST default

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TYPE booking_status AS ENUM ('proposed','confirmed','completed','cancelled');
    CREATE TYPE quote_status AS ENUM ('draft','issued','accepted');
    CREATE TABLE owners(id uuid primary key, full_name text, email text, phone text);
    CREATE TABLE properties(id uuid primary key, address_line text, suburb text, state text, postcode text);
    CREATE TABLE jobs(id uuid primary key default gen_random_uuid(), job_number text, external_enquiry_id text, stage text, source text, channel text,
      created_at timestamptz default now(), eligibility_set_at timestamptz, eligibility_outcome text, deleted_at timestamptz, qa_archived_at timestamptz,
      owner_id uuid, property_id uuid);
    CREATE TABLE workflow_events(job_id uuid, event_type text);
    CREATE TABLE customer_email_sends(id uuid primary key default gen_random_uuid(), job_id uuid, status text, purpose text, idempotency_key text, created_at timestamptz default now());
    CREATE TABLE lead_campaign_responses(job_id uuid, spot_saved_at timestamptz, opted_out_at timestamptz);
    CREATE TABLE customer_engagement_events(id uuid primary key default gen_random_uuid(), job_id uuid, event_type text, source text, metadata jsonb, occurred_at timestamptz);
    CREATE TABLE documents(job_id uuid, kind text, storage_path text, created_at timestamptz default now());
    CREATE TABLE evidence_files(job_id uuid, storage_path text, uploaded_at timestamptz default now());
    CREATE TABLE ready_check_acceptances(job_id uuid); CREATE TABLE ready_check_windows(job_id uuid, status text);
    CREATE TABLE bookings(job_id uuid, status booking_status); CREATE TABLE quotes(job_id uuid, status quote_status);
    CREATE TABLE job_communications(job_id uuid, direction text, channel text, visibility text);
  `);
  // Previous live definition first, so the migration is proven as a replacement, then applied twice (idempotent).
  const rollback = read("0208_enquiry_response_scope.rollback.sql");
  const original = rollback.slice(rollback.indexOf("CREATE VIEW"), rollback.indexOf("REVOKE ALL"));
  await db.exec(original);
  await db.exec(read("0208_enquiry_response_scope.sql"));
  await db.exec(read("0208_enquiry_response_scope.sql"));
  // N open website enquiries, each with a distinct owner/property so nothing is a duplicate contact.
  await db.exec(`
    INSERT INTO owners SELECT md5(i::text)::uuid, 'Owner '||i, 'owner'||i||'@example.org', null FROM generate_series(1, ${N}) i;
    INSERT INTO properties SELECT md5('p'||i)::uuid, i||' Fictional St', 'Testville', 'VIC', '3000' FROM generate_series(1, ${N}) i;
    INSERT INTO jobs(id, job_number, stage, source, channel, created_at, owner_id, property_id)
      SELECT md5('j'||i)::uuid, 'HV-'||(5000+i), 'preliminary_estimate_ready', 'base44', 'hivic_sourced', now() - (i||' minutes')::interval, md5(i::text)::uuid, md5('p'||i)::uuid
      FROM generate_series(1, ${N}) i;
    -- 1..1100: provider-confirmed, mixed purposes (any purpose counts), one of them ALSO in correspondence (no double count)
    INSERT INTO customer_email_sends(job_id, status, purpose) SELECT md5('j'||i)::uuid, CASE WHEN i % 2 = 0 THEN 'sent' ELSE 'delivered' END,
      CASE WHEN i % 3 = 0 THEN 'insulation_video_request' ELSE 'existing_leads_launch_v1' END FROM generate_series(1, 1100) i;
    INSERT INTO job_communications SELECT md5('j'||i)::uuid, 'outbound', 'email', 'customer' FROM generate_series(1, 1100) i;
    -- 1101..1169: correspondence only (recorded reply, no provider-confirmed send)
    INSERT INTO job_communications SELECT md5('j'||i)::uuid, 'outbound', 'email', 'customer' FROM generate_series(1101, 1169) i;
    -- 1170..1179: uncertain/in-flight attempt only
    INSERT INTO customer_email_sends(job_id, status, purpose) SELECT md5('j'||i)::uuid, CASE WHEN i % 2 = 0 THEN 'delivered_unrecorded' ELSE 'sending' END, 'existing_leads_launch_v1' FROM generate_series(1170, 1179) i;
    -- 1180..1184: latest attempt failed (older sent? no – failed only), still unanswered and retryable
    INSERT INTO customer_email_sends(job_id, status, purpose) SELECT md5('j'||i)::uuid, 'failed', 'existing_leads_launch_v1' FROM generate_series(1180, 1184) i;
    -- internal-only and inbound correspondence never count as a reply
    INSERT INTO job_communications SELECT md5('j'||i)::uuid, 'outbound', 'email', 'internal' FROM generate_series(1185, 1190) i;
    INSERT INTO job_communications SELECT md5('j'||i)::uuid, 'inbound', 'email', 'customer' FROM generate_series(1185, 1190) i;
    -- outside the open-enquiry scope: deleted, archived, removed, test
    UPDATE jobs SET deleted_at = now() WHERE job_number = 'HV-'||(5000+1200);
    UPDATE jobs SET qa_archived_at = now() WHERE job_number = 'HV-'||(5000+1201);
    INSERT INTO workflow_events SELECT id, 'lead_removed' FROM jobs WHERE job_number = 'HV-'||(5000+1202);
    UPDATE jobs SET source = 'qa_test' WHERE job_number = 'HV-'||(5000+1203);
  `);
});
afterAll(async () => { await db.close(); });

type Counts = { all: number; new: number; photos: number };
const page = async (view: string, p = 1) => (await db.query<{ r: { ids: string[]; total: number; counts: Counts; responses: Record<string, number> } }>(`SELECT office_enquiry_page($1, '', $2) r`, [view, p])).rows[0]!.r;

test("exact cohort counts beyond 1000 rows, one category per enquiry", async () => {
  const r = await page("all");
  expect(r.counts.all).toBe(1199);
  expect(r.responses).toEqual({ provider_confirmed: 1100, recorded_only: 69, uncertain: 10, unanswered: 20, unanswered_latest_failed: 5 });
  const c = r.responses;
  expect(c.provider_confirmed! + c.recorded_only! + c.uncertain! + c.unanswered!).toBe(r.counts.all);
});

test("New lists only genuinely unanswered enquiries (correspondence-only and uncertain excluded)", async () => {
  const r = await page("new");
  expect(r.total).toBe(20);
  expect(r.counts.new).toBe(20);
  expect(r.ids.length).toBe(20);
  const states = await db.query<{ response_state: string }>(`SELECT DISTINCT response_state FROM office_enquiry_index WHERE id = ANY($1::uuid[])`, [r.ids]);
  expect(states.rows.map((x) => x.response_state)).toEqual(["none"]);
});

test("pages are bounded at 50 rows and stay inside the same scope", async () => {
  const p1 = await page("all", 1), last = await page("all", 24);
  expect(p1.ids.length).toBe(50);
  expect(last.ids.length).toBe(1199 - 23 * 50);
});

test("unclear review reopens Office photo review only when newer homeowner media arrives", async () => {
  const id = (await db.query<{ id: string }>(`SELECT id FROM jobs WHERE job_number = 'HV-5001'`)).rows[0]!.id;
  await db.query(`INSERT INTO documents(job_id, kind, storage_path, created_at) VALUES ($1::uuid, 'intake_media', $1::text||'/intake/a.jpg', now() - interval '2 hours')`, [id]);
  const media = async () => (await db.query<{ media_to_review: boolean }>(`SELECT media_to_review FROM office_enquiry_index WHERE id = $1`, [id])).rows[0]!.media_to_review;
  expect(await media()).toBe(true); // unreviewed
  await db.query(`INSERT INTO customer_engagement_events(job_id, event_type, source, metadata, occurred_at) VALUES ($1, 'intake_media_reviewed', 'office', '{"outcome":"unclear"}', now() - interval '1 hour')`, [id]);
  expect(await media()).toBe(false); // homeowner owes more media
  await db.query(`INSERT INTO evidence_files(job_id, storage_path, uploaded_at) VALUES ($1::uuid, $1::text||'/intake/b.jpg', now())`, [id]);
  expect(await media()).toBe(true); // new media after the unclear review: Office owes the review
  await db.query(`INSERT INTO customer_engagement_events(job_id, event_type, source, metadata, occurred_at) VALUES ($1, 'intake_media_reviewed', 'office', '{"outcome":"below_r2"}', now() + interval '1 minute')`, [id]);
  expect(await media()).toBe(false);
});

test("rollback restores the previous definition", async () => {
  await db.exec(read("0208_enquiry_response_scope.rollback.sql"));
  const cols = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'office_enquiry_index'`);
  expect(cols.rows.some((c) => c.column_name === "response_state")).toBe(false);
  expect(cols.rows.some((c) => c.column_name === "needs_first_response")).toBe(true);
});

test("initial acknowledgement does not count as an offer; the follow-up does, once per home", async () => {
  const fresh = new PGlite();
  await fresh.exec(`CREATE TABLE s(job_id text, status text, purpose text, idempotency_key text UNIQUE)`);
  const offered = `SELECT EXISTS(SELECT 1 FROM s WHERE status='sent' AND (purpose='step3_estimate' OR purpose='existing_leads_launch_v1' AND idempotency_key !~~ '%:insulation_details:%' AND idempotency_key !~ ':b(:|$)')) o`;
  await fresh.exec(`INSERT INTO s VALUES ('j','sent','existing_leads_launch_v1','existing_leads_launch_v1:insulation_details:j')`);
  expect((await fresh.query<{ o: boolean }>(offered)).rows[0]!.o).toBe(false);
  await fresh.exec(`INSERT INTO s VALUES ('j','sent','existing_leads_launch_v1','existing_leads_launch_v1:existing_insulation_save_spot:j')`);
  expect((await fresh.query<{ o: boolean }>(offered)).rows[0]!.o).toBe(true);
  let dup = false;
  try { await fresh.exec(`INSERT INTO s VALUES ('j','sending','existing_leads_launch_v1','existing_leads_launch_v1:existing_insulation_save_spot:j')`); } catch { dup = true; }
  expect(dup).toBe(true);
  await fresh.close();
});
