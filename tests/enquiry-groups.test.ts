import { describe, expect, test } from "bun:test";
import { classifyEnquiry, exclusionFor, primaryByEmail, templateFor, realArea, GROUP_ORDER, type EnquiryInput, type ContactFacts } from "../src/lib/enquiry-groups.core";
import { GATE1_RULESET_VERSION } from "../src/lib/eligibility.core";

const passes = ["location", "residential", "ceiling_age", "previous_activity"].map((key) => ({ key, result: "pass" }));
const info = ["relevant_ceiling", "life_support", "occupancy", "area", "roof_access"].map((key) => ({ key, result: "info" }));
const audit = (ins: { result: string; fact?: string }, extra: object[] = []) => ({ ruleset_version: GATE1_RULESET_VERSION, rules: [...passes, ...info, { key: "existing_insulation", ...ins }, ...extra], hard_failures: [], review_reasons: [] });
const base = (o: Partial<EnquiryInput> = {}): EnquiryInput => ({ kind: "job", stage: "ready_check_ready_to_schedule", outcome: "likely_eligible", decisionSource: "system", reviewRequired: false, audit: audit({ result: "pass", fact: "owner: none" }), intakeWorkActive: false, area: { declared: 180 }, videoCount: 0, ...o });
const onsite = (o: Partial<EnquiryInput> = {}) => base({ outcome: "needs_onsite_confirmation", audit: audit({ result: "onsite", fact: "owner: present" }), ...o });

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
  test("unknown insulation never becomes No or group 3", () => expect(classifyEnquiry(onsite({ audit: audit({ result: "onsite", fact: "owner: unknown" }) }))).toMatchObject({ group: "other", otherReason: "missing_info" }));
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
    expect(classifyEnquiry(onsite({ videoCount: 1, audit: audit({ result: "onsite", fact: "owner: unknown" }) })).group).toBe("other");
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
  const facts = (o: Partial<ContactFacts> = {}): ContactFacts => ({ id: "a", group: "likely_size", otherReason: null, email: "owner@homeowner.com.au", consent: "granted", optedOut: false, bounced: false, stage: "new_enquiry", source: "base44", createdAt: new Date().toISOString(), alreadySent: false, jobsCreatedAfter: "2026-01-01T00:00:00Z", isPrimaryForEmail: true, ...o });
  const sel = { group: "likely_size" as const, otherReason: null };
  test("clean contact is included", () => expect(exclusionFor(facts(), sel, "step3_estimate")).toBeNull());
  test.each([
    [{ group: "likely_no_size" as const }, "Group changed"], [{ email: null }, "Missing"], [{ consent: "unknown" }, "consent unknown"], [{ consent: "withdrawn" }, "withdrawn"],
    [{ isPrimaryForEmail: false }, "Duplicate"], [{ alreadySent: true }, "Already sent"], [{ optedOut: true }, "Unsubscribed"], [{ bounced: true }, "Bounced"],
    [{ createdAt: "2025-01-01T00:00:00Z" }, "before delivery start"], [{ jobsCreatedAfter: null }, "Delivery start date not set"],
  ])("excluded: %p", (o, word) => expect(exclusionFor(facts(o), sel, "step3_estimate")).toContain(word));
  test("templates: group 3 and unchosen Other are blocked, not faked", () => {
    expect(templateFor("insulation_check", null).key).toBeNull();
    expect(templateFor("other", null).key).toBeNull();
    expect(templateFor("other", "needs_review").key).toBeNull();
    expect(templateFor("other", "not_eligible").key).toBe("preliminary_ineligible");
    expect(templateFor("likely_no_size", null).key).toBe("step3_estimate_likely");
  });
  test("newest enquiry per email is the primary contact", () => {
    const p = primaryByEmail([{ id: "1", email: "A@x.com", createdAt: "2026-01-01" }, { id: "2", email: "a@x.com ", createdAt: "2026-02-01" }, { id: "3", email: null, createdAt: "2026-03-01" }]);
    expect([...p]).toEqual(["2"]);
  });
});
