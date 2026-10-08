import { expect, test } from "bun:test";
import { insulationDeclarationRecord } from "../src/lib/insulation-review.core";
test("loose fill is a distinct owner declaration, not an R-value", () => {
  expect(insulationDeclarationRecord("loose_fill_only", true)).toEqual({ eventType: "owner_insulation_loose_fill_only_declared", declaration: "I confirm it is loose-fill insulation only", basis: "owner_declared", reviewReason: "Owner declared — review required: I confirm it is loose-fill insulation only (not verified)" });
});
test("less than R2 keeps its established event type and owner basis", () => {
  expect(insulationDeclarationRecord("below_r2", true).eventType).toBe("owner_insulation_below_r2_declared");
  expect(insulationDeclarationRecord("below_r2", true).basis).toBe("owner_declared");
});
test("neither declaration is allowed without explicit confirmation", () => {
  for (const type of ["loose_fill_only", "below_r2"]) expect(() => insulationDeclarationRecord(type, false)).toThrow();
  expect(() => insulationDeclarationRecord("photos", true)).toThrow();
});