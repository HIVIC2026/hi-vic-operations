// PGlite practice run for migration 0143 (fake TEST data only).
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
describe("0143 installer quoted answer", () => {
  test("backfills priced jobs to Yes, leaves others waiting; Yes needs a price; undo removes it", async () => {
    const d = new PGlite();
    await d.exec(`CREATE TABLE public.jobs (id int primary key, channel text, installer_quoted_price_inc_gst numeric);
      INSERT INTO public.jobs VALUES (1, 'installer_sourced', 3187.55), (2, 'installer_sourced', null), (3, 'hivic_sourced', 500);`);
    await d.exec(read("0143_installer_quoted.sql"));
    expect((await d.query(`SELECT id, installer_quoted q FROM public.jobs ORDER BY id`)).rows).toEqual([{ id: 1, q: "yes" }, { id: 2, q: null }, { id: 3, q: null }]);
    const refused = async (q: string) => { try { await d.exec(q); return false; } catch { return true; } };
    expect(await refused(`UPDATE public.jobs SET installer_quoted = 'maybe' WHERE id = 2`)).toBe(true);
    expect(await refused(`UPDATE public.jobs SET installer_quoted = 'yes' WHERE id = 2`)).toBe(true);
    await d.exec(`UPDATE public.jobs SET installer_quoted = 'no' WHERE id = 2`);
    await d.exec(read("0143_installer_quoted.undo.sql"));
    expect((await d.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='jobs' AND column_name='installer_quoted'`)).rows[0]).toEqual({ n: 0 });
  });
});
