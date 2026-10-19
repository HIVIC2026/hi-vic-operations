// STEP 17/32 (A1 manual communication): server preparation + recording with every external boundary stubbed.
// The real recordCommunication (comms.server) runs against an in-memory fake, so the stored row shape is what's asserted.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_ESTIMATED_AREA_M2 } from "../src/lib/estimate.core";
import { renderSaveSpotOfferEmail, type SaveSpotOfferFacts } from "../src/lib/save-spot-offer.core";

const JOB = "00000000-0000-4000-8000-0000000000a1", ACTOR = "00000000-0000-4000-8000-0000000000ff";
type Op = { table: string; op: string; arg: unknown };
let ops: Op[] = [];
let rows: Record<string, { one?: unknown; many?: unknown[] }> = {};
function query(table: string) {
  let inserted: unknown = null;
  const q: Record<string, unknown> = {};
  const chain = (op: string) => (...args: unknown[]) => { ops.push({ table, op, arg: args }); return q; };
  for (const m of ["select", "eq", "in", "order", "limit", "neq", "is", "not"]) q[m] = chain(m);
  q["insert"] = (arg: unknown) => { ops.push({ table, op: "insert", arg }); inserted = arg; return q; };
  q["update"] = chain("update"); q["upsert"] = chain("upsert"); q["delete"] = chain("delete");
  q["maybeSingle"] = async () => ({ data: rows[table]?.one ?? null, error: null });
  q["single"] = async () => ({ data: inserted ? { id: "comm-1" } : rows[table]?.one ?? null, error: null });
  q["then"] = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: rows[table]?.many ?? [], error: null }).then(ok, bad);
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => query(t) } }));

let route: { email: string; blocker: string | null } | null = { email: "offer_spot", blocker: null };
mock.module("../src/lib/lead-email-routing.server", () => ({ selectLeadEmailRoute: async () => route }));

// Jo-approved (12 Oct 2026) "Prepare email to copy" sender. prepareManualEmail renders ONLY through this; it never sends.
// The fake mirrors the real sender's fail-closed itemised-price guard so the pass-through contract is genuine: when the
// current estimate has no itemised snapshot the real sender returns this exact block, and prepareManualEmail surfaces it.
const officeSaveSpotCalls: unknown[] = [];
const OFFICE_SAVE_SPOT_OK = { jobId: JOB, jobNumber: "HV-9001", outcome: "sent", detail: "Preview only — not sent", preview: { to: "owner@home.test.au", subject: "Save your spot", html: "<p>Hi</p>", plainText: "Hi Sam, your preliminary price and link.", linksReady: true } };
const ITEMISED_PRICE_BLOCKED = { jobId: JOB, jobNumber: "HV-9001", outcome: "blocked", detail: "The estimate has no itemised prices. Recalculate it first." };
let officeSaveSpotResult: unknown = OFFICE_SAVE_SPOT_OK;
mock.module("../src/lib/hot-leads-send.server", () => ({
  sendSaveMySpot: async () => [],
  prepareOfficeSaveSpot: async (...a: unknown[]) => {
    officeSaveSpotCalls.push(a);
    const est = (rows["indicative_estimates"] as { one?: { snapshot?: unknown } } | undefined)?.one;
    if (!est || est.snapshot == null) return ITEMISED_PRICE_BLOCKED;
    return officeSaveSpotResult;
  },
}));
const INELIGIBLE_OK = { ok: true, to: "owner@home.test.au", subject: "Your Home Insulation Victoria eligibility result", html: "<p>Result</p>", plainText: "Your eligibility result and referral link.", linksReady: true };
let ineligible: unknown = INELIGIBLE_OK;
const ineligibleCalls: unknown[] = [];
mock.module("../src/lib/followups.server", () => ({ prepareIneligibleEmailForOffice: async (id: string, opts: unknown) => { ineligibleCalls.push([id, opts]); return ineligible; } }));
let suppression: string | null = null;
mock.module("../src/lib/emailsafety.server", () => ({ suppressionFor: async () => suppression }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {} }));

const { prepareManualEmail, recordManualCommunication, manualCommunicationHistory } = await import("../src/lib/manual-communication.server");
const writes = () => ops.filter((o) => ["insert", "update", "upsert", "delete"].includes(o.op));

