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
  test("deposit blocked until both signatures", () => {
    expect(g(base, "deposit_cleared").status).toBe("blocked");
    expect(g({ ...base, acceptanceSignedAt: base.now }, "deposit_cleared").status).toBe("blocked");
    expect(g({ ...base, acceptanceSignedAt: base.now, assignmentSignedAt: base.now }, "deposit_cleared").status).toBe("open");
  });
  test("PIESA 30-day window deadline and expiry", () => {
    const f = { ...base, piesaCompletedAt: "2026-10-01T00:00:00Z", piesaOutcome: "pass" as const };
    expect(g(f, "install_within_piesa_window").dueAt).toBe("2026-10-31T00:00:00.000Z");
    expect(g({ ...f, now: "2026-11-01T00:00:00Z" }, "install_within_piesa_window").status).toBe("overdue");
    expect(g({ ...f, installStart: "2026-11-05T00:00:00Z" }, "install_within_piesa_window").status).toBe("blocked");
    expect(g({ ...f, installCompletedAt: "2026-10-20T00:00:00Z" }, "install_within_piesa_window").status).toBe("done");
  });
  test("window length is configurable", () => {
    const f = { ...base, piesaWindowDays: 10, piesaCompletedAt: "2026-10-01T00:00:00Z", piesaOutcome: "pass" as const };
    expect(g(f, "install_within_piesa_window").dueAt).toBe("2026-10-11T00:00:00.000Z");
  });
  test("24h pre-install gates", () => {
    const f = { ...base, installStart: "2026-10-12T00:00:00Z" };
    expect(g(f, "owner_esc_consent").dueAt).toBe("2026-10-11T00:00:00.000Z");
    expect(g(f, "owner_esc_consent").status).toBe("due_soon");
    expect(g({ ...f, now: "2026-10-11T06:00:00Z" }, "piesa_copies_delivered").status).toBe("overdue");
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
    const u = urgentGates(buildComplianceTimeline({ ...base, acceptanceSignedAt: base.now, assignmentSignedAt: base.now, piesaCompletedAt: "2026-09-01T00:00:00Z", piesaOutcome: "pass" }));
    expect(u[0].status).toBe("overdue");
  });
});

describe("official ESC additions", () => {
  test("assignment copy due 10 business days after signing", () => {
    const f = { ...base, assignmentSignedAt: "2026-10-09T00:00:00Z" }; // Friday
    expect(buildComplianceTimeline(f).find((x) => x.key === "assignment_copy_to_consumer")!.dueAt).toBe("2026-10-23T00:00:00.000Z");
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
});
