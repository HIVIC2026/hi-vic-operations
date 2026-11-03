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
