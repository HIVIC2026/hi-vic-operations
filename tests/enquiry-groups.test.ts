import { describe, expect, test } from "bun:test";
import { automaticLeadEmail, classifyEnquiry, contactExclusion, sendHolds, primaryByContact, propertyKey, templateFor, realArea, GROUP_ORDER, type EnquiryInput, type ContactFacts } from "../src/lib/enquiry-groups.core";
import { captureLinkState, parseCapturePath, validateVideo, validateCaptureFile, homeownerVideoCount, capturePath } from "../src/lib/owner-capture.core";
import { GATE1_RULESET_VERSION } from "../src/lib/eligibility.core";

const passes = ["location", "residential", "ceiling_age", "previous_activity"].map((key) => ({ key, result: "pass" }));
const info = ["relevant_ceiling", "life_support", "occupancy", "area", "roof_access"].map((key) => ({ key, result: "info" }));
const audit = (ins: { result: string; fact?: string }, extra: object[] = []) => ({ ruleset_version: GATE1_RULESET_VERSION, rules: [...passes, ...info, { key: "existing_insulation", ...ins }, ...extra], hard_failures: [], review_reasons: [] });
const base = (o: Partial<EnquiryInput> = {}): EnquiryInput => ({ kind: "job", stage: "ready_check_ready_to_schedule", outcome: "likely_eligible", decisionSource: "system", reviewRequired: false, audit: audit({ result: "pass", fact: "owner: none" }), intakeWorkActive: false, area: { declared: 180 }, videoCount: 0, ...o });
const onsite = (o: Partial<EnquiryInput> = {}) => base({ outcome: "needs_onsite_confirmation", audit: audit({ result: "onsite", fact: "owner: present" }), declaredInsulation: "present", ...o });

describe("enquiry email groups", () => {
  test("likely with declared size -> group 1", () => expect(classifyEnquiry(base())).toMatchObject({ group: "likely_size", area: { m2: 180, source: "declared" } }));
  test.each([[null], [0], [NaN], [-5], [Infinity]])("bad area %p -> group 2 with assumed area, never declared", (v) => {
    const c = classifyEnquiry(base({ area: { declared: v as number | null } }));
    expect(c.group).toBe("likely_no_size");
    expect(c.area.source).toBe("assumed");
  });
  test("declared-unknown flag ignores a stray number", () => expect(classifyEnquiry(base({ area: { declared: 120, declaredUnknown: true } })).group).toBe("likely_no_size"));
  test("moves to group 1 when a real area arrives (measured wins)", () => {
    expect(classifyEnquiry(base({ area: {} })).group).toBe("likely_no_size");
    expect(classifyEnquiry(base({ area: { measured: 142, declared: 200 } })).area).toEqual({ m2: 142, source: "measured" });
  });
  test("insulation present + all other checks passed -> group 3", () => expect(classifyEnquiry(onsite()).group).toBe("insulation_check"));
  test("insulation present + roof concern -> other / review", () => expect(classifyEnquiry(onsite({ audit: audit({ result: "onsite", fact: "owner: present" }, [{ key: "roof_access", result: "onsite" }]) }))).toMatchObject({ group: "other", otherReason: "needs_review" }));
  test("insulation present + another check not passed -> not group 3", () => {
    const a = audit({ result: "onsite", fact: "owner: present" }); a.rules[1] = { key: "residential", result: "review" };
    expect(classifyEnquiry(onsite({ audit: a })).group).toBe("other");
  });
  test("unsure insulation goes to the insulation-details group, never to No", () => expect(classifyEnquiry(onsite({ declaredInsulation: "unknown", audit: audit({ result: "onsite", fact: "owner: unknown" }) })).group).toBe("insulation_check"));
  test("unanswered insulation question -> missing info", () => expect(classifyEnquiry(onsite({ declaredInsulation: null, audit: audit({ result: "onsite", fact: "unknown" }) }))).toMatchObject({ group: "other", otherReason: "missing_info" }));
  test("known fail wins even with present insulation", () => expect(classifyEnquiry(onsite({ outcome: "does_not_appear_eligible" })).otherReason).toBe("not_eligible"));
  test("stale system ruleset -> review", () => expect(classifyEnquiry(base({ audit: { ...audit({ result: "pass" }), ruleset_version: "old" } })).otherReason).toBe("needs_review"));
  test("admin decision stands even with old audit", () => expect(classifyEnquiry(base({ decisionSource: "admin", audit: { ruleset_version: "old", rules: [{ key: "previous_activity", result: "fail" }] } })).group).toBe("likely_size"));
  test("review required / no official / intake running / progressing / closed", () => {
    expect(classifyEnquiry(base({ reviewRequired: true, outcome: null })).otherReason).toBe("needs_review");
    expect(classifyEnquiry(base({ decisionSource: "preliminary" })).otherReason).toBe("missing_info");
    expect(classifyEnquiry(base({ intakeWorkActive: true })).otherReason).toBe("missing_info");
    expect(classifyEnquiry(base({ stage: "ready_check_scheduled" })).otherReason).toBe("progressing");
    expect(classifyEnquiry(base({ stage: "cancelled" })).otherReason).toBe("closed");
  });
  test("video upload flags priority but never grants a group", () => {
    expect(classifyEnquiry(onsite({ videoCount: 1 }))).toMatchObject({ group: "insulation_check", videoState: "received", nextAction: "Review video" });
    expect(classifyEnquiry(onsite({ videoCount: 1, declaredInsulation: "none", audit: audit({ result: "onsite", fact: "owner: none" }) })).group).toBe("other");
  });
  test("calculator registrations are never auto-screened", () => expect(classifyEnquiry({ ...base(), kind: "calculator", calculatorStatus: "new" })).toMatchObject({ group: "other", otherReason: "needs_review" }));
  test("exactly one group for a matrix of inputs; totals add up", () => {
    const inputs: EnquiryInput[] = [];
    for (const stage of ["new_enquiry", "ready_check_ready_to_schedule", "on_hold", "cancelled", "piesa_scheduled"])
      for (const outcome of ["likely_eligible", "needs_onsite_confirmation", "does_not_appear_eligible", null])
        for (const declared of [null, 0, 150]) for (const fact of ["owner: present", "owner: unknown", "owner: none"])
          inputs.push(base({ stage, outcome, area: { declared }, audit: audit({ result: fact === "owner: none" ? "pass" : "onsite", fact }) }));
    const counts = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0]));
    for (const i of inputs) { const c = classifyEnquiry(i); counts[c.group]++; expect(c.group === "other").toBe(c.otherReason !== null); }
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(inputs.length);
  });
  test("realArea ignores negative estimate", () => expect(realArea({ estimated: -1, declared: 90 })).toEqual({ m2: 90, source: "declared" }));
});

