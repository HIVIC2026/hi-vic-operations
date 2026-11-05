import { expect, test } from "bun:test";
import { refreshAfterJobAction } from "../src/lib/job-action-refresh.core";

test("job actions refresh their own job, not another job or whole office lists", () => {
  expect(refreshAfterJobAction(["office-job", "j1"], "j1")).toBe(true);
  expect(refreshAfterJobAction(["office-job", "j2"], "j1")).toBe(false);
  expect(refreshAfterJobAction(["office-job-money", "j1"], "j1")).toBe(true);
  expect(refreshAfterJobAction(["office-jobs", "ours"], "j1")).toBe(false);
  expect(refreshAfterJobAction(["office-enquiries", "offered"], "j1")).toBe(false);
  expect(refreshAfterJobAction(["jobs-lane-counts"], "j1")).toBe(false);
});

test("non-job actions retain the existing refresh; active safety panels still refresh", () => {
  expect(refreshAfterJobAction(["office-jobs"], undefined)).toBe(true);
  expect(refreshAfterJobAction(["office-needs"], "j1")).toBe(true);
  expect(refreshAfterJobAction(["screen"], "j1")).toBe(true);
});