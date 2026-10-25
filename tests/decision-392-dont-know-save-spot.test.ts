// Decision 392 (Jo, owner, 25 Oct 2026): "This is just for people who enquired BEFORE WE STARTED asking these questions in
// the website" — chose "Save my spot email". A NEW website enquirer who ticks "don't know" gets the existing-insulation
// Save my spot email (removal card, truthful "don't know" intro), never the 3 questions email. The actual router runs here
// with isolated reads and stubbed senders only: no hosted writes, no delivery.
// Run alone: bun test tests/decision-392-dont-know-save-spot.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test";

let insulation: string, reviewOutcome: string | null, events: { event_type: string; details: unknown; summary?: string }[];
let calls: string[], gateOpts: unknown[];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  let fields = "", inserted: Record<string, unknown> | null = null;
  const answer = () => {
    if (inserted) return { data: null, error: null };
    if (table === "jobs" && fields === "created_at, job_number") return { data: { created_at: "2026-10-25T01:00:00Z", job_number: "HV-ORDINARY" }, error: null };
    if (table === "jobs" && fields === "job_number") return { data: { job_number: "HV-ORDINARY" }, error: null };
    if (table === "jobs") return { data: { life_support_status: "no", source: "base44", channel: "hivic_sourced", eligibility_outcome: "needs_onsite_confirmation", eligibility_decision_source: "system", eligibility_review_required: false, estimated_area_m2: 150, estimated_area_unknown: false, properties: { state: "VIC", enrichment: { base44: { raw: { answers: { existing_insulation: insulation } } } } } }, error: null };
    if (table === "post_intake_work") return { data: table === "post_intake_work" && fields === "id" ? null : [], error: null };
    if (table === "customer_engagement_events") return { data: reviewOutcome ? [{ metadata: { outcome: reviewOutcome } }] : [], error: null };
    if (table === "workflow_events") return { data: events, error: null };
    if (table === "lead_campaign_responses") return { data: null, error: null };
    return { data: null, error: null };
  };
  const q = { select(s: string) { fields = s; return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
    insert(row: Record<string, unknown>) { inserted = row; if (table === "workflow_events") events.push(row as never); return q; },
    maybeSingle: async () => answer(), then(resolve: (v: unknown) => unknown) { return Promise.resolve(answer()).then(resolve); } };
  return q;
} } }));
mock.module("../src/lib/save-spot-rules.server", () => ({
  readAutomaticRules: async () => ({ state: "ok", config: { enabled: true, activatedAt: "2026-10-25T00:00:00Z" } }),
  automaticSaveSpotGate: async (_id: string, opts: unknown) => { gateOpts.push(opts); return { allowed: true }; },
}));
mock.module("../src/lib/initial-response-history.server", () => ({ initialResponseHistoryBlocker: async () => null }));
mock.module("../src/lib/service-coverage.server", () => ({ serviceCoverageEstablished: async () => true, SERVICE_AREA_REASON: "area" }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async () => { calls.push("sync"); } }));
mock.module("../src/lib/group-b-media.server", () => ({ groupBMediaForJob: async () => ({ received: false, uncertain: false, excluded: false, count: 0, pendingSync: false }) }));
mock.module("../src/lib/hot-leads-send.server", () => ({
  sendExistingInsulationSaveSpot: async () => { calls.push("save_spot_existing"); return { outcome: "sent", detail: "stub" }; },
  sendAutomaticInsulationDetails: async () => { calls.push("questions"); return { outcome: "sent", detail: "stub" }; },
  sendSaveMySpot: async () => { calls.push("save_spot_plain"); return [{ outcome: "sent", detail: "stub" }]; },
}));
const { maybeAutoRouteLeadEmail } = await import("../src/lib/lead-email-routing.server");
const { automaticLeadEmail } = await import("../src/lib/enquiry-groups.core");
const { PRESENT_AUTO_OFFER_EVENT, presentAutoOfferDetails, qualifyingDeclaration, answeredInsulationDeclaration } = await import("../src/lib/insulation-review.core");
const { existingInsulationRules, DEFAULT_FILTERS } = await import("../src/lib/save-spot-rules.core");
const { existingInsulationTemplateFacts } = await import("../src/lib/existing-insulation-template.core");
const { renderJoOutcomeEmail, basisLine, O2_DONT_KNOW_INTRO } = await import("../src/lib/jo-outcome-email.core");
const { preReleaseViolations } = await import("../src/lib/spot-only-copy.core");
const { INSULATION_DETAILS_REAL_SEND_APPROVED } = await import("../src/lib/hot-leads.core");
const { INSULATION_QUESTIONS_SEND_APPROVED } = await import("../src/lib/insulation-questions-campaign.core");

