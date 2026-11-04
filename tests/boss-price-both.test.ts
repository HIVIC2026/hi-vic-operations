// Part 10 Task 3 — Jo 3 Nov 2026 22:58: an A1 Ready Check Complete with no price → the BOSS gets BOTH the decision-288
// text AND the "Enter your price" email. One claim per job covers the pair; the email is its own channel under it: a
// held email (flag off, no office email, trade messages paused) is retried on a later sync without a second text.
// Runs the real sender over an in-memory database; every outbound path is a recorder (nothing is sent).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const T: Tables = {};
const admin = memoryPostgrest(T);
const sent: { kind: string; to: string; label?: string; subject?: string; key?: string; body?: string; text?: string }[] = [];
let paused: string | null = null;

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: unknown) => { await admin.from("workflow_events").insert({ job_id, actor_id, event_type, summary, details: details ?? {} }); },
}));
mock.module("../src/lib/installer-price.server", () => ({ readInstallerPrice: async () => null, entriesWithInstallerPrice: async (_j: string, e: unknown[]) => e }));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => paused }));
mock.module("../src/lib/qa-inbox.server", () => ({ qaDeliveryHeld: async () => false }));
mock.module("../src/lib/file-links.server", () => ({ signFile: async (_b: string, path: string) => ({ data: { signedUrl: `/api/files/SIGNED/${path.split("/").pop()}` }, error: null }) }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string; to: string; body: string }) => { sent.push({ kind: `real-sms:${p.type}`, to: p.to, key: p.idempotencyKey, body: p.body }); return { channel: "sms", to: p.to, status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string; label: string; idempotencyKey?: string; text?: string }) => { sent.push({ kind: "real-email", to: p.to, subject: p.subject, label: p.label, key: p.idempotencyKey, text: p.text }); return { channel: "email", to: p.to, status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/test-send.server", () => ({
  TEST_APP_BASE: "https://test.example",
  sendTestSms: async (ctx: { label: string }, to: string, body: string) => { sent.push({ kind: "test-sms", to, label: ctx.label, body }); return { channel: "sms", to, status: "sent", detail: "test" }; },
  sendTestEmail: async (ctx: { label: string }, to: string, subject: string, _html: string, text: string) => { sent.push({ kind: "test-email", to, label: ctx.label, subject, text }); return { channel: "email", to, status: "sent", detail: "test" }; },
}));

const { textBossPriceLink } = await import("../src/lib/boss-price-link.server");
const { LEAN_Q } = await import("../src/lib/ready-check-lean.core");

const JOB = "job-1", BIZ = "biz-1";
const entries = [
  { label: LEAN_Q.ownerName, value: "Sarah Brown" }, { label: LEAN_Q.lifeSupport, value: "No" }, { label: LEAN_Q.builtLast5, value: "No" },
  { label: LEAN_Q.roofType, value: "Sloped, tiles" }, { label: LEAN_Q.access, value: "Standard" },
  { label: LEAN_Q.areaName, value: "Whole home (excluding garage)" }, { label: LEAN_Q.lengthM, value: "10" }, { label: LEAN_Q.widthM, value: "12" },
  { label: LEAN_Q.existing, value: "No" }, { label: LEAN_Q.downlights, value: "No" }, { label: LEAN_Q.product, value: "Bradford Gold R5.0" },
];
const NOW = Date.now();
const completedAt = new Date(NOW - 10 * 60 * 1000).toISOString();
const events = (type: string) => (T["workflow_events"] ?? []).filter((e) => e["job_id"] === JOB && e["event_type"] === type);

