// Decision 319 (Jo 25 Oct 2026): White Card per installer person — upload + office verifies once; not verified = can't be
// lead or crew on an installation booked on/after 00:00 26 Oct 2026 Melbourne; earlier bookings are never blocked.
import { describe, expect, test } from "bun:test";
import {
  WHITE_CARD_BLOCK_MESSAGE, WHITE_CARD_ENFORCED_FROM, approvalFlags, missingItems, whiteCardBlocker, whiteCardEnforced, whiteCardOf, whiteCardState,
  withWhiteCardDecision, withWhiteCardUpload,
} from "../src/lib/worker-compliance.core";
import { prestartFailures, type PrestartFacts } from "../src/lib/prestart.core";
import { crewSelectionProblems, staffFromRecords } from "../src/lib/piisa-a3.core";
import { allocationBlocker, allocationOptions, type AllocationCandidate } from "../src/lib/visit-allocation.core";
import { buildNeedsHivic } from "../src/lib/allocation.core";
import { teamWhiteCardLine } from "../src/lib/trade-view.core";
import { whiteCardCell } from "../src/lib/office-partners.core";

const BEFORE = "2026-10-24T05:00:00Z"; // booked before the change
const AFTER = "2026-10-26T01:00:00Z"; // booked after the change
const uploaded = withWhiteCardUpload({ declared: { holds: "held" }, verification_id: "v1" }, { path: "workers/w1/white-card-a.jpg", uploadedAt: "2026-10-25T01:00:00Z", number: " WC123 " });
const verified = withWhiteCardDecision(uploaded, { verified: true, by: "office", at: "2026-10-25T02:00:00Z" });
const rejected = withWhiteCardDecision(uploaded, { verified: false, by: "office", at: "2026-10-25T02:00:00Z", reason: "blurry" });

describe("White Card state and records", () => {
  test("installers only; a file is not verification; verify/reject; re-upload resets the check", () => {
    expect(whiteCardState({ trade_role: "electrician", certification: verified })).toBe("not_applicable");
    expect(whiteCardState({ trade_role: "installer", certification: null })).toBe("missing");
    expect(whiteCardState({ trade_role: "installer", certification: uploaded })).toBe("awaiting_check");
    expect(whiteCardState({ trade_role: "installer", certification: verified })).toBe("verified");
    expect(whiteCardState({ trade_role: "installer", certification: rejected })).toBe("rejected");
    expect(whiteCardState({ trade_role: "installer", certification: withWhiteCardUpload(rejected, { path: "workers/w1/white-card-b.jpg", uploadedAt: "2026-10-26T00:00:00Z" }) })).toBe("awaiting_check");
  });
  test("upload keeps every other certification field (CII link) and trims the number", () => {
    expect(uploaded["verification_id"]).toBe("v1");
    expect(uploaded["declared"]).toEqual({ holds: "held" });
    expect(whiteCardOf(uploaded)?.number).toBe("WC123");
    expect(whiteCardOf(verified)?.verified_by).toBe("office");
    expect(whiteCardOf(rejected)?.rejected_reason).toBe("blurry");
  });
  test("office decision refuses with no file, and verifies only once", () => {
    expect(() => withWhiteCardDecision({}, { verified: true, by: "o", at: "x" })).toThrow("No White Card uploaded");
    expect(() => withWhiteCardDecision(verified, { verified: true, by: "o", at: "x" })).toThrow("already verified");
  });
  test("existing people show as missing (office flag + Add it), never blocked by the flag itself", () => {
    const w = { trade_role: "installer", certification: null } as const;
    expect(approvalFlags(w as never, "2026-10-25")).toContain("White Card missing");
    expect(approvalFlags({ trade_role: "installer", certification: uploaded } as never, "2026-10-25")).toContain("White Card to verify");
    expect(approvalFlags({ trade_role: "installer", certification: verified } as never, "2026-10-25").some((f) => f.startsWith("White Card"))).toBe(false);
    expect(missingItems(w as never)).toContain("white_card");
    expect(missingItems({ trade_role: "electrician" } as never)).not.toContain("white_card");
  });
});

