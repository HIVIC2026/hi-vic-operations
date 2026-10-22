import { describe, expect, test } from "bun:test";
import { parsePickupAudit, pickupAddressParts, pickupAutoDecision, needsFinishingText } from "../src/lib/mitti-pickup.core";
import { contactAnswersFromEntries } from "../src/lib/mitti.core";

// Stage 3/4 rules (Jo 23 Oct): new A1 answers are read absent-safely, and a Mitti-first Ready Check is
// only adopted automatically when everything checks out; anything off goes to office review.

const form = (answers: Record<string, string | null> = {}) => {
  const header: { item_id: string; label: string; type: string; responses?: { text: string } }[] = [
    { item_id: "a1", label: "Site address", type: "textsingle", responses: { text: "2A Chatfield Street, Kingsville, Victoria, 3012" } },
    { item_id: "o1", label: "Homeowner name", type: "textsingle", responses: { text: "Courtney Daniels" } },
  ];
  for (const [label, text] of Object.entries(answers)) header.push({ item_id: `h_${label}`, label, type: "textsingle", ...(text == null ? {} : { responses: { text } }) });
  return { audit_id: "audit_a1", template_id: "template_a1", modified_at: "2026-10-23T00:00:00.000Z", audit_data: { authorship: { owner: "Deep -", owner_id: "user_deep" } }, header_items: header, items: [] };
};

describe("contactAnswersFromEntries", () => {
  test("absent labels return null — nothing is invented", () => {
    const a = contactAnswersFromEntries([{ label: "Site address", value: "x" }]);
    expect(a).toEqual({ phone: null, email: null, contactPermission: null, electricianChoice: null, electricianPriceIncGst: null, electricianName: null, electricianLicence: null, productChoice: null, productBrand: null, productName: null, productRValue: null });
  });
  test("reads phone, email, permission and the electrician choice", () => {
    const a = contactAnswersFromEntries([
      { label: "Homeowner phone", value: "0400 111 222" },
      { label: "Homeowner email", value: "courtney@example.com" },
      { label: "Homeowner agrees to be contacted by Home Insulation Victoria", value: "Yes" },
      { label: "Who is doing the electrical safety check?", value: "My own electrician" },
      { label: "Electrician price (inc GST)", value: "$349" },
    ]);
    expect(a.phone).toBe("0400 111 222");
    expect(a.email).toBe("courtney@example.com");
    expect(a.contactPermission).toBe(true);
    expect(a.electricianChoice).toBe("own");
  });
  test("HIVIC electrician answer maps to hivic", () => {
    const a = contactAnswersFromEntries([{ label: "Who is doing the electrical safety check?", value: "Home Insulation Victoria organises one" }]);
    expect(a.electricianChoice).toBe("hivic");
  });
});

describe("parsePickupAudit contact fields", () => {
  test("reads the new answers when present", () => {
    const p = parsePickupAudit(form({ "Homeowner phone": "0400 111 222", "Homeowner email": "c@example.com", "Homeowner agrees to be contacted by Home Insulation Victoria": "Yes" }))!;
    expect(p.ownerPhone).toBe("0400 111 222");
    expect(p.ownerEmail).toBe("c@example.com");
    expect(p.contactPermission).toBe(true);
  });
  test("old forms without the answers stay null", () => {
    const p = parsePickupAudit(form())!;
    expect(p.ownerPhone).toBeNull();
    expect(p.ownerEmail).toBeNull();
    expect(p.contactPermission).toBeNull();
  });
});

describe("pickupAddressParts", () => {
  test("splits street, suburb and postcode", () => {
    expect(pickupAddressParts("2A Chatfield Street, Kingsville, Victoria, 3012")).toEqual({ addressLine: "2A Chatfield Street", suburb: "Kingsville", postcode: "3012" });
  });
  test("handles two-part addresses without guessing", () => {
    expect(pickupAddressParts("5 Somerset Ct, 3170")).toEqual({ addressLine: "5 Somerset Ct", suburb: null, postcode: "3170" });
    expect(pickupAddressParts(null)).toBeNull();
  });
});

describe("pickupAutoDecision", () => {
  const clean = { templateKind: "installer_form" as const, businessMatched: true, homeownerName: "Courtney Daniels", siteAddress: "2A Chatfield Street, Kingsville, Victoria, 3012", ownerPhone: "0400 111 222", ownerEmail: "c@example.com", contactPermission: true, duplicates: [] };
  test("everything present and matched creates the job", () => {
    expect(pickupAutoDecision(clean)).toEqual({ action: "create_job", reasons: [] });
  });
  test("our own HIVIC form always goes to review", () => {
    const d = pickupAutoDecision({ ...clean, templateKind: "hivic_form" });
    expect(d.action).toBe("office_review");
    expect(d.reasons.join(" ")).toContain("own form");
  });
  test("unmatched business goes to review", () => {
    const d = pickupAutoDecision({ ...clean, businessMatched: false });
    expect(d.action).toBe("office_review");
    expect(d.reasons).toContain("Mitti user not matched to an installer business");
  });
  test("missing phone, email or permission still create the job as Needs finishing (Jo 22 Oct)", () => {
    expect(pickupAutoDecision({ ...clean, ownerPhone: null })).toEqual({ action: "create_job_needs_finishing", reasons: [], missing: ["owner phone"] });
    expect(pickupAutoDecision({ ...clean, ownerEmail: null })).toEqual({ action: "create_job_needs_finishing", reasons: [], missing: ["owner email"] });
    expect(pickupAutoDecision({ ...clean, contactPermission: null })).toEqual({ action: "create_job_needs_finishing", reasons: [], missing: ["owner contact permission"] });
    const old = pickupAutoDecision({ ...clean, ownerPhone: null, ownerEmail: null, contactPermission: null });
    expect(old.action).toBe("create_job_needs_finishing");
    expect(needsFinishingText((old as { missing: string[] }).missing)).toBe("Needs finishing: add owner phone, owner email, owner contact permission on the Mitti form");
  });
  test("other problems still go to office review even when contact details are missing", () => {
    expect(pickupAutoDecision({ ...clean, ownerPhone: null, businessMatched: false }).action).toBe("office_review");
    expect(pickupAutoDecision({ ...clean, ownerEmail: null, homeownerName: null }).action).toBe("office_review");
  });
  test("duplicates are flagged, never auto-adopted", () => {
    const d = pickupAutoDecision({ ...clean, duplicates: [{ jobNumber: "HV-1101" }] });
    expect(d.action).toBe("office_review");
    expect(d.reasons.join(" ")).toContain("HV-1101");
  });
});

describe("installer-started A2 form (Jo 22 Oct 23:30)", () => {
  const { pickupAutoDecision: d, INSTALLER_STARTED_A2_FLAG } = require("../src/lib/mitti-pickup.core");
  const base = { businessMatched: true, homeownerName: "Mike", siteAddress: "13 The Quadrangle, Glen Waverley 3150", ownerPhone: null, ownerEmail: null, contactPermission: null, duplicates: [] };
  test("A2 started by Reinsulate becomes their installer-led job, flagged for office", () => {
    const r = d({ ...base, templateKind: "hivic_form" });
    expect(r.action).toBe("create_job_needs_finishing");
    expect(r.officeFlag).toBe(INSTALLER_STARTED_A2_FLAG);
  });
  test("A2 with no matched installer still goes to office review", () => {
    expect(d({ ...base, templateKind: "hivic_form", businessMatched: false }).action).toBe("office_review");
  });
  test("installer A1 form has no extra flag", () => {
    expect(d({ ...base, templateKind: "installer_form" }).officeFlag).toBeUndefined();
  });
});