function seed(o: { source?: string; channel?: string; testPartner?: boolean; email?: string | null; mobile?: string | null } = {}) {
  for (const k of Object.keys(T)) delete T[k];
  sent.length = 0; paused = null;
  T["properties"] = [{ id: "prop-1", address_line: "12 Example St", suburb: "Box Hill", postcode: "3128" }];
  T["owners"] = [{ id: "own-1", full_name: "Sarah Brown" }];
  T["jobs"] = [{ id: JOB, job_number: "HV-1234", source: o.source ?? "website", channel: o.channel ?? "installer_sourced", deleted_at: null, originating_installer_business_id: BIZ, property_id: "prop-1", owner_id: "own-1" }];
  T["businesses"] = [{ id: BIZ, name: "Sample Insulation Co", signer_name: "James Smith", signer_mobile: o.mobile === undefined ? "0400000000" : o.mobile, phone: null, email: o.email === undefined ? "office@sample.example" : o.email, onboarding_notes: o.testPartner ? "[TEST PARTNER]" : null }];
  T["ceiling_measurements"] = [{ id: "m-1", job_id: JOB, is_current: true, measured_area_m2: 120, removal_required: false }];
  T["documents"] = [{ id: "d-1", job_id: JOB, kind: "mitti_report", title: "Mitti Ready Check report", storage_path: `${JOB}/mitti/ready-check.pdf`, created_at: completedAt }];
  T["workflow_events"] = [{ id: "ev-1", job_id: JOB, event_type: "visit_allocated", details: { visit: "ready_check", worker_id: "w-1", worker_name: "John Doe", by: "u", mitti_user_id: null, audit_id: "audit-1", form: "none" }, created_at: completedAt }];
  T["customer_email_sends"] = [];
}
// ENTER_PRICE_EMAIL_APPROVED is ON since go-live 5 Nov 2026: the "flag off" cases pass emailApproved: false explicitly.
const run = (opts?: { emailApproved?: boolean }) => textBossPriceLink(JOB, { auditId: "audit-1", completedAt, entries }, { emailApproved: false, ...opts });

