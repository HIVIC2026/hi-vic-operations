import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildOperationsPreview, classifyOperation, communicationLabel, type OperationInput } from "../src/lib/operations-preview.core";

const now = Date.parse("2026-10-08T06:44:00Z");
export function fixture(id: string, patch: Partial<OperationInput> = {}): OperationInput {
  return { id, jobNumber: `HV-${id}`, owner: "TEST Owner", address: "18 Test Street, Melbourne VIC 3000", source: "website", channel: "hivic_sourced", businessUnit: "hivic", originatingInstaller: null, assignedInstaller: null, eligibility: "likely_eligible", eligibilityReason: null, verifiedEligibility: null, insulation: "none", mediaCount: 0, mediaReview: null, actualHandoff: false, evidence: [], communications: [], failures: [], facts: { id, stage: "preliminary_estimate_ready", createdAt: "2026-09-01T00:00:00Z", lastActivityAt: null, enteredStageAt: null }, ...patch };
}
describe("isolated operations presentation", () => {
  test("saved-only legacy scheduling remains a lead, capacity never overdue", () => {
    const input = fixture("saved"); input.facts.stage = "ready_check_ready_to_schedule";
    input.facts.campaign = { spotSavedAt: "2026-09-01T00:00:00Z", optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: null, createdAt: "2026-09-01T00:00:00Z" };
    const r = classifyOperation(input, now);
    expect(r.bucket).toBe("Leads"); expect(r.tasks[0]?.party).toBe("Capacity"); expect(r.overdue).toBe(false); expect(r.tasks[0]?.dueAt).toBeNull();
  });
  test("actual offer, booking and evidence take precedence over saved spot", () => {
    for (const fact of ["rcOfferAt", "rcBookingAt", "rcSubmittedAt"] as const) {
      const input = fixture(fact); input.facts.stage = "ready_check_ready_to_schedule";
      input.facts[fact] = "2026-10-10T00:00:00Z";
      input.facts.campaign = { spotSavedAt: "2026-09-01T00:00:00Z", optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: null, createdAt: "2026-09-01T00:00:00Z" };
      const r = classifyOperation(input, now); expect(r.bucket).toBe("Active jobs"); expect(r.process).toBe("Ready Check"); expect(r.tasks.some((t) => t.party === "Capacity")).toBe(false);
    }
  });
  test("explicit operational handoff without booking does not claim booked", () => {
    const r = classifyOperation(fixture("handoff", { actualHandoff: true }), now);
    expect(r.bucket).toBe("Active jobs"); expect(r.nextAction).not.toMatch(/booked|sent/i);
  });
  test("received vs missing evidence and responsible role", () => {
    const r = classifyOperation(fixture("evidence", { actualHandoff: true, evidence: [{ label: "Safety evidence", status: "outstanding", role: "electrician" }, { label: "Ceiling pictures", status: "uploaded", role: "installer" }] }), now);
    expect(r.tasks.some((t) => t.party === "Electrician" && t.label.includes("not received"))).toBe(true);
    expect(r.tasks.some((t) => t.party === "Office" && t.label.includes("received, verification pending"))).toBe(true);
  });
  test("ineligible unsent remains an identifiable unclosed enquiry", () => {
    const r = classifyOperation(fixture("no", { eligibility: "does_not_appear_eligible", eligibilityReason: "Building too new" }), now);
    expect(r.bucket).toBe("Leads"); expect(r.process).toBe("Ineligible enquiry"); expect(r.communicationLabel).toBe("No recorded send"); expect(r.eligibilityReason).toBe("Building too new");
    const unrelated = classifyOperation(fixture("other-mail", { eligibility: "does_not_appear_eligible", communications: [{ purpose: "step3_estimate", status: "sent", at: "2026-10-01T00:00:00Z" }] }), now);
    expect(unrelated.tasks[0]?.label).toBe("Ineligible email has no confirmed send");
  });
  test("unknown, held or queued communication never counts as sent", () => {
    for (const status of ["sent_unknown", "delivered_unrecorded", "sending", "held", "queued"]) {
      const r = classifyOperation(fixture(status, { communications: [{ purpose: "estimate", status, at: "2026-10-01T00:00:00Z" }] }), now);
      expect(r.process).not.toBe("Offer & owner response"); expect(r.communicationLabel).not.toMatch(/^Sent|^Delivered/);
    }
    expect(communicationLabel({ purpose: "estimate", status: "sent", at: null })).toContain("No confirmed send");
  });
  test("media review states and eligibility groups", () => {
    expect(classifyOperation(fixture("pictures", { mediaCount: 2, insulation: "present", eligibility: "needs_onsite_confirmation" }), now).tasks[0]?.party).toBe("Office");
    expect(classifyOperation(fixture("none", { insulation: "unknown", eligibility: "needs_onsite_confirmation" }), now).mediaState).toContain("Awaiting upload");
    expect(classifyOperation(fixture("unsuitable", { mediaReview: "over_r2" }), now).eligibilityGroup).toBe("Reviewed unsuitable insulation");
  });
  test("both customer source routes preserve installer attribution", () => {
    const r = classifyOperation(fixture("partner", { channel: "installer_sourced", originatingInstaller: "TEST Trade", assignedInstaller: "TEST Trade" }), now);
    expect(r.originatingInstaller).toBe("TEST Trade"); expect(r.assignedInstaller).toBe("TEST Trade"); expect(r.bucket).toBe("Leads");
  });
  test("on hold is reversible and not completed/closed", () => {
    const input = fixture("hold"); input.facts.stage = "on_hold";
    expect(classifyOperation(input, now).bucket).toBe("Leads");
    input.actualHandoff = true;
    expect(classifyOperation(input, now).bucket).toBe("Active jobs"); expect(classifyOperation(input, now).process).toBe("On hold");
  });
  test("unknown/conflicting stages stay in reconciliation", () => {
    const input = fixture("unknown"); input.facts.stage = "future_stage";
    expect(classifyOperation(input, now).bucket).toBe("Needs classification");
    input.facts.stage = "installation_booked";
    expect(classifyOperation(input, now).issues.join(" ")).toContain("no supporting booking");
    expect(classifyOperation(fixture("conflict", { verifiedEligibility: "eligible", eligibility: "does_not_appear_eligible" }), now).bucket).toBe("Needs classification");
  });
  test("one ID, all bucket and stage totals reconcile; scoped QA exclusion", () => {
    const unknown = fixture("unknown"); unknown.facts.stage = "not_mapped";
    const result = buildOperationsPreview([fixture("a"), fixture("a"), unknown, fixture("qa", { source: "qa_test" }), fixture("other", { businessUnit: "other" })], [], now);
    expect(result.rows).toHaveLength(2); expect(result.totals["Needs classification"]).toBe(2);
    expect(result.reconciliation.uniqueJobs).toBe(result.reconciliation.bucketSum); expect(result.reconciliation.stageSum).toBe(result.reconciliation.bucketSum); expect(result.reconciliation.excluded).toBe(2);
  });
  test("concurrent tasks count distinct jobs separately from tasks", () => {
    const result = buildOperationsPreview([fixture("a", { actualHandoff: true, evidence: [{ label: "A", status: "uploaded" }, { label: "B", status: "uploaded" }] })], [], now);
    expect(result.stages[0]?.parties.find((p) => p.party === "Office")?.jobs).toBe(1);
    expect(result.stages[0]?.parties.find((p) => p.party === "Office")?.tasks).toBe(3); // handoff arranging + two received evidence checks
  });
  test("route and endpoint both require admin; direct only; no mutations", () => {
    const route = readFileSync("src/routes/_authenticated/admin.operations-preview.tsx", "utf8");
    const endpoint = readFileSync("src/lib/operations-preview.functions.ts", "utf8");
    const server = readFileSync("src/lib/operations-preview.server.ts", "utf8");
    expect(route).toContain('/_authenticated/admin/operations-preview');
    expect(readFileSync("src/routes/_authenticated/admin.tsx", "utf8")).toContain('.admin');
    expect(endpoint).toContain('.middleware([requireSupabaseAuth])'); expect(endpoint.indexOf('await requireAdmin')).toBeLessThan(endpoint.indexOf('client.server'));
    expect(server).toContain(".eq('business_unit', 'hivic').neq('source', 'qa_test')");
    expect(server).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(|maybeAutoRoute|sendSaveMySpot|fetch\(/);
    expect(readFileSync("src/lib/office-nav.ts", "utf8")).not.toContain("operations-preview");
  });
});