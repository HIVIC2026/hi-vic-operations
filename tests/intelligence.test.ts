import { describe, expect, test } from "bun:test";
import { ageStatusFor, canReplace, gate1InputFromFacts, normaliseAddress, parseProperty, parseZone, recommendGate1, selectCurrentEstimate, type Gate1Input } from "../src/lib/intelligence.core";
import { gatherEvidence, type FetchJson } from "../src/lib/intelligence.gather";
import { bookingLeadBlocker, buildEscPayload, escDueBy, readyToInstall, staleReasons, submissionPatch, type ReadinessInput } from "../src/lib/esc.core";
import { planBase44Job } from "../src/lib/enquiry.core";

// Fixtures recorded from live read-only Vicmap WFS responses (open-data-platform), 2026-09-28.
const ADDRESS_FC = { features: [{ geometry: { type: "Point", coordinates: [145.261521, -37.895724] }, properties: { pfi: "1", property_pfi: "1296847", ezi_address: "3 LUCERNE ROAD FERNTREE GULLY 3156", state: "VIC", postcode: "3156", is_primary: "Y", source_verified: "2009-01-19T00:00:00Z" } }] };
const PROPERTY_FC = { features: [{ properties: { prop_pfi: "1296847", prop_propnum: "349133", prop_property_type: "O", prop_multi_assessment: "N", prop_status: "A", "st_area(geom)": 812.4 } }] };
const ZONE_FC = { features: [{ properties: { lga: "KNOX", zone_code: "NRZ4", zone_description: "NEIGHBOURHOOD RESIDENTIAL ZONE - SCHEDULE 4" } }] };

const fixtureFetch = (fail: string[] = []): FetchJson => async (url) => {
  const which = url.includes("typeNames=open-data-platform%3Aaddress") ? "address" : url.includes("v_property_mp") ? "property" : url.includes("plan_zone") ? "zone" : "other";
  if (fail.includes(which)) throw new Error("timeout (aborted)");
  return { status: 200, json: which === "address" ? ADDRESS_FC : which === "property" ? PROPERTY_FC : ZONE_FC };
};
const input = { addressLine: "3 Lucerne Rd", suburb: "Ferntree Gully", postcode: "3156", state: "VIC", ownerEstimateM2: 140, partnerMeasurement: null, provider: null };

const ok: Gate1Input = { addressVerified: true, inVictoria: true, residentialLikelihood: "high", nccClass: { value: "class1", direct: true }, ageStatus: "strong_over_5y", recentExtensionRisk: "no", roofForm: "pitched", roofCavityOrExposed: "likely", storeyAbove: "no", noRelevantCeilingDirect: false };

