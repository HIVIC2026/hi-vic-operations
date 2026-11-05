import { expect, test } from "bun:test";
import { scheduleSavedForm } from "../src/lib/saved-form-response.core";

test("saved job returns scheduled before a slow form finishes", async () => {
  let finish: (() => void) | undefined;
  let completed = false;
  const slow = new Promise<void>(resolve => { finish = resolve; });
  const tasks: (() => Promise<unknown>)[] = [];
  const result = scheduleSavedForm(() => slow.then(() => { completed = true; }), task => { tasks.push(task); return "wait_until"; });
  expect(result).toBe("scheduled");
  expect(completed).toBe(false);
  expect(tasks).toHaveLength(1);
  const running = tasks[0]?.();
  finish?.();
  await running;
  expect(completed).toBe(true);
});
test("without request lifetime support the durable sweep owns creation", () => {
  let ran = false;
  expect(scheduleSavedForm(async () => { ran = true; }, () => "queue_only")).toBe("scheduled");
  expect(ran).toBe(false);
});