import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  anonymisedOffer, buildNeedsHivic, coordinationState, electricalClearance, installationCoordinationBlocker,
  installerUnavailableOutcome, isConfirmedBooking, nextOfferBatch, offerExpiry, piesaOfferBlockers, rankRecCandidates,
  rectificationSendBlocker, rectificationVisitBlocker, INSTALLER_PLANNING_NOTICE, type RecCandidate,
} from "../src/lib/allocation.core";

const okPay = { ok: true, blockers: [] } as never;
const base = { readyCheckComplete: true, verifiedEligible: true, currentQuoteApproved: true, payment: okPay, hasActiveElectrician: false, hasOpenOffers: false };
const rec = (o: Partial<RecCandidate>): RecCandidate => ({ business_id: "b", name: "B", is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true, coverage_verified: true, covers_postcode: true, exact_postcode: true, has_valid_licence: true, approved_workers: 1, weekly_capacity: 5, open_jobs: 0, recent_offers_30d: 0, acceptance_rate: null, ...o });
const now = new Date("2026-10-10T00:00:00Z");
const hAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("PIESA allocation", () => {
  test("offers cannot start before the payment gate", () => {
    expect(piesaOfferBlockers({ ...base, payment: { ok: false, blockers: ["Payment option not cleared."] } as never }).length).toBeGreaterThan(0);
    expect(piesaOfferBlockers({ ...base, currentQuoteApproved: false }).length).toBeGreaterThan(0);
  });
  test("pre-accept summary carries no owner PII or exact address", () => {
    const s = anonymisedOffer({ job_number: "HV-1", suburb: "Frankston", postcode: "3199", measured_area_m2: 121, access_summary: "Manhole", observations: [], piesa_rate_inc_gst: null, address_line: "1 Secret St", owner_name: "Jo", owner_phone: "0400", owner_email: "a@b" });
    const t = JSON.stringify(s);
    for (const x of ["Secret", "Jo", "0400", "a@b"]) expect(t).not.toContain(x);
    expect(s.approx_area_m2).toBe(120);
  });
  test("only approved, licensed, in-area RECs with workers rank; cheapest never wins by price", () => {
    const r = rankRecCandidates([rec({ business_id: "out", covers_postcode: false }), rec({ business_id: "unl", has_valid_licence: false }), rec({ business_id: "nw", approved_workers: 0 }), rec({ business_id: "draft", onboarding_status: "draft" }), rec({ business_id: "ok" })]);
    expect(r.map((c) => c.business_id)).toEqual(["ok"]);
  });
  test("small batch, preferred REC alone, configurable expiry", () => {
    const r = [rec({ business_id: "a" }), rec({ business_id: "b2" }), rec({ business_id: "c" }), rec({ business_id: "d" })];
    expect(nextOfferBatch(r, new Set(), 3)).toHaveLength(3);
    expect(nextOfferBatch([rec({ business_id: "p", preferred: true }), ...r], new Set(), 3).map((c) => c.business_id)).toEqual(["p"]);
    expect(nextOfferBatch(r, new Set(["a", "b2", "c", "d"]), 3)).toHaveLength(0);
    expect(offerExpiry(now, 2)).toBe(hAgo(-2));
  });
});

describe("direct coordination", () => {
  test("contact release is not a booking; 24h reminder; 48h office", () => {
    expect(coordinationState({ releasedAt: hAgo(1), firstProposalAt: null, confirmedAt: null }, now).state).toBe("waiting");
    expect(coordinationState({ releasedAt: hAgo(25), firstProposalAt: null, confirmedAt: null }, now).state).toBe("remind");
    expect(coordinationState({ releasedAt: hAgo(25), firstProposalAt: hAgo(2), confirmedAt: null }, now).state).toBe("waiting");
    expect(coordinationState({ releasedAt: hAgo(49), firstProposalAt: hAgo(30), confirmedAt: null }, now).state).toBe("needs_office");
  });
  test("proposal must be confirmed by the other party or office", () => {
    expect(isConfirmedBooking({ status: "proposed", proposer_role: "owner" })).toBe(false);
    expect(isConfirmedBooking({ status: "accepted", proposer_role: "owner", responder_role: "owner" })).toBe(false);
    expect(isConfirmedBooking({ status: "accepted", proposer_role: "owner", responder_role: "electrician" })).toBe(true);
    expect(isConfirmedBooking({ status: "accepted", proposer_role: "owner", responder_role: "admin" })).toBe(true);
  });
  test("installer planning notice forbids installation booking", () => {
    expect(INSTALLER_PLANNING_NOTICE).toContain("Do not book installation until electrical clearance is complete");
  });
});