const SETTINGS = { id: "s", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, access_standard_multiplier: 1, access_moderate_multiplier: 1, access_difficult_multiplier: 1, indicative_veec_value: 70, minimum_customer_copayment_inc_gst: 200, is_current: true };
const { V25_LOCATIONS } = await import("../src/lib/activity48.core");
// A consistent itemised snapshot (4500 + 349 + 349 = 5198 pre-rebate) used by the happy-path owner-size estimate.
const DEFAULT_SNAPSHOT = { settings: { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349 }, scenarios: [{ by_access: { standard: { installation: 4500 } } }] };

beforeEach(() => {
  ops = []; officeSaveSpotCalls.length = 0; ineligibleCalls.length = 0; suppression = null;
  route = { email: "offer_spot", blocker: null }; officeSaveSpotResult = OFFICE_SAVE_SPOT_OK; ineligible = INELIGIBLE_OK;
  rows = {
    jobs: { one: { id: JOB, job_number: "HV-9001", owners: { email: " Owner@Home.test.au " }, estimated_area_m2: 120, estimated_area_unknown: false, properties: { postcode: "3000" } } },
    // The current estimate records "no existing insulation" (insulation_declared: "none") and carries an itemised snapshot,
    // so the approved Save my spot email variant can be selected and rendered.
    indicative_estimates: { one: { area_source: "owner_estimate", insulation_declared: "none", area_m2: 120, snapshot: DEFAULT_SNAPSHOT } },
    workflow_settings: { one: { customer_comms_enabled: true } },
    owner_contact_consents: { one: { consent_status: "granted" } },
    retail_estimator_settings: { one: SETTINGS }, veu_location_variables: { one: V25_LOCATIONS.get("3000") },
  };
});

