import { expect, test } from "bun:test";
import { runMittiPullWorker } from "../src/lib/mitti-pull-worker.server";

test("independent pull runs pending forms and completed Ready Checks", async () => {
  const calls: string[] = [];
  const result = await runMittiPullWorker({
    pending: async () => { calls.push("pending"); return [{ ok: true }, { ok: true }]; },
    completed: async () => { calls.push("completed"); return { retried: 1, watched: 2 }; },
  });
  expect(calls).toEqual(["pending", "completed"]);
  expect(result.ok).toBe(true);
  expect(result.mitti).toEqual({ checked: 2, failed: 0 });
  expect(result.mittiCompleted).toEqual({ retried: 1, watched: 2 });
});

test("failed pending pull does not prevent completed Ready Check sweep", async () => {
  let completed = 0;
  const result = await runMittiPullWorker({
    pending: async () => { throw new Error("Mitti unavailable"); },
    completed: async () => { completed++; return { retried: 0, watched: 1 }; },
  });
  expect(completed).toBe(1);
  expect(result.ok).toBe(false);
  expect(result.errors).toEqual(["Mitti unavailable"]);
});

test("individual form failures surface rather than claiming success", async () => {
  const result = await runMittiPullWorker({
    pending: async () => [{ ok: false }],
    completed: async () => ({ retried: 0, watched: 0 }),
  });
  expect(result.ok).toBe(false);
  expect(result.mitti).toEqual({ checked: 1, failed: 1 });
});