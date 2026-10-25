// Decision 393 (Jo, owner, 25 Oct 2026: "Yes, send all 54"): pure validation and per-job refusal rules for the one-off
// backlog send. Run alone: bun test tests/backlog-send.core.test.ts
import { describe, expect, test } from "bun:test";
import {
  BACKLOG_SEND_MAX, backlogOutcome, backlogRefusal, backlogSummary, existingInsulationAnswer, parseBacklogSendBody, safeDetail,
  type BacklogJobFacts,
} from "../src/lib/backlog-send.core";
import { automaticLeadEmail } from "../src/lib/enquiry-groups.core";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("body validation", () => {
  test("accepts the three known kinds and lower-cases ids", () => {
    const r = parseBacklogSendBody({ sends: [
      { jobId: uuid(1), kind: "save_spot_none" }, { jobId: uuid(2).toUpperCase(), kind: "save_spot_existing" }, { jobId: uuid(3), kind: "questions" },
    ] });
    expect(r).toEqual({ ok: true, sends: [{ jobId: uuid(1), kind: "save_spot_none" }, { jobId: uuid(2), kind: "save_spot_existing" }, { jobId: uuid(3), kind: "questions" }] });
  });
  test(`at most ${BACKLOG_SEND_MAX} items`, () => {
    expect(BACKLOG_SEND_MAX).toBe(60);
    const sends = (n: number) => Array.from({ length: n }, (_, i) => ({ jobId: uuid(i + 1), kind: "questions" }));
    expect(parseBacklogSendBody({ sends: sends(60) }).ok).toBe(true);
    const over = parseBacklogSendBody({ sends: sends(61) });
    expect(over).toEqual({ ok: false, error: "At most 60 sends per call." });
  });
  test("rejects anything else", () => {
    for (const bad of [
      null, "x", [], {}, { sends: [] }, { sends: "x" },
      { sends: [{ jobId: "not-a-uuid", kind: "questions" }] },
      { sends: [{ jobId: uuid(1), kind: "ineligible" }] },
      { sends: [{ jobId: uuid(1) }] },
      { sends: [{ jobId: uuid(1), kind: "questions", email: "a@b.c" }] },
      { sends: [{ jobId: uuid(1), kind: "questions" }], dryRun: false },
      { sends: [{ jobId: uuid(1), kind: "questions" }, { jobId: uuid(1), kind: "save_spot_none" }] },
      { sends: [{ jobId: uuid(1), kind: "questions" }, { jobId: uuid(1).toUpperCase(), kind: "questions" }] },
    ]) expect(parseBacklogSendBody(bad).ok).toBe(false);
  });
});

const OK: BacklogJobFacts = {
  jobNumber: "HV-2000", source: "base44", stage: "lead", deletedAt: null, qaArchivedAt: null, eligibilityOutcome: "needs_onsite_confirmation",
  spotSavedAt: null, campaignOptedOutAt: null, emailOptedOutAt: null, intakeMediaCount: 0, mediaReceivedAt: null, priorEmailBlocker: null,
};
const T = "2026-10-20T00:00:00Z";

describe("per-job refusal", () => {
  test("an open, untouched website enquiry may go for every kind", () => {
    for (const kind of ["save_spot_none", "save_spot_existing", "questions"] as const) expect(backlogRefusal(kind, OK)).toBeNull();
  });
  const cases: [string, Partial<BacklogJobFacts>, string][] = [
    ["qa_test", { source: "qa_test" }, "TEST job"],
    ["not base44", { source: "manual" }, "Not a website enquiry"],
    ["deleted", { deletedAt: T }, "deleted"],
    ["qa archived", { qaArchivedAt: T }, "archived"],
    ["cancelled", { stage: "cancelled" }, "cancelled"],
    ["campaign opt-out", { campaignOptedOutAt: T }, "opted out"],
    ["email opt-out", { emailOptedOutAt: T }, "opted out"],
    ["spot saved", { spotSavedAt: T }, "Spot already saved"],
    ["ineligible", { eligibilityOutcome: "does_not_appear_eligible" }, "Does not appear eligible"],
    ["already emailed", { priorEmailBlocker: "An earlier email exists" }, "Already emailed"],
  ];
  for (const [name, patch, reason] of cases) {
    test(`${name} → refused for every kind`, () => {
      for (const kind of ["save_spot_none", "save_spot_existing", "questions"] as const) expect(backlogRefusal(kind, { ...OK, ...patch })).toContain(reason);
    });
  }
  test("Jo's legacy exclusions are refused", () => expect(backlogRefusal("questions", OK, "LEGACY_EXCLUDED")).toContain("Excluded by Jo"));
  test("photos sent → only the questions email is refused", () => {
    for (const patch of [{ intakeMediaCount: 2 }, { mediaReceivedAt: T }]) {
      expect(backlogRefusal("questions", { ...OK, ...patch })).toContain("photos/video");
      expect(backlogRefusal("save_spot_none", { ...OK, ...patch })).toBeNull();
      expect(backlogRefusal("save_spot_existing", { ...OK, ...patch })).toBeNull();
    }
  });
});

describe("helpers", () => {
  test("existing-insulation answer: present/unknown only (decision 392 records unknown honestly)", () => {
    expect(existingInsulationAnswer("present")).toBe("present");
    expect(existingInsulationAnswer("unknown")).toBe("unknown");
    for (const x of ["none", null, undefined, "yes"]) expect(existingInsulationAnswer(x)).toBeNull();
  });
  test("outcome mapping and counts", () => {
    expect(["sent", "skipped", "blocked", "uncertain", "failed", undefined].map(backlogOutcome)).toEqual(["sent", "skipped", "skipped", "uncertain", "failed", "failed"]);
    const s = backlogSummary([
      { jobNumber: "HV-1", kind: "questions", outcome: "sent", detail: "Sent" },
      { jobNumber: "HV-2", kind: "questions", outcome: "skipped", detail: "x" },
      { jobNumber: "HV-3", kind: "questions", outcome: "uncertain", detail: "x" },
      { jobNumber: "HV-4", kind: "questions", outcome: "failed", detail: "x" },
    ]);
    expect([s.ok, s.sent, s.skipped, s.failed]).toEqual([true, 1, 1, 2]);
  });
  test("details never carry an email address or phone number", () => {
    const d = safeDetail("Invalid `to` field: jane.owner@example.com; call 0412 345 678 or +61 412 345 678 re HV-1234 on 2026-10-25");
    expect(d).not.toContain("jane.owner@example.com");
    expect(d).not.toContain("0412 345 678");
    expect(d).toContain("[email]");
    expect(d).toContain("HV-1234");
    expect(d).toContain("2026-10-25");
    expect(safeDetail("x".repeat(500)).length).toBe(200);
  });
});

describe("decision 392 still holds: the automatic router never sends the questions email to an unreviewed new enquiry", () => {
  const base = { source: "base44", channel: "hivic_sourced", decisionSource: "system", reviewRequired: false, intakeWorkActive: false, ownerEnteredArea: true } as const;
  for (const outcome of ["likely_eligible", "needs_onsite_confirmation"]) for (const declaredInsulation of ["present", "unknown", null] as const) {
    test(`${outcome} / ${declaredInsulation}`, () => expect(automaticLeadEmail({ ...base, outcome, declaredInsulation }).email).not.toBe("request_insulation"));
  }
});
