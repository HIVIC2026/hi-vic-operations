// Task 6 (Jo 5 Nov 2026), the office's Send of a discount version: the quote the owner already had is replaced
// (superseded), the new one is issued with a fresh sent_at (the 30 days run from today), ONE owner notification through
// the existing sender. If the owner accepted the earlier quote meanwhile, nothing is sent and nothing changes.
import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const T: Tables = {};
const admin = memoryPostgrest(T);
let notifications = 0;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError, commercialBlocker: async () => null, stageEntryBlockers: async () => [], transition: async () => {},
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details?: unknown) => { await admin.from("workflow_events").insert({ job_id, actor_id, event_type, summary, details: details ?? {}, created_at: new Date().toISOString() }); },
}));
mock.module("../src/lib/estimatelink.server", () => ({ ensureOwnerLink: async () => true }));
mock.module("../src/lib/installer-intake.server", () => ({ intakeSendBlockers: async () => [] }));
mock.module("../src/lib/installer-quote.server", () => ({ quoteBillingBlocker: async () => null }));
mock.module("../src/lib/install-evidence.server", () => ({ jobProductProblems: async () => [] }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
mock.module("../src/lib/pilot.server", () => ({ applyCobrand: async () => {} }));
mock.module("../src/lib/quote-ready-notify.server", () => ({ notifyOwnerQuoteReady: async () => { notifications++; return { email: "test accepted", sms: "test accepted" }; } }));

const { sendOfficeReviewedQuote } = await import("../src/lib/office-quote-review.server");
const { requestInstallerDiscount } = await import("../src/lib/installer-discount.server");
const { DISCOUNT_SOURCE_ACCEPTED, INSTALLER_DISCOUNT_REPLACED_EVENT } = await import("../src/lib/installer-discount.core");

const JOB = "job-1", BIZ = "biz-1", BOSS = "u-boss", Q = "q-sent", OFFICE_USER = "u-hiv";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  notifications = 0;
  T["jobs"] = [{ id: JOB, channel: "installer_sourced", originating_installer_business_id: BIZ, stage: "awaiting_quote_acceptance", source: null, deleted_at: null, qa_archived_at: null }];
  T["business_members"] = [{ business_id: BIZ, user_id: BOSS, member_role: "business_admin", active: true }];
  T["ceiling_measurements"] = [{ id: "m1", job_id: JOB, is_current: true, external_source: "mitti", external_id: "audit-1", status: "complete", measured_area_m2: 100 }];
  T["retail_estimator_settings"] = [{ id: "rs1", is_current: true, indicative_veec_value: 90, minimum_customer_copayment_inc_gst: 200 }];
  T["workflow_events"] = [];
  T["quotes"] = [{ id: Q, job_id: JOB, kind: "installation", option_code: "INSTALLER_A1", option_label: "Installer's quote (from Ready Check)", status: "issued", sent_at: ago(10), accepted_at: null, expired_at: null, release_state: "released", release_hold_reason: null, subtotal_inc_gst: 3124, gst_amount: 284, veec_discount_inc_gst: 900, customer_total_inc_gst: 2224, created_at: ago(11), version: 1 }];
  T["quote_items"] = [
    { id: "l1", quote_id: Q, code: "INSTALLER_PRICE", description: "Ceiling insulation", quantity: 1, unit: "job", unit_price_inc_gst: 2500, line_total_inc_gst: 2500, is_other: false, explanation: null, sort: 0 },
    { id: "l2", quote_id: Q, code: "AP_FEE", description: "Home Insulation Victoria fee", quantity: 1, unit: "flat", unit_price_inc_gst: 349, line_total_inc_gst: 349, is_other: false, explanation: null, sort: 1 },
    { id: "l3", quote_id: Q, code: "PIESA", description: "Electrical safety check", quantity: 1, unit: "flat", unit_price_inc_gst: 275, line_total_inc_gst: 275, is_other: false, explanation: null, sort: 2 },
  ];
});
const row = (id: string) => (T["quotes"] ?? []).find((q) => q["id"] === id)!;

test("Send replaces the old quote: old superseded, new issued with today's sent_at, one notification", async () => {
  const { quoteId } = await requestInstallerDiscount(JOB, BOSS, 200, null);
  const t0 = Date.now();
  const r = await sendOfficeReviewedQuote(JOB, quoteId, OFFICE_USER);
  expect(r.delivery).toBe("ready_to_send");
  expect(notifications).toBe(1);
  expect(row(Q)["status"]).toBe("superseded");
  expect(row(quoteId)).toMatchObject({ status: "issued", release_state: "released" });
  expect(new Date(row(quoteId)["sent_at"]).getTime()).toBeGreaterThanOrEqual(t0 - 1000);
  expect((T["workflow_events"] ?? []).filter((e) => e["event_type"] === INSTALLER_DISCOUNT_REPLACED_EVENT)).toHaveLength(1);
});

test("owner accepted the earlier quote meanwhile → Send refused, nothing changes, nothing sent", async () => {
  const { quoteId } = await requestInstallerDiscount(JOB, BOSS, 200, null);
  row(Q)["status"] = "accepted"; row(Q)["accepted_at"] = new Date().toISOString();
  await expect(sendOfficeReviewedQuote(JOB, quoteId, OFFICE_USER)).rejects.toThrow(DISCOUNT_SOURCE_ACCEPTED);
  expect(row(quoteId)["status"]).toBe("draft");
  expect(row(Q)["status"]).toBe("accepted");
  expect(notifications).toBe(0);
});

test("an ordinary (non-discount) draft's Send never touches other quotes", async () => {
  T["quotes"]!.push({ id: "q-plain", job_id: JOB, kind: "installation", option_code: "INSTALLER_A1", option_label: "Installer's quote (from Ready Check)", status: "draft", sent_at: null, release_state: "held", release_hold_reason: "Waiting for office review before sending", subtotal_inc_gst: 3124, gst_amount: 284, veec_discount_inc_gst: 900, customer_total_inc_gst: 2224, created_at: new Date().toISOString(), version: 1 });
  await sendOfficeReviewedQuote(JOB, "q-plain", OFFICE_USER);
  expect(row(Q)["status"]).toBe("issued");
  expect(row("q-plain")["status"]).toBe("issued");
});
