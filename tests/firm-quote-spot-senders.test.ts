// Runs actual server modules with local-only dependencies. No hosted client/provider can be imported.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

function load(file: string, firm: boolean, expose: string[] = [], tables: Record<string, unknown[]> = {}) {
  const calls: string[] = [];
  const reads: string[] = [];
  const db = { from(table: string) {
    reads.push(table);
    let single = false;
    const predicates: ((row: any) => boolean)[] = [];
    const q: any = { then: (done: (v: unknown) => unknown) => {
      const rows = (tables[table] ?? []).filter(r => predicates.every(p => p(r)));
      return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null, count: 0 }).then(done);
    } };
    for (const method of ["select", "in", "is", "contains", "order", "limit", "range", "gte", "not", "like", "neq", "or"]) q[method] = () => q;
    q.eq = (key: string, value: unknown) => { predicates.push(row => row[key] === value); return q; };
    for (const method of ["single", "maybeSingle"]) q[method] = () => { single = true; return q; };
    for (const method of ["insert", "update"]) q[method] = () => { calls.push(`${method}:${table}`); return q; };
    return q;
  } };
  const deps: Record<string, unknown> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: db },
    "./firm-quote.server": { skipSpotMessage: async () => firm ? { status: "skipped", reason: "firm_quote_job" } : null, isFirmQuoteJobId: async () => firm },
    "./workflow.server": { logEvent: async () => { calls.push("event"); }, WorkflowError: Error },
    "./test-send.server": { sendTestEmail: async () => { calls.push("email"); return { status: "sent", detail: "local email" }; }, sendTestSms: async () => { calls.push("sms"); return { status: "sent", detail: "local sms" }; } },
    "./test-send.core": { isTestPartner: () => true },
    "./comms.server": { assertCustomerDeliveryAllowed: async () => {}, customerCommsEnabled: async () => true, recordCommunication: async () => {}, hasCurrentOwnerContactConsent: async () => true },
    "./twilio-au1.server": { au1Configured: () => true, au1SendMessage: async () => { calls.push("sms"); return { ok: true, text: '{"sid":"local"}' }; } },
    "./owner-email-send.server": { sendGuardedOwnerEmail: async () => { calls.push("email"); return "sent"; } },
    "./sms.server": { sendRealSms: async () => { calls.push("sms"); return { status: "sent", detail: "local sms" }; }, sendingNumber: () => "+61400000000" },
    "./qa-inbox.server": { qaDeliveryHeld: async () => false, qaInboxRouteForJob: async () => null },
    "./emailsafety.server": { unsubscribeUrlForJob: async () => "https://example.test/unsubscribe" },
    "./hot-leads-send.server": { resendSend: async () => { calls.push("email"); return { outcome: "accepted", id: "local" }; } },
    "./job-live.server": { jobDeletedBlocker: async () => null },
    "./background.server": {}, "./group-b-media.server": {}, "./address": {},
    "./save-spot-reminder-settings.server": { reminderSettings: async () => ({ enabled: true, activatedAt: "2026-01-01T00:00:00Z" }) },
    "./campaign-spot-save.server": {}, "./launch-campaign.server": {},
  };
  const source = readFileSync(`src/lib/${file}.server.ts`, "utf8") + `\nexport { ${expose.join(",")} };`;
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  new Function("exports", "require", code)(exports, (name: string) => {
    if (name in deps) return deps[name];
    if (name.endsWith(".core")) return require(resolve("src/lib", name + ".ts"));
    throw new Error(`Disallowed dependency: ${name}`);
  });
  return { api: exports, calls, reads };
}