describe("email preparation rules", () => {
  const facts = (o: Partial<ContactFacts> = {}): ContactFacts => ({ id: "a", group: "likely_size", otherReason: null, email: "owner@homeowner.com.au", consent: "granted", optedOut: false, bounced: false, source: "base44", alreadySentCampaign: false, isPrimaryForContact: true, ...o });
  const sel = { group: "likely_size" as const, otherReason: null };
  test("clean contact is included", () => expect(contactExclusion(facts(), sel)).toBeNull());
  test.each([
    [{ group: "likely_no_size" as const }, "Group changed"], [{ email: null }, "invalid"], [{ email: "a@b" }, "invalid"], [{ consent: null }, "consent unknown"], [{ consent: "withdrawn" }, "withdrawn"],
    [{ isPrimaryForContact: false }, "Duplicate"], [{ alreadySentCampaign: true }, "Already sent"], [{ optedOut: true }, "Unsubscribed"], [{ bounced: true }, "Bounced"], [{ source: "qa_test" }, "Test"],
  ])("excluded: %p", (o, word) => expect(contactExclusion(facts(o), sel)).toContain(word));
  test("automatic-email scheduling rules never exclude a staff draft; they show as send holds", () => {
    expect(contactExclusion(facts(), sel)).toBeNull();
    const h = sendHolds({ commsEnabled: false, approval: "approved", purpose: "step3_estimate", stage: "ready_check_ready_to_schedule", source: "base44", createdAt: "2025-01-01T00:00:00Z", email: "owner@homeowner.com.au", jobsCreatedAfter: null });
    expect(h[0]).toContain("OFF"); expect(h.length).toBe(2);
    expect(sendHolds({ commsEnabled: true, approval: "draft", purpose: "insulation_video_request", stage: "new_enquiry", source: "base44", createdAt: new Date().toISOString(), email: "x@y.com", jobsCreatedAfter: null })).toEqual(["New template – needs approval before sending", "No manual send path yet – sending stays locked"]);
  });
  test("templates: group 3 draft, unchosen/other reasons blocked", () => {
    expect(templateFor("insulation_check", null)).toMatchObject({ key: "insulation_video_request", approval: "draft" });
    expect(templateFor("other", null).key).toBeNull();
    expect(templateFor("other", "needs_review").key).toBeNull();
    expect(templateFor("other", "not_eligible").key).toBe("preliminary_ineligible");
    expect(templateFor("likely_no_size", null).key).toBe("step3_estimate_assumed");
  });
  test("same contact + same property dedupes; different property is kept", () => {
    const k1 = propertyKey("12 Smith St", "3000"), k2 = propertyKey("12 smith st.", "3000"), k3 = propertyKey("40 Other Rd", "3000");
    expect(k1).toBe(k2);
    const p = primaryByContact([{ id: "1", email: "A@x.com", propKey: k1, createdAt: "2026-01-01" }, { id: "2", email: "a@x.com ", propKey: k2, createdAt: "2026-02-01" }, { id: "3", email: "a@x.com", propKey: k3, createdAt: "2026-01-01" }, { id: "4", email: null, propKey: k1, createdAt: "2026-03-01" }]);
    expect([...p].sort()).toEqual(["2", "3"]);
  });
});