describe("prepareManualEmail", () => {
  test("likely eligible: renders through the existing Save my spot PREVIEW path only and writes nothing", async () => {
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: true, template: "save_my_spot", to: "owner@home.test.au", subject: "Save your spot", plainText: "Hi Sam, your preliminary price and link.", html: "<p>Hi</p>", notices: [], linksReady: true });
    // The manual workflow calls the render-only Office sender with the resolved variant; it never passes a "send" mode.
    expect(officeSaveSpotCalls).toEqual([[JOB, ACTOR, "no_insulation_owner_size", false]]);
    expect(writes()).toEqual([]);
  });
  test("'Create sending links' is a separate explicit step (mode manual_copy / issueLinks)", async () => {
    await prepareManualEmail(JOB, ACTOR, { issueLinks: true });
    expect(officeSaveSpotCalls).toEqual([[JOB, ACTOR, "no_insulation_owner_size", true]]);
    route = { email: "ineligible", blocker: null };
    ineligible = { ...INELIGIBLE_OK, linksReady: false };
    await prepareManualEmail(JOB, ACTOR);
    await prepareManualEmail(JOB, ACTOR, { issueLinks: true });
    // Read-only check first, then (only if links are missing) the explicit issue step.
    expect(ineligibleCalls).toEqual([[JOB, { issueLinks: false }], [JOB, { issueLinks: false }], [JOB, { issueLinks: true }]]);
  });
  test("'Create sending links' never issues tokens for a lead the rules block (lock off, suppressed, Group B)", async () => {
    route = { email: "ineligible", blocker: null };
    ineligible = { ...INELIGIBLE_OK, linksReady: false };
    suppression = "unsubscribed";
    expect((await prepareManualEmail(JOB, ACTOR, { issueLinks: true })).ok).toBe(false);
    expect(ineligibleCalls).toEqual([[JOB, { issueLinks: false }]]);
    suppression = null; ineligibleCalls.length = 0;
    rows["workflow_settings"] = { one: { customer_comms_enabled: false } };
    expect((await prepareManualEmail(JOB, ACTOR, { issueLinks: true })).ok).toBe(false);
    expect(ineligibleCalls).toEqual([]);
    route = { email: "request_insulation", blocker: null };
    expect((await prepareManualEmail(JOB, ACTOR, { issueLinks: true })).ok).toBe(false);
    expect(officeSaveSpotCalls).toEqual([]);
    expect(writes()).toEqual([]);
  });
  test("preview without links is passed through as not ready (no copy, no 'Sent manually')", async () => {
    officeSaveSpotResult = { ...OFFICE_SAVE_SPOT_OK, preview: { ...OFFICE_SAVE_SPOT_OK.preview, linksReady: false } };
    expect(await prepareManualEmail(JOB, ACTOR)).toMatchObject({ ok: true, linksReady: false });
  });
  test("Group B route never renders, offers its wording or an internal estimate", async () => {
    route = { email: "request_insulation", blocker: null };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: false, internalEstimate: null });
    expect(!r.ok && r.reason).toContain("Group B");
    expect(officeSaveSpotCalls).toEqual([]); expect(ineligibleCalls).toEqual([]); expect(writes()).toEqual([]);
  });
  test("no ceiling size but no existing insulation: Office may prepare the assumed-size indicative email (owner-approved OPTION A)", async () => {
    rows["jobs"] = { one: { ...(rows["jobs"]!.one as object), estimated_area_m2: null, estimated_area_unknown: true } };
    rows["indicative_estimates"] = { one: { area_source: "typical_default", insulation_declared: "none", area_m2: DEFAULT_ESTIMATED_AREA_M2, snapshot: DEFAULT_SNAPSHOT } };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: true, template: "save_my_spot" });
    // P1-S77: the assumed-size variant IS Jo's Template 1, and Office sees Jo's template name.
    expect(r.ok && r.templateLabel).toBe("Jo template: Eligible — no insulation, size unknown");
    // The assumed-area variant is selected and handed to the render-only sender; nothing is written or sent.
    expect(officeSaveSpotCalls).toEqual([[JOB, ACTOR, "no_insulation_assumed_size", false]]);
    expect(writes()).toEqual([]);
  });
  test("contact guards (opt-out, saved spot, closed job, no consent) block manual prep and nothing is sent", async () => {
    const now = "2026-10-11T00:00:00Z";
    const cases: [Record<string, { one?: unknown }>, string][] = [
      [{ customer_email_optouts: { one: { opted_out_at: now } } }, "Owner opted out."],
      [{ lead_campaign_responses: { one: { spot_saved_at: now } } }, "Spot already saved."],
      [{ jobs: { one: { ...(rows["jobs"]!.one as object), stage: "cancelled" } } }, "Job is closed."],
      [{ owner_contact_consents: { one: { consent_status: "withdrawn" } } }, "No current contact consent."],
    ];
    for (const [extra, reason] of cases) {
      // The real sender refuses these; prepareManualEmail surfaces the refusal unchanged and never writes.
      officeSaveSpotResult = { jobId: JOB, jobNumber: "HV-9001", outcome: "skipped", detail: reason };
      Object.assign(rows, extra);
      expect(await prepareManualEmail(JOB, ACTOR)).toMatchObject({ ok: false, reason, internalEstimate: null });
      expect(writes()).toEqual([]);
    }
  });
  test("a real size always wins over the assumption (owner size, research estimate or measure-up)", async () => {
    rows["property_area_estimates"] = { many: [{ id: "pe1", tier: "B", net_m2: 132, created_at: "2026-10-01T00:00:00Z" }] };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: true, template: "save_my_spot" });
  });
  test("a saved typical-size estimate after a real size is known asks for a recalculation (no estimate shown)", async () => {
    rows["jobs"] = { one: { ...(rows["jobs"]!.one as object), estimated_area_m2: 120, estimated_area_unknown: false } };
    rows["indicative_estimates"] = { one: { area_source: "typical_default", insulation_declared: "none", area_m2: 120, snapshot: DEFAULT_SNAPSHOT } };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: false, internalEstimate: null });
    expect(!r.ok && r.reason).toContain("Recalculate");
  });
  test("an estimate with no itemised prices is withheld (not invented) and nothing is sent", async () => {
    rows["indicative_estimates"] = { one: { area_source: "owner_estimate", insulation_declared: "none", area_m2: 120 } }; // no snapshot
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: false, internalEstimate: null });
    expect(!r.ok && r.reason).toContain("itemised prices");
    expect(writes()).toEqual([]);
  });
  test("an existing portal send (sent / sending / uncertain) blocks a manual duplicate", async () => {
    rows["customer_email_sends"] = { many: [{ id: "s1" }] };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(!r.ok && r.reason).toContain("already sent");
    expect(officeSaveSpotCalls).toEqual([]);
    const statusFilter = ops.find((o) => o.table === "customer_email_sends" && o.op === "in");
    expect(statusFilter?.arg).toEqual(["status", ["sent", "sending", "delivered_unrecorded"]]);
  });
  test("Save my spot guard refusals are passed through, with no email", async () => {
    officeSaveSpotResult = { jobId: JOB, jobNumber: "HV-9001", outcome: "skipped", detail: "No current contact consent." };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: false, reason: "No current contact consent." });
  });
  test("ineligible: start date / 14-day window become a notice only; contact rules still block", async () => {
    route = { email: "ineligible", blocker: null };
    for (const code of ["backlog_too_old", "backlog_before_cutoff", "backlog_cutoff_not_set"]) {
      suppression = code;
      const r = await prepareManualEmail(JOB, ACTOR);
      expect(r).toMatchObject({ ok: true, template: "ineligible_result", subject: "Your Home Insulation Victoria eligibility result" });
      expect(r.ok && r.notices[0]).toContain("Automatic sending skips this lead");
    }
    for (const code of ["unsubscribed", "bounced", "test_or_example_recipient", "job_progressed_or_closed"]) {
      suppression = code;
      expect((await prepareManualEmail(JOB, ACTOR)).ok).toBe(false);
    }
    suppression = null;
    ineligible = { ok: false, reason: "no_consent" };
    expect(await prepareManualEmail(JOB, ACTOR)).toMatchObject({ ok: false, reason: "No current contact consent from the owner – do not email." });
    ineligible = { ok: false, reason: "eligibility_review_required" };
    expect(await prepareManualEmail(JOB, ACTOR)).toMatchObject({ ok: false, reason: "Eligibility needs office review first." });
    expect(officeSaveSpotCalls).toEqual([]);
    expect(writes()).toEqual([]);
  });
  test("global communications disabled: no ineligible copy (lock never bypassed); approved Save my spot campaign unchanged", async () => {
    rows["workflow_settings"] = { one: { customer_comms_enabled: false } };
    route = { email: "ineligible", blocker: null };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: false, reason: "Customer emails are switched off for the whole portal (global communications lock), so the ineligible email can't be prepared for sending." });
    expect(ineligibleCalls).toEqual([]);
    delete rows["workflow_settings"]; // unreadable setting = locked (fails closed)
    expect((await prepareManualEmail(JOB, ACTOR)).ok).toBe(false);
    route = { email: "offer_spot", blocker: null };
    rows["workflow_settings"] = { one: { customer_comms_enabled: false } };
    expect(await prepareManualEmail(JOB, ACTOR)).toMatchObject({ ok: true, template: "save_my_spot" });
    expect(writes()).toEqual([]);
  });
  test("a previous manual 'Sent manually' record blocks re-preparation (no duplicate, nothing sent)", async () => {
    rows["job_communications"] = { many: [{ created_at: "2026-10-11T23:00:00Z", source_event: "manual_office_communication:sent_manually", source_reference: "template:save_my_spot" }] };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: false, reason: "Office already recorded sending this email by hand. It won't be prepared again – check the communication history." });
    expect(officeSaveSpotCalls).toEqual([]);
    expect(writes()).toEqual([]);
  });
});

