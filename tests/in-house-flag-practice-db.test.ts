import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

test("pending in-house migration backfills only the old list, defaults billing and undoes cleanly", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE TABLE public.businesses(id uuid primary key, name text, updated_at timestamptz default now());
      CREATE TABLE public.rate_cards(id uuid primary key default gen_random_uuid(),business_id uuid,kind text,name text,version integer,effective_from date,is_active boolean);
      CREATE TABLE public.rate_card_items(id uuid primary key default gen_random_uuid(),rate_card_id uuid REFERENCES public.rate_cards(id),category text,code text,description text,unit text,unit_price_ex_gst numeric,sort integer);
      CREATE TABLE public.workflow_events(job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean,CONSTRAINT workflow_events_job_required CHECK (job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched','email_unmatched_dismissed','email_new_sender_replied','email_nojob_ai_draft','email_nojob_reply_sent','email_nojob_ai_draft_closed','email_nojob_followup_claim','email_nojob_followup_failed','email_nojob_ai_draft_failed'])));
      CREATE TABLE public.admin_config_events(id uuid primary key default gen_random_uuid(),actor_id uuid,event_type text not null,summary text not null,details jsonb not null,created_at timestamptz not null default now());
      INSERT INTO public.businesses VALUES
      ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0','Reinsulate'),
      ('17793408-bf5c-4ddd-9bec-64199f64f9fb','[TEST PARTNER] Reinsulate'),
      ('00000000-0000-0000-0000-000000000001','RAPID INSULATION');`);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner.sql", "utf8"));
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_pays_own_electricians.sql", "utf8"));
    const split = (await db.query<{ name: string; in_house: boolean; pays_own_electricians: boolean }>("SELECT name,in_house,pays_own_electricians FROM businesses ORDER BY name")).rows;
    for (const name of ["Reinsulate", "[TEST PARTNER] Reinsulate"]) expect(split.find(r => r.name === name)).toMatchObject({ in_house: false, pays_own_electricians: true });
    expect(split.find(r => r.name === "RAPID INSULATION")).toMatchObject({ in_house: false, pays_own_electricians: false });
    const splitHistory = (await db.query<{ details: { business_id: string; reason: string }; actor_id: string }>("SELECT details,actor_id::text FROM admin_config_events ORDER BY details->>'business_id'")).rows;
    expect(splitHistory).toHaveLength(2);
    expect(splitHistory.map(r => r.details.business_id).sort()).toEqual(["17793408-bf5c-4ddd-9bec-64199f64f9fb", "a8304d2d-339b-4cbf-bcf1-fb09ce7935b0"]);
    for (const r of splitHistory) { expect(r.details.reason).toBe("split pays-own-electricians from in-house partner"); expect(r.actor_id).toBe("950fa0b6-dc44-49af-a754-6a65f26a661e"); }
    expect((await db.query("SELECT r.is_active,r.kind,r.name,round(i.unit_price_ex_gst,2)::text AS price FROM rate_cards r JOIN rate_card_items i ON i.rate_card_id=r.id")).rows).toEqual([
      { is_active: true, kind: "electrical", name: "In-house PIESA", price: "318.18" }, { is_active: true, kind: "electrical", name: "In-house PIESA", price: "318.18" }
    ]);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_pays_own_electricians.undo.sql", "utf8"));
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='businesses' AND column_name='pays_own_electricians'")).rows).toEqual([]);
    expect((await db.query("SELECT details->>'reason' AS reason FROM admin_config_events WHERE details->>'reason'='undo split pays-own-electricians'")).rows).toHaveLength(2);
    expect((await db.query("SELECT pg_get_functiondef(oid) AS body FROM pg_proc WHERE proname='guard_in_house_partner'")).rows[0]).not.toEqual(expect.objectContaining({ body: expect.stringContaining("hivic.in_house_reason") }));

    const { rows } = await db.query<{ name: string; in_house: boolean; rectification_billed_by: string }>("SELECT name,in_house,rectification_billed_by FROM businesses ORDER BY name");
    expect(rows.find(r => r.name === "Reinsulate")?.in_house).toBe(true);
    expect(rows.find(r => r.name === "[TEST PARTNER] Reinsulate")?.in_house).toBe(true);
    expect(rows.find(r => r.name === "RAPID INSULATION")?.in_house).toBe(false);
    expect(rows.every(r => r.rectification_billed_by === "hivic")).toBe(true);
    expect((await db.query<{ proconfig: string[] }>("SELECT proconfig FROM pg_proc WHERE proname IN ('guard_in_house_partner','save_in_house_partner')")).rows).toEqual([{ proconfig: ["search_path=public, pg_temp"] }, { proconfig: ["search_path=public, pg_temp"] }]);
    expect((await db.query<{ price: string }>("SELECT round(unit_price_ex_gst*1.1,2)::text AS price FROM rate_card_items")).rows).toEqual([{ price: "350.00" }, { price: "350.00" }]);
    await db.exec("SELECT save_in_house_partner('00000000-0000-0000-0000-000000000001',false,'partner','00000000-0000-0000-0000-000000000002')");
    const events = (await db.query<{ actor_id: string; details: { old: { rectification_billed_by: string }; new: { rectification_billed_by: string } } }>("SELECT * FROM admin_config_events WHERE details->>'business_id'='00000000-0000-0000-0000-000000000001'")).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: "in_house_partner_changed", details: { business_id: "00000000-0000-0000-0000-000000000001", old: { in_house: false }, new: { in_house: false } } });
    expect((await db.query("SELECT * FROM workflow_events")).rows).toHaveLength(0);
    expect(events[0]?.actor_id).toBe("00000000-0000-0000-0000-000000000002");
    expect(events[0]?.details.old.rectification_billed_by).toBe("hivic");
    expect(events[0]?.details.new.rectification_billed_by).toBe("partner");
    await db.exec("SELECT save_in_house_partner('00000000-0000-0000-0000-000000000001',false,'partner','00000000-0000-0000-0000-000000000002')");
    expect((await db.query("SELECT * FROM admin_config_events WHERE details->>'business_id'='00000000-0000-0000-0000-000000000001'")).rows).toHaveLength(1);
    await db.exec("GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT,UPDATE ON businesses TO authenticated; SET ROLE authenticated");
    await expect(db.exec("SELECT save_in_house_partner('00000000-0000-0000-0000-000000000001',true,'partner','00000000-0000-0000-0000-000000000002')")).rejects.toThrow("permission denied");
    await expect(db.exec("UPDATE businesses SET in_house=true WHERE name='RAPID INSULATION'")).rejects.toThrow("Only the office");
    await db.exec("RESET ROLE");
    await expect(db.exec("UPDATE businesses SET rectification_billed_by='other'")).rejects.toThrow();
    await db.exec(`INSERT INTO rate_cards(id,business_id,kind,name) VALUES
      ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','electrical','In-house PIESA'),
      ('00000000-0000-0000-0000-000000000004','a8304d2d-339b-4cbf-bcf1-fb09ce7935b0','installation','In-house PIESA');
      INSERT INTO rate_card_items(rate_card_id,code) VALUES ('00000000-0000-0000-0000-000000000003','PIESA'),('00000000-0000-0000-0000-000000000004','PIESA');`);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner.undo.sql", "utf8"));
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='businesses' AND column_name IN ('in_house','in_house_set_at','in_house_set_by','rectification_billed_by')")).rows).toEqual([]);
    expect((await db.query("SELECT * FROM rate_cards WHERE name='In-house PIESA' AND kind='electrical' AND business_id IN ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0','17793408-bf5c-4ddd-9bec-64199f64f9fb')")).rows).toEqual([]);
    expect((await db.query("SELECT rate_card_id::text FROM rate_card_items ORDER BY rate_card_id")).rows).toEqual([{ rate_card_id: "00000000-0000-0000-0000-000000000003" }, { rate_card_id: "00000000-0000-0000-0000-000000000004" }]);
    expect((await db.query("SELECT * FROM rate_cards")).rows).toHaveLength(2);
    expect((await db.query("SELECT tgname FROM pg_trigger WHERE tgname='trg_guard_in_house_partner'")).rows).toEqual([]);
    expect((await db.query("SELECT proname FROM pg_proc WHERE proname IN ('guard_in_house_partner','save_in_house_partner')")).rows).toEqual([]);
    // Permanent office-change history survives rollback; it records a real accepted change.
    expect((await db.query("SELECT * FROM admin_config_events WHERE event_type='in_house_partner_changed'")).rows).toHaveLength(5);
  } finally { await db.close(); }
});

test("follow-up event-table migration preserves trigger saves with the real job constraint", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE TABLE public.businesses(id uuid primary key, name text, updated_at timestamptz default now());
      CREATE TABLE public.rate_cards(id uuid primary key default gen_random_uuid(),business_id uuid,kind text,name text,version integer,effective_from date,is_active boolean);
      CREATE TABLE public.rate_card_items(id uuid primary key default gen_random_uuid(),rate_card_id uuid REFERENCES public.rate_cards(id),category text,code text,description text,unit text,unit_price_ex_gst numeric,sort integer);
      CREATE TABLE public.workflow_events(job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean,CONSTRAINT workflow_events_job_required CHECK (job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched','email_unmatched_dismissed','email_new_sender_replied','email_nojob_ai_draft','email_nojob_reply_sent','email_nojob_ai_draft_closed','email_nojob_followup_claim','email_nojob_followup_failed','email_nojob_ai_draft_failed'])));
      CREATE TABLE public.admin_config_events(id uuid primary key default gen_random_uuid(),actor_id uuid,event_type text not null,summary text not null,details jsonb not null,created_at timestamptz not null default now());
      INSERT INTO public.businesses VALUES
      ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0','Reinsulate'),
      ('17793408-bf5c-4ddd-9bec-64199f64f9fb','[TEST PARTNER] Reinsulate'),
      ('00000000-0000-0000-0000-000000000001','RAPID INSULATION');`);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner.sql", "utf8"));
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner_fix_events_table.sql", "utf8"));
    await db.exec("SELECT save_in_house_partner('00000000-0000-0000-0000-000000000001',true,'partner','00000000-0000-0000-0000-000000000002')");
    expect((await db.query("SELECT actor_id::text,event_type,details FROM admin_config_events")).rows).toEqual([{
      actor_id: "00000000-0000-0000-0000-000000000002", event_type: "in_house_partner_changed",
      details: { business_id: "00000000-0000-0000-0000-000000000001", old: { in_house: false, rectification_billed_by: "hivic" }, new: { in_house: true, rectification_billed_by: "partner" } },
    }]);
    expect((await db.query("SELECT * FROM workflow_events")).rows).toHaveLength(0);
    expect((await db.query("SELECT proconfig FROM pg_proc WHERE proname='guard_in_house_partner'")).rows).toEqual([{ proconfig: ["search_path=public, pg_temp"] }]);
  } finally { await db.close(); }
});
