// STEP 17 (A1 manual communication): server preparation + recording with every external boundary stubbed.
// The real recordCommunication (comms.server) runs against an in-memory fake, so the stored row shape is what's asserted.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

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
const saveSpotCalls: unknown[] = [];
let saveSpotResult: unknown = { jobId: JOB, jobNumber: "HV-9001", outcome: "sent", detail: "Preview only — not sent", preview: { to: "owner@home.test.au", subject: "Save your spot", html: "<p>Hi</p>", plainText: "Hi Sam, your preliminary price and link." } };
mock.module("../src/lib/hot-leads-send.server", () => ({ sendSaveMySpot: async (...a: unknown[]) => { saveSpotCalls.push(a); return [saveSpotResult]; } }));
let ineligible: unknown = { ok: true, to: "owner@home.test.au", subject: "Your Home Insulation Victoria eligibility result", html: "<p>Result</p>", plainText: "Your eligibility result and referral link." };
const ineligibleCalls: string[] = [];
mock.module("../src/lib/followups.server", () => ({ prepareIneligibleEmailForOffice: async (id: string) => { ineligibleCalls.push(id); return ineligible; } }));
let suppression: string | null = null;
mock.module("../src/lib/emailsafety.server", () => ({ suppressionFor: async () => suppression }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {} }));

const { prepareManualEmail, recordManualCommunication, manualCommunicationHistory } = await import("../src/lib/manual-communication.server");
const writes = () => ops.filter((o) => ["insert", "update", "upsert", "delete"].includes(o.op));

beforeEach(() => {
  ops = []; saveSpotCalls.length = 0; ineligibleCalls.length = 0; suppression = null;
  route = { email: "offer_spot", blocker: null };
  rows = { jobs: { one: { id: JOB, job_number: "HV-9001", owners: { email: " Owner@Home.test.au " } } }, indicative_estimates: { one: { area_source: "owner_estimate" } } };
});

describe("prepareManualEmail", () => {
  test("likely eligible: renders through the existing Save my spot PREVIEW path only and writes nothing", async () => {
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: true, template: "save_my_spot", to: "owner@home.test.au", subject: "Save your spot", plainText: "Hi Sam, your preliminary price and link.", html: "<p>Hi</p>", notices: [] });
    expect(saveSpotCalls).toEqual([[[JOB], ACTOR, { mode: "preview" }]]);
    expect(writes()).toEqual([]);
  });
  test("Group B route never renders or offers its wording", async () => {
    route = { email: "request_insulation", blocker: null };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("Group B");
    expect(saveSpotCalls).toEqual([]); expect(ineligibleCalls).toEqual([]); expect(writes()).toEqual([]);
  });
  test("held typical-size estimate is not offered", async () => {
    rows["indicative_estimates"] = { one: { area_source: "typical_default" } };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(!r.ok && r.reason).toContain("typical-size");
    expect(saveSpotCalls).toEqual([]);
  });
  test("an existing portal send (sent / sending / uncertain) blocks a manual duplicate", async () => {
    rows["customer_email_sends"] = { many: [{ id: "s1" }] };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(!r.ok && r.reason).toContain("already sent");
    expect(saveSpotCalls).toEqual([]);
    const statusFilter = ops.find((o) => o.table === "customer_email_sends" && o.op === "in");
    expect(statusFilter?.arg).toEqual(["status", ["sent", "sending", "delivered_unrecorded"]]);
  });
  test("Save my spot guard refusals are passed through, with no email", async () => {
    saveSpotResult = { jobId: JOB, jobNumber: "HV-9001", outcome: "skipped", detail: "No current contact consent." };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r).toMatchObject({ ok: false, reason: "No current contact consent." });
    saveSpotResult = { jobId: JOB, jobNumber: "HV-9001", outcome: "sent", detail: "Preview only — not sent", preview: { to: "owner@home.test.au", subject: "Save your spot", html: "<p>Hi</p>", plainText: "Hi Sam, your preliminary price and link." } };
  });
  test("ineligible: render-only twin + the sender's own suppression rules (incl. start date / 14-day backlog)", async () => {
    route = { email: "ineligible", blocker: null };
    const ok = await prepareManualEmail(JOB, ACTOR);
    expect(ok).toMatchObject({ ok: true, template: "ineligible_result", subject: "Your Home Insulation Victoria eligibility result" });
    expect(ineligibleCalls).toEqual([JOB]); expect(saveSpotCalls).toEqual([]);
    suppression = "backlog_too_old";
    const old = await prepareManualEmail(JOB, ACTOR);
    expect(!old.ok && old.reason).toContain("14 days");
    suppression = "unsubscribed";
    const no = await prepareManualEmail(JOB, ACTOR);
    expect(!no.ok && no.reason).toContain("unsubscribed");
    ineligible = { ok: false, reason: "no_consent" };
    const noConsent = await prepareManualEmail(JOB, ACTOR);
    expect(!noConsent.ok && noConsent.reason).toContain("consent");
    expect(writes()).toEqual([]);
  });
  test("a previous manual send shows a notice", async () => {
    rows["job_communications"] = { many: [{ created_at: "2026-10-11T23:00:00Z" }] };
    const r = await prepareManualEmail(JOB, ACTOR);
    expect(r.ok && r.notices[0]).toContain("already recorded");
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

describe("static safety guards", () => {
  // Code only: comments may name what the module deliberately does NOT do.
  const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const server = code("src/lib/manual-communication.server.ts");
  const fns = code("src/lib/manual-communication.functions.ts");
  const ui = code("src/components/portal/manual-communication.tsx");
  test("no sender, provider, SMS, approval-flag or Save-my-spot write path is reachable from the manual workflow", () => {
    for (const src of [server, fns, ui]) {
      expect(src).not.toMatch(/resendSend|sendTestEmail|sendRealSms|sendOfficeEmail|adapter\.deliver|sendPreliminaryIneligibleEmail|sendExistingInsulationSaveSpot|sendAutomaticInsulationDetails|maybeAutoRouteLeadEmail|maybeAutoSendSaveSpot|sendHotLeadsBatch|sendInitialEstimateEmail/);
      expect(src).not.toMatch(/REAL_SEND_APPROVED|customer_comms_enabled|customer_delivery_settings|spot_saved_at|lead_campaign_responses|mitti|xero/i);
    }
    expect(fns.match(/requireAdmin\(context\.supabase\)/g)?.length).toBe(3);
  });
  test("every Save my spot call from the manual workflow is preview-only", () => {
    const calls = server.match(/sendSaveMySpot\([^)]*\)/g) ?? [];
    expect(calls.length).toBe(1);
    for (const c of calls) expect(c).toContain('mode: "preview"');
  });
  test("copying stays in the browser (no server call, no record)", () => {
    const copyFn = ui.slice(ui.indexOf("async function copyToClipboard"), ui.indexOf("function usePreparedEmail"));
    expect(copyFn).toContain("navigator.clipboard");
    expect(copyFn).not.toMatch(/Fn\b|useServerFn|fetch\(/);
  });
});
