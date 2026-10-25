import { describe, expect, test } from "bun:test";
import { quotedIntakeProblems } from "../src/lib/installer-quote-intake.core";
import { partnerFileBucket } from "../src/lib/partner-file.core";
import { createInstallerOwner } from "../src/lib/installer-owner.server";
import { onsiteProblems } from "../src/lib/onsite-ready-check.core";

const quote = { quoted: "yes", area: 175, method: "laser", amount: 3450, includes: "R5 batts and removal" };
describe("installer quote intake", () => {
  test("quoted job requires ceiling area", () => expect(quotedIntakeProblems({ ...quote, area: "" })).toEqual(["Enter the ceiling area (m²)"]));
  test("quoted job requires measurement method", () => expect(quotedIntakeProblems({ ...quote, method: "" })).toEqual(["Tell us how the ceiling area was measured"]));
  test("quoted job requires quote amount", () => expect(quotedIntakeProblems({ ...quote, amount: 0 })).toEqual(["Enter the quote amount inc GST"]));
  test("quoted job requires inclusions", () => expect(quotedIntakeProblems({ ...quote, includes: "" })).toEqual(["Tell us what the quote includes"]));
  test("valid quote passes; unquoted needs no invented measurement", () => { expect(quotedIntakeProblems(quote)).toEqual([]); expect(quotedIntakeProblems({ quoted: "no", area: null, method: null, amount: null, includes: null })).toEqual([]); });
  test("ACT refusal clears when postcode corrected to Victoria", () => {
    const input = { full_name: "Test Customer", address_line: "30 Test Road", suburb: "Test Suburb", postcode: "2604", phone: "0412345678", email: "owner@example.test", contact_permission: true, consent_by: "installer" as const };
    expect(onsiteProblems(input).length).toBe(1);
    expect(onsiteProblems({ ...input, postcode: "3001" })).toEqual([]);
  });
});
describe("private insurance files", () => {
  const business = "00000000-0000-4000-8000-000000000001";
  const onboard = "installer-onboarding/00000000-0000-4000-8000-000000000002/insurance-test.pdf";
  test("recorded onboarding certificate opens from partner-files", () => expect(partnerFileBucket(business, onboard, true)).toBe("partner-files"));
  test("another business/unrecorded onboarding file is denied", () => expect(partnerFileBucket(business, onboard, false)).toBeNull());
  test("own renewed certificate uses job-files", () => expect(partnerFileBucket(business, `partners/${business}/credentials/test.pdf`, false)).toBe("job-files"));
  test("path traversal and another business prefix rejected", () => { expect(partnerFileBucket(business, `partners/${business}/../test.pdf`, true)).toBeNull(); expect(partnerFileBucket(business, "partners/other/credentials/test.pdf", true)).toBeNull(); });
});
function dbFor(ownerId: string | null, insertCode: string | null = "23505") {
  const calls: string[] = [];
  let inserted = 0;
  const db = { from: (table: string) => {
    calls.push(table);
    const q: any = { insert: () => q, select: () => q, eq: (key: string, value: string) => { calls.push(`${key}:${value}`); return q; }, ilike: () => q, limit: () => q, single: async () => ({ data: insertCode ? null : { id: `new-owner-${++inserted}` }, error: insertCode ? { code: insertCode } : null }), maybeSingle: async () => ({ data: ownerId ? { owner_id: ownerId } : null, error: null }) };
    return q;
  } };
  return { db, calls };
}
describe("decision 282: one email, any number of owners and jobs", () => {
  const input = { full_name: "Test Owner", email: "owner@example.test", phone: "0412345678" };
  test("the same email twice makes two owner rows (two jobs), with no email lookup at all", async () => {
    const { db, calls } = dbFor(null, null);
    expect(await createInstallerOwner(db, "business-1", input)).toEqual({ id: "new-owner-1" });
    expect(await createInstallerOwner(db, "business-1", input)).toEqual({ id: "new-owner-2" });
    expect(calls).toEqual(["owners", "owners"]);
  });
  test("until owners-email-not-unique.sql is applied: the installer's own earlier customer is reused, never updated", async () => {
    const { db, calls } = dbFor("same-business-owner");
    expect(await createInstallerOwner(db, "business-1", input)).toEqual({ id: "same-business-owner" });
    expect(calls).toContain("originating_installer_business_id:business-1");
    expect(calls).toContain("channel:installer_sourced");
  });
  test("until the migration: any other collision is the neutral save error — never \"customer who isn't yours\"", async () => {
    const { db } = dbFor(null);
    const err = await createInstallerOwner(db, "business-1", input).catch((e: Error) => e.message);
    expect(err).toBe("The customer could not be saved. Please contact the office for help; your entered details are kept.");
    expect(err).not.toMatch(/isn't yours|another installer|our leads/);
  });
  test("other insert failures never reuse customer", async () => { const { db, calls } = dbFor("owner", "42501"); await expect(createInstallerOwner(db, "business-1", input)).rejects.toThrow("could not be saved"); expect(calls).toEqual(["owners"]); });
});