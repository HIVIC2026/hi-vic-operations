import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`../../docs/pending-migrations/${name}`, import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`CREATE TABLE public.workflow_settings (id integer primary key); INSERT INTO public.workflow_settings (id) VALUES (1);`);
await db.exec(read("0117_owner_copy_season.sql"));
const row = (await db.query<{ owner_copy_season: string }>(`SELECT owner_copy_season FROM public.workflow_settings WHERE id = 1`)).rows[0];
if (row?.owner_copy_season !== "summer") throw new Error("default is not summer");
await db.exec(`UPDATE public.workflow_settings SET owner_copy_season = 'winter' WHERE id = 1`);
let rejected = false;
try { await db.exec(`UPDATE public.workflow_settings SET owner_copy_season = 'spring' WHERE id = 1`); } catch { rejected = true; }
if (!rejected) throw new Error("invalid season accepted");
await db.exec(read("0117_owner_copy_season.rollback.sql"));
const left = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name='workflow_settings' AND column_name='owner_copy_season'`);
if (left.rows.length) throw new Error("undo left column behind");
console.log("PASS: season setting default summer, constraint and undo verified on practice database");