describe("recordManualCommunication", () => {
  const approved = { template: "save_my_spot" as const, subject: "Save your spot", body: "Hi Sam, your preliminary price and link.\n" };
  const inserted = () => ops.filter((o) => o.op === "insert");
  test("'Sent manually' stores ONE immutable manual row: verbatim approved email, Office-only, actor + timestamp", async () => {
    const r = await recordManualCommunication({ jobId: JOB, outcome: "sent_manually", ...approved }, ACTOR);
    expect(r).toMatchObject({ id: "comm-1", jobNumber: "HV-9001", outcome: "sent_manually", label: "Sent manually", delivered: false, countsAsOwnerContact: true });
    expect(inserted().map((o) => o.table)).toEqual(["job_communications"]);
    const row = inserted()[0]!.arg as Record<string, unknown>;
    expect(row).toMatchObject({
      job_id: JOB, direction: "outbound", channel: "email", recipients: ["owner@home.test.au"], subject: approved.subject, body: approved.body,
      provider: "manual", provider_message_id: null, delivery_status: "recorded", visibility: "internal",
      source_event: "manual_office_communication:sent_manually", source_reference: "template:save_my_spot", created_by: ACTOR, sender_user_id: ACTOR,
    });
    expect(row["sent_at"]).toBe(r.recordedAt);
    expect(Number.isNaN(Date.parse(String(row["sent_at"])))).toBe(false);
    expect(writes().length).toBe(1);
  });
  test("'Not sent' and 'Follow-up required' are internal notes (never counted as owner contact)", async () => {
    for (const outcome of ["not_sent", "followup_required"] as const) {
      ops = [];
      const r = await recordManualCommunication({ jobId: JOB, outcome, note: "No consent on file – call first" }, ACTOR);
      expect(r.countsAsOwnerContact).toBe(false);
      const row = inserted()[0]!.arg as Record<string, unknown>;
      expect(row).toMatchObject({ direction: "internal", channel: "note", recipients: [], visibility: "internal", provider: "manual", body: "No consent on file – call first", source_event: `manual_office_communication:${outcome}` });
    }
  });
  test("'Customer contacted by phone' is an internal phone note (never reads as 'Estimate sent')", async () => {
    const r = await recordManualCommunication({ jobId: JOB, outcome: "phoned", note: "Owner happy, will save spot online" }, ACTOR);
    expect(r.countsAsOwnerContact).toBe(false);
    expect(inserted()[0]!.arg).toMatchObject({ direction: "internal", channel: "phone", recipients: [], visibility: "internal", subject: "Office record: Customer contacted by phone", body: "Owner happy, will save spot online" });
  });
  test("invalid input records nothing", async () => {
    await expect(recordManualCommunication({ jobId: JOB, outcome: "phoned" }, ACTOR)).rejects.toThrow("note");
    await expect(recordManualCommunication({ jobId: JOB, outcome: "sent_manually", note: "sent it" }, ACTOR)).rejects.toThrow("approved email");
    rows["jobs"] = {};
    await expect(recordManualCommunication({ jobId: JOB, outcome: "not_sent", note: "No email on file" }, ACTOR)).rejects.toThrow("Job not found");
    expect(writes()).toEqual([]);
  });
  test("never touches Save my spot, send reservations or settings tables", async () => {
    for (const outcome of ["sent_manually", "phoned", "not_sent", "followup_required"] as const)
      await recordManualCommunication({ jobId: JOB, outcome, ...(outcome === "sent_manually" ? approved : { note: "Recorded by office" }) }, ACTOR);
    const touched = new Set(ops.map((o) => o.table));
    for (const t of ["lead_campaign_responses", "customer_email_sends", "workflow_settings", "customer_delivery_settings", "sms_messages"]) expect(touched.has(t)).toBe(false);
  });
});