describe("clearance and rectification", () => {
  const c = { piesaOutcome: "pass" as const, piesaCompletedAt: "2026-10-01", rectificationRequired: false, rectificationQuoteAccepted: false, rectificationCompletedAt: null, sectionCSignedAt: null };
  test("installation blocked before clearance", () => {
    expect(installationCoordinationBlocker(electricalClearance({ ...c, piesaCompletedAt: null }))).not.toBeNull();
    expect(electricalClearance(c)).toMatchObject({ cleared: true, basis: "initial_piesa", timingDate: "2026-10-01" });
  });
  test("Section C date drives timing after rectification", () => {
    const r = { ...c, piesaOutcome: "fail" as const, rectificationRequired: true };
    expect(electricalClearance(r).cleared).toBe(false);
    expect(electricalClearance({ ...r, rectificationQuoteAccepted: true, rectificationCompletedAt: "2026-10-05" }).cleared).toBe(false);
    expect(electricalClearance({ ...r, rectificationQuoteAccepted: true, rectificationCompletedAt: "2026-10-05", sectionCSignedAt: "2026-10-06" })).toMatchObject({ cleared: true, basis: "section_c", timingDate: "2026-10-06" });
    expect(electricalClearance(c).pendingConfirmation).toContain("pending written confirmation");
  });
  test("rectification quote needs office review before send; owner approval before visit", () => {
    const q = { kind: "rectification", status: "draft", office_reviewed_at: null, has_unpriced_items: false };
    expect(rectificationSendBlocker(q, false)).not.toBeNull();
    expect(rectificationSendBlocker(q, true)).not.toBeNull();
    expect(rectificationSendBlocker({ ...q, office_reviewed_at: "x" }, true)).toBeNull();
    expect(rectificationVisitBlocker({ quoteAccepted: false, recActiveApproved: true })).not.toBeNull();
    expect(rectificationVisitBlocker({ quoteAccepted: true, recActiveApproved: true })).toBeNull();
  });
  test("agreed installer decline goes to office, never substitution", () => {
    expect(installerUnavailableOutcome({ reason: "ill" })).toMatchObject({ substitute: false, exception: "installer_unavailable" });
  });
});

describe("Needs Home Insulation Victoria queue", () => {
  test("only exceptions, each with why and next", () => {
    const items = buildNeedsHivic({ now, jobs: [{ id: "j", job_number: "HV-1" }], coverageExhausted: [], releases: [
      { job_id: "j", visit_kind: "piesa", released_at: hAgo(10), confirmed_at: null },
      { job_id: "j", visit_kind: "installation", released_at: hAgo(50), confirmed_at: null },
    ], failedComms: [], rectDeclined: [], rectPricing: [], installerUnavailable: [{ job_id: "j", at: hAgo(1), reason: null }], piesaTiming: [], escTiming: [], evidenceRejected: [], registryQueries: [], officeOverdue: [] });
    expect(items.map((i) => i.code).sort()).toEqual(["installation_booking_overdue", "installer_unavailable"]);
    for (const i of items) { expect(i.why.length).toBeGreaterThan(10); expect(i.next.length).toBeGreaterThan(10); }
  });
});

test("Mitti sync never moves a job stage by itself", () => {
  const src = readFileSync("src/lib/mitti.server.ts", "utf8");
  expect(src).not.toMatch(/\btransition\(|commit_guarded_stage|autoAdvanceJob|update\(\{[^}]*\bstage\s*:/);
});
