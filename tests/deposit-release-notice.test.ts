// Decision 170 (Jo, 24 Oct 2026): the 48h deposit-release owner notice. Pure wording + the server's once-per-release
// and TEST-only guarantees against an in-memory backend with every sender mocked. Run: bun test tests/deposit-release-notice.test.ts
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEPOSIT_RELEASE_NOTICE_EVENT, PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED, depositReleaseKeys, depositReleaseText, renderDepositReleasedEmail } from "../src/lib/deposit-release-notice.core";
import { SMS_BRAND_PREFIX, SMS_FRESHNESS, SMS_MESSAGE_TYPES, brandSmsBody, smsBlocker, smsStaleReason } from "../src/lib/sms.core";
import { HIV_BANK_DETAILS, bankDetailLines } from "../src/lib/payments.core";

const LINK = "https://estimate.homeinsulationvictoria.com.au/my-job/tok";

describe("wording (decision 170)", () => {
  test("text: approved sentence, link, STOP last, under two segments with the brand prefix", () => {
    const t = depositReleaseText({ firstName: "Helen", day: "Tuesday 11 November", link: LINK });
    expect(t).toBe(`Hi Helen, we didn't receive your install deposit in time, so Tuesday 11 November has been released. Your installer will offer new days once it's paid: ${LINK} Reply STOP to opt out.`);
    expect(brandSmsBody(t).startsWith(SMS_BRAND_PREFIX)).toBe(true);
    expect(brandSmsBody(t).length).toBeLessThanOrEqual(SMS_BRAND_PREFIX.length + 306);
    expect(depositReleaseText({ firstName: null, day: "Monday 3 November", link: LINK })).toContain("Hi there, we didn't");
  });
  test("email: headline, same message, bank details and See my job", () => {
    const m = renderDepositReleasedEmail({ firstName: "Helen", day: "Tuesday 11 November", link: LINK, depositAmount: "$185.10", bankLines: bankDetailLines(HIV_BANK_DETAILS, "Home Insulation Victoria HV-3117") });
    expect(m.subject).toBe("Helen, your install day was released");
    expect(m.html).toContain("Hi Helen,");
    expect(m.html).toContain("Your install day was released");
    expect(m.html).toContain("so Tuesday 11 November has been released. Your installer will offer new days once it's paid.");
    expect(m.html).toContain("Pay your $185.10 deposit by card, bank transfer or PayID");
    // O64 design: bank details as label/value rows.
    expect(m.html).toContain("<strong>082-902</strong>");
    expect(m.html).toContain("<strong>777966349</strong>");
    expect(m.html).toContain('Home Insulation Victoria <span style="white-space:nowrap;">HV-3117</span>');
    expect(m.text).toContain("BSB 082-902 · Account 777966349");
    expect(m.text).toContain("Reference: Home Insulation Victoria HV-3117");
    expect(m.html).toContain(">See my job<");
    expect(m.text).toContain("Account name: Home Insulation Victoria");
    expect(m.text).toContain(`See my job: ${LINK}`);
  });
  test("flags: owner notice approved; SMS type deposit_release is an approved owner type under quiet hours", () => {
    expect(PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED).toBe(true);
    expect(SMS_MESSAGE_TYPES.deposit_release).toMatchObject({ audience: "owner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.deposit_release).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
    expect(smsStaleReason("deposit_release", { at: "2026-10-26T01:00:00.000Z" }, "2026-10-26T02:00:00.000Z")).toBeNull();
    expect(smsStaleReason("deposit_release", { at: "2026-10-24T01:00:00.000Z" }, "2026-10-26T02:00:00.000Z")).toMatch(/Too late/);
    const base = { type: "deposit_release", to: "0412 345 678", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-26T02:00:00.000Z" };
    expect(smsBlocker(base)).toBeNull();
    expect(smsBlocker({ ...base, isTestRecord: true })).toBe("TEST record – use the test sender");
    expect(smsBlocker({ ...base, commsEnabled: false })).toBe("Customer communications are switched off");
  });
  test("one key pair per released booking", () => {
    expect(depositReleaseKeys("b1")).toEqual({ email: "deposit-release:v1:b1:email", sms: "deposit-release:v1:b1:sms" });
    expect(depositReleaseKeys("b1").sms).not.toBe(depositReleaseKeys("b2").sms);
  });
  test("the sweep calls the notice once per released booking, after the release, and the next action says the installer offers new days", () => {
    const s = readFileSync("src/lib/payments.server.ts", "utf8");
    const release = s.indexOf('"install_booking_released_unpaid"');
    const notice = s.indexOf("sendDepositReleaseNotice({ jobId: b.job_id, bookingId: b.id");
    expect(release).toBeGreaterThan(0);
    expect(notice).toBeGreaterThan(release);
    expect(s).toContain("the installer offers 3 new days once the deposit is paid");
    expect(s).not.toContain("install_booking_released_owner_notice_not_sent\", \"Owner notice about the released booking is awaiting wording approval");
    const srv = readFileSync("src/lib/deposit-release-notice.server.ts", "utf8");
    expect(srv).not.toMatch(/resendSend\(|fetch\(|twilio/i);
    for (const t of ["sendTestEmail", "sendTestSms", "assertCustomerDeliveryAllowed", "sendGuardedOwnerEmail", "sendRealSms"]) expect(srv).toContain(t);
  });
});

// ---- in-memory backend for the server module ----
type Row = Record<string, any>;
const db: Record<string, Row[]> = {
  workflow_events: [],
  jobs: [{ id: "job-real", owner_id: "o1", source: "website" }, { id: "job-test", owner_id: "o2", source: "qa_test" }],
  owners: [{ id: "o1", full_name: "Helen Yang", email: "helen@example.test", phone: "0412 345 678" }, { id: "o2", full_name: "Test Owner", email: "test@example.test", phone: "0400 000 000" }],
  job_assignments: [],
};
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const api: any = {
    select: () => api, order: () => api, limit: () => api,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] ?? {})[kk] === vv)); return api; },
    maybeSingle: async () => ({ data: db[table]!.find((r) => filters.every((f) => f(r))) ?? null }),
    then: (res: any) => res({ data: db[table]!.filter((r) => filters.every((f) => f(r))) }),
  };
  return api;
}
const calls = { testEmail: [] as string[], testSms: [] as string[], guarded: [] as string[], real: [] as string[] };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {}, logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: unknown) => { db.workflow_events!.push({ job_id, event_type, summary, details }); } }));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async () => LINK }));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (ctx: { jobSource: string | null; label: string }, _to: string, subject: string) => { calls.testEmail.push(`${ctx.jobSource}:${ctx.label}:${subject}`); return { status: "sent", detail: "test" }; },
  sendTestSms: async (ctx: { jobSource: string | null; label: string }, _to: string, body: string) => { calls.testSms.push(`${ctx.jobSource}:${ctx.label}:${body}`); return { status: "sent", detail: "test" }; },
}));
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async (p: { key: string; build: () => { subject: string } }) => { calls.guarded.push(`${p.key}:${p.build().subject}`); return "sent"; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string; to: string | null; event?: { at: string } }) => { calls.real.push(`${p.type}:${p.idempotencyKey}:${p.to}:${p.event?.at ?? "no-event"}`); return { status: "sent", detail: "ok", sid: "x" }; } }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => undefined }));
const { sendDepositReleaseNotice } = await import("../src/lib/deposit-release-notice.server");

