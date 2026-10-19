// P1 UAT DEF-08: the office was told "PIESA offers sent to approved electricians" when no offer had been sent.
// The allocation now refuses with the sentence below instead. Pure rule, no database.
import { describe, expect, test } from "bun:test";
import { noOfferMessage } from "@/lib/allocation.core";

describe("noOfferMessage", () => {
  test("nobody could take the owner's times says exactly that, and what to do next", () => {
    const m = noOfferMessage("piesa", "owner_times");
    expect(m).toContain("no PIESA offer was sent");
    expect(m).toContain("Ask the owner to choose new times");
  });

  test("no electrician left to offer it to says exactly that", () => {
    const m = noOfferMessage("piesa", "coverage");
    expect(m).toContain("no offer was sent");
    expect(m).toContain("Needs Home Insulation Victoria");
  });

  test("a fix-up says fix-up, never PIESA", () => {
    expect(noOfferMessage("rectification", "owner_times")).toContain("fix-up");
    expect(noOfferMessage("rectification", "owner_times")).not.toContain("PIESA");
  });

  test("it never reads like a success message", () => {
    for (const kind of ["piesa", "rectification"] as const) {
      for (const reason of ["owner_times", "coverage"] as const) {
        expect(noOfferMessage(kind, reason)).not.toContain("sent to approved electricians");
      }
    }
  });
});
