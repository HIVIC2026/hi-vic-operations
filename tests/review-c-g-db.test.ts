// Practice database (PGlite, in memory, fake data only) proof for review items C (0126) and G (0127).
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const BASE = `
CREATE ROLE authenticated; CREATE ROLE anon;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE quote_status AS ENUM ('draft','issued','accepted','declined','superseded','expired');
CREATE TYPE quote_kind AS ENUM ('installation','rectification');
CREATE TYPE assignment_role AS ENUM ('electrician','installer','property_manager');
CREATE TYPE job_stage AS ENUM ('new_enquiry','complete','cancelled');
CREATE TABLE jobs (id uuid primary key, owner uuid, stage job_stage default 'new_enquiry', installation_completed_at timestamptz);
CREATE TABLE asg (job_id uuid, user_id uuid, role assignment_role);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind quote_kind, status quote_status, customer_total_inc_gst numeric, veec_discount_inc_gst numeric);
CREATE TABLE quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, description text, quantity numeric, sort int, line_total_inc_gst numeric);
CREATE FUNCTION is_job_owner(_j uuid, _u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM jobs WHERE id=_j AND owner=_u) $$;
CREATE FUNCTION job_assignment_role(_j uuid, _u uuid) RETURNS assignment_role LANGUAGE sql STABLE AS $$ SELECT role FROM asg WHERE job_id=_j AND user_id=_u LIMIT 1 $$;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY; GRANT SELECT ON quotes, quote_items, jobs, asg TO authenticated;
CREATE POLICY quote_visibility ON quotes FOR SELECT TO authenticated USING (true);
CREATE TABLE workflow_settings (piesa_install_window_days int, urgency_red_days int, urgency_amber_days int);
CREATE TABLE piesa_records (job_id uuid, completed_date date, outcome text, is_current boolean);
`;
const J = "11111111-1111-1111-1111-111111111111", OWNER = "22222222-2222-2222-2222-222222222222", INST = "33333333-3333-3333-3333-333333333333";
test("C: trades can't select quote rows; scope function returns lines without prices; undo restores", async () => {
  const db = new PGlite(); await db.exec(BASE);
  await db.exec(`INSERT INTO jobs (id, owner) VALUES ('${J}','${OWNER}'); INSERT INTO asg VALUES ('${J}','${INST}','installer');
    INSERT INTO quotes (id, job_id, kind, status, customer_total_inc_gst, veec_discount_inc_gst) VALUES ('44444444-4444-4444-4444-444444444444','${J}','installation','accepted',3178,1120);
    INSERT INTO quote_items (quote_id, description, quantity, sort, line_total_inc_gst) VALUES ('44444444-4444-4444-4444-444444444444','R5.0 ceiling batts',120,1,3600);`);
  await db.exec(read("0126_trade_quote_scope.sql"));
  const as = async (u: string, sql: string) => { await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${u}',false)`); const r = await db.query(sql); await db.exec("RESET ROLE"); return r.rows; };
  expect((await as(INST, "SELECT * FROM quotes")).length).toBe(0);
  expect((await as(OWNER, "SELECT * FROM quotes")).length).toBe(1);
  const scope = await as(INST, `SELECT * FROM trade_quote_scope('${J}')`);
  expect(scope.length).toBe(1);
  expect(Object.keys(scope[0] as object).sort()).toEqual(["description", "quantity", "quote_kind", "quote_status", "sort"]);
  expect((await as(OWNER, `SELECT * FROM trade_quote_scope('${J}')`)).length).toBe(0);
  await db.exec(read("0126_trade_quote_scope.rollback.sql"));
  expect((await as(INST, "SELECT * FROM quotes")).length).toBe(1);
});
test("G: PIESA countdown follows the Melbourne date; undo restores", async () => {
  const db = new PGlite(); await db.exec(BASE);
  await db.exec(`SET TIME ZONE 'UTC'; INSERT INTO workflow_settings VALUES (30, 5, 10); INSERT INTO jobs (id) VALUES ('${J}');`);
  // Completed "yesterday" in Melbourne terms
  await db.exec(`INSERT INTO piesa_records VALUES ('${J}', ((now() AT TIME ZONE 'Australia/Melbourne')::date - 1), 'pass', true)`);
  await db.exec(read("0127_melbourne_piesa_dates.sql"));
  const r = (await db.query<{ days_remaining: number }>("SELECT days_remaining FROM job_piesa_deadlines")).rows[0]!;
  expect(Number(r.days_remaining)).toBe(29);
  await db.exec(read("0127_melbourne_piesa_dates.rollback.sql"));
  const r2 = (await db.query<{ days_remaining: number }>("SELECT days_remaining FROM job_piesa_deadlines")).rows[0]!;
  expect(Number.isFinite(Number(r2.days_remaining))).toBe(true);
});