describe("both channels under one claim", () => {
  beforeEach(() => seed());

  test("flag off (real partner): the text goes, the email is held and recorded ONCE; a second sync resends nothing", async () => {
    const r1 = await run();
    expect(r1).toContain("boss sms sent");
    expect(sent.map((s) => s.kind)).toEqual(["real-sms:boss_price_link"]);
    expect(sent[0]!.body).toBe("HV-1234 Ready Check done at 12 Example St, Box Hill. Enter your price: https://estimate.homeinsulationvictoria.com.au/field/job-1#price");
    expect(events("boss_price_link_sent")).toHaveLength(1);
    expect(events("enter_price_email_held")).toHaveLength(1);
    expect(events("enter_price_email_held")[0]!["details"]).toMatchObject({ reason: "email wording not approved yet (ENTER_PRICE_EMAIL_APPROVED)", key: "boss-price-link:v1:job-1:email" });
    expect(events("enter_price_email_held")[0]!["summary"]).toContain("retried on the next sync within 24h of Complete, then dropped"); // M3
    const r2 = await run();
    expect(r2).toContain("held");
    expect(sent).toHaveLength(1);
    expect(events("boss_price_link_sent")).toHaveLength(1);
    expect(events("enter_price_email_held")).toHaveLength(1);
  });

  test("flag on (real partner): ONE text + ONE email to the business office email, claimed under the one job key; never twice", async () => {
    const r = await run({ emailApproved: true });
    expect(r).toContain("boss sms sent");
    expect(r).toContain("email sent");
    expect(sent.map((s) => s.kind)).toEqual(["real-sms:boss_price_link", "real-email"]);
    const mail = sent[1]!;
    expect(mail.to).toBe("office@sample.example");
    expect(mail.key).toBe("boss-price-link:v1:job-1:email");
    expect(mail.label).toBe("enter_price_email");
    expect(mail.subject).toBe("HV-1234: Ready Check done. Time to price it.");
    expect(mail.text).toContain("Hi James,");
    expect(mail.text).toContain("Here's what John found at Sarah's place. Enter your price and Home Insulation Victoria sends them the quote once every check passes.");
    expect(mail.text).toContain("HV-1234 · Sarah Brown");
    expect(mail.text).toContain("12 Example St, Box Hill VIC 3128 · Ready Check ");
    expect(mail.text).toContain("Measured ceiling: 120 m² (1 area)");
    expect(mail.text).toContain("Existing insulation: None");
    expect(mail.text).toContain("Removal needed: None");
    expect(mail.text).toContain("Enter your price: https://estimate.homeinsulationvictoria.com.au/field/job-1#price");
    expect(mail.text).toContain("See the full Ready Check ›: https://estimate.homeinsulationvictoria.com.au/api/files/SIGNED/ready-check.pdf");
    expect(events("boss_price_link_sent")).toHaveLength(1);
    expect(events("enter_price_email_held")).toHaveLength(0);
    expect(T["customer_email_sends"]).toHaveLength(1);
    expect(T["customer_email_sends"]![0]).toMatchObject({ job_id: JOB, purpose: "enter_price_email", idempotency_key: "boss-price-link:v1:job-1:email", status: "sent" });
    const r2 = await run({ emailApproved: true });
    expect(r2).toContain("already");
    expect(sent).toHaveLength(2);
  });

  test("held email is retried alone: no office email at first → held once; email added → the email goes, the text is NOT resent", async () => {
    seed({ email: null });
    await run({ emailApproved: true });
    expect(sent.map((s) => s.kind)).toEqual(["real-sms:boss_price_link"]);
    expect(events("enter_price_email_held")[0]!["details"]).toMatchObject({ reason: "no office email on file for the installer" });
    T["businesses"]![0]!["email"] = "office@sample.example";
    const r = await run({ emailApproved: true });
    expect(r).toContain("email sent");
    expect(sent.map((s) => s.kind)).toEqual(["real-sms:boss_price_link", "real-email"]);
    expect(events("boss_price_link_sent")).toHaveLength(1);
    expect(events("enter_price_email_held")).toHaveLength(1);
  });

  test("a stale completion (over 24h) never fires the email on a later sync, even with the flag on", async () => {
    await run(); // flag off → text sent, email held
    T["jobs"]![0]!["id"] = JOB; // unchanged
    const old = new Date(NOW - 30 * 60 * 60 * 1000).toISOString();
    const r = await textBossPriceLink(JOB, { auditId: "audit-1", completedAt: old, entries }, { emailApproved: true });
    expect(r).toContain("already");
    expect(sent.map((s) => s.kind)).toEqual(["real-sms:boss_price_link"]);
  });

  test("trade messages paused: neither channel is claimed, nothing recorded; both go on the next sync", async () => {
    paused = "Trade messages are paused";
    const r = await run({ emailApproved: true });
    expect(r).toContain("held");
    expect(sent).toHaveLength(0);
    expect(events("boss_price_link_sent")).toHaveLength(0);
    expect(events("enter_price_email_held")).toHaveLength(0);
    paused = null;
    await run({ emailApproved: true });
    expect(sent.map((s) => s.kind)).toEqual(["real-sms:boss_price_link", "real-email"]);
  });

  test("no business mobile: the text is recorded as not sent (never retried), the email still goes", async () => {
    seed({ mobile: null });
    const r = await run({ emailApproved: true });
    expect(r).toContain("not sent: no business mobile");
    expect(r).toContain("email sent");
    expect(sent.map((s) => s.kind)).toEqual(["real-email"]);
    const r2 = await run({ emailApproved: true });
    expect(sent).toHaveLength(1);
    expect(r2).toContain("already");
  });

  test("TEST job → test-sends only, the email draft included even while the flag is off", async () => {
    seed({ source: "qa_test", testPartner: true });
    const r = await run();
    expect(r).toContain("(test)");
    expect(sent.map((s) => s.kind)).toEqual(["test-sms", "test-email"]);
    expect(sent[1]!.label).toBe("boss-price-link:v1:job-1:email");
    expect(sent[1]!.text).toContain("Enter your price: https://test.example/field/job-1#price");
    expect(sent[1]!.text).toContain("TEST — only sent to Jo.");
    expect(events("enter_price_email_held")).toHaveLength(0);
  });

  test("TEST partner on a real-source job → test-sends only", async () => {
    seed({ testPartner: true });
    await run();
    expect(sent.map((s) => s.kind)).toEqual(["test-sms", "test-email"]);
  });

  test("Home Insulation Victoria lead → nothing at all", async () => {
    seed({ channel: "hivic_sourced" });
    const r = await run({ emailApproved: true });
    expect(r).toBe("skipped: not an installer-supplied job");
    expect(sent).toHaveLength(0);
    expect(events("boss_price_link_sent")).toHaveLength(0);
  });

  test("no Ready Check PDF on file → the email has no 'See the full Ready Check' link", async () => {
    T["documents"] = [];
    await run({ emailApproved: true });
    expect(sent[1]!.text).not.toContain("See the full Ready Check");
  });
});
