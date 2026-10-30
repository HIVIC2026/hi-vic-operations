import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

test("pending in-house migration backfills only the old list, defaults billing and undoes cleanly", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.businesses(id uuid primary key, name text, updated_at timestamptz default now());
      CREATE TABLE public.rate_cards(id uuid primary key default gen_random_uuid(),business_id uuid,kind text,name text,version integer,effective_from date,is_active boolean);
      CREATE TABLE public.rate_card_items(id uuid primary key default gen_random_uuid(),rate_card_id uuid,category text,code text,description text,unit text,unit_price_ex_gst numeric,sort integer);
      CREATE TABLE public.workflow_events(actor_id uuid,event_type text,summary text,details jsonb,internal boolean);
      INSERT INTO public.businesses VALUES
      ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0','Reinsulate'),
      ('17793408-bf5c-4ddd-9bec-64199f64f9fb','[TEST PARTNER] Reinsulate'),
      ('00000000-0000-0000-0000-000000000001','RAPID INSULATION');`);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner.sql", "utf8"));
    const { rows } = await db.query<{ name: string; in_house: boolean; rectification_billed_by: string }>("SELECT name,in_house,rectification_billed_by FROM businesses ORDER BY name");
    expect(rows.find(r => r.name === "Reinsulate")?.in_house).toBe(true);
    expect(rows.find(r => r.name === "[TEST PARTNER] Reinsulate")?.in_house).toBe(true);
    expect(rows.find(r => r.name === "RAPID INSULATION")?.in_house).toBe(false);
    expect(rows.every(r => r.rectification_billed_by === "hivic")).toBe(true);
    expect((await db.query<{ price: string }>("SELECT round(unit_price_ex_gst*1.1,2)::text AS price FROM rate_card_items")).rows).toEqual([{ price: "350.00" }, { price: "350.00" }]);
    await db.exec("SELECT save_in_house_partner('00000000-0000-0000-0000-000000000001',false,'partner','00000000-0000-0000-0000-000000000002')");
    const events = (await db.query<{ actor_id: string; details: { old: { rectification_billed_by: string }; new: { rectification_billed_by: string } } }>("SELECT * FROM workflow_events")).rows;
    expect(events).toHaveLength(1);
    expect(events[0]?.actor_id).toBe("00000000-0000-0000-0000-000000000002");
    expect(events[0]?.details.old.rectification_billed_by).toBe("hivic");
    expect(events[0]?.details.new.rectification_billed_by).toBe("partner");
    await db.exec("SELECT save_in_house_partner('00000000-0000-0000-0000-000000000001',false,'partner','00000000-0000-0000-0000-000000000002')");
    expect((await db.query("SELECT * FROM workflow_events")).rows).toHaveLength(1);
    await db.exec("GRANT USAGE ON SCHEMA public TO authenticated; SET ROLE authenticated");
    await expect(db.exec("SELECT save_in_house_partner('00000000-0000-0000-0000-000000000001',true,'partner','00000000-0000-0000-0000-000000000002')")).rejects.toThrow("permission denied");
    await db.exec("RESET ROLE");
    await expect(db.exec("UPDATE businesses SET rectification_billed_by='other'")).rejects.toThrow();
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner.undo.sql", "utf8"));
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='businesses' AND column_name IN ('in_house','in_house_set_at','in_house_set_by','rectification_billed_by')")).rows).toEqual([]);
  } finally { await db.close(); }
});