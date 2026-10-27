import { describe, expect, test } from "bun:test";
import { officeLegacyTarget } from "../src/lib/legacy-links.core";
import { readFileSync } from "node:fs";
import { buildOperationsPreview, classifyOperation, communicationLabel, sendingControlState, type OperationInput } from "../src/lib/operations-preview.core";

const now = Date.parse("2026-10-08T06:44:00Z");
const sent = (purpose: string, status = "sent", actionKey?: string) => ({ purpose, status, at: "2026-10-01T00:00:00Z", actionKey });
export function fixture(id: string, patch: Partial<OperationInput> = {}): OperationInput {
  return { id, jobNumber: `HV-${id}`, owner: "TEST Owner", address: "18 Test Street, Melbourne VIC 3000", source: "website", channel: "hivic_sourced", businessUnit: "hivic", originatingInstaller: null, assignedInstaller: null, eligibility: "likely_eligible", eligibilityReason: null, verifiedEligibility: null, insulation: "none", mediaCount: 0, mediaReview: null, actualHandoff: false, evidence: [], communications: [], failures: [], facts: { id, stage: "preliminary_estimate_ready", createdAt: "2026-09-01T00:00:00Z", lastActivityAt: null, enteredStageAt: null }, ...patch };
}
describe("isolated operations presentation", () => {
  test("insulation sending composes approval with BOTH global locks", () => {
    expect(sendingControlState(true, false, true)).toBe("Paused");
    expect(sendingControlState(true, true, false)).toBe("Paused");
    expect(sendingControlState(false, true, true)).toBe("Paused");
    expect(sendingControlState(true, true, true)).toBe("Enabled");
    expect(sendingControlState(true, undefined, true)).toBe("Unknown");
  });
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
    const r = classifyOperation(fixture("evidence", { facts: { id: "evidence", stage: "ready_check_complete", createdAt: "2026-09-01", lastActivityAt: null, enteredStageAt: null }, actualHandoff: true, evidence: [{ label: "Safety evidence", status: "outstanding", role: "electrician", gate: "assessment" }, { label: "Ceiling pictures", status: "uploaded", role: "installer", gate: "assessment" }] }), now);
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
    const result = buildOperationsPreview([fixture("a", { facts: { id: "a", stage: "ready_check_complete", createdAt: "2026-09-01", lastActivityAt: null, enteredStageAt: null }, actualHandoff: true, evidence: [{ label: "A", status: "uploaded", gate: "assessment" }, { label: "B", status: "uploaded", gate: "assessment" }] })], [], now);
    expect(result.stages[0]?.parties.find((p) => p.party === "Office")?.jobs).toBe(1);
    expect(result.stages[0]?.parties.find((p) => p.party === "Office")?.tasks).toBe(2); // two received evidence checks; sync task belongs to System
  });
  test("route and endpoint both require admin; direct only; no mutations", () => {
    const endpoint = readFileSync("src/lib/operations-preview.functions.ts", "utf8");
    const server = readFileSync("src/lib/operations-preview.server.ts", "utf8");
    expect(officeLegacyTarget("operations-preview")).toEqual({ to: "/admin/jobs/active" });
    expect(readFileSync("src/routes/_authenticated/admin.tsx", "utf8")).toContain('.admin');
    expect(endpoint).toContain('.middleware([requireSupabaseAuth])'); expect(endpoint.indexOf('await requireAdmin')).toBeLessThan(endpoint.indexOf('client.server'));
    expect(server).toContain(".eq('business_unit', 'hivic').is('deleted_at', null).or('source.is.null,source.neq.qa_test')");
    expect(server).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(|maybeAutoRoute|sendSaveMySpot|fetch\(/);
    expect(readFileSync("src/lib/office-nav.ts", "utf8")).not.toMatch(/key: "[^"]+", label: "[^"]+", to: "\/admin\/operations-preview"/);
  });
  test("future installation and PIISA requirements do not block leads now", () => {
    const r = classifyOperation(fixture("future", { evidence: [{ label: "PIISA", gate: "installation", status: "outstanding" }, { label: "Completed photos", gate: "installation", status: "outstanding" }] }), now);
    expect(r.bucket).toBe("Leads"); expect(r.blocked).toBe(false); expect(r.tasks).toHaveLength(1);
    expect(r.evidence).toHaveLength(2);
    expect(classifyOperation(fixture("unknown-gate", { evidence: [{ label: "Unknown", gate: "new_gate", status: "outstanding" }] }), now).bucket).toBe("Needs classification");
  });
  test("legacy stage order alone is not PIESA completion proof; installation guards establish prior gates", () => {
    const f = fixture("legacy", { actualHandoff: true, evidence: [{ label: "PIESA", gate: "electrical", status: "outstanding" }] });
    f.facts.stage = "awaiting_electrician";
    expect(classifyOperation(f, now).bucket).toBe("Needs classification");
    f.facts.stage = "installation_scheduling";
    expect(classifyOperation(f, now).bucket).toBe("Active jobs");
    expect(classifyOperation(f, now).tasks.some(t => t.label === "PIESA: not received")).toBe(true);
  });
  test("unrelated/manual and ambiguous legacy campaign emails never prove photos or estimate contact", () => {
    for (const purpose of ["followup", "email", "existing_leads_launch_v1", "area_unavailable"]) {
      const r = classifyOperation(fixture(purpose, { communications: [sent(purpose)] }), now);
      expect(r.process).toBe("Eligibility & estimate");
      const photos = classifyOperation(fixture(purpose, { insulation: "present", eligibility: "needs_onsite_confirmation", insulationOnlyPassed: true, communications: [sent(purpose)] }), now);
      expect(photos.tasks[0]?.party).toBe("System");
    }
    const photoMail = sent("existing_leads_launch_v1", "sent", "existing_leads_launch_v1:insulation_details:x");
    expect(classifyOperation(fixture("photo-mail", { insulation: "present", eligibility: "needs_onsite_confirmation", insulationOnlyPassed: true, communications: [photoMail] }), now).tasks[0]?.party).toBe("Owner");
    expect(classifyOperation(fixture("offer-mail", { communications: [sent("existing_leads_launch_v1", "sent", "existing_leads_launch_v1:save_my_spot:x")] }), now).process).toBe("Offer & owner response");
  });
  test("latest purpose outcome recovers failures without deleting history; unknown send protects against retry", () => {
    const history = [{ ...sent("step3_estimate", "failed"), recordedAt: "2026-10-01T00:00:00Z" }, { ...sent("step3_estimate"), recordedAt: "2026-10-02T00:00:00Z" }];
    const r = classifyOperation(fixture("recovered", { communications: history }), now);
    expect(r.blocked).toBe(false); expect(r.process).toBe("Offer & owner response"); expect(r.communications).toHaveLength(2);
    const unknown = classifyOperation(fixture("unknown-send", { communications: [...history, { ...sent("step3_estimate", "sent_unknown"), recordedAt: "2026-10-03T00:00:00Z" }] }), now);
    expect(unknown.process).toBe("Eligibility & estimate"); expect(unknown.nextAction).toContain("do not resend"); expect(unknown.nextAction).not.toContain("failed");
  });
  test("null source survives scope and is visibly unclassified", () => {
    const r = buildOperationsPreview([fixture("null", { source: null, channel: null })], [], now);
    expect(r.rows).toHaveLength(1); expect(r.totals["Needs classification"]).toBe(1); expect(r.reconciliation.excluded).toBe(0);
  });
  test("installation deadline does not make quote or payment action overdue", () => {
    for (const status of ["issued", "accepted"]) {
      const f = fixture(status); f.facts.stage = status === "issued" ? "awaiting_quote_acceptance" : "measured_quote_accepted";
      f.facts.quote = { status, releaseState: "released", holdReason: null, sentAt: "2026-10-01", acceptedAt: status === "accepted" ? "2026-10-02" : null };
      f.facts.installDeadline = "2026-10-01";
      const r = classifyOperation(f, now);
      expect(r.tasks[0]?.overdue).toBe(false); expect(r.tasks[0]?.dueAt).toBeNull();
      expect(r.tasks.find(t => t.label.includes("commence"))?.overdue).toBe(true);
      f.paymentDueAt = "2026-10-01";
      if (status === "accepted") expect(classifyOperation(f, now).tasks[0]?.overdue).toBe(true);
      f.facts.installedAt = "2026-10-02";
      expect(classifyOperation(f, now).tasks.some(t => t.label.includes("commence"))).toBe(false);
    }
  });
  test("draft/historic or unconfirmed quotes alone are not operational handoffs", () => {
    for (const status of ["draft", "declined", "expired", "superseded", "issued", "accepted"]) {
      const f = fixture(status); f.facts.quote = { status, releaseState: "queued", holdReason: null, sentAt: null, acceptedAt: null };
      expect(classifyOperation(f, now).bucket).toBe("Leads");
      f.facts.rcOfferAt = "2026-10-08";
      expect(classifyOperation(f, now).bucket).toBe("Active jobs");
    }
    for (const status of ["issued", "accepted"]) {
      const f = fixture(status); f.facts.quote = { status, releaseState: "released", holdReason: null, sentAt: "2026-10-08", acceptedAt: "2026-10-08" };
      expect(classifyOperation(f, now).bucket).toBe("Active jobs");
    }
  });
  test("notified ineligible enquiry has no mandatory closure task", () => {
    const r = classifyOperation(fixture("notified", { eligibility: "does_not_appear_eligible", communications: [sent("preliminary_ineligible")] }), now);
    expect(r.bucket).toBe("Leads"); expect(r.tasks).toHaveLength(0); expect(r.nextAction).toBe("No outstanding task recorded");
  });
  test("otherwise-eligible insulation group requires real insulationOnly pass", () => {
    for (const passed of [undefined, false, true]) {
      const r = classifyOperation(fixture("checks", { insulation: "present", eligibility: "needs_onsite_confirmation", insulationOnlyPassed: passed }), now);
      expect(r.eligibilityGroup.includes("Otherwise eligible")).toBe(passed === true);
      if (!passed) expect(r.eligibilityLabel).toContain("other eligibility checks");
    }
  });
});
describe("preview cross-cutting flags (phase 2)", () => {
  const saved = { spotSavedAt: "2026-09-01T00:00:00Z", optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: null, createdAt: "2026-09-01T00:00:00Z" };
  test("Spot saved covers saved leads even when media review is the current stage, without changing stage totals", () => {
    const a = fixture("s1"); a.facts.campaign = { ...saved };
    const b = fixture("s2", { insulation: "some", mediaCount: 2 }); b.facts.campaign = { ...saved };
    const c = fixture("s3", { actualHandoff: true }); c.facts.campaign = { ...saved };
    const d = fixture("s4");
    const p = buildOperationsPreview([a, b, c, d], [], now);
    const rb = p.rows.find((r) => r.id === "s2")!;
    expect(rb.process).toBe("Insulation review");
    expect(rb.spotSavedOpen).toBe(true);
    expect(p.rows.find((r) => r.id === "s3")!.spotSavedOpen).toBe(false);
    expect(p.flags.spotSaved).toBe(2);
    expect(p.flags.mediaToReview).toBe(1);
    expect(p.reconciliation.stageSum).toBe(4);
  });
  test("reviewed media and opted-out spots are not flagged", () => {
    const a = fixture("m1", { insulation: "some", mediaCount: 3, mediaReview: "below_r2" });
    const b = fixture("m2"); b.facts.campaign = { ...saved, optedOutAt: "2026-09-02T00:00:00Z" };
    const p = buildOperationsPreview([a, b], [], now);
    expect(p.flags).toEqual({ spotSaved: 0, mediaToReview: 0 });
  });
});
