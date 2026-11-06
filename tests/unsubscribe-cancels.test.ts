// Jo 7 Nov 2026: an email unsubscribe cancels the job the same way a STOP text does — enquiries and saved spots are
// cancelled "Opted out (unsubscribed)"; later jobs are marked Do not contact instead.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

let T: Tables = {};
// A table name here makes every read of it throw (a database outage mid clean-up).
let broken: string | null = null;
const db = { from: (t: string) => { if (t === broken) throw new Error(`${t} unavailable`); return memoryPostgrest(T).from(t); } };
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
beforeEach(() => { cancelCalls.length = 0; broken = null; });

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

test("a failed unsubscribe clean-up shows on Needs me and the tick retries it", async () => {
  const { unsubscribeCleanupFailedFact, buildNeedsRows, UNSUBSCRIBE_CLEANUP_FAILED_LINE } = await import("../src/lib/office-needs.core");
  const { cardOf } = await import("../src/lib/needs-cards.core");
  const { unsubscribeCleanupNeeds, retryUnsubscribeCleanups } = await import("../src/lib/unsubscribe-cleanup.server");
  seed("new_enquiry", "enquiry");
  T["jobs"]![0]!["job_number"] = "HV-7";
  broken = "office_enquiry_index";
  expect(await recordUnsubscribe(TOKEN)).toBe(true);
  expect(T["customer_email_optouts"]![0]!["opted_out_at"]).not.toBeNull(); // the opt-out itself is saved
  expect(T["jobs"]![0]!["stage"]).toBe("new_enquiry");
  const raised = T["workflow_events"]!.filter((e) => e["event_type"] === "unsubscribe_cleanup_failed");
  expect(raised).toHaveLength(1);
  expect(raised[0]!["internal"]).toBe(true);
  expect(raised[0]!["details"]?.["needs_office"]).toBe(true);
  // Needs me: one Today row on the Failed card until the clean-up has run.
  const evs = () => T["workflow_events"]!.map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: e["details"] ?? null }));
  const fact = unsubscribeCleanupFailedFact(evs());
  expect(fact).not.toBeNull();
  const rows = buildNeedsRows({ now: Date.now(), jobs: [{ jobId: "j1", jobNumber: "HV-7", surname: "Smith", suburb: null, unsubscribeCleanupFailed: fact }] });
  expect(rows.today.map((r) => [r.kind, r.line, r.button.label])).toEqual([["unsubscribe_cleanup_failed", UNSUBSCRIBE_CLEANUP_FAILED_LINE, "Open job"]]);
  expect(cardOf("unsubscribe_cleanup_failed")).toBe("failed");
  expect((await unsubscribeCleanupNeeds(db, { includeTest: false })).map((n) => [n.jobId, n.jobNumber])).toEqual([["j1", "HV-7"]]);
  // Still failing: the retry leaves the row up.
  expect(await retryUnsubscribeCleanups(db, Date.now())).toEqual({ tried: 1, cleaned: 0 });
  expect(unsubscribeCleanupFailedFact(evs())).not.toBeNull();
  // Fixed: the retry does the clean-up (Do not contact + the STOP cancel rule) and clears the row.
  broken = null;
  expect(await retryUnsubscribeCleanups(db, Date.now())).toEqual({ tried: 1, cleaned: 1 });
  expect(T["jobs"]![0]!["stage"]).toBe("cancelled");
  expect(T["jobs"]![0]!["cancelled_reason"]).toBe("Opted out (unsubscribed)");
  expect(T["workflow_events"]!.filter((e) => e["event_type"] === "owner_do_not_contact_set")).toHaveLength(1);
  expect(unsubscribeCleanupFailedFact(evs())).toBeNull();
  expect(await unsubscribeCleanupNeeds(db, { includeTest: false })).toEqual([]);
  expect(await retryUnsubscribeCleanups(db, Date.now())).toEqual({ tried: 0, cleaned: 0 });
});

test("the older Needs list shows the failed unsubscribe clean-up until it is done", async () => {
  const { mittiOfficeItems } = await import("../src/lib/ready-check-chase.core");
  const raise = { job_id: "j1", event_type: "unsubscribe_cleanup_failed", created_at: "2026-11-07T01:00:00Z", details: { needs_office: true } };
  expect(mittiOfficeItems([raise], new Date()).map((i) => i.code)).toEqual(["unsubscribe_cleanup_failed"]);
  expect(mittiOfficeItems([raise, { job_id: "j1", event_type: "unsubscribe_cleanup_done", created_at: "2026-11-07T02:00:00Z", details: {} }], new Date())).toEqual([]);
});
