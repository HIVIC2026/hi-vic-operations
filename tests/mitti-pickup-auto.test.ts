import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { parsePickupAudit, pickupAddressParts, pickupAutoDecision, needsFinishingText, typedJobDecision, type TypedPickupJob } from "../src/lib/mitti-pickup.core";
import { provisionalGivesWayToMitti } from "../src/lib/measurement.core";
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
    expect(a).toEqual({ phone: null, email: null, contactPermission: null, electricianChoice: null, electricianPriceIncGst: null, electricianName: null, electricianLicence: null, productOption: null });
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
  test("our own HIVIC form started by a matched installer = their lead, flagged; unmatched → review", () => {
    const d = pickupAutoDecision({ ...clean, templateKind: "hivic_form" });
    expect(d.action).toBe("create_job");
    expect(d.officeFlag).toContain("installer's own lead");
    const u = pickupAutoDecision({ ...clean, templateKind: "hivic_form", businessMatched: false });
    expect(u.action).toBe("office_review");
    expect(u.reasons.join(" ")).toContain("own form");
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
  test("existing owner/address links to that job and flags the office, never a new job (Jo 23 Oct)", () => {
    const d = pickupAutoDecision({ ...clean, duplicates: [{ jobNumber: "HV-1101" }] });
    expect(d.action).toBe("link_existing");
    expect(d.officeFlag).toContain("HV-1101");
  });
  test("A1 vs A2 history labels", () => {
    const { pickupFormLabel } = require("../src/lib/mitti-pickup.core");
    expect(pickupFormLabel("installer_form")).toBe("A1");
    expect(pickupFormLabel("hivic_form")).toBe("A2");
  });
  test("unknown ceiling size never stops a Mitti installer job", async () => {
    const { intakeJobFacts } = await import("../src/lib/enquiry.server");
    expect(() => intakeJobFacts({ estimated_area_m2: null }, "installer_mitti", { channel: "installer_sourced", businessId: "b", userId: "u" } as never)).not.toThrow();
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

test("Jo 23 Oct: a picked-up Mitti job is marked installer-led (else commercialBlocker stops owner acceptance)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/lib/mitti-pickup-auto.server.ts", "utf8");
  const create = src.indexOf("await upsertEnquiry("), mark = src.indexOf('update({ installer_led: true })'), link = src.indexOf("await linkMittiReadyCheckToJob(null, { auditId: r.auditId, jobId: created.job_id }");
  expect(create).toBeGreaterThan(0);
  expect(mark).toBeGreaterThan(create);
  expect(mark).toBeLessThan(link);
});

// Jo 24 Oct (HV-3164): Deep started the A1 himself and typed the HV number; it was skipped and never synced.
describe("typed HV number on an installer-started form", () => {
  const stages = ["preliminary_estimate_ready", "ready_check_scheduled"];
  const job: TypedPickupJob = { jobId: "j1", jobNumber: "HV-3164", stage: "preliminary_estimate_ready", channel: "installer_sourced", deleted: false, businessId: "reinsulate", hasOtherMittiForm: false };
  test("his own installer job before the Ready Check links automatically", () =>
    expect(typedJobDecision("HV-3164", job, "reinsulate", stages)).toEqual({ action: "link", jobId: "j1", jobNumber: "HV-3164" }));
  test.each([
    [null, "reinsulate", "Form says HV-3164 but there is no such job"],
    [{ ...job, deleted: true }, "reinsulate", "Form says HV-3164 but there is no such job"],
    [job, null, "Form says HV-3164 but the Mitti user is not matched to an installer business"],
    [job, "other", "Form says HV-3164, which is not this installer's job"],
    [{ ...job, channel: "hivic_sourced" }, "reinsulate", "Form says HV-3164, which is not this installer's job"],
    [{ ...job, stage: "measured_quote_accepted" }, "reinsulate", "Form says HV-3164, which is past the Ready Check (measured_quote_accepted)"],
    [{ ...job, hasOtherMittiForm: true }, "reinsulate", "Form says HV-3164, which already has its own Mitti Ready Check form"],
  ] as [TypedPickupJob | null, string | null, string][])("office review: %#", (j, biz, reason) =>
    expect(typedJobDecision("HV-3164", j, biz, stages)).toEqual({ action: "office_review", reasons: [reason] }));
  test("the scan no longer drops forms with a typed HV number", () => {
    const src = readFileSync("src/lib/mitti-pickup.server.ts", "utf8");
    expect(src).not.toContain(`=== "linked") continue`);
    expect(src).toContain("typedJob: await typedPickupJob(");
  });
});

describe("provisional Add-job size gives way to the Mitti form", () => {
  const prov = { provenance: "installer_supplied_provisional", status: "needs_review", external_source: "installer_import", accepted_by: null };
  test("provisional, unlinked, unaccepted → replaced (kept as history)", () => expect(provisionalGivesWayToMitti(prov)).toBe(true));
  test.each([
    [{ ...prov, status: "complete" }], [{ ...prov, external_source: "mitti" }], [{ ...prov, accepted_by: "office" }],
    [{ ...prov, provenance: "onsite_measured" }], [null],
  ])("never replaces %o", (m) => expect(provisionalGivesWayToMitti(m)).toBe(false));
  test("link supersedes rather than relabelling the provisional row", () => {
    const src = readFileSync("src/lib/mitti.server.ts", "utf8");
    expect(src).toMatch(/update\(\{ is_current: false \}\)\.eq\("id", m\.id\)/);
  });
});
