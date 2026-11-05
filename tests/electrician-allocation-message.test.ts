import { expect, test } from "bun:test";
import { electricianAllocationMessage } from "../src/lib/electrician-allocation-message.core";
test("missing-email failure explains the actual repair, not another identical pick", () => {
  expect(electricianAllocationMessage("Electrician needs a Mitti email", "James Spark")).toBe("James Spark — add their email on the Team page first.");
});
test("other failures retain the reason and the saved choice", () => {
  expect(electricianAllocationMessage("Assignment unavailable")).toContain("Assignment unavailable");
  expect(electricianAllocationMessage("Assignment unavailable")).toContain("Your choice is saved");
});