describe("property intelligence", () => {
  test("address normaliser expands road types", () => expect(normaliseAddress("7 Lucerne Rd", "Ferntree Gully", "3156")?.prefix).toBe("7 LUCERNE ROAD"));
  test("one Vicmap source failure -> partial result, not failure", async () => {
    const r = await gatherEvidence(input, fixtureFetch(["zone"]));
    expect(r.checks.find((c) => c.source_key === "vicmap_planning")?.status).toBe("timeout");
    expect(r.facts.find((f) => f.key === "address_verified")?.value).toBe(true);
    expect(r.facts.find((f) => f.key === "residential_likelihood")?.value).toBe("unknown");
  });
  test("all sources ok with fixtures", async () => {
    const r = await gatherEvidence(input, fixtureFetch());
    expect(r.checks.filter((c) => c.status === "ok").map((c) => c.source_key).sort()).toEqual(["vicmap_address", "vicmap_planning", "vicmap_property"]);
  });
  test("planning zone alone cannot prove NCC class", async () => {
    const zone = parseZone(ZONE_FC as never);
    expect(zone.find((f) => f.key === "residential_likelihood")?.value).toBe("medium");
    const r = await gatherEvidence(input, fixtureFetch());
    expect(r.facts.find((f) => f.key === "ncc_class_evidence")?.value).toBe("unknown");
    expect(recommendGate1(gate1InputFromFacts(r.facts, "2026-09-28")).outcome).toBe("needs_onsite_confirmation");
  });
  test("parcel area never becomes ceiling area", async () => {
    expect(JSON.stringify(parseProperty(PROPERTY_FC as never))).not.toContain("812");
    const r = await gatherEvidence({ ...input, ownerEstimateM2: null }, fixtureFetch());
    expect(r.areas).toHaveLength(0);
  });
  test("flat/low-slope roof => review, not automatic fail", () => expect(recommendGate1({ ...ok, roofForm: "low_slope_flat" }).outcome).toBe("needs_onsite_confirmation"));
  test("direct <5-year evidence => does_not_appear_eligible", () => {
    expect(ageStatusFor({ date: "2024-03-01", kind: "direct_record" }, "2026-09-28")).toBe("recent_under_5y");
    expect(recommendGate1({ ...ok, ageStatus: "recent_under_5y" }).outcome).toBe("does_not_appear_eligible");
  });
  test("unknown age => needs_onsite_confirmation", () => expect(recommendGate1({ ...ok, ageStatus: "unknown" }).outcome).toBe("needs_onsite_confirmation"));
  test("strong old age + residential + compatible roof => likely_eligible with onsite checks", () => {
    const r = recommendGate1(ok);
    expect(r.outcome).toBe("likely_eligible");
    expect(r.nextAction).toContain("pending onsite insulation, lighting and electrical confirmation");
    expect(r.onsite.length).toBeGreaterThan(2);
  });
  test("listing year built is supporting, never strong", () => expect(ageStatusFor({ date: "1990-12-31", kind: "listing_year_built" }, "2026-09-28")).toBe("supporting_over_5y"));
  test("install date change rechecks 5-year test", () => {
    const e = { date: "2021-06-01", kind: "historical_imagery_same_footprint" as const };
    expect(ageStatusFor(e, "2026-09-28")).toBe("strong_over_5y");
    expect(ageStatusFor(e, "2026-05-01")).toBe("unknown");
  });
  test("stronger area estimate cannot be overwritten by weaker", () => {
    expect(canReplace({ tier: "B", net_m2: 120 }, { tier: "F", net_m2: 150 })).toBe(false);
    expect(canReplace({ tier: "F", net_m2: 150 }, { tier: "B", net_m2: 120 })).toBe(true);
  });
  test("imported partner measurement wins over remote estimates", async () => {
    const r = await gatherEvidence({ ...input, partnerMeasurement: { net_m2: 118, source: "Partner import", external_id: "X1" } }, fixtureFetch());
    expect(r.areas.map((a) => a.tier)).toEqual(["A"]);
    expect(selectCurrentEstimate([{ tier: "F", net_m2: 140 }, { tier: "A", net_m2: 118 }, { tier: "D", net_m2: 160 }])?.tier).toBe("A");
    expect(r.facts.find((f) => f.key === "floorplan_status")?.value).toBe("partner_supplied");
  });
  test("no floorplan provider => provider_not_configured, no fabricated document", async () => {
    const r = await gatherEvidence(input, fixtureFetch());
    const fp = r.facts.find((f) => f.key === "floorplan_status");
    expect(fp?.value).toBe("provider_not_configured");
    expect(fp?.sourceUrl).toBeUndefined();
    expect(r.checks.find((c) => c.source_key === "evidence_provider")?.status).toBe("not_configured");
  });
  test("repeat enquiry does not change stage", () => {
    expect(planBase44Job({ external_enquiry_id: "HIV-1", preliminary_outcome: "likely_eligible" } as never, { stage: "eligibility_review" }).patch).not.toHaveProperty("stage");
  });
});

const start = "2026-10-10T00:00:00.000Z";
const good: ReadinessInput = {
  scheduledStart: start, consent: { status: "valid", scheduled_start: start, owner_signed_at: "2026-10-01T00:00:00.000Z", ap_signed_at: "2026-10-01T01:00:00.000Z" },
  notification: { status: "sent", sent_at: "2026-10-05T00:00:00.000Z", submission_reference: "ESC-123", scheduled_start: start },
  deliveries: { owner: "2026-10-05T00:00:00.000Z", installer: "2026-10-05T00:00:00.000Z" },
  piesa: { date: "2026-09-20", deadline: "2026-10-20", outcome: "pass" },
};

