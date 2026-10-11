// STEP 17 (A1 manual communication): pure rules. No I/O.
import { describe, expect, test } from "bun:test";
import {
  GROUP_B_MANUAL_BLOCKED, MANUAL_OUTCOME_LABEL, MANUAL_OUTCOME_ORDER, MANUAL_PROVIDER, MANUAL_SENT_EVENT, MANUAL_SOURCE_EVENT, MANUAL_TEMPLATE_LABEL, MANUAL_TEMPLATES,
  TYPICAL_SIZE_MANUAL_BLOCKED, manualOutcomeOf, manualReasonText, manualRecordBlocker, manualRecordContent, manualSendReference, manualTemplateFor, planManualRecord,
  type ManualOutcome,
} from "../src/lib/manual-communication.core";
import { communicationOrigin } from "../src/lib/portal-presentation.core";
import {
  ASSUMED_SIZE_LABEL, MANUAL_NEXT_LABEL, PREVIEW_LINK_TOKEN, assumedSizeEstimate, hasPreviewPlaceholder, manualLeadView, manualSuppression, missingSizeContactBlocker, previewDisplayText, withManualSends,
} from "../src/lib/manual-communication.core";
import { enquiryStatus } from "../src/lib/enquiry-groups.core";
import { DEFAULT_ESTIMATED_AREA_M2, computeEstimate, type RetailSettings } from "../src/lib/estimate.core";
import { V25_LOCATIONS } from "../src/lib/activity48.core";

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