beforeEach(() => { insulation = "Don't know"; reviewOutcome = null; events = []; calls = []; gateOpts = []; });

describe("selector", () => {
  const base = { source: "base44", channel: "hivic_sourced", decisionSource: "system", reviewRequired: false, intakeWorkActive: false, ownerEnteredArea: true } as const;
  for (const outcome of ["likely_eligible", "needs_onsite_confirmation"]) {
    test(`${outcome} + don't know → existing-insulation Save my spot`, () =>
      expect(automaticLeadEmail({ ...base, outcome, declaredInsulation: "unknown" })).toEqual({ email: "offer_spot", blocker: null, existingInsulation: true, insulationUnknown: true }));
  }
  test("no owner size keeps the labelled typical-size flag", () => expect(automaticLeadEmail({ ...base, outcome: "likely_eligible", declaredInsulation: "unknown", ownerEnteredArea: false }).assumedArea).toBe(true));
  test("an Office-reviewed don't-know keeps the reviewed path", () => expect(automaticLeadEmail({ ...base, outcome: "needs_onsite_confirmation", declaredInsulation: "unknown", officeReviewed: true }).email).toBe("request_insulation"));
  test("present is unchanged (no insulationUnknown); unanswered stays with the Office; ineligible stays ineligible", () => {
    expect(automaticLeadEmail({ ...base, outcome: "needs_onsite_confirmation", declaredInsulation: "present" })).toEqual({ email: "offer_spot", blocker: null, existingInsulation: true });
    expect(automaticLeadEmail({ ...base, outcome: "needs_onsite_confirmation", declaredInsulation: null }).email).toBe("none");
    expect(automaticLeadEmail({ ...base, outcome: "does_not_appear_eligible", declaredInsulation: "unknown" }).email).toBe("ineligible");
    expect(automaticLeadEmail({ ...base, outcome: "needs_onsite_confirmation", declaredInsulation: "unknown", source: "qa_test" }).email).toBe("none");
  });
});

describe("actual router", () => {
  test("don't know records the honest qualification, then sends the existing-insulation Save my spot — never the questions email", async () => {
    expect(await maybeAutoRouteLeadEmail("job")).toEqual({ route: "offer_spot", sent: true, reason: "stub" });
    expect(calls).toEqual(["sync", "save_spot_existing"]);
    expect(gateOpts).toEqual([{ route: "offer_spot", coverageVerified: true, existingInsulationOffer: "unknown" }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: PRESENT_AUTO_OFFER_EVENT, details: { answer: "unknown", declaration_type: "unknown_auto_offer", basis: "owner_declared" } });
    expect(String(events[0]!.summary)).toContain("doesn't know");
  });
  test("present still records the present qualification", async () => {
    insulation = "Yes";
    await maybeAutoRouteLeadEmail("job");
    expect(gateOpts).toEqual([{ route: "offer_spot", coverageVerified: true, existingInsulationOffer: true }]);
    expect(events[0]).toMatchObject({ details: { answer: "yes", declaration_type: "present_auto_offer" } });
  });
  test("an Office review keeps the reviewed request path (no new qualification recorded)", async () => {
    reviewOutcome = "unclear";
    expect((await maybeAutoRouteLeadEmail("job")).route).toBe("request_insulation");
    expect(calls).not.toContain("save_spot_existing");
    expect(events).toEqual([]);
  });
});

