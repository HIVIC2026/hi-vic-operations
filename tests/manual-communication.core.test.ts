// STEP 17 (A1 manual communication): pure rules. No I/O.
import { describe, expect, test } from "bun:test";
import {
  GROUP_B_MANUAL_BLOCKED, MANUAL_OUTCOME_LABEL, MANUAL_OUTCOME_ORDER, MANUAL_PROVIDER, MANUAL_SENT_EVENT, MANUAL_SOURCE_EVENT, MANUAL_TEMPLATE_LABEL, MANUAL_TEMPLATES,
  TYPICAL_SIZE_MANUAL_BLOCKED, manualOutcomeOf, manualReasonText, manualRecordBlocker, manualRecordContent, manualSendReference, manualTemplateFor, planManualRecord,
  type ManualOutcome,
} from "../src/lib/manual-communication.core";
import { communicationOrigin } from "../src/lib/portal-presentation.core";

const approved = { template: "save_my_spot" as const, subject: "Save your spot – your preliminary price", body: "Hi Sam,\n\nHere is your preliminary price and your link to save your spot.\n" };

describe("manualTemplateFor – only approved A1 emails can be prepared", () => {
  test("likely eligible → approved Save your spot", () => {
    expect(manualTemplateFor({ route: "offer_spot", routeBlocker: null, typicalSizeEstimate: false })).toEqual({ template: "save_my_spot" });
  });
  test("ineligible → approved preliminary result", () => {
    expect(manualTemplateFor({ route: "ineligible", routeBlocker: null, typicalSizeEstimate: false })).toEqual({ template: "ineligible_result" });
  });
  test("Group B insulation-details wording is never offered", () => {
    for (const typical of [false, true]) expect(manualTemplateFor({ route: "request_insulation", routeBlocker: null, typicalSizeEstimate: typical })).toEqual({ blocked: GROUP_B_MANUAL_BLOCKED });
  });
  test("held typical-size estimate is not offered (existing hold stays in force)", () => {
    expect(manualTemplateFor({ route: "offer_spot", routeBlocker: null, typicalSizeEstimate: true })).toEqual({ blocked: TYPICAL_SIZE_MANUAL_BLOCKED });
  });
  test("no route → the router's own reason, never a catch-all email", () => {
    const r = manualTemplateFor({ route: "none", routeBlocker: "Eligibility needs office review", typicalSizeEstimate: false });
    expect("blocked" in r && r.blocked).toContain("Eligibility needs office review");
    expect("template" in manualTemplateFor({ route: "none", routeBlocker: null, typicalSizeEstimate: false })).toBe(false);
  });
  test("every template has a label", () => { for (const t of MANUAL_TEMPLATES) expect(MANUAL_TEMPLATE_LABEL[t].length).toBeGreaterThan(5); });
});

describe("manualReasonText – the manual copy obeys the approved sender's own rules", () => {
  test("consent, opt-out, bounce, test, stage, start-date/backlog and official holds all block, in plain words", () => {
    for (const c of ["no_consent", "unsubscribed", "bounced", "test_or_example_recipient", "job_progressed_or_closed", "eligibility_review_required", "official_not_ineligible", "no_owner_email", "backlog_cutoff_not_set", "backlog_before_cutoff", "backlog_too_old"]) {
      const t = manualReasonText(c);
      expect(t).toBeTruthy(); expect(t).not.toBe(c);
    }
    expect(manualReasonText(null)).toBeNull();
  });
  test("an unknown code still blocks (fails closed)", () => { expect(manualReasonText("something_new")).toBe("something_new"); });
});

describe("planManualRecord", () => {
  test("every outcome is a manual, Office-only, recorded entry tagged with its exact outcome", () => {
    for (const o of MANUAL_OUTCOME_ORDER) {
      const p = planManualRecord(o);
      expect(p).toMatchObject({ provider: MANUAL_PROVIDER, visibility: "internal", deliveryStatus: "recorded", sourceEvent: `${MANUAL_SOURCE_EVENT}:${o}` });
    }
  });
  test("only an actual manual email is outbound owner contact (Office status would read 'Estimate sent')", () => {
    expect(planManualRecord("sent_manually")).toMatchObject({ direction: "outbound", channel: "email", countsAsOwnerContact: true, needsApprovedEmail: true });
    expect(planManualRecord("phoned")).toMatchObject({ direction: "internal", channel: "phone", countsAsOwnerContact: false, needsNote: true });
    expect(planManualRecord("not_sent")).toMatchObject({ direction: "internal", channel: "note", countsAsOwnerContact: false, needsNote: true });
    expect(planManualRecord("followup_required")).toMatchObject({ direction: "internal", channel: "note", countsAsOwnerContact: false, needsNote: true });
  });
  test("labels match the agreed four outcomes", () => {
    expect(MANUAL_OUTCOME_ORDER.map((o) => MANUAL_OUTCOME_LABEL[o])).toEqual(["Sent manually", "Customer contacted by phone", "Not sent", "Follow-up required"]);
  });
});

