// Task 5 (recovery paths): the signed-copy email retries after a definite failure, never logs "sent" when the date
// did not save, and repairs from the send record without resending.
import { beforeEach, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
const J = "job-1", ASG = "asg-1", FINAL = "jobs/J/final.pdf", KEY = `veec-copy:v1:${ASG}`;
let tables: Record<string, Row[]> = {};
let failCopyUpdate = false;
let failSendsRead = false;

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" = "select", patch: Row = {}, maybe = false;
  const run = () => {
    const rows = (tables[table] ??= []);
    if (op === "update") {
      if (table === "customer_assignments" && failCopyUpdate) return { data: null, error: { message: "update failed" } };
      for (const r of rows) if (filters.every((f) => f(r))) Object.assign(r, patch);
      return { data: null, error: null };
    }
    if (table === "customer_email_sends" && failSendsRead) return { data: null, error: { message: "read failed" } };
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    return { data: maybe ? hit[0] ?? null : hit, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b, update: (p: Row) => { op = "update"; patch = p; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    maybeSingle: () => { maybe = true; return b; }, limit: () => b,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
  };
  return b;
}
const admin = { from: builder, storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }) }) } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job: string, _a: unknown, type: string, summary: string, details?: unknown) => { (tables["workflow_events"] ??= []).push({ job_id: job, event_type: type, summary, details: details ?? {} }); },
}));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
const work: unknown[][] = []; const done: unknown[][] = [];
mock.module("../src/lib/recovery-work.server", () => ({
  addWork: async (...a: unknown[]) => { work.push(a); return "added"; },
  markDone: async (...a: unknown[]) => { done.push(a); },
  workStatus: async () => null,
}));
const sends: { key: string; retryAfterDefiniteFailure?: boolean }[] = [];
let sendResults: string[] = [];
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { key: string; retryAfterDefiniteFailure?: boolean }) => { sends.push({ key: p.key, retryAfterDefiniteFailure: p.retryAfterDefiniteFailure }); return sendResults.shift() ?? "sent"; },
}));

const { sendVeecCopyEmail, repairVeecCopyEmail } = await import("../src/lib/veec-copy-email.server");
const events = () => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === "veec_copy_email_sent");

beforeEach(() => {
  failCopyUpdate = false; failSendsRead = false; sends.length = 0; work.length = 0; done.length = 0; sendResults = [];
  tables = {
    customer_assignments: [{ id: ASG, job_id: J, record_kind: "final_veec_assignment", status: "effective_complete", consumer_signed_at: "2026-11-21T03:00:00Z", copy_sent_at: null, final_copy_path: FINAL }],
    jobs: [{ id: J, job_number: "HV-1", owner_id: "o", source: "website" }],
    owners: [{ id: "o", full_name: "Helen Yang", email: "helen@example.com" }],
    job_assignments: [], customer_estimate_links: [{ job_id: J, purpose: "step3_estimate", status: "active", token: "tok", expires_at: "2099-01-01T00:00:00Z" }],
    workflow_events: [], customer_email_sends: [],
  };
});

test("rejected_then_retried: asks the guarded sender to retry after a definite failure; the date is set only when it goes", async () => {
  sendResults = ["failed: rejected", "sent"];
  expect(await sendVeecCopyEmail(J)).toBe("failed: rejected");
  expect(tables["customer_assignments"]![0]!["copy_sent_at"]).toBeNull();
  expect(events()).toHaveLength(0);
  expect(await sendVeecCopyEmail(J)).toBe("sent");
  expect(sends).toEqual([{ key: KEY, retryAfterDefiniteFailure: true }, { key: KEY, retryAfterDefiniteFailure: true }]);
  expect(tables["customer_assignments"]![0]!["copy_sent_at"]).not.toBeNull();
  expect(events()).toHaveLength(1);
});

test("date_save_fails_no_event: no 'sent' event, and the job goes on the still-to-finish list", async () => {
  failCopyUpdate = true;
  expect(await sendVeecCopyEmail(J)).toBe("sent");
  expect(events()).toHaveLength(0);
  expect(work).toEqual([["veec_copy_email", ASG, J, {}]]);
});

test("repair_sets_date_without_send: a sent record sets the date from sent_at, logs once, marks done, sends nothing", async () => {
  tables["customer_email_sends"] = [{ idempotency_key: KEY, status: "sent", sent_at: "2026-11-22T01:00:00Z" }];
  expect(await repairVeecCopyEmail(J)).toBe("repaired");
  expect(tables["customer_assignments"]![0]!["copy_sent_at"]).toBe("2026-11-22T01:00:00Z");
  expect(events()).toHaveLength(1);
  expect(done).toEqual([["veec_copy_email", ASG]]);
  expect(sends).toHaveLength(0);
  tables["customer_assignments"]![0]!["copy_sent_at"] = null; // date lost again: still one event
  expect(await repairVeecCopyEmail(J)).toBe("repaired");
  expect(events()).toHaveLength(1);
});

test("unclear_flags_office_no_send: sending / delivered_unrecorded go to the office and nothing is sent", async () => {
  for (const status of ["sending", "delivered_unrecorded"]) {
    work.length = 0;
    tables["customer_email_sends"] = [{ idempotency_key: KEY, status, sent_at: null }];
    expect(await repairVeecCopyEmail(J)).toBe("needs_office");
    expect(work).toEqual([["veec_copy_email", ASG, J, {}, { status: "needs_office", lastError: "uncertain" }]]);
  }
  expect(sends).toHaveLength(0);
});

test("repair: failed record or no record sends again; already sent is left; a read error throws", async () => {
  tables["customer_email_sends"] = [{ idempotency_key: KEY, status: "failed", sent_at: null }];
  expect(await repairVeecCopyEmail(J)).toBe("sent");
  tables["customer_assignments"]![0]!["copy_sent_at"] = null; tables["customer_email_sends"] = [];
  expect(await repairVeecCopyEmail(J)).toBe("sent");
  expect(sends).toHaveLength(2);
  expect(await repairVeecCopyEmail(J)).toBe("already sent");
  tables["customer_assignments"]![0]!["copy_sent_at"] = null; failSendsRead = true;
  await expect(repairVeecCopyEmail(J)).rejects.toThrow("read failed");
});
