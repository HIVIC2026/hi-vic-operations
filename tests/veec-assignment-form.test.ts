import { describe, expect, test } from "bun:test";
import {
  AP_DECLARATION, AP_NAME_ON_FORM, CONSUMER_DECLARATION, INSTALLER_DECLARATION, SECTION_1_CONSUMER_RIGHTS, SMS_SEGMENT_LIMIT, VEEC_COPY_EMAIL_APPROVED, VEEC_FORM_BODY, VEEC_FORM_FIELDS, VEEC_SIGN_EMAIL_APPROVED, VEEC_SIGN_SMS_APPROVED,
  apPrerequisiteBlockers, nextVeecReminderStep, veecCopyDueAt, veecPrefill, veecSignReminderText, veecSignRequestText, type VeecFacts,
} from "../src/lib/veec-assignment-form.core";
import { ASSIGNMENT_VEEC_BLOCKER, finalAssignmentAvailability, parseFormFields, type Template } from "../src/lib/assignment.core";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";

const facts: VeecFacts = {
  ap: { fullName: "Jo Lowe", companyName: "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria", companyAddress: "1 Test St, Testville VIC 3000", phone: "03 0000 0000" },
  electrician: { name: "TEST Sparky", phone: "0400 000 000", licence: "A-00000", company: "TEST REC Pty Ltd", companyAddress: "2 Test St", recNumber: "REC-00000" },
  ces: { issued: false, number: null },
  installers: [{ name: "TEST Installer", company: "TEST Insulation Co", phone: "0400 000 001", eec: "EEC-0001" }],
  installationAddress: "3 Test St, Testville VIC 3000", dateCompleted: "2026-10-20",
  areas: [{ name: "Area 1", existing: "uninsulated", existingRValue: null, removed: false, productType: "48A", brand: "TestBatt", model: "R5.0 Ceiling", rValue: "R5.0", areaM2: 120 }],
  priceBeforeIncentive: 3300, consumerPaymentAfter: 1500, benefitAmount: 1800,
  consumer: { name: "TEST Owner", phone: "0400 000 002", email: "test.owner@example.test" },
};

describe("official ESC VEEC assignment form v1.1", () => {
  test("declarations are the official words with the AP name filled and no placeholder left", () => {
    for (const s of [SECTION_1_CONSUMER_RIGHTS, AP_DECLARATION, CONSUMER_DECLARATION]) { expect(s).toContain(AP_NAME_ON_FORM); expect(s).not.toContain("<insert name of accredited person>"); }
    expect(AP_DECLARATION).toContain("I <insert name> am the authorised representative of"); // the signer's own name is typed at signing
    expect(AP_DECLARATION).toContain("the consumer has been provided with a copy of the warranty against defects (with a minimum period of 5 years) for any product(s) installed.");
    expect(INSTALLER_DECLARATION).toContain("I am certified by the Energy Efficiency Council (EEC) as a Certified Insulation Installer");
    expect(CONSUMER_DECLARATION).toContain("to the best of my knowledge, the information provided by the installer in Section 2 is correct and complete");
    expect(VEEC_FORM_BODY.indexOf("Section 1")).toBeLessThan(VEEC_FORM_BODY.indexOf("Section 3"));
    expect(VEEC_FORM_BODY.indexOf("Part A: Accredited person declaration")).toBeLessThan(VEEC_FORM_BODY.indexOf("Part B: Declaration by lead installer"));
    expect(VEEC_FORM_BODY.indexOf("Section 4")).toBeGreaterThan(VEEC_FORM_BODY.indexOf("Installer signature:"));
  });
  test("every Section 2 field survives parseFormFields and the co-payment default is Price reduction", () => {
    const parsed = parseFormFields(JSON.parse(JSON.stringify(VEEC_FORM_FIELDS)));
    expect(parsed.length).toBe(VEEC_FORM_FIELDS.length);
    expect(parsed.map((f) => f.key)).toEqual(VEEC_FORM_FIELDS.map((f) => f.key));
    for (const k of ["ap_full_name", "elec_rec_number", "ces_issued", "ces_number", "installer_1_eec", "installer_4_eec", "installation_address", "date_completed", "area_1_existing_type", "area_1_not_metallic", "area_1_product_type", "area_3_area_m2", "price_before_incentive", "consumer_payment_after", "benefit_form", "benefit_amount", "consumer_email"]) expect(parsed.some((f) => f.key === k)).toBe(true);
    expect(veecPrefill(facts).values["benefit_form"]).toBe("Price reduction");
  });
  test("prefill fills from facts, blanks stay blank and are named; CES number required only when issued", () => {
    const full = veecPrefill(facts);
    expect(full.missing).toEqual([]);
    expect(full.values["area_1_product_type"]).toBe("48A: Bulk insulation batt or blanket product");
    expect(full.values["area_1_removed"]).toBe("No");
    expect(full.values["benefit_amount"]).toBe(1800);
    const gaps = veecPrefill({ ...facts, ap: { ...facts.ap, phone: null }, installers: [], ces: { issued: true, number: null } });
    expect(gaps.missing).toContain("Accredited person – phone number");
    expect(gaps.missing).toContain("Installer EEC Certification number");
    expect(gaps.missing).toContain("Certificate of Electrical Safety number");
    expect(gaps.values["installer_2_name"]).toBeUndefined();
    // office override fills a gap; an empty override never overwrites a fact
    expect(veecPrefill({ ...facts, ap: { ...facts.ap, phone: null } }, { ap_phone: "03 1111 1111", consumer_email: "" }).missing).toEqual([]);
  });
  test("AP may sign only once the four prerequisites are recorded (24h rule for PIESA copies and ESC notice)", () => {
    const start = "2026-10-20T22:00:00.000Z"; // install starts
    const ok = { installStart: start, piesaCopyToInstallerAt: "2026-10-18T00:00:00Z", piesaCopyToOwnerAt: "2026-10-18T00:00:00Z", escNotificationSentAt: "2026-10-19T00:00:00Z", warrantyCopyProvidedAt: "2026-10-21T00:00:00Z", collectionNotices: [{ installer: "TEST Installer", providedAt: "2026-10-01T00:00:00Z" }] };
    expect(apPrerequisiteBlockers(ok)).toEqual([]);
    expect(apPrerequisiteBlockers({ ...ok, escNotificationSentAt: "2026-10-20T10:00:00Z" })[0]).toMatch(/ESC installation notification/);
    expect(apPrerequisiteBlockers({ ...ok, piesaCopyToOwnerAt: null })[0]).toMatch(/PIESA copy to the owner/);
    expect(apPrerequisiteBlockers({ ...ok, warrantyCopyProvidedAt: null })[0]).toMatch(/warranty/);
    expect(apPrerequisiteBlockers({ ...ok, collectionNotices: [{ installer: "TEST Installer", providedAt: null }] })[0]).toMatch(/collection notice to TEST Installer/);
    expect(apPrerequisiteBlockers({ ...ok, collectionNotices: [] })[0]).toMatch(/No installer/);
  });
  test("form availability no longer needs AP review or a separate installer declaration; blocker says the owner must sign", () => {
    const T = (k: string): Template => ({ template_key: k, version: "v", body: "x", approved: true, is_active: true, required: true });
    expect(finalAssignmentAvailability({ installationCompleted: true, agreementSigned: true, templates: [T("consumer_declaration")] })).toEqual([]);
    expect(finalAssignmentAvailability({ installationCompleted: false, agreementSigned: true, templates: [T("consumer_declaration")] })[0]).toMatch(/not yet recorded as complete/);
    expect(ASSIGNMENT_VEEC_BLOCKER).toMatch(/owner has not signed/);
  });
});

