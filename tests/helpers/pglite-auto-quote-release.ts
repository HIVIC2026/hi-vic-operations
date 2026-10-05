import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`../../docs/pending-migrations/${name}`, import.meta.url), "utf8");

const db = new PGlite();
await db.exec(`
  CREATE TABLE public.workflow_settings (id integer primary key, auto_send_quote boolean not null default false, customer_comms_enabled boolean not null default false);
  CREATE TABLE public.quotes (id uuid primary key default gen_random_uuid());
  INSERT INTO public.workflow_settings (id) VALUES (1);
`);
await db.exec(read("0114_auto_quote_release.sql"));
const settings = (await db.query<Record<string, unknown>>(`SELECT * FROM public.workflow_settings WHERE id = 1`)).rows[0];
if (settings?.quote_estimate_variance_tolerance_pct !== "15.00" || settings.installer_quote_min_inc_gst_per_m2 !== null || settings.installer_quote_max_inc_gst_per_m2 !== null) throw new Error("defaults did not apply safely");
await db.exec(`INSERT INTO public.quotes (release_state, release_hold_reason) VALUES ('queued', NULL), ('held', 'Quote held: TEST')`);
try {
  await db.exec(`INSERT INTO public.quotes (release_state) VALUES ('invalid')`);
  throw new Error("invalid release state was accepted");
} catch (error) {
  if (error instanceof Error && error.message === "invalid release state was accepted") throw error;
}
await db.exec(read("0114_auto_quote_release.undo.sql"));
const remaining = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='quotes' AND column_name LIKE 'release_%') OR (table_name='workflow_settings' AND column_name LIKE 'quote_estimate_%'))`);
if (remaining.rows.length) throw new Error("undo left release columns behind");
console.log("PASS: migration, safe defaults, constraints, and undo verified on practice database");