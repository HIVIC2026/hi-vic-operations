import { describe, expect, test } from "bun:test";
import { possibleDuplicateGroups, repeatKey, sameOwner } from "../src/lib/enquiry-repeat.core";
describe("repeat enquiry matching", () => {
  test("same street in either style", () => expect(repeatKey("12 Smith Street, Preston VIC 3072", null, "3072")).toBe(repeatKey("12 smith st", "Preston", "3072")));
  test("different postcode never matches", () => expect(repeatKey("12 Smith St", null, "3072")).not.toBe(repeatKey("12 Smith St", null, "3073")));
  test("owner by email or mobile", () => {
    expect(sameOwner({ email: "A@x.com", phone: null }, { email: "a@x.com ", phone: null })).toBe(true);
    expect(sameOwner({ email: "a@x.com", phone: "0412 345 678" }, { email: "b@y.com", phone: "+61412345678" })).toBe(true);
    expect(sameOwner({ email: "a@x.com", phone: null }, { email: "b@y.com", phone: null })).toBe(false);
  });
  test("groups duplicates newest first; different owners at one address are not grouped", () => {
    const j = (id: string, email: string, createdAt: string) => ({ id, jobNumber: id, email, phone: null, address: "5 Vale Rd, Heidelberg VIC 3084", postcode: "3084", createdAt });
    const g = possibleDuplicateGroups([j("HV-1", "p@x.com", "2026-10-01"), j("HV-2", "p@x.com", "2026-10-03"), j("HV-3", "other@x.com", "2026-10-02")]);
    expect(g.length).toBe(1);
    expect(g[0]!.map((x) => x.id)).toEqual(["HV-2", "HV-1"]);
  });
});
