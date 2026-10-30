import { describe, expect, test } from "bun:test";
import { payStepInvoiceId } from "../src/lib/journey.core";

// Jo 29 Oct 2026: the TEST journey runner pays each step on its own invoice (batch 3b), never the install invoice by default.
const view = (fixes: { id: string } | null = { id: "fix" }, repeat: { id: string } | null = { id: "rep" }) =>
  ({ invoices: { install: { id: "inst" }, fixes, repeat } });

describe("Jo 29 Oct: test tool pays each step on its own invoice", () => {
  test("fixes are paid on the fixes invoice", () => {
    expect(payStepInvoiceId(view(), "fixes")).toBe("fix");
  });
  test("safety check, install deposit and balance are paid on the install invoice", () => {
    for (const s of ["safety_check", "install_deposit", "balance"] as const) expect(payStepInvoiceId(view(), s)).toBe("inst");
  });
  test("a repeat safety check is paid on the repeat invoice", () => {
    expect(payStepInvoiceId(view(), "repeat_safety_check")).toBe("rep");
  });
  test("no fixes invoice yet: stops, never pays the install invoice", () => {
    expect(() => payStepInvoiceId(view(null), "fixes")).toThrow(/fixes/);
  });
});