describe("manualRecordBlocker / manualRecordContent", () => {
  test("unknown outcome is refused", () => { expect(manualRecordBlocker({ outcome: "x" as ManualOutcome })).toBeTruthy(); });
  test("'Sent manually' needs the prepared approved email (template + subject + full body)", () => {
    expect(manualRecordBlocker({ outcome: "sent_manually" })).toContain("Prepare the approved email first");
    expect(manualRecordBlocker({ outcome: "sent_manually", subject: approved.subject, body: approved.body })).toContain("Prepare the approved email first");
    expect(manualRecordBlocker({ outcome: "sent_manually", template: "group_b" as never, subject: approved.subject, body: approved.body })).toContain("Prepare the approved email first");
    expect(manualRecordBlocker({ outcome: "sent_manually", ...approved, body: "too short" })).toContain("Prepare the approved email first");
    expect(manualRecordBlocker({ outcome: "sent_manually", note: "I emailed them" })).toContain("Prepare the approved email first");
    expect(manualRecordBlocker({ outcome: "sent_manually", ...approved })).toBeNull();
  });
  test("phone / not sent / follow-up need a note", () => {
    for (const o of ["phoned", "not_sent", "followup_required"] as const) {
      expect(manualRecordBlocker({ outcome: o })).toContain("note");
      expect(manualRecordBlocker({ outcome: o, note: "  a " })).toContain("note");
      expect(manualRecordBlocker({ outcome: o, ...approved })).toContain("note");
      expect(manualRecordBlocker({ outcome: o, note: "Spoke to owner; call back Friday." })).toBeNull();
    }
  });
  test("approved email stored verbatim with its template; notes trimmed under an Office subject", () => {
    expect(manualRecordContent({ outcome: "sent_manually", ...approved })).toEqual({ subject: approved.subject, body: approved.body, sourceReference: manualSendReference("save_my_spot") });
    expect(manualSendReference("ineligible_result")).toBe("template:ineligible_result");
    expect(planManualRecord("sent_manually").sourceEvent).toBe(MANUAL_SENT_EVENT);
    expect(manualRecordContent({ outcome: "not_sent", note: "  No consent on file  " })).toEqual({ subject: "Office record: Not sent", body: "No consent on file", sourceReference: null });
  });
});

describe("telling manual records apart from system-delivered email (staff label in portal-presentation.core)", () => {
  test("provider manual (incl. column default) = Office record", () => {
    expect(communicationOrigin({ provider: "manual", direction: "outbound", delivery_status: "recorded", sent_at: "2026-10-12T00:00:00Z" })).toEqual({ manual: true, label: "Recorded by Office – not sent by the portal" });
    expect(communicationOrigin({ provider: null, delivery_status: "recorded" }).manual).toBe(true);
  });
  test("portal senders keep the confirmed-send wording", () => {
    expect(communicationOrigin({ provider: "resend", direction: "outbound", delivery_status: "recorded", sent_at: "2026-10-12T00:00:00Z" })).toEqual({ manual: false, label: "From the portal · Recorded — send not confirmed" });
    expect(communicationOrigin({ provider: "base44_bridge", direction: "outbound", delivery_status: "sent", sent_at: "2026-10-12T00:00:00Z" }).label).toBe("From the portal · Sent");
    expect(communicationOrigin({ provider: "resend", direction: "outbound", delivery_status: "failed", sent_at: null }).label).toBe("From the portal · Failed");
    expect(communicationOrigin({ provider: "twilio", direction: "inbound", delivery_status: "received", sent_at: null }).label).toBe("Received by the portal");
  });
  test("manualOutcomeOf parses only exact manual markers", () => {
    expect(manualOutcomeOf(`${MANUAL_SOURCE_EVENT}:phoned`)).toBe("phoned");
    expect(manualOutcomeOf(`${MANUAL_SOURCE_EVENT}:bogus`)).toBeNull();
    expect(manualOutcomeOf("launch_campaign")).toBeNull();
    expect(manualOutcomeOf(null)).toBeNull();
  });
});
