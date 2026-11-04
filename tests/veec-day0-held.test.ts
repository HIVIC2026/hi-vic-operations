// Part 4 fix wave (final review minor): the day-0 VEEC request step is recorded only after the All done email actually went.
// A `held —` result (contacts / tax invoice / rebate-form PDF not ready) leaves the step open for the next tick; no text goes.
import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {}; const admin = memoryPostgrest(tables);
let allDone = "held — No installer office on file";
const sms: unknown[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { (tables.workflow_events ??= []).push({ job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {} }); },
}));
mock.module("../src/lib/approved-owner-emails.server", () => ({ emailOwnerInstallComplete: async () => allDone }));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async () => "https://estimate.homeinsulationvictoria.com.au/my-job/tok" }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: unknown) => { sms.push(p); return { status: "sent", detail: "recorded" }; } }));

const { sendVeecSignStep } = await import("../src/lib/veec-reminders.server");
const J = "00000000-0000-0000-0000-00000000000a";
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.jobs = [{ id: J, owner_id: "o", source: "website", stage: "evidence_outstanding", installation_completed_at: "2026-11-21T02:00:00Z", deleted_at: null }];
  tables.owners = [{ id: "o", full_name: "Helen Yang", email: "helen@example.com", phone: "0400111222" }];
  tables.job_assignments = [{ id: "a", job_id: J, role: "installer", active: true, business_id: "b" }];
  tables.businesses = [{ id: "b", onboarding_notes: null }];
  tables.customer_agreements = []; tables.invoices = []; tables.workflow_events = [];
  sms.length = 0; allDone = "held — No installer office on file";
});

test("All done held: the day-0 step is NOT recorded and no text goes; once it sends, the step is recorded once", async () => {
  expect(await sendVeecSignStep(J, "request")).toBe("All done email held — No installer office on file");
  expect(tables.workflow_events!.filter((e) => e.event_type === "veec_sign_reminder")).toHaveLength(0);
  expect(sms).toHaveLength(0);
  // next tick: still held, still open
  expect(await sendVeecSignStep(J, "request")).toMatch(/^All done email held/);
  expect(tables.workflow_events!.filter((e) => e.event_type === "veec_sign_reminder")).toHaveLength(0);
  // fixed: it goes, the step is recorded, the text goes, and it never repeats
  allDone = "sent";
  expect(await sendVeecSignStep(J, "request")).toBe("All done email sent; sms sent: recorded");
  expect(tables.workflow_events!.filter((e) => e.event_type === "veec_sign_reminder")).toHaveLength(1);
  expect(sms).toHaveLength(1);
  expect(await sendVeecSignStep(J, "request")).toBe("already handled");
  expect(sms).toHaveLength(1);
});
