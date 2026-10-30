import { describe, expect, test } from "bun:test";
import { withJobProduct, type JobZone } from "../src/lib/install-evidence.core";

// Jo 30 Oct 2026: the Mitti Ready Check asks the product once per job ("What insulation product will you be using on this
// job?"); an area with no product of its own uses that answer, so real installs aren't held at "insulation product not recorded".
const z = (product: string | null | undefined): JobZone => ({ name: "Main ceiling", underInsulated: false, areaM2: 120, product, beforeVideo: true });

describe("Jo 30 Oct: an area with no product uses the job's Ready Check product", () => {
  test("blank area product takes the job's product", () => {
    expect(withJobProduct([z(null), z(undefined)], "Bradford Gold R5").map((a) => a.product)).toEqual(["Bradford Gold R5", "Bradford Gold R5"]);
  });
  test("an area's own product is kept", () => {
    expect(withJobProduct([z("Earthwool R6")], "Bradford Gold R5")[0]!.product).toBe("Earthwool R6");
  });
  test("no job product: areas stay blank, so the job is still held", () => {
    expect(withJobProduct([z(null)], null)[0]!.product).toBeNull();
  });
  test("other area facts are untouched", () => {
    const [a] = withJobProduct([z(null)], "Bradford Gold R5");
    expect(a).toEqual({ ...z(null), product: "Bradford Gold R5" });
  });
});
