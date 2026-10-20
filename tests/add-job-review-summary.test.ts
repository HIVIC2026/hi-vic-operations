// Review summary must not claim consent/acknowledgement that a restored draft intentionally reset.
import { describe, expect, test } from "bun:test";
import { contactPermissionSummary, customerProblems, organiseSummary, restoreCustomer } from "../src/lib/add-job-flow.core";
import { coordinationProblems } from "../src/lib/installer-intake.core";

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
  test("self-managed without fresh acknowledgement says still required, matching the blocker", () => {
    expect(organiseSummary("self_managed", false)).toBe("I’ll manage the job myself — responsibility still needs to be ticked");
    expect(coordinationProblems("self_managed", false).length).toBe(1);
  });
  test("self-managed with acknowledgement and HIVIC-managed are positive", () => {
    expect(organiseSummary("self_managed", true)).toBe("I’ll manage the job myself (responsibility acknowledged)");
    expect(organiseSummary("hivic_managed", false)).toBe("Home Insulation Victoria manages the process");
    expect(organiseSummary(null, false)).toBe("Who organises the job still needs to be chosen");
  });
});