describe("manual copy restrictions – contact rules block, the automatic schedule does not (STEP 32)", () => {
  test("consent, opt-out, bounce, test, stage and official holds block, in plain words", () => {
    for (const c of ["no_consent", "unsubscribed", "bounced", "test_or_example_recipient", "job_progressed_or_closed", "eligibility_review_required", "official_not_ineligible", "no_owner_email"]) {
      const t = manualReasonText(c);
      expect(t).toBeTruthy(); expect(t).not.toBe(c);
      expect(manualSuppression(c)).toEqual({ block: t, notice: null });
    }
    expect(manualReasonText(null)).toBeNull();
    expect(manualSuppression(null)).toEqual({ block: null, notice: null });
  });
  test("email start date / 14-day window only become a notice for the manual copy", () => {
    for (const c of ["backlog_cutoff_not_set", "backlog_before_cutoff", "backlog_too_old"]) {
      const r = manualSuppression(c);
      expect(r.block).toBeNull();
      expect(r.notice).toContain("Automatic sending skips this lead");
    }
    expect(manualSuppression("backlog_too_old").notice).toContain("14 days");
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

describe("missing ceiling size – internal estimate on the assumed 150 m² (STEP 32)", () => {
  const settings = { id: "s", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, access_standard_multiplier: 1, access_moderate_multiplier: 1, access_difficult_multiplier: 1, indicative_veec_value: 70, minimum_customer_copayment_inc_gst: 200 } as unknown as RetailSettings;
  const loc = V25_LOCATIONS.get("3000")!;
  test("uses the existing pricing maths unchanged; only the area is the labelled 150 m² assumption", () => {
    const e = assumedSizeEstimate(loc, settings);
    const ref = computeEstimate({ m2: DEFAULT_ESTIMATED_AREA_M2, source: "typical_default", basis: "assumed", id: null, label: "x" }, loc, "none", settings).primary.by_access.standard;
    expect(e).toMatchObject({ areaM2: 150, estimatedCost: ref.estimated_customer_total, rebate: ref.applied_discount, grossBeforeRebate: ref.pre_discount_total, installation: ref.installation, assessmentFee: 349, apFee: 349 });
    expect(e.rebate).toBeGreaterThan(0);
  });
  test("always says it is an assumption – never measured, never from the owner, never saved or sent", () => {
    const e = assumedSizeEstimate(loc, settings);
    expect(e.areaLabel).toBe(ASSUMED_SIZE_LABEL);
    expect(e.areaLabel).toContain("Assumed size: 150 m²");
    expect(e.areaLabel).toContain("not measured and not provided by the owner");
    expect(e.assumption).toContain("office use only");
    expect(e.assumption).toContain("not saved, not sent");
    expect(`${e.areaLabel} ${e.assumption}`).not.toMatch(/verified|confirmed|measured area of/i);
  });
});

describe("Leads status after manual communication (STEP 32)", () => {
  const base = { spotSaved: false, ineligible: false, ineligibleEmailSent: false, campaignSent: false, insulationEmailSent: false, campaignGroup: null };
  const rec = (outcome: string, at: string, extra: Partial<{ source_reference: string; body: string }> = {}) => ({ source_event: `manual_office_communication:${outcome}`, source_reference: extra.source_reference ?? null, created_at: at, body: extra.body ?? null });
  const status = (rows: ReturnType<typeof rec>[], b: Partial<typeof base> = {}) => enquiryStatus(withManualSends({ ...base, ...b }, manualLeadView(rows)));
  test("no manual record: unchanged", () => {
    expect(manualLeadView([])).toEqual({ saveSpotSentAt: null, ineligibleSentAt: null, latest: null });
    expect(status([])).toBe("needs_attention");
  });
  test("Sent manually (Save your spot) completes that email action and keeps manual provenance", () => {
    const rows = [rec("sent_manually", "2026-10-12T01:00:00Z", { source_reference: "template:save_my_spot", body: "long email" })];
    expect(status(rows)).toBe("offered_spot");
    expect(manualLeadView(rows)).toEqual({ saveSpotSentAt: "2026-10-12T01:00:00Z", ineligibleSentAt: null, latest: { kind: "sent_manually", at: "2026-10-12T01:00:00Z", note: null } });
    expect(MANUAL_NEXT_LABEL.sent_manually).toContain("not by the portal");
  });
  test("Sent manually (ineligible) completes the ineligible email action", () => {
    expect(status([rec("sent_manually", "2026-10-12T01:00:00Z", { source_reference: "template:ineligible_result" })], { ineligible: true })).toBe("ineligible");
  });
  test("Customer contacted by phone records contact but never marks an email as sent", () => {
    const rows = [rec("phoned", "2026-10-12T01:00:00Z", { body: "Spoke to owner" })];
    expect(status(rows)).toBe("needs_attention");
    expect(status(rows, { ineligible: true })).toBe("needs_attention");
    expect(manualLeadView(rows).latest).toEqual({ kind: "phoned", at: "2026-10-12T01:00:00Z", note: "Spoke to owner" });
  });
  test("Not sent keeps the action outstanding", () => {
    const rows = [rec("not_sent", "2026-10-12T01:00:00Z", { body: "No consent yet" })];
    expect(status(rows)).toBe("needs_attention");
    expect(MANUAL_NEXT_LABEL[manualLeadView(rows).latest!.kind]).toContain("still to do");
  });
  test("Follow-up required shows the next action as pending follow-up – even after a manual send", () => {
    const rows = [rec("sent_manually", "2026-10-12T01:00:00Z", { source_reference: "template:save_my_spot" }), rec("followup_required", "2026-10-12T02:00:00Z", { body: "Call back Friday" })];
    expect(status(rows)).toBe("offered_spot");
    const v = manualLeadView([...rows].reverse());
    expect(v.latest).toEqual({ kind: "followup_pending", at: "2026-10-12T02:00:00Z", note: "Call back Friday" });
    expect(MANUAL_NEXT_LABEL.followup_pending).toBe("Next action: follow-up pending");
  });
  test("a portal send keeps its own provenance; spot saved still wins; nothing completes the job", () => {
    expect(status([], { campaignSent: true, campaignGroup: "likely" })).toBe("offered_spot");
    expect(status([rec("sent_manually", "2026-10-12T01:00:00Z", { source_reference: "template:save_my_spot" })], { spotSaved: true })).toBe("spot_saved");
    expect(withManualSends({ ...base, campaignGroup: "onsite" as const, campaignSent: true }, manualLeadView([rec("sent_manually", "x", { source_reference: "template:save_my_spot" })])).campaignGroup).toBe("onsite");
  });
  test("unknown or unrelated records are ignored", () => {
    expect(manualLeadView([{ source_event: "launch_campaign", source_reference: null, created_at: "2026-10-12T01:00:00Z" }, rec("bogus", "2026-10-12T02:00:00Z")]).latest).toBeNull();
  });
});

describe("preview placeholders can never reach a customer (STEP 32)", () => {
  const url = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${PREVIEW_LINK_TOKEN}`;
  test("placeholder is 43 chars of link-safe characters (passes validators) and obviously not real", () => {
    expect(PREVIEW_LINK_TOKEN).toMatch(/^PREVIEW_ONLY_[A-Za-z0-9_-]{30}$/);
  });
  test("display text replaces placeholder links with a plain marker; real links untouched", () => {
    const real = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"R".repeat(43)}`;
    const shown = previewDisplayText(`Unsubscribe: ${url}\nRefer: https://homeinsulationvictoria.com.au/homeowner?ref=${PREVIEW_LINK_TOKEN} ${real}`);
    expect(shown).not.toContain(PREVIEW_LINK_TOKEN);
    expect(shown).toContain("Unsubscribe: [link created before sending]");
    expect(shown).toContain(real);
  });
  test("'Sent manually' with a placeholder body is refused server-side", () => {
    expect(hasPreviewPlaceholder(`Hi Sam, unsubscribe: ${url}`)).toBe(true);
    expect(manualRecordBlocker({ outcome: "sent_manually", ...approved, body: `${approved.body}${url}` })).toContain("placeholder");
    expect(manualRecordBlocker({ outcome: "sent_manually", ...approved })).toBeNull();
  });
});

describe("missing size: contact status first", () => {
  const ok = { stage: "preliminary_estimate_ready", optedOut: false, spotSaved: false, consent: true };
  test("only a contactable owner gets the internal estimate", () => {
    expect(missingSizeContactBlocker(ok)).toBeNull();
    expect(missingSizeContactBlocker({ ...ok, stage: "complete" })).toBe("Job is closed.");
    expect(missingSizeContactBlocker({ ...ok, spotSaved: true })).toBe("Spot already saved.");
    expect(missingSizeContactBlocker({ ...ok, optedOut: true })).toBe("Owner opted out.");
    expect(missingSizeContactBlocker({ ...ok, consent: false })).toBe("No current contact consent.");
  });
});
