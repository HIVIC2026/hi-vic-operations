// Jo 24 Oct: every Add a job has the owner's full name (it goes on the quote) and a looked-up full address
// (the postcode sets the VEU rebate). Bad examples are real ones from Deep's first uploads.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OWNER_FULL_NAME, PICK_ADDRESS, hasFullName, hasStreetNumber, onsiteProblems, type OnsiteInput } from "../src/lib/onsite-ready-check.core";
import { customerProblems, restoreCustomer } from "../src/lib/add-job-flow.core";

const ok: OnsiteInput = { full_name: "Bijay Baskota", address_line: "18 Arapiles Avenue", suburb: "Craigieburn", postcode: "3064", phone: "0412 345 678", email: "b@example.com", contact_permission: true, consent_by: "installer", address_verified: true };

describe("owner's full name", () => {
  test.each(["ian", "Mike", "Ayad", "Elijabeth", "J Smith", "  "])("refuses %p", (n) => expect(hasFullName(n)).toBe(false));
  test.each(["Ian Smith", "Kim turner", "Jo Li", "Mary-Anne O'Brien", "Ziqiao Wang"])("accepts %p", (n) => expect(hasFullName(n)).toBe(true));
  test("plain message on the screen", () => expect(onsiteProblems({ ...ok, full_name: "ian" })).toEqual([OWNER_FULL_NAME]));
});

describe("full address", () => {
  test.each(["18 Dixie Street", "27/274 Poath Road", "2A Chatfield Street", "54-84 Percy Street", "Unit 3 12 Smith St", "Lot 5 Banjo Drive"])("street number present: %p", (a) => expect(hasStreetNumber(a)).toBe(true));
  test.each(["Poath Road", "the Quadrangle", "banjo"])("no street number: %p", (a) => expect(hasStreetNumber(a)).toBe(false));
  test("missing number is named", () => expect(onsiteProblems({ ...ok, address_line: "Arapiles Avenue" })).toEqual(["Add the street number to the address"]));
  test("a postcode outside the rebate list is caught", () => expect(onsiteProblems({ ...ok, postcode: "3999" })).toEqual(["Check the postcode — it isn't on the Victorian rebate postcode list"]));
  test("a complete looked-up job has no problems", () => expect(customerProblems(ok)).toEqual([]));
  test("a typed (not picked) address must be picked from the list on the phone", () => {
    expect(customerProblems({ ...ok, address_verified: false })).toEqual([PICK_ADDRESS]);
    expect(customerProblems({ ...ok, address_verified: false }, { requirePicked: false })).toEqual([]); // sample screens
  });
  test("a saved phone draft keeps the pick, never the consent", () => {
    const r = restoreCustomer({ ...ok });
    expect([r.address_verified, r.contact_permission]).toEqual([true, false]);
  });
  test("the server applies the same rules when the job is saved", () => {
    const src = readFileSync("src/lib/partner-import.server.ts", "utf8");
    expect(src).toContain("blockers.push(...oc.onsiteProblems(");
  });
  test("the phone screen uses the Google address picker, Victoria only", () => {
    const src = readFileSync("src/components/trade/customer-fields.tsx", "utf8");
    expect(src).toContain("<VerifiedAddressInput");
    expect(src).toContain("victoriaOnly");
  });
});

const typed = { ...restoreCustomer({}), full_name: "Ann Lee", address_line: "12 Bush Track", suburb: "Kinglake", postcode: "3763", phone: "0412 345 678", email: "a@b.co", contact_permission: true, consent_by: "installer" as const, address_typed: true };
test("A8: a typed address is accepted without the list, but still checked", () => {
  expect(customerProblems(typed)).toEqual([]);
  expect(customerProblems({ ...typed, address_typed: false })).toContain(PICK_ADDRESS);
  expect(customerProblems({ ...typed, postcode: "2604" })).toContain("We can only take Victorian jobs — this one can't be added");
  expect(customerProblems({ ...typed, address_line: "Bush Track" })).toContain("Add the street number to the address");
  expect(restoreCustomer({ ...typed }).address_typed).toBe(true);
});
test("A8 wiring: the link shows only after no match; picking again clears typed", () => {
  const cf = readFileSync("src/components/trade/customer-fields.tsx", "utf8");
  expect(cf).toContain("onNoMatch="); expect(cf).toContain("ADDRESS_TYPE_IN"); expect(cf).toContain("ADDRESS_PICK_AGAIN");
  expect(cf).toContain("address_verified: true, address_typed: false");
  expect(readFileSync("src/lib/onsite-ready-check.functions.ts", "utf8")).toContain("address_typed: z.boolean().optional()");
});