describe("manualCommunicationHistory", () => {
  test("labels Office records apart from portal-delivered email", async () => {
    rows["job_communications"] = { many: [
      { id: "c", created_at: "2026-10-12T02:00:00Z", sent_at: "2026-10-12T02:00:00Z", received_at: null, direction: "internal", channel: "note", subject: "Office record: Follow-up required", body: "Call back Friday 10am", provider: "manual", delivery_status: "recorded", source_event: "manual_office_communication:followup_required", created_by: ACTOR },
      { id: "a", created_at: "2026-10-12T01:00:00Z", sent_at: "2026-10-12T01:00:00Z", received_at: null, direction: "outbound", channel: "email", subject: "Save your spot", body: "long approved email", provider: "manual", delivery_status: "recorded", source_event: "manual_office_communication:sent_manually", created_by: ACTOR },
      { id: "b", created_at: "2026-10-10T01:00:00Z", sent_at: "2026-10-10T01:00:00Z", received_at: null, direction: "outbound", channel: "email", subject: "Save your spot", body: "system email", provider: "resend", delivery_status: "sent", source_event: "launch_campaign", created_by: null },
    ] };
    rows["profiles"] = { many: [{ id: ACTOR, full_name: "Jo Lowe", email: null }] };
    const h = await manualCommunicationHistory(JOB);
    expect(h.map((x) => [x.id, x.manual, x.originLabel, x.outcomeLabel, x.by, x.note])).toEqual([
      ["c", true, "Recorded by Office – not sent by the portal", "Follow-up required", "Jo Lowe", "Call back Friday 10am"],
      ["a", true, "Recorded by Office – not sent by the portal", "Sent manually", "Jo Lowe", null],
      ["b", false, "From the portal · Sent", null, null, null],
    ]);
  });
});