const bank = { ...HIV_BANK_DETAILS };
const input = (jobId: string, bookingId: string) => ({ jobId, bookingId, wasStart: "2026-11-10T20:30:00.000Z", depositCents: 18_510, bank, reference: "Home Insulation Victoria HV-3117", releasedAt: "2026-11-05T03:00:00.000Z" });

describe("sendDepositReleaseNotice (server, mocked backend)", () => {
  test("real job: one event, one guarded email and one real text per released booking; a retry sends nothing", async () => {
    const r1 = await sendDepositReleaseNotice(input("job-real", "bk-1"));
    expect(r1).toContain("email sent");
    expect(r1).toContain("sms sent");
    expect(calls.guarded).toEqual(["deposit-release:v1:bk-1:email:Helen, your install day was released"]);
    expect(calls.real).toEqual(["deposit_release:deposit-release:v1:bk-1:sms:0412 345 678:2026-11-05T03:00:00.000Z"]);
    expect(db.workflow_events!.filter((e) => e["event_type"] === DEPOSIT_RELEASE_NOTICE_EVENT && e["details"]?.booking_id === "bk-1").length).toBe(1);
    expect(await sendDepositReleaseNotice(input("job-real", "bk-1"))).toBe("already handled");
    expect(calls.guarded.length).toBe(1);
    expect(calls.real.length).toBe(1);
    expect(calls.testEmail.length + calls.testSms.length).toBe(0);
    // A later release of a NEW booking on the same job is a new notice.
    await sendDepositReleaseNotice(input("job-real", "bk-2"));
    expect(calls.guarded.length).toBe(2);
    expect(calls.real[1]).toContain("deposit-release:v1:bk-2:sms");
  });
  test("qa_test job: test sender only, never the guarded owner email or the real SMS sender", async () => {
    const before = { guarded: calls.guarded.length, real: calls.real.length };
    const r = await sendDepositReleaseNotice(input("job-test", "bk-t1"));
    expect(r).toContain("email sent");
    expect(calls.testEmail).toEqual(["qa_test:deposit_release:bk-t1:Test, your install day was released"]);
    expect(calls.testSms[0]).toContain("qa_test:deposit_release:bk-t1:Hi Test, we didn't receive your install deposit in time, so Wednesday 11 November has been released.");
    expect(calls.guarded.length).toBe(before.guarded);
    expect(calls.real.length).toBe(before.real);
    expect(await sendDepositReleaseNotice(input("job-test", "bk-t1"))).toBe("already handled");
    expect(calls.testEmail.length).toBe(1);
  });
});