describe("homeowner video capture", () => {
  const J = "11111111-1111-4111-8111-111111111111", O = "22222222-2222-4222-8222-222222222222", U = "33333333-3333-4333-8333-333333333333";
  const job = { stage: "ready_check_ready_to_schedule", outcome: "needs_onsite_confirmation", decisionSource: "system", reviewRequired: false };
  const live = { status: "active", expires_at: new Date(Date.now() + 864e5).toISOString() };
  test("link states: valid, expired, revoked, missing, closed job, review", () => {
    expect(captureLinkState(live, job)).toBe("ok");
    // Jo 1 Nov 2026: no time limit — an old date on an active link still works (Chris Machar HV-1083 case).
    expect(captureLinkState({ ...live, expires_at: "2020-01-01" }, job)).toBe("ok");
    expect(captureLinkState({ status: "active", expires_at: "2026-10-30T23:10:13Z" }, { stage: "preliminary_estimate_ready", outcome: "needs_onsite_confirmation", decisionSource: "system", reviewRequired: false }, Date.parse("2026-11-01"))).toBe("ok");
    expect(captureLinkState({ ...live, status: "revoked" }, job)).toBe("invalid");
    expect(captureLinkState(null, job)).toBe("invalid");
    expect(captureLinkState(live, { ...job, stage: "cancelled" })).toBe("closed");
    expect(captureLinkState(live, { ...job, reviewRequired: true })).toBe("invalid");
  });
  test("upload path is bound to the link's job (no cross-job)", () => {
    const p = capturePath(J, U, "video/quicktime");
    expect(parseCapturePath(J, p)).toBe(U);
    expect(parseCapturePath(O, p)).toBeNull();
    expect(parseCapturePath(J, `${J}/intake/base44/${U}.mp4`)).toBeNull();
    expect(parseCapturePath(J, `${J}/intake/owner-capture/../x.mp4`)).toBeNull();
  });
  test("iPhone MOV/MP4 accepted; other types and oversize refused", () => {
    expect(validateVideo({ mime: "video/quicktime", fileName: "IMG_1.MOV", size: 1e6 }).ok).toBe(true);
    expect(validateVideo({ mime: "", fileName: "clip.mp4", size: 1e6 }).ok).toBe(true);
    expect(validateVideo({ mime: "application/pdf", fileName: "a.pdf", size: 10 }).ok).toBe(false);
    expect(validateCaptureFile({ mime: "image/jpeg", fileName: "roof.jpg", size: 10 }).ok).toBe(true);
    expect(validateVideo({ mime: "video/mp4", fileName: "a.mp4", size: 300 * 1024 * 1024 }).ok).toBe(false);
  });
  test("Base44 homeowner videos count once; trade/photos do not", () => expect(homeownerVideoCount([
    { kind: "intake_media", mime_type: "video/quicktime", storage_path: "a" }, { kind: "intake_media", mime_type: "video/quicktime", storage_path: "a" },
    { kind: "intake_media", mime_type: "image/jpeg", storage_path: "b" }, { kind: "evidence", mime_type: "video/mp4", storage_path: "c" },
  ])).toBe(1));
});

import { enquiryStatus, STATUS_ORDER } from "../src/lib/enquiry-groups.core";
describe("one office status per enquiry", () => {
  const b = { spotSaved: false, ineligible: false, ineligibleEmailSent: false, campaignSent: false, insulationEmailSent: false, campaignGroup: null as "likely" | "onsite" | null };
  test("spot saved wins over everything", () => expect(enquiryStatus({ ...b, spotSaved: true, ineligible: true, campaignSent: true, campaignGroup: "likely" })).toBe("spot_saved"));
  test("ineligible is final only once its email sent", () => expect(enquiryStatus({ ...b, ineligible: true, ineligibleEmailSent: true })).toBe("ineligible"));
  test("unsent ineligible needs attention", () => expect(enquiryStatus({ ...b, ineligible: true })).toBe("needs_attention"));
  test("likely email sent -> offering spot", () => expect(enquiryStatus({ ...b, campaignSent: true, campaignGroup: "likely" })).toBe("offered_spot"));
  test("onsite email sent -> insulation details needed", () => expect(enquiryStatus({ ...b, campaignSent: true, campaignGroup: "onsite" })).toBe("insulation_requested"));
  test("video request sent -> insulation details needed", () => expect(enquiryStatus({ ...b, insulationEmailSent: true })).toBe("insulation_requested"));
  test("nothing sent -> needs attention", () => expect(enquiryStatus(b)).toBe("needs_attention"));
  test("five statuses, no overlap", () => expect(new Set(STATUS_ORDER).size).toBe(5));
});

