import { describe, expect, test } from "bun:test";
import {
  classifyPortalJobNumber, parsePickupAudit, pickupAddressKey, pickupDuplicates,
  portalJobNumberItem, propertyAddressKey, templateKindFor,
} from "../src/lib/mitti-pickup.core";

const audit = (overrides: Record<string, unknown> = {}) => ({
  audit_id: "audit_test1",
  template_id: "template_a1",
  modified_at: "2026-10-22T02:13:48.636Z",
  archived: false,
  audit_data: { date_completed: null, authorship: { owner: "Deep -", owner_id: "user_deep" } },
  header_items: [
    { item_id: "t1", label: "Title Page", type: "textsingle" },
    { item_id: "pjn1", label: "Portal Job Number", type: "textsingle", responses: { text: "1101" } },
    { item_id: "a1", label: "Site address", type: "textsingle", responses: { text: "2A Chatfield Street, Kingsville, Victoria, 3012" } },
    { item_id: "o1", label: "Homeowner name", type: "textsingle", responses: { text: "Courtney Daniels" } },
    { item_id: "as1", label: "Assessor", type: "textsingle", responses: { text: "Sultan Sharma" } },
  ],
  items: [{ item_id: "x", label: "Roof type", type: "textsingle" }],
  ...overrides,
});

describe("mitti pickup core", () => {
  test("parses a Mitti-started Ready Check audit", () => {
    const p = parsePickupAudit(audit());
    expect(p?.auditId).toBe("audit_test1");
    expect(p?.mittiRef).toBe("1101");
    expect(p?.siteAddress).toBe("2A Chatfield Street, Kingsville, Victoria, 3012");
    expect(p?.homeownerName).toBe("Courtney Daniels");
    expect(p?.mittiOwnerUserId).toBe("user_deep");
    expect(p?.mittiOwnerName).toBe("Deep -");
  });

  test("falls back to the older Owner name label", () => {
    const a = audit();
    (a.header_items as { label: string; responses?: { text?: string } }[])[3] = { item_id: "o1", label: "Owner name", responses: { text: "Helen Yang" } };
    expect(parsePickupAudit(a)?.homeownerName).toBe("Helen Yang");
  });

  test("classifies Portal Job Number values", () => {
    expect(classifyPortalJobNumber(null)).toBe("none");
    expect(classifyPortalJobNumber("")).toBe("none");
    expect(classifyPortalJobNumber("1101")).toBe("installer_ref");
    expect(classifyPortalJobNumber("HV-3066")).toBe("linked");
    expect(classifyPortalJobNumber("hv-1589")).toBe("linked");
  });

  test("finds the Portal Job Number header item for write-back", () => {
    const it = portalJobNumberItem(audit());
    expect(it?.itemId).toBe("pjn1");
    expect(it?.type).toBe("textsingle");
    expect(it?.current).toBe("1101");
  });

  test("maps template ids to form kinds", () => {
    const ids = { readyCheck: "template_a2", readyCheckPriced: "template_a1" };
    expect(templateKindFor("template_a1", ids)).toBe("installer_form");
    expect(templateKindFor("template_a2", ids)).toBe("hivic_form");
    expect(templateKindFor("template_x", ids)).toBe("unknown");
  });

  test("address keys match across Mitti and portal formats", () => {
    expect(pickupAddressKey("2A Chatfield Street, Kingsville, Victoria, 3012"))
      .toBe(propertyAddressKey("2A Chatfield Street", "Kingsville"));
    expect(pickupAddressKey("824 High Street Road, Glen Waverley, Victoria, 3150"))
      .not.toBe(propertyAddressKey("2A Chatfield Street", "Kingsville"));
  });

  test("flags same-address and same-owner duplicates without blocking", () => {
    const jobs = [
      { id: "j1", job_number: "HV-2303", stage: "new_enquiry", owner: "Someone Else", addressLine: "2a Chatfield St", suburb: "Kingsville" },
      { id: "j2", job_number: "HV-9999", stage: "complete", owner: "Courtney Daniels", addressLine: "1 Other Street", suburb: "Mulgrave" },
      { id: "j3", job_number: "HV-8888", stage: "new_enquiry", owner: "Different Person", addressLine: "99 Nowhere Street", suburb: "Brighton" },
    ];
    const p = parsePickupAudit(audit())!;
    const d = pickupDuplicates(p, jobs);
    expect(d.map((x) => x.jobNumber).sort()).toEqual(["HV-2303", "HV-9999"]);
  });

  test("no duplicate flag when nothing matches", () => {
    const jobs = [{ id: "j3", job_number: "HV-8888", stage: "new_enquiry", owner: "Different Person", addressLine: "99 Nowhere Street", suburb: "Brighton" }];
    expect(pickupDuplicates(parsePickupAudit(audit())!, jobs)).toEqual([]);
  });
});
