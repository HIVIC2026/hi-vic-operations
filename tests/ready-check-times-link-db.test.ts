// PGlite practice run for migration 0144 (fake TEST data only).
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const refused = async (d: PGlite, q: string) => { try { await d.exec(q); return false; } catch { return true; } };
describe("0144 ready check times link", () => {
  test("allows the new link kind only; existing links untouched; undo restores", async () => {
    const d = new PGlite();
    await d.exec(`CREATE TABLE public.customer_estimate_links (id int primary key, purpose text NOT NULL, CONSTRAINT customer_estimate_links_purpose_check CHECK (purpose = 'step3_estimate'));
      INSERT INTO public.customer_estimate_links VALUES (1, 'step3_estimate');`);
    expect(await refused(d, `INSERT INTO public.customer_estimate_links VALUES (2, 'ready_check_times')`)).toBe(true);
    await d.exec(read("0144_ready_check_times_link.sql"));
    await d.exec(`INSERT INTO public.customer_estimate_links VALUES (2, 'ready_check_times')`);
    expect(await refused(d, `INSERT INTO public.customer_estimate_links VALUES (3, 'anything')`)).toBe(true);
    await d.exec(`DELETE FROM public.customer_estimate_links WHERE id = 2`);
    await d.exec(read("0144_ready_check_times_link.undo.sql"));
    expect((await d.query(`SELECT count(*)::int n FROM public.customer_estimate_links`)).rows[0]).toEqual({ n: 1 });
  });
});