describe("one automatic email route", () => {
  const baseRoute = { source: "base44", channel: "hivic_sourced", decisionSource: "system", reviewRequired: false, intakeWorkActive: false, outcome: "likely_eligible", declaredInsulation: "none" as const, ownerEnteredArea: true };
  test("eligible no-insulation owner with entered size gets the spot offer", () => expect(automaticLeadEmail(baseRoute)).toEqual({ email: "offer_spot", blocker: null }));
  test("existing insulation gets the existing-insulation offer (Jo 23 Oct)", () => expect(automaticLeadEmail({ ...baseRoute, outcome: "needs_onsite_confirmation", declaredInsulation: "present" })).toEqual({ email: "offer_spot", blocker: null, existingInsulation: true }));
  test("decision 392: unsure insulation gets the same existing-insulation Save my spot, never the questions email", () => expect(automaticLeadEmail({ ...baseRoute, outcome: "needs_onsite_confirmation", declaredInsulation: "unknown" })).toEqual({ email: "offer_spot", blocker: null, existingInsulation: true, insulationUnknown: true }));
  test("decision 417: an Office-reviewed unsure owner gets Save my spot (no office hold)", () => expect(automaticLeadEmail({ ...baseRoute, outcome: "needs_onsite_confirmation", declaredInsulation: "unknown", officeReviewed: true })).toMatchObject({ email: "offer_spot", blocker: null, existingInsulation: true }));
  test("official ineligible gets the ineligible email", () => expect(automaticLeadEmail({ ...baseRoute, outcome: "does_not_appear_eligible", declaredInsulation: "unknown" })).toEqual({ email: "ineligible", blocker: null }));
  test.each([
    [{ source: "qa_test" }, "TEST"], [{ reviewRequired: true }, "office review"], [{ intakeWorkActive: true }, "still running"], [{ decisionSource: null }, "missing"],
  ])("unsafe route %p is held with one reason", (change, reason) => {
    const result = automaticLeadEmail({ ...baseRoute, ...change });
    expect(result.email).toBe("none"); expect(result.blocker).toContain(reason);
  });
});

describe("office photo/video review outcomes (Jo, 8 Oct)", () => {
  const audit = { ruleset_version: GATE1_RULESET_VERSION, rules: [
    { key: "location", result: "pass" }, { key: "residential", result: "pass" }, { key: "ceiling_age", result: "pass" },
    { key: "previous_activity", result: "pass" }, { key: "roof_access", result: "pass" }, { key: "existing_insulation", result: "onsite" },
  ] };
  const base = { kind: "job" as const, stage: "eligibility_review", outcome: "needs_onsite_confirmation", decisionSource: "system", reviewRequired: false,
    audit, intakeWorkActive: false, declaredInsulation: "present" as const, area: { declared: 120 }, videoCount: 2 };
  test("below R2 moves to the Save my spot offer group", () => {
    const c = classifyEnquiry({ ...base, officeInsulation: "below_r2" });
    expect(c.group).toBe("likely_size"); expect(c.reason).toContain("below R2");
  });
  test("below R2 without a size uses the assumed-size offer group", () => {
    const c = classifyEnquiry({ ...base, area: {}, officeInsulation: "below_r2" });
    expect(c.group).toBe("likely_no_size");
  });
  test("over R2 moves to ineligible", () => {
    const c = classifyEnquiry({ ...base, officeInsulation: "over_r2" });
    expect(c.group).toBe("other"); expect(c.otherReason).toBe("not_eligible"); expect(c.reason).toContain("R2 or above");
  });
  test("unclear stays in the insulation group asking for more pictures", () => {
    const c = classifyEnquiry({ ...base, officeInsulation: "unclear" });
    expect(c.group).toBe("insulation_check"); expect(c.nextAction).toBe("Request more photos");
  });
  test("no review keeps the original insulation-check grouping", () => {
    const c = classifyEnquiry(base);
    expect(c.group).toBe("insulation_check"); expect(c.nextAction).toBe("Review video");
  });
  test("review never overrides a recorded hard fail", () => {
    const c = classifyEnquiry({ ...base, outcome: "does_not_appear_eligible", audit: { ...audit, hard_failures: ["Previous upgrade"] }, officeInsulation: "below_r2" });
    expect(c.otherReason).toBe("not_eligible");
  });
});
