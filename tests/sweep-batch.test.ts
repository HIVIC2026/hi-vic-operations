// Pure helpers behind the batched tick sweeps (perf 25 Oct 2026) and the completion-pack "paid in full" rule.
import { describe, expect, test } from "bun:test";
import { chunkIds, groupByJob, latestPerJob, stepsForRecord, SWEEP_ID_CHUNK } from "@/lib/sweep-batch.core";
import { invoiceFullyPaid } from "@/lib/completion-pack.core";

describe("sweep-batch.core", () => {
  test("chunkIds keeps order and bounds every chunk", () => {
    const ids = Array.from({ length: 401 }, (_, i) => `j${i}`);
    const c = chunkIds(ids);
    expect(c.map((x) => x.length)).toEqual([SWEEP_ID_CHUNK, SWEEP_ID_CHUNK, 401 - 2 * SWEEP_ID_CHUNK]);
    expect(c.flat()).toEqual(ids);
    expect(chunkIds([])).toEqual([]);
  });
  test("groupByJob drops rows without a job and keeps row order", () => {
    const m = groupByJob([{ job_id: "a", n: 1 }, { job_id: null, n: 2 }, { job_id: "a", n: 3 }, { job_id: "b", n: 4 }]);
    expect([...m.keys()]).toEqual(["a", "b"]);
    expect(m.get("a")!.map((r) => r.n)).toEqual([1, 3]);
  });
  test("latestPerJob = order by created_at desc limit 1 per job (first wins a tie)", () => {
    const m = latestPerJob([
      { job_id: "a", created_at: "2026-10-01T00:00:00Z", id: "old" },
      { job_id: "a", created_at: "2026-10-03T00:00:00Z", id: "new" },
      { job_id: "a", created_at: "2026-10-02T00:00:00Z", id: "mid" },
      { job_id: "b", created_at: "2026-10-01T00:00:00Z", id: "b1" },
      { job_id: "b", created_at: "2026-10-01T00:00:00Z", id: "b2" },
    ]);
    expect(m.get("a")!.id).toBe("new");
    expect(m.get("b")!.id).toBe("b1");
  });
  test("stepsForRecord only counts steps of THAT record (a re-done PIESA starts again)", () => {
    const ev = [
      { details: { step: "request", piesa_record_id: "r1" } },
      { details: { step: "day_1", piesa_record_id: "r1" } },
      { details: { step: "request", piesa_record_id: "r2" } },
      { details: { piesa_record_id: "r1" } },
      { details: null },
    ];
    expect(stepsForRecord(ev, "r1")).toEqual(["request", "day_1"]);
    expect(stepsForRecord(ev, "r2")).toEqual(["request"]);
    expect(stepsForRecord(ev, "r3")).toEqual([]);
  });
});

describe("completion pack: invoice paid in full", () => {
  test("cumulative paid reaches the total (half-cent tolerance); no invoice or zero total is never paid", () => {
    expect(invoiceFullyPaid({ total_inc_gst: 4000, total_paid: 4000 })).toBe(true);
    expect(invoiceFullyPaid({ total_inc_gst: "4000.00", total_paid: "3999.996" })).toBe(true);
    expect(invoiceFullyPaid({ total_inc_gst: 4000, total_paid: 3999.99 })).toBe(false);
    expect(invoiceFullyPaid({ total_inc_gst: 0, total_paid: 0 })).toBe(false);
    expect(invoiceFullyPaid(null)).toBe(false);
    expect(invoiceFullyPaid(undefined)).toBe(false);
  });
});
