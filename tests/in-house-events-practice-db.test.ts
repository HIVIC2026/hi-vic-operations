import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

test("backfill history has exact fields, is idempotent and its undo is scoped", async () => {
  const db = new PGlite();
  const ids = ["a8304d2d-339b-4cbf-bcf1-fb09ce7935b0", "17793408-bf5c-4ddd-9bec-64199f64f9fb"];
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE TABLE businesses(id uuid primary key, name text, updated_at timestamptz default now());
      CREATE TABLE rate_cards(id uuid primary key default gen_random_uuid(),business_id uuid,kind text,name text,version integer,effective_from date,is_active boolean);
      CREATE TABLE rate_card_items(id uuid primary key default gen_random_uuid(),rate_card_id uuid,category text,code text,description text,unit text,unit_price_ex_gst numeric,sort integer);
      CREATE TABLE workflow_events(job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean);
      INSERT INTO businesses(id,name) VALUES ('${ids[0]}','Reinsulate'),('${ids[1]}','[TEST PARTNER] Reinsulate');`);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner.sql", "utf8"));
    const sql = readFileSync("docs/pending-migrations/2026-10-30_in_house_partner_events.sql", "utf8");
    await db.exec(sql);
    const rows = (await db.query<{ job_id: null; actor_id: null; internal: boolean; summary: string; details: Record<string, unknown> }>("SELECT * FROM workflow_events WHERE event_type='in_house_partner_backfilled' ORDER BY details->>'business_id'")).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const id = String(row.details.business_id);
      expect(ids).toContain(id);
      expect(row).toMatchObject({ job_id: null, actor_id: null, internal: true, summary: "In-house partner flag set for existing in-house partner" });
      expect(row.details).toEqual({ business_id: id, business_name: id === ids[0] ? "Reinsulate" : "[TEST PARTNER] Reinsulate", old: { in_house: false }, new: { in_house: true, rectification_billed_by: "hivic" }, reason: "backfill from the previous hard-coded list" });
    }
    await db.exec(sql);
    expect((await db.query("SELECT * FROM workflow_events")).rows).toHaveLength(2);
    await db.exec(`INSERT INTO workflow_events(event_type,details) VALUES ('in_house_partner_changed','{"business_id":"${ids[0]}"}'),('in_house_partner_backfilled','{"business_id":"other"}')`);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner_events.undo.sql", "utf8"));
    expect((await db.query("SELECT * FROM workflow_events WHERE event_type='in_house_partner_backfilled' AND details->>'business_id'=ANY($1)", [ids])).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM workflow_events")).rows).toHaveLength(2);
  } finally { await db.close(); }
});