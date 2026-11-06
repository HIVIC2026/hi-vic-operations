// Jo 7 Nov 2026: an email unsubscribe cancels the job the same way a STOP text does — enquiries and saved spots are
// cancelled "Opted out (unsubscribed)"; later jobs are marked Do not contact instead.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

let T: Tables = {};
const db = { from: (t: string) => memoryPostgrest(T).from(t) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
const cancelCalls: unknown[][] = [];
mock.module("../src/lib/office-actions.server", () => ({ cancelJobFully: async (...a: unknown[]) => { cancelCalls.push(a); } }));
afterAll(() => mock.restore());
const { recordUnsubscribe } = await import("../src/lib/emailsafety.server");

const TOKEN = "A".repeat(43);
function seed(stage: string, bucket: string) {
  T = {
    customer_email_optouts: [{ id: "o1", job_id: "j1", token: TOKEN, opted_out_at: null }],
    jobs: [{ id: "j1", owner_id: "own1", stage, source: "base44", deleted_at: null }],
    office_enquiry_index: [{ id: "j1", stage, owner_phone: "0491 234 567", office_bucket: bucket, source: "base44", deleted_at: null }],
    owner_contact_consents: [], customer_followups: [], workflow_events: [], lead_campaign_responses: [],
    job_assignments: [], partner_offers: [],
  };
}
beforeEach(() => { cancelCalls.length = 0; });

test("unsubscribe at enquiry stage cancels job with Opted out (unsubscribed)", async () => {
  seed("new_enquiry", "enquiry");
  expect(await recordUnsubscribe(TOKEN)).toBe(true);
  const job = T["jobs"]![0]!;
  expect(job["stage"]).toBe("cancelled");
  expect(job["cancelled_reason"]).toBe("Opted out (unsubscribed)");
  const ev = T["workflow_events"]!.find((e) => e["event_type"] === "stage_changed");
  expect(ev?.["summary"]).toBe("Cancelled: Opted out (unsubscribed)");
  expect(ev?.["details"]?.["source"]).toBe("email_unsubscribe");
});

test("unsubscribe on a saved spot with an installer offer cancels through the full-cancel path", async () => {
  seed("ready_check_ready_to_schedule", "active");
  T["lead_campaign_responses"] = [{ job_id: "j1", spot_saved_at: "2026-11-01T00:00:00Z" }];
  T["partner_offers"] = [{ id: "p1", job_id: "j1", status: "pending" }];
  expect(await recordUnsubscribe(TOKEN)).toBe(true);
  expect(cancelCalls).toEqual([["j1", "Opted out (unsubscribed)", null, { tell: { owner: false, installer: true } }]]);
});

test("unsubscribe after $349 paid does not cancel, marks do not contact", async () => {
  seed("assessment_booked", "active");
  expect(await recordUnsubscribe(TOKEN)).toBe(true);
  expect(T["jobs"]![0]!["stage"]).toBe("assessment_booked");
  expect(cancelCalls).toHaveLength(0);
  const dnc = T["workflow_events"]!.filter((e) => e["event_type"] === "owner_do_not_contact_set");
  expect(dnc).toHaveLength(1);
  expect(dnc[0]!["details"]?.["source"]).toBe("email_unsubscribe");
});

test("second unsubscribe click does nothing more", async () => {
  seed("assessment_booked", "active");
  await recordUnsubscribe(TOKEN);
  const before = JSON.stringify(T);
  expect(await recordUnsubscribe(TOKEN)).toBe(true);
  expect(JSON.stringify(T)).toBe(before);
});
