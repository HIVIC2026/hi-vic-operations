// Review summary must not claim consent/acknowledgement that a restored draft intentionally reset.
import { describe, expect, test } from "bun:test";
import { contactPermissionSummary, customerProblems, restoreCustomer } from "../src/lib/add-job-flow.core";

const saved = { full_name: "QA TEST Owner", address_line: "1 Test St", suburb: "Ballarat", postcode: "3350", phone: "0400000000", email: "qa@hivic-test.example", contact_permission: true, consent_by: "installer" };

describe("Add job review summary after restored draft", () => {
  test("restored customer shows permission still required, matching the submit blocker", () => {
    const c = restoreCustomer(saved);
    expect(contactPermissionSummary(c)).toBe("Contact permission still needs to be ticked");
    expect(customerProblems(c)).toContain("Confirm the owner has given Home Insulation Victoria permission to contact them");
  });
  test("freshly ticked permission shows positive confirmation and no blocker", () => {
    const c = { ...restoreCustomer(saved), contact_permission: true, consent_by: "installer" as const };
    expect(contactPermissionSummary(c)).toBe("Permission to contact given");
    expect(customerProblems(c).some((p) => /permission to contact/.test(p))).toBe(false);
  });
  test("ticked box without installer consent source is not positive", () => {
    expect(contactPermissionSummary({ contact_permission: true, consent_by: null })).toBe("Contact permission still needs to be ticked");
  });
});
