// Jo 24 Oct: installer presses Complete in Mitti → measurements recorded, eligibility from the form, quote stage,
// quote out — or held for the office with the reason. Pure rules + wiring.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { completionPlan } from "../src/lib/mitti-complete.core";
import { PREVIOUS_VEU_QUESTION, VEU_NOT_ANSWERED, STOP_PREVIOUS_VEU, STOP_NO_CONTACT } from "../src/lib/ready-check-answers.core";

const m = (over: Record<string, unknown> = {}) => ({ id: "m1", status: "draft", external_source: "mitti", external_id: "audit_1", provenance: "hivic_onsite", review_flags: [],
  measured_area_m2: 137.61, insulation_present: false, existing_r_value: null, removal_required: null, removal_m2: null, access_difficulty: "moderate", ...over });
const veuNo = [{ label: PREVIOUS_VEU_QUESTION, value: "No" }];
const base = { auditId: "audit_1", completed: true, modifiedAt: "2026-10-24T01:00:00Z", entries: veuNo, ourLead: false, websiteFacts: null };

describe("completionPlan", () => {
  test("HV-3117 shape: no existing insulation means no removal — completes", () =>
    expect(completionPlan({ ...base, measurement: m() as never })).toEqual({ kind: "complete", fill: { removal_required: false } }));
  test("not Complete in Mitti, another form, or no record: nothing happens", () => {
    expect(completionPlan({ ...base, completed: false, measurement: m() as never })).toEqual({ kind: "skip" });
    expect(completionPlan({ ...base, measurement: m({ external_id: "audit_other" }) as never })).toEqual({ kind: "skip" });
    expect(completionPlan({ ...base, measurement: null })).toEqual({ kind: "skip" });
  });
  test("already complete continues to the quote steps", () => expect(completionPlan({ ...base, measurement: m({ status: "complete" }) as never })).toEqual({ kind: "already" }));
  test("previous VEU: Yes holds, unanswered holds", () => {
    expect(completionPlan({ ...base, entries: [{ label: PREVIOUS_VEU_QUESTION, value: "Yes" }], measurement: m() as never })).toEqual({ kind: "hold", reasons: [STOP_PREVIOUS_VEU] });
    expect(completionPlan({ ...base, entries: [], measurement: m() as never })).toEqual({ kind: "hold", reasons: [VEU_NOT_ANSWERED] });
  });
  test("owner said No to contact holds", () => expect(completionPlan({ ...base, entries: [...veuNo, { label: "Homeowner agrees to be contacted by Home Insulation Victoria", value: "No" }], measurement: m() as never }).kind).toBe("hold"));
  test("missing area holds with the field named", () => {
    const r = completionPlan({ ...base, measurement: m({ measured_area_m2: null }) as never });
    expect(r.kind).toBe("hold");
    expect(r.kind === "hold" && r.reasons[0]!.startsWith("Ready Check is missing:")).toBe(true);
  });
  test("removal blank on a home WITH insulation: installer job assumes none, our lead holds", () => {
    const withIns = m({ insulation_present: true, existing_r_value: 1.5 });
    expect(completionPlan({ ...base, measurement: withIns as never })).toEqual({ kind: "complete", fill: { removal_required: false } });
    const lead = completionPlan({ ...base, ourLead: true, measurement: withIns as never });
    expect(lead.kind).toBe("hold");
  });
  test("our lead: website life support / built in last 5 years holds", () =>
    expect(completionPlan({ ...base, ourLead: true, websiteFacts: { lifeSupportStatus: "yes", overFiveYears: "yes" }, measurement: m() as never }).kind).toBe("hold"));
  test("answers flagged for office review hold", () => expect(completionPlan({ ...base, measurement: m({ review_flags: ["measured_area_m2"] }) as never }).kind).toBe("hold"));
  void STOP_NO_CONTACT;
});

test("wiring: one completion step for both forms, behind the switch; retry/watch sweep on the tick; eligibility from the form counts", () => {
  const sync = readFileSync("src/lib/mitti.server.ts", "utf8");
  expect(sync).toContain('ourLead: readyCheckVariant(job.channel) !== "ready_check_priced"');
  const srv = readFileSync("src/lib/mitti-complete.server.ts", "utf8");
  expect(srv).toContain("const enabled = i.enabled ?? AUTO_QUOTE_SEND_ENABLED;");
  expect(srv).toContain(".neq(\"status\", \"complete\")"); // completes once (compare-and-swap)
  expect(srv).toContain("stageEntryBlockers(jobId, to)"); // guarded stage moves, held with reasons
  expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("sweepCompletedMittiReadyChecks()");
  const ve = readFileSync("src/lib/verified-eligibility.server.ts", "utf8");
  expect(ve).toContain("if (v && !verificationStale(v, { ref: e.readyCheck.ref, version: e.readyCheck.version })) return v.outcome === \"eligible\";"); // office decision wins
  const rel = readFileSync("src/lib/office-quote-review.server.ts", "utf8");
  expect(rel).toContain("ensureOwnerLink(jobId)");
  expect(rel).toContain("commercialBlocker(jobId)");
});
