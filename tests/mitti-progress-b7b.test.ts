import { expect, test } from "bun:test";
import { pullMittiPages } from "../src/lib/mitti-pull-batch.core";

function fixture(initial: string | null = null) {
  let time = 0, cursor = initial;
  const writes: (string | null)[] = [], attempted: string[] = [];
  const deps = {
    page: async (offset: number, size: number) => ["a", "b", "c", "d", "e", "f"].slice(offset, offset + size).map(id => ({ id })),
    cursor: async () => cursor,
    checkpoint: async (id: string | null) => { writes.push(id); cursor = id; },
    sync: async ({ id }: { id: string }) => { time += 10; attempted.push(id); return { ok: id !== "b" }; },
    failure: async () => {}, now: () => time,
  };
  return { deps, writes, attempted };
}
test("full six-job run with no cursor writes no progress", async () => {
  const f = fixture(); await pullMittiPages(f.deps, { budgetMs: 1000 }); expect(f.writes).toEqual([]);
});
test("budget stop writes only last finished attempt once, including a failed job", async () => {
  const f = fixture(); const r = await pullMittiPages(f.deps, { budgetMs: 20 });
  expect(r).toEqual({ checked: 2, failed: 1, deferred: true }); expect(f.writes).toEqual(["b"]);
});
test("three bounded invocations reach all six jobs with at most one write each", async () => {
  const f = fixture();
  await pullMittiPages(f.deps, { maxJobs: 2 }); expect(f.writes).toEqual(["b"]);
  await pullMittiPages(f.deps, { maxJobs: 2 }); expect(f.writes).toEqual(["b", "d"]);
  await pullMittiPages(f.deps, { maxJobs: 2 }); expect(f.attempted).toEqual(["a", "b", "c", "d", "e", "f"]);
  expect(f.writes).toEqual(["b", "d", "f"]);
});
test("a completed rotation resets an existing cursor once then later full runs write nothing", async () => {
  const f = fixture("b"); await pullMittiPages(f.deps, { budgetMs: 1000 });
  expect(f.writes).toEqual([null]);
  await pullMittiPages(f.deps, { budgetMs: 1000 }); expect(f.writes).toEqual([null]);
});
test("stop before any job does not write or lose existing progress", async () => {
  const f = fixture("b"); await pullMittiPages(f.deps, { budgetMs: 0 }); expect(f.writes).toEqual([]);
});