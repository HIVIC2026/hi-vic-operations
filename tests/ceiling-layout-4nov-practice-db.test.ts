// Practice-DB (PGlite) proof for docs/pending-migrations/ceiling-layout-4nov.sql. Fake data only; never live.
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");

describe("ceiling-layout-4nov.sql on a practice database", () => {
  it("adds blank retail prices, the switch ON by default, refuses $0, and rolls back", async () => {
    const db = new PGlite();
    await db.exec(`CREATE TABLE public.retail_estimator_settings (id serial primary key, is_current boolean, r5_install_inc_gst_per_m2 numeric(10,2) not null);
      CREATE TABLE public.workflow_settings (id int primary key);
      INSERT INTO public.retail_estimator_settings (is_current, r5_install_inc_gst_per_m2) VALUES (true, 30); INSERT INTO public.workflow_settings VALUES (1);`);
    await db.exec(read("ceiling-layout-4nov.sql"));
    await db.exec(read("ceiling-layout-4nov.sql")); // re-run safe
    const r = await db.query<Record<string, unknown>>("select topup_inc_gst_per_m2, r6_install_inc_gst_per_m2, r7_install_inc_gst_per_m2, r5_install_inc_gst_per_m2 from retail_estimator_settings");
    expect(r.rows[0]).toEqual({ topup_inc_gst_per_m2: null, r6_install_inc_gst_per_m2: null, r7_install_inc_gst_per_m2: null, r5_install_inc_gst_per_m2: "30.00" });
    expect((await db.query<{ t: boolean }>("select topups_count_existing_insulation t from workflow_settings")).rows[0]!.t).toBe(true);
    await expect(db.exec("update retail_estimator_settings set topup_inc_gst_per_m2 = 0")).rejects.toThrow();
    await db.exec(read("ceiling-layout-4nov.rollback.sql"));
    expect((await db.query("select column_name from information_schema.columns where column_name like 'topup%'")).rows).toEqual([]);
  });
});

describe("publish_owner_prices with the new retail prices (practice database)", () => {
  it("saves top-up/R6.0/R7.0, keeps blanks blank, carries values forward and refuses $0", async () => {
    const db = new PGlite();
    await db.exec(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`).catch(() => undefined);
    await db.exec(`CREATE TABLE public.retail_estimator_settings (id serial primary key, version integer, is_current boolean, r5_install_inc_gst_per_m2 numeric, removal_inc_gst_per_m2 numeric, piesa_assessment_inc_gst numeric, ap_management_inc_gst numeric, access_standard_multiplier numeric, access_moderate_multiplier numeric, access_difficult_multiplier numeric, indicative_veec_value numeric, veec_value_source_label text, veec_value_source_url text, veec_value_checked_at date, minimum_customer_copayment_inc_gst numeric, spec_version text, spec_source_url text, notes text, created_by uuid, created_at timestamptz default now(), veec_buy_price numeric, max_discount_metro_inc_gst numeric, max_discount_regional_inc_gst numeric);
      CREATE TABLE public.workflow_settings (id int primary key);
      CREATE TABLE public.admin_config_events (id serial primary key, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
      INSERT INTO public.retail_estimator_settings (version, is_current, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst, ap_management_inc_gst) VALUES (1, true, 30, 12, 349, 349);
      INSERT INTO public.workflow_settings VALUES (1);`);
    await db.exec(read("ceiling-layout-4nov.sql"));
    const actor = "00000000-0000-0000-0000-000000000001";
    await db.query("select public.publish_owner_prices($1, $2::jsonb, 'test')", [actor, JSON.stringify({ topup_inc_gst_per_m2: 25 })]);
    let r = (await db.query<Record<string, unknown>>("select version, topup_inc_gst_per_m2, r6_install_inc_gst_per_m2, r7_install_inc_gst_per_m2, r5_install_inc_gst_per_m2 from retail_estimator_settings where is_current")).rows[0]!;
    expect(r).toEqual({ version: 2, topup_inc_gst_per_m2: "25.00", r6_install_inc_gst_per_m2: null, r7_install_inc_gst_per_m2: null, r5_install_inc_gst_per_m2: "30" });
    await db.query("select public.publish_owner_prices($1, $2::jsonb, 'test')", [actor, JSON.stringify({ r6_install_inc_gst_per_m2: 36, r7_install_inc_gst_per_m2: 41 })]);
    r = (await db.query<Record<string, unknown>>("select topup_inc_gst_per_m2, r6_install_inc_gst_per_m2, r7_install_inc_gst_per_m2 from retail_estimator_settings where is_current")).rows[0]!;
    expect(r).toEqual({ topup_inc_gst_per_m2: "25.00", r6_install_inc_gst_per_m2: "36.00", r7_install_inc_gst_per_m2: "41.00" });
    await expect(db.query("select public.publish_owner_prices($1, $2::jsonb, 'test')", [actor, JSON.stringify({ r7_install_inc_gst_per_m2: 0 })])).rejects.toThrow(/above zero/);
  });
});
