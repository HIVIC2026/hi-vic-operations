import { describe, expect, test } from "bun:test";
import { buildComplianceTimeline, urgentGates, type TimelineFacts } from "../src/lib/compliance-timeline.core";

const base: TimelineFacts = {
  now: "2026-10-10T00:00:00Z", acceptanceSignedAt: null, assignmentSignedAt: null, depositCleared: false,
  piesaCompletedAt: null, piesaOutcome: null, installStart: null, installCompletedAt: null, ownerEscConsentAt: null,
  escSentAt: null, piesaCopiesDeliveredAt: null, installerDeclarationAt: null, evidenceComplete: false,
  assignmentEffective: false, apApprovedAt: null, veecLodgedAt: null,
};
const g = (f: TimelineFacts, k: string) => buildComplianceTimeline(f).find((x) => x.key === k)!;

describe("compliance timeline", () => {
  test("deposit requires commercial quote acceptance, not post-install assignment", () => {
    expect(g(base, "deposit_cleared").status).toBe("blocked");
    expect(g({ ...base, acceptanceSignedAt: base.now }, "deposit_cleared").status).toBe("open");
  });
  test("PIESA 30-day window deadline and expiry", () => {
    const f = { ...base, piesaCompletedAt: "2026-10-01T00:00:00Z", piesaOutcome: "pass" as const };
    expect(g(f, "install_within_piesa_window").dueAt).toBe("2026-10-31T12:59:59.999Z");
    expect(g({ ...f, now: "2026-11-01T00:00:00Z" }, "install_within_piesa_window").status).toBe("overdue");
    expect(g({ ...f, installStart: "2026-11-05T00:00:00Z" }, "install_within_piesa_window").status).toBe("blocked");
    expect(g({ ...f, installCompletedAt: "2026-10-20T00:00:00Z" }, "install_within_piesa_window").status).toBe("done");
  });
  test("window length is configurable", () => {
    const f = { ...base, piesaWindowDays: 10, piesaCompletedAt: "2026-10-01T00:00:00Z", piesaOutcome: "pass" as const };
    expect(g(f, "install_within_piesa_window").dueAt).toBe("2026-10-11T12:59:59.999Z");
  });
  test("24h pre-install gates", () => {
    const f = { ...base, installStart: "2026-10-12T00:00:00Z" };
    expect(g(f, "owner_esc_consent").dueAt).toBe("2026-10-11T00:00:00.000Z");
    expect(g(f, "owner_esc_consent").status).toBe("due_soon");
    expect(g({ ...f, now: "2026-10-11T06:00:00Z" }, "piesa_copies_delivered").status).toBe("overdue");
    expect(g(f, "piesa_copies_delivered").label).toContain("owner and installer");
  });
  test("ESC notice not open earlier than 5 days before", () => {
    const f = { ...base, installStart: "2026-10-20T00:00:00Z" };
    expect(g(f, "esc_notified").status).toBe("not_yet");
    expect(g({ ...f, now: "2026-10-16T00:00:00Z" }, "esc_notified").status).toBe("open");
  });
  test("failed PIESA blocks", () => {
    expect(g({ ...base, depositCleared: true, piesaCompletedAt: base.now, piesaOutcome: "fail" }, "piesa_completed").status).toBe("blocked");
  });
  test("urgent ordering", () => {
    const u = urgentGates(buildComplianceTimeline({ ...base, acceptanceSignedAt: base.now, piesaCompletedAt: "2026-09-01T00:00:00Z", piesaOutcome: "pass" }));
    expect(u[0].status).toBe("overdue");
  });
});

describe("official ESC additions", () => {
  test("assignment copy due 10 business days after signing", () => {
    const f = { ...base, assignmentSignedAt: "2026-10-09T00:00:00Z" }; // Friday
    expect(buildComplianceTimeline(f).find((x) => x.key === "assignment_copy_to_consumer")!.dueAt).toBe("2026-10-23T12:59:59.999Z");
  });
  test("life support gate only when flagged", () => {
    expect(buildComplianceTimeline(base).some((x) => x.key === "life_support_plan")).toBe(false);
    expect(buildComplianceTimeline({ ...base, lifeSupport: true }).some((x) => x.key === "life_support_plan")).toBe(true);
  });
  test("AP review needs co-payment and completion docs", () => {
    const f = { ...base, installCompletedAt: base.now, installerDeclarationAt: base.now, evidenceComplete: true, assignmentEffective: true };
    expect(buildComplianceTimeline(f).find((x) => x.key === "ap_approved")!.status).toBe("not_yet");
    expect(buildComplianceTimeline({ ...f, coPaymentPaidAt: base.now, completionDocsGivenAt: base.now }).find((x) => x.key === "ap_approved")!.status).toBe("open");
  });
  test("official form labels keep the two assessments separate and the co-payment non-reimbursable", () => {
    expect(g(base, "piesa_completed").label).toContain("Pre Insulation Electrical Safety Assessment (PIESA)");
    expect(g(base, "installer_safety_assessment").label).toContain("installer safety assessment");
    expect(g(base, "co_payment_paid").when).toContain("must not be reimbursed");
  });
});

import { complianceRecordBlockers } from "../src/lib/compliance-timeline.core";
describe("compliance records gate stages", () => {
  const none = new Set<never>();
  test("install start needs pre-install docs", () => expect(complianceRecordBlockers("evidence_outstanding", none, { lifeSupport: false, ownerPaidIncGst: 0 })).toHaveLength(1));
  test("life support adds plan before PIESA booking", () => {
    expect(complianceRecordBlockers("piesa_scheduled", none, { lifeSupport: true, ownerPaidIncGst: 0 })).toHaveLength(1);
    expect(complianceRecordBlockers("assessment_booked", none, { lifeSupport: false, ownerPaidIncGst: 0 })).toHaveLength(0);
  });
  test("AP review needs safety, completion docs, co-payment", () => expect(complianceRecordBlockers("ap_review", none, { lifeSupport: false, ownerPaidIncGst: 0 })).toHaveLength(3));
  test("Xero payment ≥ $200 satisfies co-payment", () => expect(complianceRecordBlockers("ap_review", none, { lifeSupport: false, ownerPaidIncGst: 1858 })).toHaveLength(2));
  test("ready for VEEC also needs assignment copy", () => expect(complianceRecordBlockers("ready_for_veec", new Set(["installer_safety_assessment", "completion_consumer_docs", "co_payment_paid"] as never[]), { lifeSupport: false, ownerPaidIncGst: 0 })).toEqual(["Activity 48 record missing: Copy of signed VEEC assignment form given to owner"]));
});

test("Jo 24 Oct: the 30-day PIESA window is about commencement — started in time, finished late is still done", () => {
  const f = { ...base, piesaCompletedAt: "2026-10-01T00:00:00Z", piesaOutcome: "pass" as const, installStart: "2026-10-30T22:00:00Z", installCompletedAt: "2026-11-02T05:00:00Z" };
  const g = buildComplianceTimeline(f).find((x) => x.key === "install_within_piesa_window")!;
  expect(g.status).toBe("done");
  expect(g.label).toContain("commenced");
  const late = buildComplianceTimeline({ ...f, installStart: "2026-11-02T00:00:00Z" }).find((x) => x.key === "install_within_piesa_window")!;
  expect(late.status).toBe("overdue");
});
