import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

describe("0137 installer job facts (practice database)", () => {
  test("columns, checks and re-run safety", async () => {
    const db = new PGlite();
    await db.exec("create table public.jobs (id int primary key); insert into public.jobs values (1);");
    const sql = readFileSync("docs/pending-migrations/0137_installer_job_facts.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql); // idempotent
    await db.exec("update public.jobs set installer_site_check='yes', installer_site_check_date='2026-10-03', installer_quoted_price_inc_gst=3200, installer_price_includes='R5 batts 120 m2'");
    const r = (await db.query<{ s: string; p: string }>("select installer_site_check s, installer_quoted_price_inc_gst p from public.jobs")).rows[0]!;
    expect(r.s).toBe("yes"); expect(Number(r.p)).toBe(3200);
    await expect(db.exec("update public.jobs set installer_site_check='maybe'")).rejects.toThrow();
    await expect(db.exec("update public.jobs set installer_quoted_price_inc_gst=0")).rejects.toThrow();
    await db.exec("update public.jobs set installer_site_check=null, installer_quoted_price_inc_gst=null");
  });
});