describe("cutoff: only installations booked on/after 00:00 26 Oct 2026 Melbourne", () => {
  test("the cutoff instant is midnight AEDT", () => {
    expect(new Date(WHITE_CARD_ENFORCED_FROM).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", hour12: false })).toMatch(/^26\/10\/2026, (00|24):00:00$/);
  });
  test("booked before → not enforced; after or not booked yet → enforced", () => {
    expect(whiteCardEnforced(BEFORE)).toBe(false);
    expect(whiteCardEnforced("2026-10-25T12:59:59Z")).toBe(false);
    expect(whiteCardEnforced(WHITE_CARD_ENFORCED_FROM)).toBe(true);
    expect(whiteCardEnforced(AFTER)).toBe(true);
    expect(whiteCardEnforced(null)).toBe(true);
  });
  test("blocker: verified / not loaded / not applicable never block", () => {
    expect(whiteCardBlocker("missing", AFTER)).toBe(WHITE_CARD_BLOCK_MESSAGE);
    expect(whiteCardBlocker("awaiting_check", AFTER)).toBe("White Card not verified");
    expect(whiteCardBlocker("rejected", null)).toBe(WHITE_CARD_BLOCK_MESSAGE);
    expect(whiteCardBlocker("missing", BEFORE)).toBeNull();
    expect(whiteCardBlocker("verified", AFTER)).toBeNull();
    expect(whiteCardBlocker(undefined, AFTER)).toBeNull();
    expect(whiteCardBlocker("not_applicable", AFTER)).toBeNull();
  });
});

describe("pre-start check (lead)", () => {
  const START = "2026-10-29T21:00:00Z";
  const ok: PrestartFacts = {
    start: START, clearance: { cleared: true, blocker: null }, deadline: "2026-11-20",
    esc: { status: "sent", sent_at: "2026-10-27T21:00:00Z", submission_reference: "R", scheduled_start: START },
    lead: { found: true, status: "verified", level: "full", expiresOn: "2028-01-01", name: "Lee", whiteCard: "missing" }, consentBlockers: [], piesaCompletedAt: "2026-10-20",
  };
  test("booked after the change: lead without a verified White Card fails with the plain reason", () => {
    expect(prestartFailures({ ...ok, bookingCreatedAt: AFTER })).toEqual(["Lead installer Lee: White Card not verified"]);
  });
  test("booked before the change: not blocked; verified card passes; not loaded passes", () => {
    expect(prestartFailures({ ...ok, bookingCreatedAt: BEFORE })).toEqual([]);
    expect(prestartFailures({ ...ok, bookingCreatedAt: AFTER, lead: { ...ok.lead, whiteCard: "verified" } })).toEqual([]);
    expect(prestartFailures({ ...ok, bookingCreatedAt: AFTER, lead: { ...ok.lead, whiteCard: undefined } })).toEqual([]);
  });
});

describe("crew selection", () => {
  const C = "f334286a-9492-4c21-8508-aad48dfe4a77", C2 = "a334286a-9492-4c21-8508-aad48dfe4a77";
  const W = (id: string, name: string, ref: string, certification: Record<string, unknown>) => ({ id, full_legal_name: name, approval_status: "approved", removed_at: null, trade_role: "installer", licence_expires_on: null, certification: { ...certification, verification_id: ref } });
  const certs = [{ id: C, status: "verified", certificate_number: "CII-1", issuer: null, worker_id: null }, { id: C2, status: "verified", certificate_number: "CII-2", issuer: null, worker_id: null }];
  const levels = [{ certification_id: C, level: "full", expires_on: "2028-01-01", recorded_at: "2026-10-01T00:00:00Z" }, { certification_id: C2, level: "full", expires_on: "2028-01-01", recorded_at: "2026-10-01T00:00:00Z" }];
  const workers = [W("w-lead", "Lead Person", C, {}), W("w-crew", "Crew Person", C2, verified)];
  test("roster carries each person's White Card state; the rule applies only when the booking is given", () => {
    const legacy = staffFromRecords(workers as never, certs, levels, undefined, "2026-10-25");
    expect(legacy.find((s) => s.workerId === "w-lead")).toMatchObject({ whiteCard: "missing" });
    expect(legacy.find((s) => s.workerId === "w-lead")!.whiteCardBlocked).toBeUndefined();
    const after = staffFromRecords(workers as never, certs, levels, undefined, "2026-10-25", { bookingCreatedAt: AFTER });
    expect(after.find((s) => s.workerId === "w-lead")!.whiteCardBlocked).toBe(true);
    expect(after.find((s) => s.workerId === "w-crew")!.whiteCardBlocked).toBe(false);
  });
  test("booked after: missing White Card blocks lead and crew; booked before: allowed", () => {
    const after = staffFromRecords(workers as never, certs, levels, undefined, "2026-10-25", { bookingCreatedAt: AFTER });
    expect(crewSelectionProblems({ lead: "w-lead", additional: [] }, after).problems).toEqual(["Lead Person: White Card not verified"]);
    expect(crewSelectionProblems({ lead: "w-crew", additional: [{ workerId: "w-lead" }] }, after).problems).toEqual(["Lead Person: White Card not verified"]);
    expect(crewSelectionProblems({ lead: "w-crew", additional: [] }, after).problems).toEqual([]);
    const before = staffFromRecords(workers as never, certs, levels, undefined, "2026-10-25", { bookingCreatedAt: BEFORE });
    expect(crewSelectionProblems({ lead: "w-lead", additional: [] }, before).problems).toEqual([]);
  });
});

describe("install-day allocation", () => {
  const cand = (whiteCard: AllocationCandidate["whiteCard"]): AllocationCandidate => ({ workerId: "w", name: "Ann", tradeRole: "installer", email: null, mobile: "0400", clearance: { certStatus: "verified", level: "full", expiresOn: "2028-01-01" }, whiteCard });
  test("install day needs a verified White Card for bookings after the change; Ready Checks never do", () => {
    expect(allocationBlocker("install", cand("missing"), "2026-10-25", { bookingCreatedAt: AFTER })).toBe(WHITE_CARD_BLOCK_MESSAGE);
    expect(allocationBlocker("install", cand("missing"), "2026-10-25", { bookingCreatedAt: BEFORE })).toBeNull();
    expect(allocationBlocker("install", cand("verified"), "2026-10-25", { bookingCreatedAt: AFTER })).toBeNull();
    expect(allocationBlocker("ready_check", cand("missing"), "2026-10-25", { bookingCreatedAt: AFTER })).toBeNull();
    expect(allocationBlocker("install", cand("missing"), "2026-10-25")).toBeNull(); // rule not applied by older callers
    expect(allocationOptions("install", [cand("rejected")], "2026-10-25", { bookingCreatedAt: null })[0]).toMatchObject({ allowed: false, reason: WHITE_CARD_BLOCK_MESSAGE });
  });
});

describe("office item and labels", () => {
  test("Needs me shows the White Card item for an upcoming install", () => {
    const base = { now: new Date(), coverageExhausted: [], releases: [], failedComms: [], rectDeclined: [], rectPricing: [], installerUnavailable: [], piesaTiming: [], evidenceRejected: [], registryQueries: [], officeOverdue: [], escTiming: [] };
    const items = buildNeedsHivic({ ...base, jobs: [{ id: "a", job_number: "A", stage: "installation_booked", suburb: null }], prestart: { esc: [], failed: [], certs: [], whiteCards: [{ job_id: "a", detail: "Lee: White Card missing — booked before 26 Oct 2026, so not blocked." }] } } as never);
    expect(items.map((i) => i.code)).toEqual(["white_card_not_verified"]);
  });
  test("My business line and office cell", () => {
    expect(teamWhiteCardLine("missing")).toMatchObject({ tone: "rose", canUpload: true });
    expect(teamWhiteCardLine("awaiting_check")).toMatchObject({ tone: "rose", canUpload: false });
    expect(teamWhiteCardLine("verified")).toMatchObject({ tone: "green", canUpload: false });
    expect(teamWhiteCardLine(null)).toBeNull();
    expect(whiteCardCell("awaiting_check")).toMatchObject({ label: "To verify", canDecide: true });
    expect(whiteCardCell("missing")).toMatchObject({ label: "Missing", canDecide: false });
  });
});
