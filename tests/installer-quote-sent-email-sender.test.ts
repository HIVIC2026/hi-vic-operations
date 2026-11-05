// "Quote sent" email to the installer's office (Jo 5 Nov 2026 22:45): runs the real sender over an in-memory database;
// every outbound path is a recorder (nothing is sent). One attempt per quote; held reasons recorded once; TEST → test-send;
// real → sendOfficeEmail; HIV leads get nothing; never throws; never touches a stage or a quote.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const T: Tables = {};
const admin = memoryPostgrest(T);
const sent: { kind: string; to: string; label?: string; subject?: string; key?: string; text?: string; businessId?: string | null }[] = [];
let paused: string | null = null;

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: unknown) => { await admin.from("workflow_events").insert({ job_id, actor_id, event_type, summary, details: details ?? {} }); },
}));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => paused }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string; label: string; idempotencyKey?: string; text?: string; record: { businessId?: string | null } }) => { sent.push({ kind: "real-email", to: p.to, subject: p.subject, label: p.label, key: p.idempotencyKey, text: p.text, businessId: p.record.businessId }); return { channel: "email", to: p.to, status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/test-send.server", () => ({
  TEST_APP_BASE: "https://test.example",
  sendTestEmail: async (ctx: { label: string }, to: string, subject: string, _html: string, text: string) => { sent.push({ kind: "test-email", to, label: ctx.label, subject, text }); return { channel: "email", to, status: "sent", detail: "test" }; },
}));

const { emailInstallerQuoteSent } = await import("../src/lib/installer-quote-sent-email.server");

const JOB = "job-1", BIZ = "biz-1", QUOTE = "q-1";
const SENT_AT = "2026-11-05T03:00:00Z"; // Thu 5 Nov 2026 Melbourne → valid through Sat 5 Dec 2026
const events = (type: string) => (T["workflow_events"] ?? []).filter((e) => e["job_id"] === JOB && e["event_type"] === type);
const attempts = () => (T["customer_email_sends"] ?? []).filter((e) => e["job_id"] === JOB);

function seed(o: { source?: string; channel?: string; testPartner?: boolean; email?: string | null; kind?: string; sentAt?: string | null; deleted?: string | null; ownerName?: string | null } = {}) {
  for (const k of Object.keys(T)) delete T[k];
  sent.length = 0; paused = null;
  T["properties"] = [{ id: "prop-1", address_line: "12 Example St", suburb: "Box Hill", postcode: "3128" }];
  T["owners"] = [{ id: "own-1", full_name: o.ownerName === undefined ? "Sarah Brown" : o.ownerName }];
  T["jobs"] = [{ id: JOB, job_number: "HV-1234", stage: "awaiting_quote_acceptance", source: o.source ?? "website", channel: o.channel ?? "installer_sourced", deleted_at: o.deleted ?? null, originating_installer_business_id: BIZ, property_id: "prop-1", owner_id: "own-1" }];
  T["businesses"] = [{ id: BIZ, name: "Sample Insulation Co", signer_name: "Deep Patel", email: o.email === undefined ? "office@sample.example" : o.email, onboarding_notes: o.testPartner ? "[TEST PARTNER]" : null }];
  T["quotes"] = [{ id: QUOTE, job_id: JOB, kind: o.kind ?? "installation", status: "issued", sent_at: o.sentAt === undefined ? SENT_AT : o.sentAt, customer_total_inc_gst: "4850.00" }];
  T["workflow_events"] = [];
  T["customer_email_sends"] = [];
}
const run = (opts?: { approved?: boolean }) => emailInstallerQuoteSent(JOB, QUOTE, opts);
const snapshot = () => JSON.stringify({ jobs: T["jobs"], quotes: T["quotes"] });

