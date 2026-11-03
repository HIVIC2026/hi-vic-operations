import { expect, test } from "bun:test";
import { teamWorkerRoleProblem } from "../src/lib/team-required.core";

test("installer must choose Lead or Crew; missing or invalid choice is refused", () => {
  for (const role of [undefined, null, "", "owner"]) {
    expect(teamWorkerRoleProblem("installer", role)).toBe("Choose Lead or Crew.");
  }
});

test("either explicit installer choice is accepted", () => {
  expect(teamWorkerRoleProblem("installer", "lead")).toBeNull();
  expect(teamWorkerRoleProblem("installer", "crew")).toBeNull();
});

test("electricians are not asked to choose Lead or Crew", () => {
  expect(teamWorkerRoleProblem("electrician", undefined)).toBeNull();
});