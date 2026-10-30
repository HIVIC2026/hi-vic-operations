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
      CREATE TABLE public.workflow_events(job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean,CONSTRAINT workflow_events_job_required CHECK (job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched','email_unmatched_dismissed','email_new_sender_replied','email_nojob_ai_draft','email_nojob_reply_sent','email_nojob_ai_draft_closed','email_nojob_followup_claim','email_nojob_followup_failed','email_nojob_ai_draft_failed'])));
      CREATE TABLE public.admin_config_events(id uuid primary key default gen_random_uuid(),actor_id uuid,event_type text not null,summary text not null,details jsonb not null,created_at timestamptz not null default now());
      INSERT INTO businesses(id,name) VALUES ('${ids[0]}','Reinsulate'),('${ids[1]}','[TEST PARTNER] Reinsulate');`);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner.sql", "utf8"));
    const sql = readFileSync("docs/pending-migrations/2026-10-30_in_house_partner_events.sql", "utf8");
    await db.exec(sql);
    const rows = (await db.query<{ actor_id: null; summary: string; details: Record<string, unknown> }>("SELECT * FROM admin_config_events WHERE event_type='in_house_partner_backfilled' ORDER BY details->>'business_id'")).rows;
    expect(rows).toHaveLength(2);
    expect((await db.query("SELECT * FROM workflow_events")).rows).toHaveLength(0);
    for (const row of rows) {
      const id = String(row.details.business_id);
      expect(ids).toContain(id);
      expect(row).toMatchObject({ actor_id: null, summary: "In-house partner flag set for existing in-house partner" });
      expect(row.details).toEqual({ business_id: id, business_name: id === ids[0] ? "Reinsulate" : "[TEST PARTNER] Reinsulate", old: { in_house: false }, new: { in_house: true, rectification_billed_by: "hivic" }, reason: "backfill from the previous hard-coded list" });
    }
    await db.exec(sql);
    expect((await db.query("SELECT * FROM admin_config_events")).rows).toHaveLength(2);
    await db.exec(`INSERT INTO admin_config_events(event_type,summary,details) VALUES ('in_house_partner_changed','Unrelated accepted change','{"business_id":"${ids[0]}"}'),('in_house_partner_backfilled','Unrelated backfill','{"business_id":"other"}')`);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner_events.undo.sql", "utf8"));
    expect((await db.query("SELECT * FROM admin_config_events WHERE event_type='in_house_partner_backfilled' AND details->>'business_id'=ANY($1)", [ids])).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM admin_config_events")).rows).toHaveLength(2);
  } finally { await db.close(); }
});