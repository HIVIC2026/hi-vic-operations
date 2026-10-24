// Manually-approved backlog release + T1–T7 renderer/link/size rules. Pure and source-level only: no DB, no provider,
// nothing is enqueued or sent.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  MANUAL_BACKLOG_FACTS_VERSION,
  MANUAL_BACKLOG_REASON,
  isManualBacklog,
  routeContextForWorkItem,
} from "../src/lib/manual-backlog.core";
import {
  backlogRules,
  defaultFilters,
  matchAutomaticRules,
  type AutomaticRuleFilters,
} from "../src/lib/save-spot-rules.core";
import {
  NO_SIZE_REAL_SEND_HELD,
  noSizeEstimateBlocker,
  noSizeInitialAllowed,
} from "../src/lib/no-size-estimate.core";
import { emailSuppression, withUnsubscribe } from "../src/lib/emailsafety.core";
import { AREA_BASIS_MISMATCH, joAreaBasis } from "../src/lib/jo-area-basis.core";
import { computeEstimate, pickArea } from "../src/lib/estimate.core";
import {
  JO_RESULT_FALLBACK_URL,
  renderJoOutcomeEmail,
  type JoOutcomeFacts,
} from "../src/lib/jo-outcome-email.core";
import { PRIVACY_URL, PUBLIC_CALCULATOR_URL } from "../src/lib/estimate-email";

const src = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");
const trusted = routeContextForWorkItem({
  reason: MANUAL_BACKLOG_REASON,
  facts_version: MANUAL_BACKLOG_FACTS_VERSION,
});
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-19T10:00:00Z");

describe("trusted backlog context", () => {
  test("only an item carrying BOTH ENQ_01 markers is trusted", () => {
    expect(isManualBacklog(trusted)).toBe(true);
    expect(
      isManualBacklog(
        routeContextForWorkItem({ reason: MANUAL_BACKLOG_REASON, facts_version: "v2" }),
      ),
    ).toBe(false);
    expect(
      isManualBacklog(
        routeContextForWorkItem({ reason: "intake", facts_version: MANUAL_BACKLOG_FACTS_VERSION }),
      ),
    ).toBe(false);
    expect(isManualBacklog(routeContextForWorkItem({ reason: null, facts_version: null }))).toBe(
      false,
    );
  });
  test("strings, booleans and look-alike symbols are never trusted", () => {
    for (const v of [
      true,
      "ENQUIRY_BACKLOG_MANUAL",
      1,
      Symbol("hivic.manual-backlog-release"),
      JSON.parse(JSON.stringify(trusted)).manualBacklog,
    ]) {
      expect(isManualBacklog({ manualBacklog: v })).toBe(false);
    }
    expect(isManualBacklog({})).toBe(false);
    expect(isManualBacklog(null)).toBe(false);
  });
  test("no server function, route or client file can set the flag", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(import.meta.dir, "..", dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?)$/.test(e.name) && /manual-backlog\.core|manualBacklog/.test(src(p)))
          hits.push(p);
      }
    };
    walk("src");
    expect(
      hits.filter(
        (p) =>
          p.endsWith(".functions.ts") ||
          p.startsWith("src/routes/") ||
          p.startsWith("src/components/"),
      ),
    ).toEqual([]);
    // The only producer of the context is the post-intake worker reading the claimed DB row.
    expect(hits.filter((p) => src(p).includes("routeContextForWorkItem(")).sort()).toEqual([
      "src/lib/manual-backlog.core.ts",
      "src/lib/postintake.server.ts",
    ]);
  });
  test("worker passes the context; router forwards it only to the three relaxed checks", () => {
    expect(src("src/lib/postintake.server.ts")).toContain(
      "maybeAutoRouteLeadEmail(item.job_id, routeContextForWorkItem(item))",
    );
    const r = src("src/lib/lead-email-routing.server.ts");
    expect(r).toContain(
      'automaticSaveSpotGate(jobId, { route: "offer_spot", coverageVerified: true, ...(route.existingInsulation ? { existingInsulationOffer: true } : {}), ...(manualBacklog ? { manualBacklog: ctx.manualBacklog } : {}) })',
    );
    expect(r).toContain("sendDecisionIneligibleEmail(jobId, manualBacklog ? ctx : {})");
    // Service coverage is still checked before the gate on every path.
    expect(r.indexOf("serviceCoverageEstablished(jobId)")).toBeLessThan(
      r.indexOf("automaticSaveSpotGate(jobId"),
    );
  });
});

