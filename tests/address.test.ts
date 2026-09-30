import { describe, expect, it } from "bun:test";
import { formatPropertyAddress } from "../src/lib/address";

describe("property address formatting", () => {
  it("joins split address fields once", () => {
    expect(formatPropertyAddress({ address_line: "8/2 Dundas St", suburb: "Thornbury", state: "VIC", postcode: "3071" })).toBe("8/2 Dundas St, Thornbury, VIC 3071");
  });

  it("does not repeat locality fields already present", () => {
    expect(formatPropertyAddress({ address_line: "8/2 Dundas St, Thornbury VIC 3071", suburb: "Thornbury", state: "VIC", postcode: "3071" })).toBe("8/2 Dundas St, Thornbury VIC 3071");
  });

  it("supports Victorian 8xxx postcodes and units", () => {
    expect(formatPropertyAddress({ address_line: "Unit 4, 10 Main Rd, Docklands VIC 8008", suburb: "Docklands", state: "vic", postcode: "8008" })).toBe("Unit 4, 10 Main Rd, Docklands VIC 8008");
  });
});