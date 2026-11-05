// apply_quote_adjustment (docs/pending-migrations/apply-quote-adjustment.sql) proven on a throwaway in-process database.
import { describe, expect, test } from "bun:test";
import { QA, QUOTE_ADJUST_ROLLBACK_SQL, callAdjust, quoteAdjustDb } from "./helpers/pglite-quote-adjust";

const state = async (db: Awaited<ReturnType<typeof quoteAdjustDb>>) => ({
  q: (await db.query<any>(`SELECT status, version, subtotal_inc_gst::float AS sub, customer_total_inc_gst::float AS total, manually_adjusted, release_state, release_hold_reason, sent_at FROM public.quotes`)).rows[0],
  items: (await db.query<any>(`SELECT line_total_inc_gst::float AS t FROM public.quote_items ORDER BY sort`)).rows.map((r) => r.t),
  adj: (await db.query<any>(`SELECT reason, before_snapshot, after_snapshot FROM public.quote_adjustments`)).rows,
});

describe("apply_quote_adjustment", () => {
  test("saves the lines, the totals, the version and the adjustment record together", async () => {
    const db = await quoteAdjustDb();
    const r = (await callAdjust(db)).rows[0]!.r;
    expect(r.ok).toBe(true);
    const s = await state(db);
    expect(s.items).toEqual([2200, 1000]);
    expect(s.q).toMatchObject({ sub: 3200, total: 1730, version: 2, manually_adjusted: true, status: "issued" });
    expect(s.adj).toHaveLength(1);
    expect(s.adj[0].before_snapshot).toEqual({ old: true });
    expect(s.adj[0].after_snapshot.version).toBe(2);
    expect(s.adj[0].after_snapshot.quote_items.map((i: any) => Number(i.line_total_inc_gst))).toEqual([2200, 1000]);
    expect(r.after.version).toBe(2);
  });
  test("applies the held/draft release change in the same save", async () => {
    const db = await quoteAdjustDb();
    await callAdjust(db, { release: { status: "draft", release_state: "held", release_hold_reason: "Adjusted after sending — office must re-approve", sent_at: null } });
    expect((await state(db)).q).toMatchObject({ status: "draft", release_state: "held", sent_at: null, release_hold_reason: "Adjusted after sending — office must re-approve" });
  });
  test("a failing quote_adjustments insert rolls back the lines and the totals", async () => {
    const db = await quoteAdjustDb();
    await db.exec(`CREATE FUNCTION public.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced adjustment failure'; END $$;
      CREATE TRIGGER boom BEFORE INSERT ON public.quote_adjustments FOR EACH ROW EXECUTE FUNCTION public.boom();`);
    await expect(callAdjust(db)).rejects.toThrow("forced adjustment failure");
    const s = await state(db);
    expect(s.items).toEqual([2000, 1000]);
    expect(s.q).toMatchObject({ sub: 3000, total: 1530, version: 1, manually_adjusted: false });
    expect(s.adj).toHaveLength(0);
  });
  test("a stale version raises version_conflict and changes nothing", async () => {
    const db = await quoteAdjustDb();
    await expect(callAdjust(db, { version: 7 })).rejects.toThrow("version_conflict");
    const s = await state(db);
    expect(s.items).toEqual([2000, 1000]);
    expect(s.q.version).toBe(1);
    expect(s.adj).toHaveLength(0);
  });
  test("a line that is not on the quote rolls everything back", async () => {
    const db = await quoteAdjustDb();
    await expect(callAdjust(db, { items: [{ id: "20000000-0000-4000-8000-0000000000ff", quantity: 1, unit_price_inc_gst: 1, line_total_inc_gst: 1 }] })).rejects.toThrow("quote_item_not_found");
    expect((await state(db)).q.version).toBe(1);
  });
  test("rollback file removes the function", async () => {
    const db = await quoteAdjustDb();
    await db.exec(QUOTE_ADJUST_ROLLBACK_SQL);
    await expect(callAdjust(db)).rejects.toThrow();
  });
});