describe("Office automatic rules stay strict for normal sends", () => {
  const rules: AutomaticRuleFilters = {
    ...defaultFilters(),
    eligibility: { enabled: true, outcomes: ["likely_eligible"] },
    insulation: { enabled: true, values: ["none"] },
    jobStatus: { enabled: true, stages: ["preliminary_estimate_ready"] },
    enquiryDate: { enabled: true, window: "last_3_days", fromDate: null, toDate: null },
  } as AutomaticRuleFilters;
  const facts = (createdDaysAgo: number, stage = "preliminary_estimate_ready") => ({
    eligibilityOutcome: "likely_eligible",
    insulation: "none" as const,
    areaM2: 120,
    areaUnknown: false,
    postcode: "3000",
    stage,
    createdAt: new Date(NOW - createdDaysAgo * DAY).toISOString(),
  });
  test("old enquiry: normal rules block on date, backlog rules do not", () => {
    expect(matchAutomaticRules(facts(30), rules, NOW).failedCategories).toEqual(["enquiryDate"]);
    expect(matchAutomaticRules(facts(30), backlogRules(rules), NOW).eligible).toBe(true);
  });
  test("backlog rules skip status filter but keep eligibility/insulation", () => {
    expect(matchAutomaticRules(facts(30, "eligibility_review"), backlogRules(rules), NOW).eligible).toBe(true);
    expect(matchAutomaticRules(facts(30, "eligibility_review"), rules, NOW).failedCategories).toEqual(["jobStatus", "enquiryDate"]);
    expect(matchAutomaticRules({ ...facts(30), insulation: "present" as never }, backlogRules(rules), NOW).failedCategories).toEqual(["insulation"]);
    expect(matchAutomaticRules({ ...facts(30), eligibilityOutcome: "needs_onsite_confirmation" }, backlogRules(rules), NOW).failedCategories).toEqual(["eligibility"]);
    expect(rules.enquiryDate.enabled && rules.jobStatus.enabled).toBe(true); // original not mutated
  });
  test("gate skips activation/history ONLY under the trusted flag", () => {
    const g = src("src/lib/save-spot-rules.server.ts");
    expect(g).toMatch(
      /if \(!manualBacklog\) \{\s*if \(!config\.activatedAt\) return blocked\("rules_unavailable"[\s\S]*?blocked\("historical", BACKLOG_REASON\);\s*\}/,
    );
    expect(g).toContain("manualBacklog ? backlogRules(config.rules) : config.rules");
    // selection switch, lifecycle and route checks run before the bypass.
    const at = g.indexOf("if (!manualBacklog) {");
    for (const s of ['blocked("selection_disabled"', 'blocked("lifecycle"'])
      expect(g.indexOf(s)).toBeLessThan(at);
    expect(g.indexOf('blocked("not_offer_spot"')).toBeGreaterThan(at);
  });
});

describe("T1 no-size first reply", () => {
  test("held for normal real sends; allowed only in the trusted backlog", () => {
    expect(noSizeInitialAllowed({ isTest: false, mode: "send", manualBacklog: false })).toBe(false);
    expect(noSizeInitialAllowed({ isTest: false, mode: "send", manualBacklog: true })).toBe(true);
    expect(NO_SIZE_REAL_SEND_HELD).toContain("nothing sent");
  });
  test("even in the backlog it must be exactly the labelled 150 m², no insulation, no owner size", () => {
    const b = (o: Partial<Parameters<typeof noSizeEstimateBlocker>[0]>) =>
      noSizeEstimateBlocker({
        areaSource: "typical_default",
        areaM2: 150,
        ownerArea: null,
        insulation: "none",
        followup: false,
        automaticInitial: true,
        ...o,
      });
    expect(b({})).toBeNull();
    expect(b({ areaM2: 140 })).not.toBeNull();
    expect(b({ insulation: "unknown" })).not.toBeNull();
    expect(b({ ownerArea: 120 })).not.toBeNull();
  });
});

describe("T7 timing override", () => {
  const base = {
    purpose: "preliminary_ineligible" as const,
    optedOut: false,
    bounced: false,
    stage: "eligibility_review",
    jobSource: "base44",
    jobCreatedAt: new Date(NOW - 40 * DAY).toISOString(),
    recipient: "owner@gmail.com",
    jobsCreatedAfter: null,
    now: NOW,
  };
  test("ordinary send keeps the cutoff and 14-day rules", () => {
    expect(emailSuppression(base)).toBe("backlog_cutoff_not_set");
    expect(
      emailSuppression({ ...base, jobsCreatedAfter: new Date(NOW - 50 * DAY).toISOString() }),
    ).toBe("backlog_too_old");
    expect(
      emailSuppression({ ...base, jobsCreatedAfter: new Date(NOW - 10 * DAY).toISOString() }),
    ).toBe("backlog_before_cutoff");
  });
  test("trusted backlog skips ONLY the timing rules", () => {
    const t = { ...base, manualBacklogIneligible: true };
    expect(emailSuppression(t)).toBeNull();
    expect(emailSuppression({ ...t, optedOut: true })).toBe("unsubscribed");
    expect(emailSuppression({ ...t, bounced: true })).toBe("bounced");
    expect(emailSuppression({ ...t, recipient: "x@example.com" })).toBe(
      "test_or_example_recipient",
    );
    expect(emailSuppression({ ...t, stage: "awaiting_electrician" })).toBe(
      "job_progressed_or_closed",
    );
    expect(emailSuppression({ ...t, purpose: "step3_estimate", stage: "new_enquiry" })).toBe(
      "backlog_cutoff_not_set",
    );
  });
  test("server only sets the flag for preliminary_ineligible under the trusted context", () => {
    expect(src("src/lib/emailsafety.server.ts")).toContain(
      'manualBacklogIneligible: purpose === "preliminary_ineligible" && isManualBacklog(ctx)',
    );
  });
});

describe("owner-supplied size drives the preliminary quote", () => {
  test("owner size beats research area; measurement still wins", () => {
    expect(pickArea({ estimate: { id: "e", m2: 210, tier: "B" }, owner: 118 })).toMatchObject({
      m2: 118,
      source: "owner_estimate",
    });
    expect(pickArea({ measurement: { id: "m", m2: 125 }, owner: 118 }).source).toBe(
      "accepted_measurement",
    );
  });
  test("price is computed on the owner m²", () => {
    const S = {
      id: "s",
      version: 1,
      r5_install_inc_gst_per_m2: 30,
      piesa_assessment_inc_gst: 349,
      ap_management_inc_gst: 300,
      indicative_veec_value: 70,
      min_customer_copayment: 200,
    } as never;
    const loc = {
      postcode: "3000",
      metropolitan_or_regional: "metropolitan",
      climate_region: "mild",
    } as never;
    const a = computeEstimate(
      pickArea({ estimate: { id: "e", m2: 210, tier: "B" }, owner: 118 }),
      loc,
      "none",
      S,
    );
    const b = computeEstimate(pickArea({ owner: 118 }), loc, "none", S);
    expect(a.area.m2).toBe(118);
    expect(a.primary.by_access.standard.installation).toBe(
      b.primary.by_access.standard.installation,
    );
  });
  test("area basis: known, assumed, and fail-closed cases", () => {
    expect(joAreaBasis({ areaSource: "owner_estimate", areaM2: 118, ownerAreaM2: 118 })).toEqual({
      ok: true,
      ceilingSizeKnown: true,
      areaEstimated: false,
      areaM2: 118,
    });
    expect(joAreaBasis({ areaSource: "typical_default", areaM2: 150, ownerAreaM2: null })).toEqual({
      ok: true,
      ceilingSizeKnown: false,
      areaEstimated: true,
      areaM2: 150,
    });
    for (const x of [
      { areaSource: "area_estimate", areaM2: 210, ownerAreaM2: 118 },
      { areaSource: "area_estimate", areaM2: 210, ownerAreaM2: null },
      { areaSource: "owner_estimate", areaM2: 120, ownerAreaM2: 118 },
      { areaSource: "typical_default", areaM2: 150, ownerAreaM2: 118 },
      { areaSource: "accepted_measurement", areaM2: 125, ownerAreaM2: null },
    ])
      expect(joAreaBasis(x)).toEqual({ ok: false, reason: AREA_BASIS_MISMATCH });
  });
  test("both live senders use the shared basis", () => {
    expect(src("src/lib/hot-leads-send.server.ts")).toContain(
      "ceilingAreaM2: areaBasis.areaM2, areaEstimated: areaBasis.areaEstimated",
    );
    expect(src("src/lib/followups.server.ts")).toContain(
      "ceilingAreaM2: areaBasis.areaM2,\n      areaEstimated: areaBasis.areaEstimated,",
    );
  });
});

describe("T1–T7 render through Jo's one shell with real links", () => {
  const T = "https://estimate.homeinsulationvictoria.com.au/estimate/AbCdEfGhIjKlMnOpQrStUv";
  const UNSUB =
    "https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=AbCdEfGhIjKlMnOpQrStUvWx";
  const links = {
    saveMySpotUrl: `${T}/campaign`,
    uploadMediaUrl: `${T}/video`,
    reviewResultUrl: T,
    calculatorUrl: `${T}/calculator`,
  };
  const fig = (known: boolean) => ({
    veuRebate: 1400,
    customerTotal: 2100,
    totalBeforeRebate: 3500,
    installation: 2851,
    piesaFee: 349,
    apFee: 300,
    ceilingAreaM2: known ? 118 : 150,
    areaEstimated: !known,
  });
  const recipient = {
    firstName: "Sam",
    propertyAddress: "1 Test St, Melbourne VIC 3000",
    enquiryReference: "HV-1",
  };
  const cases: { name: string; facts: JoOutcomeFacts; known: boolean; cta: string }[] = [
    {
      name: "T1",
      facts: { outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false },
      known: false,
      cta: `${T}/campaign`,
    },
    {
      name: "T2",
      facts: { outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true },
      known: true,
      cta: `${T}/campaign`,
    },
    {
      name: "T3",
      facts: {
        outcome: "likely_eligible",
        insulation: "present",
        ceilingSizeKnown: false,
        deskCheckStatus: "looks_eligible",
      },
      known: false,
      cta: `${T}/campaign`,
    },
    {
      name: "T4",
      facts: {
        outcome: "likely_eligible",
        insulation: "present",
        ceilingSizeKnown: true,
        deskCheckStatus: "looks_eligible",
      },
      known: true,
      cta: `${T}/campaign`,
    },
    {
      name: "T5",
      facts: {
        outcome: "needs_onsite_confirmation",
        insulation: "unknown",
        ceilingSizeKnown: false,
      },
      known: false,
      cta: `${T}/video`,
    },
    {
      name: "T6",
      facts: {
        outcome: "needs_onsite_confirmation",
        insulation: "unknown",
        ceilingSizeKnown: true,
      },
      known: true,
      cta: `${T}/video`,
    },
  ];
  // The subject (and therefore <title>) legitimately differs per template; everything else in the
  // shared shell must be identical.
  const shellOf = (html: string) =>
    html.replace(/<title>[^<]*<\/title>/, "<title></title>").replace(/<div style="display:none[^>]*>[^<]*<\/div>\n?/, "").slice(0, 400);
  const t1 = withUnsubscribe(
    renderJoOutcomeEmail({ ...cases[0]!.facts, recipient, figures: fig(false), links })!,
    UNSUB,
  );

  for (const c of cases) {
    test(`${c.name}: primary button, footer links, size wording, no placeholders`, () => {
      const m = withUnsubscribe(
        renderJoOutcomeEmail({ ...c.facts, recipient, figures: fig(c.known), links })!,
        UNSUB,
      );
      expect(m.html).toContain(`href="${c.cta}"`);
      // Decision 137 footer: AP number · ABN · Unsubscribe (the earlier Contact us / Privacy links stay on T8 only).
      expect(m.html).toContain(`href="${UNSUB}"`);
      expect(m.html).toContain("VEU Accredited Person A003654");
      void PRIVACY_URL;
      expect(m.html).not.toMatch(
        /\[(Save my spot|Upload my photos|Review my result|Contact us|Privacy|Remove my enquiry)[^\]]*\]/,
      );
      expect(m.plainText).not.toContain("{{");
      expect(m.html).not.toContain("data-hiv-remove-enquiry");
      if (c.known) {
        expect(m.plainText).toContain("Based on what you told us: 118 m² ceiling");
        expect(m.plainText).not.toContain("150 m²");
      } else {
        expect(m.plainText).toContain("Based on a typical 150 m² ceiling (estimated, not measured)");
        expect(m.plainText).not.toContain("Based on what you told us");
      }
      expect(shellOf(m.html)).toBe(shellOf(t1.html));
    });
    test(`${c.name}: missing primary link fails closed`, () => {
      const key = c.cta.endsWith("/video") ? "uploadMediaUrl" : "saveMySpotUrl";
      expect(() =>
        renderJoOutcomeEmail({
          ...c.facts,
          recipient,
          figures: fig(c.known),
          links: { ...links, [key]: "" },
        }),
      ).toThrow();
    });
  }
  test("T7: Review my result -> customer page, else public fallback; same shell", () => {
    const r = (reviewResultUrl: string) =>
      withUnsubscribe(
        renderJoOutcomeEmail({
          outcome: "does_not_appear_eligible",
          insulation: null,
          ceilingSizeKnown: false,
          recipient,
          reason: "The home was built less than five years ago.",
          links: { saveMySpotUrl: "", uploadMediaUrl: "", reviewResultUrl, calculatorUrl: "" },
        })!,
        UNSUB,
      );
    expect(r(T).html).toContain(`href="${T}"`);
    const fb = r(JO_RESULT_FALLBACK_URL);
    expect(fb.html).toContain(`href="${JO_RESULT_FALLBACK_URL}"`);
    expect(fb.html).toContain(`href="${PUBLIC_CALCULATOR_URL}"`);
    expect(fb.html).not.toMatch(
      /\[(Review my result|Contact us|Privacy|Remove my enquiry)[^\]]*\]/,
    );
    expect(shellOf(fb.html)).toBe(shellOf(t1.html));
    expect(() =>
      renderJoOutcomeEmail({
        outcome: "does_not_appear_eligible",
        insulation: null,
        ceilingSizeKnown: false,
        recipient,
        links: { saveMySpotUrl: "", uploadMediaUrl: "", reviewResultUrl: "", calculatorUrl: "" },
      }),
    ).toThrow();
  });
  test("link destinations exist as app pages/endpoints", () => {
    for (const f of [
      "src/routes/estimate.$token.tsx",
      "src/routes/estimate_.$token.campaign.tsx",
      "src/routes/estimate_.$token.video.tsx",
      "src/routes/estimate_.$token.calculator.tsx",
      "src/routes/privacy.tsx",
      "src/routes/api/public/unsubscribe.ts",
    ])
      expect(existsSync(join(import.meta.dir, "..", f))).toBe(true);
    for (const f of ["src/lib/hot-leads-send.server.ts", "src/lib/followups.server.ts"])
      expect(src(f)).not.toContain("#calculator");
  });
  test("live T1–T7 senders render only through renderJoOutcomeEmail", () => {
    const h = src("src/lib/hot-leads-send.server.ts"),
      f = src("src/lib/followups.server.ts");
    expect(h).toContain("jo.renderJoOutcomeEmail(");
    expect(f).toContain("renderJoOutcomeEmail(");
    for (const legacy of [
      "renderSaveSpotFromLikelyEmail",
      "renderStep3SaveSpot",
      "renderIneligibleOutcomeEmail",
      "renderEstimateEmail(",
      "renderIneligibleEmail(",
    ]) {
      expect(h).not.toContain(legacy);
      expect(f).not.toContain(legacy);
    }
  });
});

describe("ENQ_00 / ENQ_01", () => {
  test("ENQ_00 no longer predicts T1 no-size or old T7 as held", () => {
    const s = src("supabase/manual_sql/ENQ_00_RECONCILE_ALL.sql");
    expect(s).not.toMatch(/then 'BACKLOG_(CUTOFF_NOT_SET|BEFORE_CUTOFF|TOO_OLD)'/);
    expect(s).not.toMatch(
      /'A_ELIGIBLE_NO_INSULATION', 'C_INSULATION_UNKNOWN'\)\s*and \(c\.area_m2 is null/,
    );
    expect(s).toContain("then 'STAGE_MOVED_ON'");
  });
  test("ENQ_01 still writes both markers idempotently", () => {
    const s = src("supabase/manual_sql/ENQ_01_ENQUEUE_SAFE.sql");
    expect(s).toContain(`'${MANUAL_BACKLOG_FACTS_VERSION}', '${MANUAL_BACKLOG_REASON}'`);
    expect(s).toContain("on conflict (job_id, work_type) do update");
    expect(s).toContain("where w.status <> 'processing'");
  });
});
