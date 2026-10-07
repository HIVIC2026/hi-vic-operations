import { describe, expect, test } from "bun:test";
import { chunkRows, readInChunks, readingProgress, rowRangeLabel } from "../src/lib/bulk-import.core";
const rows = Array.from({ length: 200 }, (_, i) => ({ n: String(i + 1) }));
const noWait = async () => {};
describe("large uploads read in chunks", () => {
  test("200 rows split into 8 chunks of 25 with row numbers", () => {
    const c = chunkRows(rows);
    expect(c.length).toBe(8); expect(c[4]).toMatchObject({ from: 101, to: 125 });
    expect(rowRangeLabel(c[4]!)).toBe("Rows 101–125"); expect(readingProgress(200, 120)).toBe("Reading 200 customers… 120 done");
  });
  test("a chunk that fails once is retried and nothing is lost; progress reaches 200", async () => {
    let failedOnce = false; const seen: number[] = [];
    const r = await readInChunks(chunkRows(rows), async (c) => { if (c.from === 51 && !failedOnce) { failedOnce = true; throw new Error("timeout"); } return c.rows; }, { wait: noWait, onDone: (n) => seen.push(n) });
    expect(r.leads.length).toBe(200); expect(r.failed.length).toBe(0); expect(seen.at(-1)).toBe(200);
  });
  test("a chunk that keeps failing is reported by its rows; the rest is kept", async () => {
    const r = await readInChunks(chunkRows(rows), async (c) => { if (c.from === 101) throw new Error("rate limited"); return c.rows; }, { wait: noWait });
    expect(r.leads.length).toBe(175); expect(r.failed.map(rowRangeLabel)).toEqual(["Rows 101–125"]);
    const again = await readInChunks(r.failed, async (c) => c.rows, { wait: noWait });
    expect(again.leads.length).toBe(25); expect(again.failed.length).toBe(0);
  });
});
