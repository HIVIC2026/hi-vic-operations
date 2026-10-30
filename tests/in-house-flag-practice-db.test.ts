import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

test("pending in-house migration backfills only the old list, defaults billing and undoes cleanly", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.businesses(id uuid primary key, name text);
      INSERT INTO public.businesses VALUES
      ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0','Reinsulate'),
      ('17793408-bf5c-4ddd-9bec-64199f64f9fb','[TEST PARTNER] Reinsulate'),
      ('00000000-0000-0000-0000-000000000001','RAPID INSULATION');`);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner.sql", "utf8"));
    const { rows } = await db.query<{ name: string; in_house: boolean; rectification_billed_by: string }>("SELECT name,in_house,rectification_billed_by FROM businesses ORDER BY name");
    expect(rows.find(r => r.name === "Reinsulate")?.in_house).toBe(true);
    expect(rows.find(r => r.name === "[TEST PARTNER] Reinsulate")?.in_house).toBe(true);
    expect(rows.find(r => r.name === "RAPID INSULATION")?.in_house).toBe(false);
    expect(rows.every(r => r.rectification_billed_by === "hivic")).toBe(true);
    await expect(db.exec("UPDATE businesses SET rectification_billed_by='other'")).rejects.toThrow();
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner.undo.sql", "utf8"));
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='businesses' AND column_name IN ('in_house','in_house_set_at','in_house_set_by','rectification_billed_by')")).rows).toEqual([]);
  } finally { await db.close(); }
});