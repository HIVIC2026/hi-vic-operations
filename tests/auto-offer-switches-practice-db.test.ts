import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Decision 246: the two automatic-offer switches are OFF by default and the migration is idempotent (the Settings
// build may add the same columns first). Proven on the practice database before any live run.
const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");

test("switches default OFF, re-applying is a no-op, rollback removes them", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE public.workflow_settings (id integer primary key, offer_dispatch_mode text not null default 'office_picks'); INSERT INTO public.workflow_settings (id) VALUES (1);`);
  await db.exec(read("auto-offer-switches.sql"));
  await db.exec(read("auto-offer-switches.sql"));
  const row = (await db.query<Record<string, unknown>>(`SELECT auto_installer_offers, auto_electrician_offers FROM public.workflow_settings WHERE id = 1`)).rows[0]!;
  expect(row).toEqual({ auto_installer_offers: false, auto_electrician_offers: false });
  await expect(db.exec(`UPDATE public.workflow_settings SET auto_installer_offers = NULL`)).rejects.toThrow();
  await db.exec(`UPDATE public.workflow_settings SET auto_installer_offers = true`);
  await db.exec(read("auto-offer-switches.sql")); // never resets a switch Jo turned on
  expect((await db.query<{ v: boolean }>(`SELECT auto_installer_offers v FROM public.workflow_settings`)).rows[0]!.v).toBe(true);
  await db.exec(read("auto-offer-switches.rollback.sql"));
  const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'workflow_settings' AND column_name LIKE 'auto_%'`);
  expect(cols.rows).toEqual([]);
  await db.close();
});

test("columns added first by another migration (same names) are left as they are", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE public.workflow_settings (id integer primary key, auto_installer_offers boolean not null default false, auto_electrician_offers boolean not null default false);
    INSERT INTO public.workflow_settings (id, auto_electrician_offers) VALUES (1, true);`);
  await db.exec(read("auto-offer-switches.sql"));
  expect((await db.query<{ v: boolean }>(`SELECT auto_electrician_offers v FROM public.workflow_settings`)).rows[0]!.v).toBe(true);
  await db.close();
});
