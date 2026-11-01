import { beforeEach, describe, expect, mock, test } from "bun:test";

const emails: { to: string; label: string }[] = [];
const texts: { to: string; label: string }[] = [];
const events: { type: string; details: any }[] = [];
let failed = false;
let source = "qa_test";
const admin = { from(table: string) {
  const filters: Record<string, unknown> = {};
  const q: any = {
    select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; },
    is: () => q, limit: () => q, order: () => q, range: () => q, in: () => q,
    maybeSingle: () => Promise.resolve(result(true)),
    then: (resolve: any) => Promise.resolve(result(false)).then(resolve),
  };
  function result(single: boolean) {
    if (table === "workflow_events") return { data: events.filter(e => e.type === filters.event_type).map(e => ({ details: e.details })), error: null };
    if (table === "jobs") return { data: single ? { job_number: "HV-TEST", source, owners: { full_name: "Test Owner", email: "owner@hivic-test.example", phone: "owner-phone" }, properties: { suburb: "Test" } } : [{ id: "job" }], error: null };
    const row = { job_id: "job", business_id: "business", user_id: "worker", profiles: { full_name: "Worker", email: "worker@hivic-test.example", phone: "worker-phone" }, businesses: { in_house: true, name: "TEST Installer", email: "office@hivic-test.example", phone: "office-phone" } };
    return { data: failed ? null : single ? row : [row], error: failed ? { message: "read failed" } : null };
  }
  return q;
} };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, type: string, _s: string, details: any) => { events.push({ type, details }); } }));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async () => "https://example.test/my-job" }));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (ctx: any, to: string) => { emails.push({ to, label: ctx.label }); return { status: "sent", detail: "mock" }; },
  sendTestSms: async (ctx: any, to: string) => { texts.push({ to, label: ctx.label }); return { status: "sent", detail: "mock" }; },
}));
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => ({ deadline: "2026-11-30", booked: false, expired: false, clearance: { timingDate: "2026-10-31" } }) }));
mock.module("../src/lib/test-send.core", () => ({ isTestPartner: () => false }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async (p: any) => { emails.push({ to: p.to, label: "owner" }); return "sent"; } }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: any) => { emails.push({ to: p.to, label: "installer" }); return { status: "sent", detail: "mock" }; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: any) => { texts.push({ to: p.to, label: p.type }); return { status: "sent", detail: "mock" }; } }));
const { sweepInstallWindowRule, sendInstallWindowReminder } = await import("../src/lib/thirty-day-rule.server");
beforeEach(() => { emails.length = 0; texts.length = 0; events.length = 0; failed = false; source = "qa_test"; });
describe("in-house official clock delivery (mocked only)", () => {
  for (const [day, step] of [["10", "reminder_20"], ["20", "reminder_10"]] as const) {
    test(`${step} is prepared for an in-house job and emailed to its office, never texted to that office`, async () => {
      expect((await sweepInstallWindowRule(new Date(`2026-11-${day}T00:00:00Z`))).reminders).toBe(1);
      expect(events.some(e => e.details.step === step)).toBe(true);
      expect(emails.filter(e => e.label.endsWith(":installer"))).toEqual([{ to: "office@hivic-test.example", label: `install_window:${step}:installer` }]);
      expect(texts.filter(e => e.label.endsWith(":installer"))).toEqual([]);
      expect(texts.filter(e => e.label.endsWith(":owner"))).toHaveLength(1);
      await sendInstallWindowReminder("job", step, "2026-11-30");
      expect(emails).toHaveLength(2);
    });
  }
  test("failed partner lookup records and dispatches nothing", async () => {
    failed = true;
    expect(await sendInstallWindowReminder("job", "reminder_20", "2026-11-30")).toBe("in_house_read_failed");
    expect(events).toEqual([]); expect(emails).toEqual([]); expect(texts).toEqual([]);
  });
  test("non-TEST delivery branch emails the in-house business office, never texts its office or worker (all providers mocked)", async () => {
    source = "base44";
    await sendInstallWindowReminder("job", "reminder_10", "2026-11-30", new Date("2026-11-20T00:00:00Z"));
    expect(emails.filter(e => e.label === "installer")).toEqual([{ to: "office@hivic-test.example", label: "installer" }]);
    expect(texts).toEqual([{ to: "owner-phone", label: "install_window_reminder" }]);
  });
});