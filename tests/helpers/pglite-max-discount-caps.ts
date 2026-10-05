// Practice-DB proof for migration 0109 (max discount caps) on throwaway PGlite. Fake TEST data only.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const SQL = read("0109_max_discount_caps.sql");
const ROLLBACK = read("0109_max_discount_caps.rollback.sql");
const OFFICE = "00000000-0000-4000-8000-0000000000a1";
const run = async () => {
  const db = new PGlite();
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.retail_estimator_settings (
  id uuid primary key default gen_random_uuid(), version integer not null, is_current boolean not null default false,
  r5_install_inc_gst_per_m2 numeric(10,2) not null, removal_inc_gst_per_m2 numeric(10,2) not null,
  piesa_assessment_inc_gst numeric(10,2) not null, ap_management_inc_gst numeric(10,2) not null,
  access_standard_multiplier numeric(6,3) not null default 1, access_moderate_multiplier numeric(6,3) not null default 1.1,
  access_difficult_multiplier numeric(6,3) not null default 1.25, indicative_veec_value numeric(10,2) not null default 70,
  veec_value_source_label text, veec_value_source_url text, veec_value_checked_at date,
  minimum_customer_copayment_inc_gst numeric(10,2) not null default 200,
  spec_version text, spec_source_url text, notes text, created_by uuid, veec_buy_price numeric(10,2) not null default 70);
CREATE TABLE public.admin_config_events (id bigint generated always as identity primary key, actor_id uuid, event_type text, summary text, details jsonb);
INSERT INTO public.retail_estimator_settings (version, is_current, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst, ap_management_inc_gst, created_by)
  VALUES (1, true, 30, 15, 349, 349, '${OFFICE}');
`);
  let pass = 0, fail = 0;
  const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); ok ? pass++ : fail++; };

  // 1) Migration applies; existing row picks up defaults untouched otherwise.
  await db.exec(SQL);
  const cur = (await db.query(`SELECT * FROM public.retail_estimator_settings WHERE is_current`)).rows[0] as any;
  check("existing row keeps values, gains caps 1500/2100", cur.r5_install_inc_gst_per_m2 === "30.00" && cur.max_discount_metro_inc_gst === "1500.00" && cur.max_discount_regional_inc_gst === "2100.00");

  // 2) publish_owner_prices accepts the new keys and versions forward.
  const v2 = await db.query(`SELECT public.publish_owner_prices('${OFFICE}', '{"max_discount_metro_inc_gst": 1600}'::jsonb, 'TEST raise metro cap') as v`);
  const row2 = (await db.query(`SELECT * FROM public.retail_estimator_settings WHERE is_current`)).rows[0] as any;
  check("publish new cap keeps other prices", (v2.rows[0] as any).v === 2 && row2.max_discount_metro_inc_gst === "1600.00" && row2.max_discount_regional_inc_gst === "2100.00" && row2.r5_install_inc_gst_per_m2 === "30.00");
  const ev = (await db.query(`SELECT * FROM public.admin_config_events`)).rows[0] as any;
  check("change history recorded with reason", ev.event_type === "owner_prices_changed" && ev.details.reason === "TEST raise metro cap");

  // 3) Old keys still work alongside.
  await db.query(`SELECT public.publish_owner_prices('${OFFICE}', '{"r5_install_inc_gst_per_m2": 31, "max_discount_regional_inc_gst": 2200}'::jsonb, 'TEST both kinds')`);
  const row3 = (await db.query(`SELECT * FROM public.retail_estimator_settings WHERE is_current`)).rows[0] as any;
  check("mixed change carries caps forward", row3.r5_install_inc_gst_per_m2 === "31.00" && row3.max_discount_metro_inc_gst === "1600.00" && row3.max_discount_regional_inc_gst === "2200.00");

  // 4) Unknown keys and non-positive caps refused.
  const bad = async (sql: string) => { try { await db.query(sql); return false; } catch { return true; } };
  check("unknown key refused", await bad(`SELECT public.publish_owner_prices('${OFFICE}', '{"nope": 5}'::jsonb, 'TEST bad key')`));
  check("zero cap refused", await bad(`SELECT public.publish_owner_prices('${OFFICE}', '{"max_discount_metro_inc_gst": 0}'::jsonb, 'TEST zero cap')`));
  check("missing reason refused", await bad(`SELECT public.publish_owner_prices('${OFFICE}', '{"max_discount_metro_inc_gst": 1700}'::jsonb, '')`));

  // 5) Rollback restores the 0103 function shape and drops the columns.
  await db.exec(ROLLBACK);
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='retail_estimator_settings' AND column_name LIKE 'max_discount%'`)).rows;
  check("rollback drops cap columns", cols.length === 0);
  check("rollback refuses new keys again", await bad(`SELECT public.publish_owner_prices('${OFFICE}', '{"max_discount_metro_inc_gst": 1500}'::jsonb, 'TEST after rollback')`));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run();