describe("guards accept the don't-know offer exactly, nothing wider", () => {
  test("qualifyingDeclaration: the exact unknown record qualifies; altered shapes don't", () => {
    const ok = presentAutoOfferDetails("unknown");
    expect(qualifyingDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: ok }])).toBe(true);
    expect(qualifyingDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: { ...ok, declaration_type: "present_auto_offer" } }])).toBe(false);
    expect(qualifyingDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: { ...ok, basis: "office" } }])).toBe(false);
    expect(qualifyingDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: { ...ok, preliminary_queue_qualification: false } }])).toBe(false);
    expect(qualifyingDeclaration([{ event_type: "owner_insulation_below_r2_declared", details: ok }])).toBe(false);
    expect(qualifyingDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: presentAutoOfferDetails() }])).toBe(true);
  });
  test("a don't-know record never counts as answering the insulation questions", () => {
    expect(answeredInsulationDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: presentAutoOfferDetails("unknown") }])).toBe(false);
    expect(answeredInsulationDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: presentAutoOfferDetails() }])).toBe(true);
  });
  test("rules add only the owner's real answer", () => {
    const live = { ...DEFAULT_FILTERS, insulation: { enabled: true, values: ["none"] as never } };
    expect(existingInsulationRules(live, "unknown").insulation.values).toEqual(["none", "unknown"] as never);
    expect(existingInsulationRules(live).insulation.values).toEqual(["none", "present"] as never);
  });
  test("template facts: authorised unknown → standard existing wording; a photo review still wins", () => {
    expect(existingInsulationTemplateFacts({ insulation: "unknown", authorized: true, reviewOutcome: null, readFailed: false })).toEqual({ declaredThinPatchy: false, declaredExisting: true });
    expect(existingInsulationTemplateFacts({ insulation: "unknown", authorized: true, reviewOutcome: "unclear", readFailed: false }).declaredExisting).toBe(false);
  });
});

describe("the don't-know email is truthful and spot-only", () => {
  const LINKS = { saveMySpotUrl: "https://e/c", uploadMediaUrl: "https://e/v", reviewResultUrl: "https://e", calculatorUrl: "https://e/calc" };
  const FIG = { veuRebate: 1610, customerTotal: 2188, totalBeforeRebate: 3798, installation: 3100, piesaFee: 349, apFee: 349, ceilingAreaM2: 137, areaEstimated: false, removalUpTo: 2055 };
  const r = (extra: Record<string, unknown>) => renderJoOutcomeEmail({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, declaredExisting: true, recipient: { firstName: "Helen", propertyAddress: "x", enquiryReference: "HV-T" }, figures: FIG, links: LINKS, ...extra } as never)!;
  test("don't-know intro + basis, removal card, Save my spot, O2 closing; never 'You told us there's some insulation' or the questions", () => {
    const m = r({ declaredUnknown: true });
    expect(m.html.replace(/&#39;|&#x27;|&rsquo;|’/g, "'")).toContain("You weren't sure if there's insulation in your ceiling");
    for (const t of [m.plainText, m.html]) expect(t).not.toContain("You told us there");
    expect(m.plainText).toContain(O2_DONT_KNOW_INTRO);
    expect(m.plainText).toContain("Based on what you told us: 137 m² ceiling, existing insulation not known yet.");
    expect(m.plainText).toContain("If some needs removing: $15/m²");
    expect(m.plainText).toContain("Up to $2,055");
    expect(m.plainText).toContain("Save my free spot: https://e/c");
    expect(m.plainText).toContain("If your existing insulation is already R2.0 or above, the rebate isn't available");
    expect(m.plainText).not.toContain("ANSWER 3 QUICK QUESTIONS");
    expect(m.ctas).toContain("save_my_spot");
    expect(preReleaseViolations(m.plainText)).toEqual([]);
    expect(preReleaseViolations(m.html.replace(/<[^>]+>/g, " "))).toEqual([]);
  });
  test("without the don't-know fact the some-insulation copy is unchanged; a present answer never gets don't-know wording", () => {
    expect(r({}).plainText).toContain("You told us there's some insulation");
    expect(r({ insulation: "present", declaredUnknown: true }).plainText).not.toContain("You weren't sure");
    expect(basisLine({ ...FIG, areaEstimated: true }, "unknown")).toBe("Based on a typical 137 m² ceiling (an estimate, not your actual size), existing insulation not known yet.");
  });
});

test("questions invitation approved for the backlog (decision 393); the automatic Save my spot after answers was switched on by Jo (decision 388 update)", () => {
  expect(INSULATION_DETAILS_REAL_SEND_APPROVED).toBe(true);
  expect(INSULATION_QUESTIONS_SEND_APPROVED).toBe(true);
});