describe("ESC pre-install controls", () => {
  test("all conditions met => READY TO INSTALL", () => expect(readyToInstall(good)).toMatchObject({ ready: true, dueBy: escDueBy(start) }));
  test("ESC consent <24h => blocked", () => expect(readyToInstall({ ...good, consent: { ...good.consent!, ap_signed_at: "2026-10-09T12:00:00.000Z" } }).blockers.join()).toContain("consent"));
  test("ESC notification unsent => blocked", () => expect(readyToInstall({ ...good, notification: { ...good.notification!, status: "ready", sent_at: null, submission_reference: null } }).ready).toBe(false));
  test("ESC notification <24h => blocked", () => expect(readyToInstall({ ...good, notification: { ...good.notification!, sent_at: "2026-10-09T06:00:00.000Z" } }).blockers.join()).toContain("less than 24h"));
  test("PIESA not delivered to both >=24h => blocked", () => {
    expect(readyToInstall({ ...good, deliveries: { owner: good.deliveries.owner, installer: null } }).ready).toBe(false);
    expect(readyToInstall({ ...good, deliveries: { owner: "2026-10-09T10:00:00.000Z", installer: good.deliveries.installer } }).ready).toBe(false);
  });
  test("current PIESA 30-day gate remains", () => expect(readyToInstall({ ...good, piesa: { date: "2026-09-01", deadline: "2026-10-01", outcome: "pass" } }).blockers.join()).toContain("30-day"));
  test("reschedule marks old notice stale", () => {
    const prev = { scheduled_start: start, scheduled_end: null, premises_address: "A", owner_contact: { name: "J" } };
    expect(staleReasons(prev, { ...prev, scheduled_start: "2026-10-12T00:00:00.000Z" })).toContain("installation date/time changed");
    expect(staleReasons(prev, { ...prev, premises_address: "B" })).toContain("premises address changed");
    expect(readyToInstall({ ...good, scheduledStart: "2026-10-12T00:00:00.000Z" }).blockers.join()).toContain("stale");
  });
  test("no actual ESC submission => never status sent", () => {
    const built = buildEscPayload(null, { jobNumber: "HV-1", installationDays: ["2026-10-10"], scheduledStart: start, scheduledEnd: null, premisesAddress: "A", owner: { name: "J", email: "j@x.au", phone: null }, extra: {} });
    expect(built.status).toBe("configuration_required");
    expect(() => submissionPatch({ reference: "ESC-1", sentAt: "2026-10-01T00:00:00Z", method: "manual_portal", confirmed: false, actorId: "u" }, "2026-10-02T00:00:00Z")).toThrow();
    expect(() => submissionPatch({ reference: "", sentAt: "2026-10-01T00:00:00Z", method: "manual_portal", confirmed: true, actorId: "u" }, "2026-10-02T00:00:00Z")).toThrow();
  });
  test("approved config with missing required field => configuration_required", () => {
    const cfg = { version: "g1", required_fields: [{ key: "product_type", label: "Product type" }], approved: true, is_active: true };
    const i = { jobNumber: "HV-1", installationDays: ["2026-10-10"], scheduledStart: start, scheduledEnd: null, premisesAddress: "A", owner: { name: "J", email: "j@x.au", phone: null } };
    expect(buildEscPayload(cfg, { ...i, extra: {} }).status).toBe("configuration_required");
    expect(buildEscPayload(cfg, { ...i, extra: { product_type: "batts" } }).status).toBe("ready");
  });
  test("booking with <24h lead is rejected", () => {
    expect(bookingLeadBlocker("2026-10-10T10:00:00Z", "2026-10-09T12:00:00Z")).not.toBeNull();
    expect(bookingLeadBlocker("2026-10-12T10:00:00Z", "2026-10-09T12:00:00Z")).toBeNull();
  });
});