const h = { jobId: "job", ownerName: "TEST Owner", phone: "0400000000", email: "owner@example.test", isTest: true, source: "qa_test" };
for (const [fn, args] of [
  ["messageOwner", [h, "batch", "https://example.test/my-job/token", null, null, "sent"]],
  ["messageOwner", [h, "batch", "https://example.test/my-job/token", null, null, "reminder"]],
  ["textOwner", [h, "batch", "https://example.test/my-job/token", null, null, () => "local text"]],
  ["legacyQuickTapsReminder", [h, "batch", "https://example.test/my-job/token", null]],
] as const) {
  test(`${fn} ${String(args.at(-1))}: firm quote skips with exact reason, no email/text`, async () => {
    const f = load("area-batch", true, [fn]);
    const r = await f.api[fn](...args);
    expect(r.status).toBe("skipped"); expect(r.detail).toBe("firm_quote_job");
    if (fn === "messageOwner") expect(r.email).toEqual({ status: "skipped", detail: "firm_quote_job" });
    expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
  });
  test(`${fn} ${String(args.at(-1))}: normal owner still uses existing sender`, async () => {
    const f = load("area-batch", false, [fn]);
    expect((await f.api[fn](...args)).status).toBe("sent");
    expect(f.calls).toContain("sms"); if (fn === "messageOwner") expect(f.calls).toContain("email");
  });
}
for (const step of ["released", "reminder", "release_text"]) {
  test(`legacy release ${step} skips firm quote before reads or delivery`, async () => {
    const f = load("spot-release", true, ["sendTurnMessages"]);
    expect(await f.api.sendTurnMessages("job", { seq: 1, businessId: "biz" }, step, "https://example.test/my-job/token")).toBe("firm_quote_job");
    expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
  });
  test(`legacy release ${step} normal owner still sends`, async () => {
    const f = load("spot-release", false, ["sendTurnMessages"], { jobs: [{ id: "job", source: "qa_test", owner_id: "owner" }], owners: [{ id: "owner", full_name: "TEST", email: "owner@example.test", phone: "0400000000" }] });
    await f.api.sendTurnMessages("job", { seq: 1, businessId: "biz" }, step, "https://example.test/my-job/token");
    expect(f.calls).toContain("sms"); if (step !== "release_text") expect(f.calls).toContain("email");
  });
}
for (const type of ["spot_saved", "save_spot_reminder", "spot_released", "quick_taps", "quick_taps_reminder"]) {
  test(`${type} shared SMS boundary skips firm quote without even a blocked record`, async () => {
    const f = load("sms", true);
    expect(await f.api.sendRealSms({ type, jobId: "job", to: "0400000000", body: "local", idempotencyKey: "local" })).toEqual({ status: "skipped", detail: "firm_quote_job", sid: null });
    expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
  });
}
for (const fn of ["queuePreliminarySpotSavedConfirmation"]) test("preliminary saved email reuses guard before records", async () => {
  const f = load("email-preliminary-offer", true, [fn]);
  expect(await f.api[fn]("job")).toEqual({ status: "skipped", reason: "firm_quote_job" });
  expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
});
for (const step of ["day_2", "day_7", "day_21"]) test(`${step} follow-up skips firm quote with exact reason`, async () => {
  const f = load("estimate-followup", true);
  expect(await f.api.sendEstimateFollowupStep({ id: "job" }, step)).toBe("firm_quote_job");
  expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
});
test("firm quote auto-close is refused even when directly called", async () => {
  const f = load("estimate-followup", true);
  expect(await f.api.closeEstimateFollowup({ id: "job" })).toBe("firm_quote_job");
  expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
});
test("follow-up facts omit firm jobs even with old estimate email history", async () => {
  const f = load("estimate-followup", true);
  expect((await f.api.loadEstimateFollowupFacts([{ id: "job" }])).size).toBe(0);
  expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
});
test("follow-up sweep cannot send or auto-close excluded firm jobs", async () => {
  const f = load("estimate-followup", true, [], { jobs: [{ id: "job", stage: "preliminary_estimate_ready" }] });
  const r = await f.api.sweepEstimateFollowups(new Date("2026-12-30T00:00:00Z"));
  expect(r.sent).toBe(0); expect(r.closed).toBe(0); expect(r.failed).toBe(0); expect(f.calls).toEqual([]);
});
for (const purpose of ["spot_saved", "spot_saved_email", "spot_saved_confirmation", "save_spot_reminder", "spot_released", "spot_released:reminder", "spot_released:release_text", "quick_taps", "quick_taps_reminder", "estimate_followup_day_2", "estimate_followup_day_7", "estimate_followup_day_21"]) {
  test(`${purpose}: guarded email boundary skips firm quote before any reads/claims`, async () => {
    const f = load("owner-email-send", true);
    expect(await f.api.sendGuardedOwnerEmail({ jobId: "job", purpose, to: "owner@example.test", key: "local", build: () => { throw new Error("must not render"); } })).toBe("firm_quote_job");
    expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
  });
}
test("normal spot email reaches the existing provider and returns sent", async () => {
  const f = load("owner-email-send", false, [], { customer_email_sends: [{ id: "local" }], workflow_events: [] });
  expect(await f.api.sendGuardedOwnerEmail({ jobId: "job", jobSource: "base44", purpose: "spot_released", to: "owner@example.test", key: "local", build: () => ({ subject: "unchanged", html: "unchanged", text: "unchanged" }) })).toBe("sent");
  expect(f.calls).toContain("email");
});
test("excluded firm job has a genuinely close-due legacy history but sweep never closes it", async () => {
  const emailed = "2026-10-01T00:00:00Z";
  const job = { id: "job", source: "base44", stage: "preliminary_estimate_ready", deleted_at: null, qa_archived_at: null, owners: { email: "owner@example.test" } };
  const tables = { jobs: [job], customer_email_sends: [{ job_id: "job", purpose: "step3_estimate", status: "sent", sent_at: emailed }], workflow_events: [
    { job_id: "job", event_type: "estimate_followup_sent", details: { step: "day_21" }, created_at: "2026-10-22T00:00:00Z" },
    { job_id: "job", event_type: "estimate_followup_send_result", details: { step: "day_21", sent: true }, created_at: "2026-10-22T00:00:00Z" },
  ] };
  const core = require("../src/lib/estimate-followup.core");
  tables.workflow_events[0].event_type = core.ESTIMATE_FOLLOWUP_EVENT;
  tables.workflow_events[1].event_type = core.ESTIMATE_FOLLOWUP_RESULT_EVENT;
  const normal = load("estimate-followup", false, [], tables);
  const facts = (await normal.api.loadEstimateFollowupFacts([job])).get("job");
  expect(core.decideEstimateFollowup(facts, "2026-12-30T00:00:00Z")).toEqual({ kind: "close" });
  const firm = load("estimate-followup", true, [], tables);
  expect((await firm.api.loadEstimateFollowupFacts([job])).has("job")).toBe(false);
  expect(await firm.api.sweepEstimateFollowups(new Date("2026-12-30T00:00:00Z"))).toMatchObject({ closed: 0, sent: 0, failed: 0 });
  expect(firm.calls).toEqual([]); expect(job.stage).toBe("preliminary_estimate_ready");
});
test("outbox treats skipped firm SMS as non-retryable, never success", async () => {
  const f = load("external-action-dispatcher", true);
  let attempts = 0;
  const dispatch = f.api.createExternalActionDispatcher(async () => ({ sendRealSms: async () => { attempts++; return { status: "skipped", detail: "firm_quote_job", sid: null }; } }));
  const payload = Buffer.from(JSON.stringify({ type: "spot_released", body: "local", jobId: "job", to: "0400000000" })).toString("base64url");
  expect(await dispatch({ action_type: "customer_sms", job_id: "job", payload_ref: `real_sms:spot_released:${payload}`, idempotency_key: "local" })).toEqual({ ok: false, code: "firm_quote_job", retryable: false });
  expect(attempts).toBe(1);
});
test("private saved email boundary skips firm quote before reservation", async () => {
  const f = load("spot-saved-send", true, ["sendEmail"]);
  expect(await f.api.sendEmail("job", {}, {})).toEqual({ status: "skipped", detail: "firm_quote_job" });
  expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
});
test("campaign saved confirmation skips with exact reason before queue or claims", async () => {
  const f = load("launch-campaign", true);
  expect(await f.api.queueSpotSavedConfirmations("job", "token")).toEqual({ queued: false, status: "skipped", reason: "firm_quote_job" });
  expect(f.calls).toEqual([]); expect(f.reads).toEqual([]);
});