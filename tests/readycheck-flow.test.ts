import { describe, expect, test } from "bun:test";
import {
  HOUR, bookingStageExitBlocker, confirmBlocker, deliveryDecision, leaseReclaimable, nextAction,
  retryTargets, scheduleTasks, taskStillApplies, visitStatus, type VisitFacts,
} from "../src/lib/readycheck-flow.core";

const trade = { kind: "trade" as const, userId: "t1" };
const owner = { kind: "owner" as const, ownerId: "o1" };
const base: VisitFacts = {
  coordinationEnabled: true, estimateApproved: true, ownerRequested: true,
  assignment: { id: "a1", version: 2, tradeUserId: "t1" }, contactsReleased: true,
  openProposal: { id: "p1", version: 1, enteredBy: trade, assignmentVersion: 2 },
  confirmedBooking: false, cancelled: false,
};

describe("visit status", () => {
  test("flag off or legacy job -> office review, never auto-progress", () => {
    expect(visitStatus({ ...base, coordinationEnabled: false })).toBe("office_review");
    expect(visitStatus({ ...base, ownerRequested: false })).toBe("office_review");
    expect(nextAction({ ...base, ownerRequested: false }, "office")).toBe("Office review: set up visit");
    expect(nextAction({ ...base, ownerRequested: false }, "trade")).toBeNull();
  });
  test("confirmed booking kept with flag off", () => {
    expect(visitStatus({ ...base, coordinationEnabled: false, confirmedBooking: true })).toBe("booked");
  });
  test("stale proposal from older assignment needs a new time", () => {
    expect(visitStatus({ ...base, assignment: { id: "a1", version: 3, tradeUserId: "t2" } })).toBe("awaiting_time");
  });
  test("one action per role", () => {
    expect(nextAction(base, "owner")).toBe("Confirm time");
    expect(nextAction(base, "trade")).toBeNull();
    expect(nextAction({ ...base, openProposal: null }, "trade")).toBe("Contact owner and enter time");
  });
});

describe("confirmation", () => {
  const ok = { facts: base, confirmer: owner, jobOwnerId: "o1", proposalId: "p1", proposalVersion: 1 };
  test("exact owner counterpart confirms", () => expect(confirmBlocker(ok)).toBeNull());
  test("same party, wrong owner, stale version, reassigned trade fail", () => {
    expect(confirmBlocker({ ...ok, confirmer: trade })).not.toBeNull();
    expect(confirmBlocker({ ...ok, confirmer: { kind: "owner", ownerId: "o2" } })).not.toBeNull();
    expect(confirmBlocker({ ...ok, proposalVersion: 0 })).not.toBeNull();
    const ownerEntered = { ...base, openProposal: { ...base.openProposal!, enteredBy: owner } };
    expect(confirmBlocker({ ...ok, facts: ownerEntered, confirmer: { kind: "trade", userId: "t9" } })).not.toBeNull();
    expect(confirmBlocker({ ...ok, facts: ownerEntered, confirmer: trade })).toBeNull();
  });
  test("office needs evidence", () => {
    const office = { kind: "office" as const, userId: "x" };
    expect(confirmBlocker({ ...ok, confirmer: office })).not.toBeNull();
    expect(confirmBlocker({ ...ok, confirmer: office, officeEvidence: { method: "phone", note: "Owner agreed 9am" } })).toBeNull();
  });
});

describe("timers and delivery", () => {
  test("24h / 48h schedule", () => {
    const [r, a] = scheduleTasks(0);
    expect(r.dueAtMs).toBe(24 * HOUR);
    expect(a.dueAtMs).toBe(48 * HOUR);
  });
  test("48h alert stands after a time is entered; reminder does not", () => {
    expect(taskStillApplies("reminder_24h", "awaiting_confirmation")).toBe(false);
    expect(taskStillApplies("office_alert_48h", "awaiting_confirmation")).toBe(true);
    expect(taskStillApplies("office_alert_48h", "booked")).toBe(false);
  });
  test("retry only failed recipient; suppressed/unknown never resent", () => {
    expect(retryTargets([{ recipient: "owner", outcome: "sent" }, { recipient: "trade", outcome: "failed" }, { recipient: "x", outcome: "suppressed" }, { recipient: "y", outcome: "unknown" }])).toEqual(["trade"]);
  });
  test("delivery gate", () => {
    const g = { switchOn: true, consentCurrent: true, assignmentCurrent: true, deliveryUnknown: false };
    expect(deliveryDecision(g)).toBe("send");
    expect(deliveryDecision({ ...g, switchOn: false })).toBe("suppress");
    expect(deliveryDecision({ ...g, consentCurrent: false })).toBe("block");
    expect(deliveryDecision({ ...g, deliveryUnknown: true })).toBe("block");
  });
  test("lease recovery", () => {
    expect(leaseReclaimable(100, 101)).toBe(true);
    expect(leaseReclaimable(200, 101)).toBe(false);
  });
});

describe("stage exit", () => {
  test("booked needs approval, request and confirmation", () => {
    expect(bookingStageExitBlocker("assessment_booking", "assessment_booked", base)).not.toBeNull();
    expect(bookingStageExitBlocker("assessment_booking", "assessment_booked", { ...base, confirmedBooking: true })).toBeNull();
    expect(bookingStageExitBlocker("assessment_booking", "assessment_booked", { ...base, confirmedBooking: true, ownerRequested: false })).not.toBeNull();
  });
});
