// Practice database (PGlite) for 0103 owner price settings. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const ACTOR = "10000000-0000-4000-8000-000000000001";
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.retail_estimator_settings (id uuid primary key default gen_random_uuid(), version int not null, is_current boolean not null default false,
      r5_install_inc_gst_per_m2 numeric, removal_inc_gst_per_m2 numeric, piesa_assessment_inc_gst numeric, ap_management_inc_gst numeric,
      access_standard_multiplier numeric, access_moderate_multiplier numeric, access_difficult_multiplier numeric, indicative_veec_value numeric,
      veec_value_source_label text, veec_value_source_url text, veec_value_checked_at date, minimum_customer_copayment_inc_gst numeric,
      spec_version text, spec_source_url text, notes text, created_by uuid, created_at timestamptz default now());
    CREATE UNIQUE INDEX one_current ON retail_estimator_settings(is_current) WHERE is_current;
    CREATE TABLE public.admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default now());
    INSERT INTO retail_estimator_settings (version, is_current, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst, ap_management_inc_gst, access_standard_multiplier, access_moderate_multiplier, access_difficult_multiplier, notes)
      VALUES (1, true, 30, 15, 349, 349, 1, 1.1, 1.25, 'original');`);
  await db.exec(read("0103_owner_price_settings.sql"));
});
describe("0103 owner prices (practice database)", () => {
  test("existing row keeps its prices; buy price starts at $70; rerun safe", async () => {
    await db.exec(read("0103_owner_price_settings.sql"));
    expect((await db.query(`SELECT r5_install_inc_gst_per_m2::int r5, notes, veec_buy_price::int b FROM retail_estimator_settings`)).rows).toEqual([{ r5: 30, notes: "original", b: 70 }]);
  });
  test("a change publishes a new version with history; old version keeps its values", async () => {
    const r = await db.query<{ v: number }>(`SELECT public.publish_owner_prices($1, '{"r5_install_inc_gst_per_m2": 32, "veec_buy_price": 72}', 'TEST new rates') v`, [ACTOR]);
    expect(r.rows[0].v).toBe(2);
    const rows = (await db.query(`SELECT version, is_current, r5_install_inc_gst_per_m2::int r5, removal_inc_gst_per_m2::int rem, veec_buy_price::int b, created_by FROM retail_estimator_settings ORDER BY version`)).rows;
    expect(rows).toEqual([{ version: 1, is_current: false, r5: 30, rem: 15, b: 70, created_by: null }, { version: 2, is_current: true, r5: 32, rem: 15, b: 72, created_by: ACTOR }]);
    expect((await db.query(`SELECT actor_id, event_type, details->>'reason' reason FROM admin_config_events`)).rows).toEqual([{ actor_id: ACTOR, event_type: "owner_prices_changed", reason: "TEST new rates" }]);
  });
  test("bad changes refused and nothing changes", async () => {
    for (const bad of [`'{"r5_install_inc_gst_per_m2": 0}', 'ok reason'`, `'{"margin": 5}', 'ok reason'`, `'{"access_moderate_multiplier": 0.9}', 'ok reason'`, `'{"r5_install_inc_gst_per_m2": 31}', ''`])
      await expect(db.query(`SELECT public.publish_owner_prices('${ACTOR}', ${bad})`)).rejects.toThrow();
    expect((await db.query(`SELECT count(*)::int n FROM retail_estimator_settings`)).rows).toEqual([{ n: 1 }]);
  });
  test("signed-in users cannot call it directly", async () => {
    await db.exec(`SET ROLE authenticated`);
    await expect(db.query(`SELECT public.publish_owner_prices('${ACTOR}', '{"r5_install_inc_gst_per_m2": 31}', 'reason')`)).rejects.toThrow();
  });
  test("undo removes only the new parts", async () => {
    await db.exec(read("0103_owner_price_settings.rollback.sql"));
    expect((await db.query(`SELECT count(*)::int n, max(r5_install_inc_gst_per_m2)::int r5 FROM retail_estimator_settings`)).rows).toEqual([{ n: 1, r5: 30 }]);
  });
});
