import { expect, test } from "bun:test";
import { pullMittiPages } from "../src/lib/mitti-pull-batch.core";
import { mittiApi } from "../src/lib/mitti.core";

function fixture() {
  const forms = ["a", "b", "c", "d", "e", "f"];
  let cursor: string | null = null, time = 0;
  const stored = new Set<string>(), failures = new Map<string, string>(), reads: number[] = [];
  const deps = {
    page: async (offset: number, size: number) => { reads.push(offset); return forms.slice(offset, offset + size).map(id => ({ id })); },
    cursor: async () => cursor,
    checkpoint: async (id: string) => { cursor = id; },
    sync: async ({ id }: { id: string }) => { time += 10; stored.add(id); return { ok: true }; },
    failure: async (id: string, message: string) => { failures.set(id, message); },
    now: () => time,
  };
  return { deps, stored, failures, reads };
}

test("three mocked pages sync every form/job", async () => {
  const f = fixture();
  const r = await pullMittiPages(f.deps, { pageSize: 2, budgetMs: 1000 });
  expect([...f.stored]).toEqual(["a", "b", "c", "d", "e", "f"]);
  expect(f.reads).toEqual([0, 2, 4, 6]); expect(r.checked).toBe(6);
});
test("a throwing form is recorded for office review and does not stop others", async () => {
  const f = fixture(), sync = f.deps.sync;
  f.deps.sync = async row => { if (row.id === "b") throw Error("Mitti timed out"); return sync(row); };
  const r = await pullMittiPages(f.deps, { pageSize: 2, budgetMs: 1000 });
  expect(r.failed).toBe(1); expect(f.failures.get("b")).toBe("Mitti timed out");
  expect([...f.stored]).toEqual(["a", "c", "d", "e", "f"]);
});
test("budget stop persists progress and fresh invocations continue, including after failure", async () => {
  const f = fixture();
  expect((await pullMittiPages(f.deps, { pageSize: 2, budgetMs: 20 })).deferred).toBe(true);
  expect([...f.stored]).toEqual(["a", "b"]);
  await pullMittiPages(f.deps, { pageSize: 2, budgetMs: 20 });
  await pullMittiPages(f.deps, { pageSize: 2, budgetMs: 20 });
  expect([...f.stored]).toEqual(["a", "b", "c", "d", "e", "f"]);
});
test("replay visits forms but leaves existing idempotent records alone", async () => {
  const f = fixture();
  await pullMittiPages(f.deps, { pageSize: 2, budgetMs: 1000 });
  await pullMittiPages(f.deps, { pageSize: 2, budgetMs: 1000 });
  expect(f.stored.size).toBe(6); expect(f.failures.size).toBe(0);
});
test("returned operational failure is not reported as success", async () => {
  const f = fixture(); f.deps.sync = async () => ({ ok: false, message: "Ready Check could not be read" });
  const r = await pullMittiPages(f.deps, { pageSize: 2, budgetMs: 1000 });
  expect(r.failed).toBe(6); expect(f.failures.size).toBe(6);
});
test("failed page/checkpoint reads fail visibly rather than dropping jobs", async () => {
  const f = fixture(); f.deps.page = async () => { throw Error("Page failed"); };
  await expect(pullMittiPages(f.deps)).rejects.toThrow("Page failed");
  const g = fixture(); g.deps.checkpoint = async () => { throw Error("Cursor failed"); };
  await expect(pullMittiPages(g.deps)).rejects.toThrow("Cursor failed");
});
test("Mitti API pagination follows all three form pages without network", async () => {
  const calls: string[] = [];
  const api = mittiApi(async (_method, path) => {
    calls.push(path);
    const n = Number(new URL(path, "https://api.mitti.com").searchParams.get("page")) || 1;
    return { audits: [{ audit_id: `form-${n}` }], next_page: n < 3 ? `/audits/search?page=${n + 1}` : null };
  });
  const result = await api.searchAudits("2026-11-01T00:00:00Z");
  expect(result.audits.map((a: { audit_id: string }) => a.audit_id)).toEqual(["form-1", "form-2", "form-3"]);
  expect(calls.length).toBe(3);
});