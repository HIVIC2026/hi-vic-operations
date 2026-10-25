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
    const s = anonymisedOffer({ job_number: "HV-1", suburb: "Frankston", postcode: "3199", measured_area_m2: 121, access_summary: "Manhole", observations: [], electrician_rate_inc_gst: null, address_line: "1 Secret St", owner_name: "Jo", owner_phone: "0400", owner_email: "a@b" });
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
    expect(nextOfferBatch([rec({ business_id: "p", preferred: true }), ...r], new Set(), 3, { installerSourced: true }).map((c) => c.business_id)).toEqual(["p"]);
    expect(nextOfferBatch([rec({ business_id: "p", preferred: true }), ...r], new Set(), 3)).toHaveLength(3);
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

describe("clearance and electrical fixes", () => {
  const c = { piesaOutcome: "pass" as const, piesaCompletedAt: "2026-10-01", rectificationRequired: false, rectificationQuoteAccepted: false, rectificationCompletedAt: null, sectionCSignedAt: null };
  test("installation blocked before clearance", () => {
    expect(installationCoordinationBlocker(electricalClearance({ ...c, piesaCompletedAt: null }))).not.toBeNull();
    expect(electricalClearance(c)).toMatchObject({ cleared: true, basis: "initial_piesa", timingDate: "2026-10-01" });
  });
  test("decision 316: fixes clear the job but the 30 days still run from the official PIESA date", () => {
    const r = { ...c, piesaOutcome: "fail" as const, rectificationRequired: true };
    expect(electricalClearance(r).cleared).toBe(false);
    expect(electricalClearance({ ...r, rectificationQuoteAccepted: true, rectificationCompletedAt: "2026-10-05" }).cleared).toBe(false);
    expect(electricalClearance({ ...r, rectificationQuoteAccepted: true, rectificationCompletedAt: "2026-10-05", sectionCSignedAt: "2026-10-06" })).toMatchObject({ cleared: true, basis: "section_c", timingDate: "2026-10-01" });
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

describe("Needs queue rows (finish pass)", () => {
  const base = { now: new Date(), coverageExhausted: [], releases: [], failedComms: [], rectDeclined: [], rectPricing: [], installerUnavailable: [], piesaTiming: [], escTiming: [], evidenceRejected: [], registryQueries: [], officeOverdue: [] };
  test("no-longer-approved electrician becomes an exception with stage, suburb and urgency", () => {
    const items = buildNeedsHivic({ ...base, jobs: [{ id: "j1", job_number: "HV-1", stage: "rectification_scheduling", suburb: "Frankston 3199" }], recNoLongerApproved: [{ job_id: "j1", since: null }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ code: "rec_no_longer_approved", stage: "rectification_scheduling", suburb: "Frankston 3199", urgency: "today", tab: "piesa" });
  });
  test("urgent timing sorts before routine-office items; routine waiting never appears", () => {
    const items = buildNeedsHivic({ ...base, jobs: [{ id: "a", job_number: "A" }, { id: "b", job_number: "B" }],
      officeOverdue: [{ job_id: "a", title: "x", since: "2020-01-01" }], piesaTiming: [{ job_id: "b", urgency: "red", piesa_expired: false, days_remaining: 2 }],
      releases: [{ job_id: "a", visit_kind: "piesa", released_at: new Date().toISOString(), confirmed_at: null }] });
    expect(items.map((i) => i.code)).toEqual(["piesa_timing_invalid", "office_overdue"]);
  });
  test("coverage exhausted uses the approved wording", () => {
    const items = buildNeedsHivic({ ...base, jobs: [{ id: "a", job_number: "A" }], coverageExhausted: [{ job_id: "a", created_at: "2026-01-01" }] });
    expect(items[0].why).toMatch(/^No approved electrician coverage/);
  });
});

describe("Finish pass: deep links, status wording, planning notice", () => {
  test("every Needs tab maps to a real job section; unknown section ignored", async () => {
    const { NEEDS_TAB_SECTION, NEEDS_TEXT, parseJobSection } = await import("../src/lib/allocation.core");
    for (const t of Object.values(NEEDS_TEXT)) expect(parseJobSection(NEEDS_TAB_SECTION[t.tab])).toBeDefined();
    expect(parseJobSection("evil")).toBeUndefined();
    expect(parseJobSection(undefined)).toBeUndefined();
  });
  test("trade status wording follows the source of truth", async () => {
    const { electricalStatusLabel: l } = await import("../src/lib/allocation.core");
    expect(l({ offerPending: true, stage: "piesa_and_install_window_pending" })).toBe("Offered");
    expect(l({ stage: "piesa_and_install_window_pending" })).toBe("Accepted · Arrange visit");
    expect(l({ stage: "piesa_and_install_window_pending", proposalPending: true })).toBe("Awaiting owner confirmation");
    expect(l({ stage: "piesa_scheduled" })).toBe("Booked");
    expect(l({ stage: "piesa_complete" })).toBe("PIESA complete");
    expect(l({ stage: "rectification_required" })).toBe("Electrical fixes required");
    expect(l({ stage: "installation_scheduling" })).toBe("Electrically cleared");
  });
  test("planning notice is recorded only after a confirmed PIESA booking, never as a stage change or a dead outbox row (F13)", () => {
    const src = readFileSync("src/lib/booking.server.ts", "utf8");
    const i = src.indexOf('"installer_planning_notice", INSTALLER_PLANNING_NOTICE');
    expect(i).toBeGreaterThan(src.indexOf('status: "confirmed"'));
    expect(src).not.toContain("queueInstallerPlanningNotice");
    expect(readFileSync("src/lib/allocation.server.ts", "utf8")).not.toContain("enqueue_external_action");
  });
});

import { offerRateBlocker, electricianRateText } from "../src/lib/allocation.core";
import { recSlaForAssigned, REC_BUCKETS } from "../src/lib/pilot.core";
describe("electrician rate is never the customer price", () => {
  test("shows only the electrician's own agreed rate, or Rate to be confirmed", () => {
    expect(electricianRateText({ electrician_rate_inc_gst: 180 })).toBe("Your agreed rate: $180.00 inc GST");
    expect(electricianRateText({ electrician_rate_inc_gst: null, rate_to_confirm: true })).toBe("Rate to be confirmed");
    // A legacy summary carrying only the customer price must not surface it as a payout.
    expect(electricianRateText({ piesa_rate_inc_gst: 349 } as never)).toBe("Rate to be confirmed");
  });
  test("blocks offers/acceptance without a rate unless office marked rate-to-confirm", () => {
    expect(offerRateBlocker(null, false)).toMatch(/No agreed electrician rate/);
    expect(offerRateBlocker(null, true)).toBeNull();
    expect(offerRateBlocker(150, false)).toBeNull();
  });
  test("anonymised offer carries the electrician rate field, never a customer price field", () => {
    const s = anonymisedOffer({ job_number: "HV-1", suburb: null, postcode: null, measured_area_m2: null, access_summary: null, observations: [], electrician_rate_inc_gst: 175 });
    expect(s.electrician_rate_inc_gst).toBe(175);
    expect(JSON.stringify(s)).not.toMatch(/349|piesa_rate|customer/);
  });
  test("electrician dashboard source never renders the customer price as their fee", () => {
    const src = readFileSync("src/components/portal/trade-work.tsx", "utf8");
    expect(src).not.toMatch(/349|Agreed fee|piesa_rate_inc_gst/);
    expect(src).toContain("electricianRateText");
  });
});
describe("assigned electrician never sees 'Waiting for electrician'", () => {
  test("hides the generic ok SLA text but keeps warnings", () => {
    expect(recSlaForAssigned({ state: "ok", message: "Waiting for electrician" })).toBeNull();
    expect(recSlaForAssigned({ state: "attention", message: "No response for 24 hours" })?.state).toBe("attention");
    expect(REC_BUCKETS.join("|")).not.toMatch(/Waiting for electrician/);
    expect(REC_BUCKETS).toContain("Awaiting owner confirmation");
  });
});
describe("electrician-facing screens wording scan", () => {
  test("no '$349 fee' or customer price shown as electrician pay on electrician-facing screens", () => {
    const files = ["src/routes/_authenticated/partner.index.tsx", "src/routes/_authenticated/field.$jobId.tsx", "src/routes/_authenticated/field.index.tsx", "src/routes/w.$token.tsx", "src/components/portal/partner.tsx"];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect({ f, hit: /\$349 fee|Agreed fee|349[^\n]{0,40}(payout|electrician fee|REC fee)/i.test(src) }).toEqual({ f, hit: false });
    }
  });
});

describe("48h escalation covers every direct-contact visit", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const kinds = ["ready_check", "piesa", "rectification", "installation"] as const;
  const input = (k: (typeof kinds)[number], confirmed: string | null) => ({
    now, jobs: [{ id: "j", job_number: "HV-T" }], coverageExhausted: [], failedComms: [], rectDeclined: [], rectPricing: [], installerUnavailable: [],
    piesaTiming: [], escTiming: [], evidenceRejected: [], registryQueries: [], officeOverdue: [],
    releases: [{ job_id: "j", visit_kind: k, released_at: ago(49), confirmed_at: confirmed }],
  });
  test("each visit: 48h with no confirmed booking goes to the office list; confirmed never does", () => {
    for (const k of kinds) {
      expect(buildNeedsHivic(input(k, null)).length).toBe(1);
      expect(buildNeedsHivic(input(k, ago(1))).length).toBe(0);
    }
  });
  test("Ready Check gets its own office entry", () => {
    expect(buildNeedsHivic(input("ready_check", null)).map((i) => i.code)).toEqual(["ready_check_booking_overdue"]);
  });
});
