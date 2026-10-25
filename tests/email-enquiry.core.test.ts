// Decision 255: what an enquiry created from a new sender's email may hold — read from the email, never guessed.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { completeVicAddress, latestText, phoneIn, planEmailEnquiry, EMAIL_ENQUIRY_CONSENT_SENTENCE } from "../src/lib/email-enquiry.core";
import { tidyEnquiryDetails } from "../src/lib/name-address-tidy.core";
import { intakeJobFacts } from "../src/lib/enquiry.server";

describe("complete Victorian street address", () => {
  test("number + street + type + suburb + postcode is found", () => {
    expect(completeVicAddress("my house at 14 Example Street, Ringwood 3134. It's old")).toEqual({ street: "14 Example Street", suburb: "Ringwood", postcode: "3134" });
    expect(completeVicAddress("we're at 3/22 long rd box hill vic 3128 thanks")).toEqual({ street: "3/22 Long Rd", suburb: "Box Hill", postcode: "3128" });
    expect(completeVicAddress("8 Carrington Rd, Box Hill North, VIC 3129.")).toEqual({ street: "8 Carrington Rd", suburb: "Box Hill North", postcode: "3129" });
  });
  test("anything less is null — never guessed", () => {
    expect(completeVicAddress("my house in Ringwood 3134")).toBeNull(); // no street
    expect(completeVicAddress("12 Smith St Clayton")).toBeNull(); // no postcode
    expect(completeVicAddress("12 Smith St 3168")).toBeNull(); // no suburb
    expect(completeVicAddress("12 Smith St, Sydney 2000")).toBeNull(); // not Victorian
    expect(completeVicAddress("12 Smith St Clayton 3168 and 4 Jones Rd Ringwood 3134")).toBeNull(); // which home?
  });
});

describe("phone and name", () => {
  test("one Australian number is kept, two or none are not", () => {
    expect(phoneIn("Call me on 0412345678")).toBe("0412 345 678");
    expect(phoneIn("ph (03) 9876 5432")).toBe("(03) 9876 5432");
    expect(phoneIn("+61 412 345 678")).toBe("0412 345 678");
    expect(phoneIn("0412 345 678 or 03 9876 5432")).toBeNull();
    expect(phoneIn("job HV-3150, postcode 3134")).toBeNull();
  });
  test("quoted history below the reply is ignored", () => {
    expect(latestText("Please call 0412 345 678\n\nOn Mon, 3 Oct 2026, Jo wrote:\n> 0400 000 000")).toBe("Please call 0412 345 678");
    expect(planEmailEnquiry({ from: "a@b.com", fromName: "A B", subject: null, body: "Hi\n\nFrom: Home Insulation Victoria\nCall 03 9000 0000" })!.phone).toBeNull();
  });
  test("display name tidied; an email-address display name is not a name", () => {
    expect(planEmailEnquiry({ from: "Priya.K@Example.com", fromName: "PRIYA EXAMPLE", subject: "x", body: "y" })).toEqual({ fullName: "Priya Example", email: "priya.k@example.com", phone: null, address: null });
    expect(planEmailEnquiry({ from: "x@example.com", fromName: "x@example.com", subject: null, body: "" })!.fullName).toBe("");
    expect(planEmailEnquiry({ from: null, fromName: "No Address", subject: null, body: "" })).toBeNull();
  });
});

test("no address → the enquiry is created without one (decision 281: no Fix details pile; the reply asks for it)", () => {
  const p = planEmailEnquiry({ from: "sam@example.org", fromName: "Sam Person", subject: "Rebate", body: "How much is the rebate?" })!;
  expect(p.address).toBeNull();
  expect(tidyEnquiryDetails({ fullName: p.fullName, addressLine: "", suburb: null, postcode: null }).problems).toEqual(["street_missing", "suburb_missing", "postcode_missing"]);
  const q = planEmailEnquiry({ from: "sam@example.org", fromName: "Sam Person", subject: "Quote", body: "We're at 14 Example Street, Ringwood 3134" })!;
  expect(tidyEnquiryDetails({ fullName: q.fullName, addressLine: q.address!.street, suburb: q.address!.suburb, postcode: q.address!.postcode }).problems).toEqual([]);
});

test("intake: an email enquiry records an unknown ceiling size; other sources keep their rules", () => {
  const hivic = { channel: "hivic_sourced" } as const;
  expect(intakeJobFacts({ estimated_area_m2: null, area_unknown: true }, "email", hivic, { emailIntake: true })).toMatchObject({ estimated_area_m2: null, estimated_area_unknown: true });
  expect(intakeJobFacts({ estimated_area_m2: null, area_unknown: true }, "qa_test", hivic, { emailIntake: true })).toMatchObject({ estimated_area_unknown: true });
  expect(() => intakeJobFacts({ estimated_area_m2: null, area_unknown: true }, "qa_test", hivic)).toThrow();
  expect(() => intakeJobFacts({ estimated_area_m2: null, area_unknown: true }, "base44", hivic, { emailIntake: true })).toThrow();
});

test("consent sentence: reply-only, VEU consent captured on the homeowner page", () => {
  expect(EMAIL_ENQUIRY_CONSENT_SENTENCE).toContain("consent to reply to that email only");
  expect(EMAIL_ENQUIRY_CONSENT_SENTENCE).toContain("homeowner page captures");
  // The server never writes a granted contact consent for an email enquiry.
  expect(readFileSync("src/lib/email-enquiry.server.ts", "utf8").replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/owner_contact_consents|recordContactConsent/);
});