describe("assumed-size indicative email disclosure (owner-approved OPTION A)", () => {
  // Exercises the REAL renderer with a representative assumed-area fixture. OPTION A requires the email to clearly state:
  // (1) the ceiling area is assumed not measured, (2) the estimate is indicative, (3) actual measurement needs confirmation,
  // (4) final pricing needs confirmation. It must also never send.
  test("the assumed-size email clearly discloses assumption, indicative pricing, and confirmation needs", () => {
    const facts: SaveSpotOfferFacts = {
      variant: "no_insulation_assumed_size", assumedArea: true,
      address: "1 Fixture Street, Testville VIC 3000", areaM2: DEFAULT_ESTIMATED_AREA_M2, firstName: "Sam", reference: "HV-9001",
      installation: 4500, assessmentFee: 349, apFee: 349, gross: 5198, discount: 1481.76, customer: 3716.24,
      removal: { kind: "excluded" }, apCount: 2,
      calculatorUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/TOKEN/calculator",
      originalSaveUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/TOKEN/calculator?keep=original",
      unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=abcdefghijklmnopqrstuvwxyz12345", referralUrl: null,
    };
    const mail = renderSaveSpotOfferEmail(facts);
    const body = `${mail.html}\n${mail.plainText}`;
    expect(body).toMatch(/assumed/i);                                  // (1) assumed area
    expect(body).toMatch(/not a measurement|not measured/i);           // (1) not measured
    expect(body).toMatch(/preliminary estimate|indicative/i);          // (2) indicative
    expect(body).toMatch(/confirm your actual ceiling area|Ready Check/i); // (3) measurement confirmation
    expect(body).toMatch(/final price|final pricing/i);                // (4) final pricing confirmation
    expect(mail.subject).toMatch(/rebate/i);
  });
});

describe("static safety guards", () => {
  // Code only: comments may name what the module deliberately does NOT do.
  const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const server = code("src/lib/manual-communication.server.ts");
  const fns = code("src/lib/manual-communication.functions.ts");
  const ui = code("src/components/portal/manual-communication.tsx");
  test("no sender, provider, SMS, approval-flag or Save-my-spot write path is reachable from the manual workflow", () => {
    for (const src of [server, fns, ui]) {
      expect(src).not.toMatch(/resendSend|sendTestEmail|sendRealSms|sendOfficeEmail|adapter\.deliver|sendPreliminaryIneligibleEmail|sendExistingInsulationSaveSpot|sendAutomaticInsulationDetails|maybeAutoRouteLeadEmail|maybeAutoSendSaveSpot|sendHotLeadsBatch|sendInitialEstimateEmail/);
      expect(src).not.toMatch(/REAL_SEND_APPROVED|customer_comms_enabled|customer_delivery_settings|mitti|xero/i);
    }
    // Reads only: the one write is recordCommunication (comms.server). Never writes Save my spot, owners, jobs or tokens directly.
    expect(server).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(server).not.toMatch(/unsubscribeUrlForJob|referralUrlForJob/);
    expect(fns.match(/requireAdmin\(context\.supabase\)/g)?.length).toBe(3);
  });
  test("every Save my spot call from the manual workflow is render-only (preview / manual_copy, never send)", () => {
    const calls = server.match(/prepareOfficeSaveSpot\([^)]*\)/g) ?? [];
    expect(calls.length).toBe(1);
    for (const c of calls) {
      // The manual workflow passes a boolean issueLinks flag, never an explicit "send" / "test_to_jo" mode.
      expect(c).not.toMatch(/"send"|test_to_jo|mode:\s*"send"/);
      expect(c).toContain("!!opts.issueLinks");
    }
  });
  test("copying stays in the browser (no server call, no record)", () => {
    const copyFn = ui.slice(ui.indexOf("async function copyToClipboard"), ui.indexOf("function usePreparedEmail"));
    expect(copyFn).toContain("navigator.clipboard");
    expect(copyFn).not.toMatch(/Fn\b|useServerFn|fetch\(/);
  });
});
