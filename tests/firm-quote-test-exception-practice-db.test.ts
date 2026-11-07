// Practice database (PGlite) proof for the firm-quote TEST-only exception (Jo, option A, 7 Nov 2026).
// The switch stays NULL: TEST jobs with TEST owner emails may request a firm quote; real enquiries are refused.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeEach, expect, test } from "bun:test";

const SQL = readFileSync(new URL("../drizzle/migrations/0197_firm_quote_test_exception.sql", import.meta.url), "utf8");
let db: PGlite;
let n = 0;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE workflow_settings (id int primary key, firm_quote_flow_live_at timestamptz);
    INSERT INTO workflow_settings VALUES (1, NULL);
    CREATE TABLE owners (id uuid primary key, email text, phone text);
    CREATE TABLE jobs (id uuid primary key, owner_id uuid, source text, stage text, created_at timestamptz, deleted_at timestamptz, qa_archived_at timestamptz);
    CREATE TABLE documents (job_id uuid, kind text, mime_type text, storage_path text);
    CREATE TABLE customer_estimate_links (id uuid primary key, job_id uuid, purpose text, status text);
    CREATE TABLE lead_campaign_responses (job_id uuid, opted_out_at timestamptz, spot_saved_at timestamptz);
    CREATE TABLE customer_email_optouts (job_id uuid, opted_out_at timestamptz);
    CREATE TABLE sms_optouts (phone text, opted_in_at timestamptz, opted_out_at timestamptz);
    CREATE TABLE quotes (job_id uuid);
    CREATE TABLE workflow_events (id serial, job_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default now());
    CREATE FUNCTION save_campaign_spot_atomic(p_job uuid, p_link uuid, s jsonb, b boolean, t text, d jsonb) RETURNS void LANGUAGE sql AS
      $$ INSERT INTO lead_campaign_responses(job_id, spot_saved_at) VALUES (p_job, now()) $$;
    DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await db.exec(SQL);
});

async function job(o: { source: string; email: string; created: string; media?: boolean }) {
  n++;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, owner = `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`, link = `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await db.query("INSERT INTO owners VALUES ($1,$2,NULL)", [owner, o.email]);
  await db.query("INSERT INTO jobs VALUES ($1,$2,$3,'preliminary_estimate_ready',$4,NULL,NULL)", [id, owner, o.source, o.created]);
  if (o.media !== false) await db.query("INSERT INTO documents VALUES ($1,'intake_media','image/jpeg','x/intake/photo.jpg')", [id]);
  await db.query("INSERT INTO customer_estimate_links VALUES ($1,$2,'step3_estimate','active')", [link, id]);
  return { id, link };
}
async function request(j: { id: string; link: string }) {
  const r = await db.query<{ r: { ok: boolean; reason?: string; dueBy?: string } }>("SELECT request_firm_quote_atomic($1,$2,'2026-11-17') AS r", [j.id, j.link]);
  return r.rows[0]!.r;
}
const after = "2026-11-07T00:00:00Z";

test("switch NULL: a real website enquiry with photos is still refused, nothing recorded", async () => {
  const real = await job({ source: "base44", email: "owner@gmail.com", created: after });
  expect(await request(real)).toEqual({ ok: false, reason: "not_firm_quote" });
  expect((await db.query("SELECT 1 FROM workflow_events")).rows).toHaveLength(0);
  expect((await db.query("SELECT 1 FROM lead_campaign_responses")).rows).toHaveLength(0);
});
test("switch NULL: a real website enquiry with a TEST-looking email is still refused (source must be qa_test)", async () => {
  expect(await request(await job({ source: "base44", email: "qa.owner@hivic-test.example", created: after }))).toEqual({ ok: false, reason: "not_firm_quote" });
});
test("switch NULL: a TEST job with a @hivic-test.example owner is saved once", async () => {
  const t = await job({ source: "qa_test", email: "qa.owner@hivic-test.example", created: after });
  expect(await request(t)).toEqual({ ok: true, dueBy: "2026-11-17", already: false });
  expect(await request(t)).toEqual({ ok: true, dueBy: "2026-11-17", already: true });
  expect((await db.query("SELECT 1 FROM workflow_events WHERE event_type='firm_quote_requested'")).rows).toHaveLength(1);
});
test("switch NULL: Jo's TEST inbox counts as a TEST owner email", async () => {
  expect((await request(await job({ source: "qa_test", email: " JoLowexo@hotmail.com ", created: after }))).ok).toBe(true);
});
test("switch NULL: a TEST job with a real-looking owner email is refused", async () => {
  expect(await request(await job({ source: "qa_test", email: "someone@dcconstructionsolutions.com.au", created: after }))).toEqual({ ok: false, reason: "not_firm_quote" });
});
test("switch NULL: TEST jobs made before the exception started stay legacy", async () => {
  expect(await request(await job({ source: "qa_test", email: "qa.owner@hivic-test.example", created: "2026-11-06T21:29:59Z" }))).toEqual({ ok: false, reason: "not_firm_quote" });
});
test("switch NULL: a TEST job without owner photos is refused", async () => {
  expect(await request(await job({ source: "qa_test", email: "qa.owner@hivic-test.example", created: after, media: false }))).toEqual({ ok: false, reason: "not_firm_quote" });
});
test("switch ON: unchanged — real website enquiries after go-live are accepted, before go-live refused", async () => {
  await db.exec("UPDATE workflow_settings SET firm_quote_flow_live_at='2026-11-06T12:00:00Z'");
  expect((await request(await job({ source: "base44", email: "owner@gmail.com", created: after }))).ok).toBe(true);
  expect(await request(await job({ source: "base44", email: "owner2@gmail.com", created: "2026-11-06T11:00:00Z" }))).toEqual({ ok: false, reason: "not_firm_quote" });
  expect(await request(await job({ source: "installer_portal", email: "owner3@gmail.com", created: after }))).toEqual({ ok: false, reason: "not_firm_quote" });
});
