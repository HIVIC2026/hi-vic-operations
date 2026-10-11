import { test, expect } from "bun:test"; import { PGlite } from "@electric-sql/pglite"; import { readFileSync } from "node:fs"; import { join } from "node:path";
const MIG = join(import.meta.dir, "..", "docs", "pending-migrations");
test("0122", async () => { const d = new PGlite(); await d.exec("CREATE TABLE public.workflow_settings (id int primary key); INSERT INTO public.workflow_settings VALUES (1);");
 const s = readFileSync(join(MIG, "0122_owner_resign_setting.sql"),"utf8"); await d.exec(s); await d.exec(s);
 const r = await d.query("select owner_resign_after_install v from public.workflow_settings"); expect((r.rows[0] as any).v).toBe(false);
 await d.exec(readFileSync(join(MIG, "0122_owner_resign_setting.rollback.sql"),"utf8")); });