describe("one branded email to the installer's office", () => {
  beforeEach(() => seed());

  test("real partner, flag on: ONE email to the business office email with the approved copy; the event is recorded before the send; a re-run sends nothing", async () => {
    const before = snapshot();
    const r1 = await run();
    expect(r1).toContain("email sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "real-email", to: "office@sample.example", subject: "HV-1234: Quote sent to Sarah", key: "installer-quote-sent:v1:q-1", label: "installer_quote_sent_email", businessId: BIZ });
    expect(sent[0]!.text).toContain("Hi Deep,");
    expect(sent[0]!.text).toContain("Quote: $4,850 inc GST");
    expect(sent[0]!.text).toContain("Valid until Sat 5 Dec 2026");
    expect(sent[0]!.text).toContain("See the quote: https://estimate.homeinsulationvictoria.com.au/field/job-1");
    expect(sent[0]!.text).not.toContain("TEST — only sent to Jo.");
    expect(events("installer_quote_sent_email")).toHaveLength(1);
    expect(events("installer_quote_sent_email")[0]!["details"]).toMatchObject({ key: "installer-quote-sent:v1:q-1", quote_id: QUOTE, business_id: BIZ, to: "office@sample.example" });
    expect(attempts()).toHaveLength(1);
    expect(attempts()[0]).toMatchObject({ purpose: "installer_quote_sent_email", idempotency_key: "installer-quote-sent:v1:q-1", status: "sent" });
    // Idempotent: the release hook re-running (retry, second Send, sweep) never emails again.
    const r2 = await run();
    expect(r2).toContain("already attempted");
    expect(sent).toHaveLength(1);
    expect(events("installer_quote_sent_email")).toHaveLength(1);
    expect(attempts()).toHaveLength(1);
    // Never a stage or quote change.
    expect(snapshot()).toBe(before);
  });

  test("HIV lead: nothing sent, nothing recorded", async () => {
    seed({ channel: "hivic_sourced" });
    const r = await run();
    expect(r).toContain("skipped");
    expect(sent).toHaveLength(0);
    expect(T["workflow_events"]).toHaveLength(0);
    expect(attempts()).toHaveLength(0);
  });

  test("fixes quote, unsent quote, closed job, unknown quote: skipped without a record", async () => {
    for (const o of [{ kind: "rectification" }, { sentAt: null }, { deleted: "2026-11-05T04:00:00Z" }]) {
      seed(o);
      expect(await run()).toContain("skipped");
      expect(sent).toHaveLength(0);
      expect(T["workflow_events"]).toHaveLength(0);
    }
    seed();
    expect(await emailInstallerQuoteSent(JOB, "q-missing")).toContain("skipped");
    expect(sent).toHaveLength(0);
  });

  test("flag off (real partner): held, recorded ONCE; a later run while still off records nothing more; flag on later sends once", async () => {
    const r1 = await run({ approved: false });
    expect(r1).toContain("held");
    expect(sent).toHaveLength(0);
    expect(events("installer_quote_sent_email_held")).toHaveLength(1);
    expect(events("installer_quote_sent_email_held")[0]!["details"]).toMatchObject({ reason: "email wording not approved yet (INSTALLER_QUOTE_SENT_EMAIL_APPROVED)", key: "installer-quote-sent:v1:q-1" });
    expect(attempts()).toHaveLength(0);
    await run({ approved: false });
    expect(events("installer_quote_sent_email_held")).toHaveLength(1);
    const r3 = await run({ approved: true });
    expect(r3).toContain("email sent");
    expect(sent).toHaveLength(1);
    expect(attempts()).toHaveLength(1);
  });

  test("no office email on the business: held once with the reason; nothing claimed", async () => {
    seed({ email: null });
    expect(await run()).toContain("held: no office email on file for the installer");
    expect(sent).toHaveLength(0);
    expect(events("installer_quote_sent_email_held")[0]!["details"]).toMatchObject({ reason: "no office email on file for the installer" });
    expect(attempts()).toHaveLength(0);
  });

  test("trade messages paused: held once, not claimed; unpause → sent", async () => {
    paused = "Trade messages are paused (Jo 30 Oct 2026)";
    expect(await run()).toContain("held: Trade messages are paused");
    expect(sent).toHaveLength(0);
    expect(events("installer_quote_sent_email_held")).toHaveLength(1);
    paused = null;
    expect(await run()).toContain("email sent");
    expect(sent.map((s) => s.kind)).toEqual(["real-email"]);
  });

  test("TEST job → test-send with the TEST base link, marked TEST; TEST partner on a real job likewise; pause never holds TEST", async () => {
    seed({ source: "qa_test" });
    paused = "Trade messages are paused";
    expect(await run({ approved: false })).toContain("email (test) sent");
    expect(sent[0]).toMatchObject({ kind: "test-email", to: "office@sample.example", label: "installer-quote-sent:v1:q-1" });
    expect(sent[0]!.text).toContain("TEST — only sent to Jo.");
    expect(sent[0]!.text).toContain("See the quote: https://test.example/field/job-1");
    seed({ testPartner: true });
    expect(await run()).toContain("email (test) sent");
    expect(sent[0]!.kind).toBe("test-email");
  });

  test("no owner name on file: 'the owner' wording, still sent", async () => {
    seed({ ownerName: null });
    expect(await run()).toContain("email sent");
    expect(sent[0]!.subject).toBe("HV-1234: Quote sent to the owner");
    expect(sent[0]!.text).toContain("HV-1234 · the owner");
  });

  test("replacement quote (office sent a new installer price): 'Updated quote sent' wording, own key per quote id; the old quote's email is untouched", async () => {
    T["quotes"]!.push({ id: "q-2", job_id: JOB, kind: "installation", status: "issued", sent_at: "2026-11-06T03:00:00Z", customer_total_inc_gst: "5100.00" });
    T["workflow_events"]!.push({ job_id: JOB, event_type: "installer_price_quote_replaced", summary: "Office sent the replacement installer price", details: { quote_id: "q-2", replaced_quote_id: QUOTE } });
    expect(await run()).toContain("email sent");
    expect(sent[0]!.subject).toBe("HV-1234: Quote sent to Sarah");
    expect(await emailInstallerQuoteSent(JOB, "q-2")).toContain("email sent");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ kind: "real-email", to: "office@sample.example", subject: "HV-1234: Updated quote sent to Sarah", key: "installer-quote-sent:v1:q-2" });
    expect(sent[1]!.text).toContain("Updated quote sent.");
    expect(sent[1]!.text).toContain("Your new price is in. The updated quote for Sarah's place went out today.");
    expect(sent[1]!.text).toContain("Quote: $5,100 inc GST");
    expect(sent[1]!.text).toContain("Valid until Sun 6 Dec 2026");
    expect(attempts().map((a) => a["idempotency_key"])).toEqual(["installer-quote-sent:v1:q-1", "installer-quote-sent:v1:q-2"]);
    // Re-running the replacement never emails again.
    expect(await emailInstallerQuoteSent(JOB, "q-2")).toContain("already attempted");
    expect(sent).toHaveLength(2);
  });

  test("replacement whose old quote can't be read: nothing sent or claimed now (the sweep retries); never throws", async () => {
    T["workflow_events"]!.push({ job_id: JOB, event_type: "installer_price_quote_replaced", summary: "x", details: { quote_id: QUOTE, replaced_quote_id: "q-gone" } });
    await expect(run()).resolves.toContain("not sent");
    expect(sent).toHaveLength(0);
    expect(attempts()).toHaveLength(0);
  });

  test("a failed send keeps the one attempt (status failed) and is never retried", async () => {
    mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string }) => { sent.push({ kind: "real-email-failed", to: p.to }); return { channel: "email", to: p.to, status: "failed", detail: "provider refused" }; } }));
    expect(await run()).toContain("email failed");
    expect(attempts()[0]).toMatchObject({ status: "failed", error: "provider refused" });
    expect(await run()).toContain("already attempted");
    expect(sent).toHaveLength(1);
    mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string; label: string; idempotencyKey?: string; text?: string; record: { businessId?: string | null } }) => { sent.push({ kind: "real-email", to: p.to, subject: p.subject, label: p.label, key: p.idempotencyKey, text: p.text, businessId: p.record.businessId }); return { channel: "email", to: p.to, status: "sent", detail: "ok" }; } }));
  });

  test("a database failure never throws to the caller", async () => {
    for (const k of Object.keys(T)) delete T[k];
    await expect(run()).resolves.toMatch(/not sent|skipped/);
  });
});

