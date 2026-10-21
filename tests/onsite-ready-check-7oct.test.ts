import { describe, expect, test } from "bun:test";
import { addressFromReverse, isAuMobile, mittiFormUrl, onsiteProblems, onsiteState, plainMittiError, retryable, OFFICE_SETUP, OWNER_PAPERWORK_FIRST, PREPARING } from "../src/lib/onsite-ready-check.core";

const ok = { full_name: "Megan Tomlins", address_line: "1 Test St", suburb: "Fraser Rise", postcode: "3336", phone: "0403 595 088", email: "megan@example.com", contact_permission: true, consent_by: "installer" as const };
const facts = { mittiInvited: true, templateSet: true, gateADone: true, booked: true, auditId: null, lastError: null };

describe("on-site Ready Check (Jo, 7 Oct)", () => {
  test("minimum details only; complete input has no problems", () => expect(onsiteProblems(ok)).toEqual([]));
  test("installer consent confirmation is required", () => expect(onsiteProblems({ ...ok, contact_permission: false }).join()).toContain("permission to contact"));
  test("non-Victorian postcode is refused plainly", () => expect(onsiteProblems({ ...ok, postcode: "2604" })).toContain("We can only take Victorian jobs — this one can't be added"));
  test("mobile and email checked once each", () => {
    expect(isAuMobile("+61 403 595 088")).toBe(true);
    expect(onsiteProblems({ ...ok, phone: "9999", email: "x" })).toEqual(["Check the mobile — it should look like 0412 345 678", "Check the email address"]);
  });
  test("location gives an editable suggestion", () => {
    expect(addressFromReverse({ address: { house_number: "12", road: "Smith St", suburb: "Frankston", postcode: "3199", state: "Victoria" } })).toEqual({ address_line: "12 Smith St", suburb: "Frankston", postcode: "3199", state: "Victoria" });
    expect(addressFromReverse({})).toBeNull();
  });
  test("form ready -> opens Mitti", () => expect(onsiteState({ ...facts, auditId: "a1" })).toEqual({ kind: "open", url: mittiFormUrl("a1") }));
  test("never a dead screen: preparing, office, paperwork, retry all explain", () => {
    expect(onsiteState(facts)).toEqual({ kind: "preparing", message: PREPARING });
    expect(onsiteState({ ...facts, mittiInvited: false })).toEqual({ kind: "office", message: OFFICE_SETUP });
    expect(onsiteState({ ...facts, gateADone: false, booked: false })).toEqual({ kind: "owner_paperwork", message: OWNER_PAPERWORK_FIRST });
    expect(onsiteState({ ...facts, lastError: "Mitti could not be reached. Try again shortly." }).kind).toBe("retry");
  });
  test("Mitti stays hidden until the business is invited, even if a form exists", () => expect(onsiteState({ ...facts, mittiInvited: false, auditId: "a1" }).kind).toBe("office"));
  test("Mitti errors in installer words; only network errors auto-retry", () => {
    expect(plainMittiError("The assigned installer (x) was not found in Mitti.")).toContain("Mitti login isn't linked");
    expect(retryable("Mitti could not be reached.")).toBe(true);
    expect(retryable("was not found in Mitti")).toBe(false);
  });
});

describe("on-site consent clears Gate A (Jo, 8 Oct)", () => {
  test("installer tick alone is accepted; owner tick is retired; auto-send off holds the form", async () => {
    expect(onsiteProblems({ ...ok, consent_by: "installer" })).toEqual([]);
    expect(onsiteProblems({ ...ok, consent_by: "owner" }).join()).toContain("permission to contact");
    expect(onsiteProblems({ ...ok, consent_by: null }).join()).toContain("permission to contact");
    expect(onsiteState({ ...facts, autoSend: false }).kind).toBe("office");
    const { evaluateOwnerGates } = await import("../src/lib/owner-gates.core");
    const base = { isTest: false, signed: [], approved: {}, tenant: false, lifeSupport: false, visitedByInstaller: false, hasQuote: false, agreementSigned: false, agreementWordingApproved: false, escConsentSigned: false, piesaCopyDelivered: false, piesaDeclarationMappingApproved: false, assignmentEffective: false };
    expect(evaluateOwnerGates(base)[0]!.complete).toBe(true);
    expect(evaluateOwnerGates({ ...base, onsiteConsent: true })[0]!.complete).toBe(true);
  });
});