describe("decision 120: request + reminders", () => {
  const done = "2026-10-20T04:00:00.000Z";
  test("request at completion, then days 1, 3, 7, office alert day 10, nothing after signing", () => {
    expect(nextVeecReminderStep({ installCompletedAt: done, consumerSignedAt: null, done: [], now: done })).toBe("request");
    expect(nextVeecReminderStep({ installCompletedAt: done, consumerSignedAt: null, done: ["request"], now: "2026-10-20T20:00:00Z" })).toBeNull();
    expect(nextVeecReminderStep({ installCompletedAt: done, consumerSignedAt: null, done: ["request"], now: "2026-10-21T04:00:00Z" })).toBe("reminder_1");
    expect(nextVeecReminderStep({ installCompletedAt: done, consumerSignedAt: null, done: ["request", "reminder_1"], now: "2026-10-23T05:00:00Z" })).toBe("reminder_3");
    expect(nextVeecReminderStep({ installCompletedAt: done, consumerSignedAt: null, done: ["request", "reminder_1", "reminder_3"], now: "2026-10-27T05:00:00Z" })).toBe("reminder_7");
    expect(nextVeecReminderStep({ installCompletedAt: done, consumerSignedAt: null, done: ["request", "reminder_1", "reminder_3", "reminder_7"], now: "2026-10-30T05:00:00Z" })).toBe("office_alert_10");
    expect(nextVeecReminderStep({ installCompletedAt: done, consumerSignedAt: "2026-10-22T00:00:00Z", done: ["request"], now: "2026-11-30T00:00:00Z" })).toBeNull();
    expect(nextVeecReminderStep({ installCompletedAt: null, consumerSignedAt: null, done: [], now: done })).toBeNull();
    // a missed earlier step is sent before a later one (one per sweep, in order)
    expect(nextVeecReminderStep({ installCompletedAt: done, consumerSignedAt: null, done: [], now: "2026-10-30T05:00:00Z" })).toBe("request");
  });
  test("texts: under two segments, secure link, STOP line; everything held behind unapproved flags", () => {
    const link = "https://estimate.homeinsulationvictoria.com.au/my-job/abcdefghijklmnopqrstuvwxyz0123456789ABCD?screen=done";
    for (const t of [veecSignRequestText(1800, link), veecSignReminderText(1800, link)]) { expect(t.length).toBeLessThan(SMS_SEGMENT_LIMIT); expect(t).toContain(link); expect(t).toContain("Reply STOP to opt out"); expect(t).toContain("$1,800"); }
    expect(veecSignReminderText(1800, link)).toMatch(/still needs your signature/);
    expect(VEEC_COPY_EMAIL_APPROVED).toBe(false); expect(VEEC_SIGN_EMAIL_APPROVED).toBe(false); expect(VEEC_SIGN_SMS_APPROVED).toBe(false);
    expect(SMS_MESSAGE_TYPES.veec_sign_request.wordingApproved).toBe(true); // decision 166
    expect(SMS_MESSAGE_TYPES.veec_sign_reminder.wordingApproved).toBe(true); // decision 168
  });
  test("copy due within 10 Melbourne business days of the owner's signature", () => {
    // 20 Oct + 10 business days = 3 Nov, but 3 Nov 2026 is Melbourne Cup Day (Victorian public holiday) → 4 Nov.
    expect(veecCopyDueAt("2026-10-20T04:00:00.000Z").slice(0, 10)).toBe("2026-11-04");
  });
});