describe("wiring (source facts)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  test("releaseQuoteToOwner fires the installer email after the quote is committed and the owner is told; detached with waitUntil, else inline; never for a quote that wasn't claimed", () => {
    const s = read("src/lib/office-quote-review.server.ts");
    const idx = (t: string) => { const i = s.indexOf(t); expect(i, t).toBeGreaterThan(-1); return i; };
    expect(idx('if (!claimed) throw new WorkflowError("The quote changed or was already sent. Reload it.");')).toBeLessThan(idx("emailInstallerQuoteSent(jobId, quoteId)"));
    expect(idx("notifyOwnerQuoteReady(jobId, quoteId, quote.kind)")).toBeLessThan(idx("emailInstallerQuoteSent(jobId, quoteId)"));
    expect(s).toContain("requestContext.getStore()?.waitUntil");
  });
  test("sender: plan first, claim BEFORE the event and the send; TEST → test-send; real → sendOfficeEmail partner with the quote key; never a quote or stage write; no raw provider", () => {
    const s = read("src/lib/installer-quote-sent-email.server.ts");
    const idx = (t: string) => { const i = s.indexOf(t); expect(i, t).toBeGreaterThan(-1); return i; };
    expect(idx("installerQuoteSentPlan({")).toBeLessThan(idx("insert({ job_id: jobId, purpose: INSTALLER_QUOTE_SENT_PURPOSE, idempotency_key: key })"));
    expect(idx("insert({ job_id: jobId, purpose: INSTALLER_QUOTE_SENT_PURPOSE, idempotency_key: key })")).toBeLessThan(idx("logEvent(jobId, null, INSTALLER_QUOTE_SENT_EVENT"));
    expect(idx("logEvent(jobId, null, INSTALLER_QUOTE_SENT_EVENT")).toBeLessThan(idx("renderInstallerQuoteSentEmail("));
    // The replacement check comes before the claim, so a failed check never burns the one attempt.
    expect(idx("ownQuoteReplacement(jobId, quoteId)")).toBeLessThan(idx("insert({ job_id: jobId, purpose: INSTALLER_QUOTE_SENT_PURPOSE, idempotency_key: key })"));
    expect(idx("INSTALLER_QUOTE_SENT_HELD_EVENT")).toBeGreaterThan(-1);
    expect(s).toContain('const test = j.source === "qa_test" || isTestPartner(b ?? {});');
    expect(s).toContain("const base = test ? TEST_APP_BASE : SET_PASSWORD_BASE;");
    expect(s).toContain("sendTestEmail(");
    expect(s).toContain('recipient: "partner"');
    expect(s).toContain("idempotencyKey: key");
    expect(s).toContain("tradeMessagesPausedNow(");
    expect(s).not.toMatch(/fetch\(|resendSend|sendRealSms|transition\(|from\("quotes"\)\s*\.update/);
    expect(s).not.toContain("@tanstack/react-start/server");
  });
});
