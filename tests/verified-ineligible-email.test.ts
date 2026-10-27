import { beforeEach, expect, mock, test } from "bun:test";
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let on = false;
let outcome = "not_eligible";
let deliveries = 0;
let final = true;
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op = "read", value: Row = {}, ignore = false;
  const run = () => {
    const rows = tables[table] ??= [];
    const selected = rows.filter(r => filters.every(f => f(r)));
    if (op === "insert" || op === "upsert") {
      if (rows.some(r => r.idempotency_key === value.idempotency_key)) return { data: ignore ? [] : null, error: ignore ? null : { message: "duplicate" } };
      const row = { id: `row-${rows.length}`, status: "sending", ...value }; rows.push(row); return { data: [row], error: null };
    }
    if (op === "update") selected.forEach(r => Object.assign(r, value));
    return { data: selected, error: null };
  };
  const q: any = {
    select: () => q, eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    like: (k: string, v: string) => { filters.push(r => String(r[k]).startsWith(v.replace("%", ""))); return q; },
    order: () => q, limit: () => q,
    insert: (v: Row) => { op = "insert"; value = v; return q; },
    upsert: (v: Row, opts: Row) => { op = "upsert"; value = v; ignore = opts.ignoreDuplicates; return q; },
    update: (v: Row) => { op = "update"; value = v; return q; },
    maybeSingle: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
    single: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
    then: (resolve: any) => Promise.resolve(run()).then(resolve),
  }; return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/verified-eligibility.server", () => ({
  currentVerification: async () => ({ outcome, reason: "Existing insulation is R3.0", ready_check_ref: "RC", ready_check_version: 1, recorded_by: "office" }),
  gatherEvidence: async () => ({ readyCheck: { ref: "RC", version: 1, final } }),
}));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => on, assertCustomerDeliveryAllowed: async () => { if (!on) throw new Error("Customer messages are off"); } }));
mock.module("../src/lib/followups.server", () => ({
  INELIGIBLE_PURPOSE: "preliminary_ineligible", ineligibleKey: (id: string) => `preliminary_ineligible:${id}`,
  renderPreliminaryIneligibleMail: async (_id: string, reason: string | null) => ({ subject: "Not eligible", html: reason ?? "fallback", plainText: reason ?? "fallback" }),
}));
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async (p: Row) => {
  const ex = tables.customer_email_sends.find(r => r.idempotency_key === p.key);
  if (ex && ex.status !== "failed") return "already attempted";
  if (ex) ex.status = "sent";
  else tables.customer_email_sends.push({ job_id: p.jobId, purpose: p.purpose, idempotency_key: p.key, status: "sent" });
  deliveries++; return "sent";
} }));
const { sendVerifiedIneligibleEmail, retryHeldVerifiedIneligibleEmails } = await import("../src/lib/verified-ineligible-email.server");
beforeEach(() => {
  Object.keys(tables).forEach(k => delete tables[k]);
  tables.jobs = [{ id: "job", stage: "ready_check_complete", source: "website", owners: { email: "owner@example.test" } }];
  tables.customer_email_sends = []; on = false; outcome = "not_eligible"; deliveries = 0; final = true;
});
test("switch OFF records exactly one held email without sending", async () => {
  await sendVerifiedIneligibleEmail("job"); await sendVerifiedIneligibleEmail("job");
  expect(deliveries).toBe(0); expect(tables.customer_email_sends).toHaveLength(1);
  expect(tables.customer_email_sends[0].status).toBe("failed"); expect(tables.customer_email_sends[0].error).toStartWith("held:");
});
test("held email sends when ON and never duplicates on re-record or retry", async () => {
  await sendVerifiedIneligibleEmail("job"); on = true;
  await retryHeldVerifiedIneligibleEmails(); await sendVerifiedIneligibleEmail("job"); await retryHeldVerifiedIneligibleEmails();
  expect(deliveries).toBe(1); expect(tables.customer_email_sends).toHaveLength(1); expect(tables.customer_email_sends[0].status).toBe("sent");
});
test("needs_review prepares no email and sends nothing", async () => {
  on = true; outcome = "needs_review"; await sendVerifiedIneligibleEmail("job");
  expect(deliveries).toBe(0); expect(tables.customer_email_sends).toHaveLength(0);
});
test("held decision changed to needs_review never sends later", async () => {
  await sendVerifiedIneligibleEmail("job"); on = true; outcome = "needs_review"; await retryHeldVerifiedIneligibleEmails(); expect(deliveries).toBe(0);
});
test("non-final Ready Check never prepares an email", async () => {
  final = false; on = true; await sendVerifiedIneligibleEmail("job"); expect(deliveries).toBe(0); expect(tables.customer_email_sends).toHaveLength(0);
});
for (const status of ["sent", "sending", "delivered_unrecorded"]) test(`${status} T7 is never resent`, async () => {
  on = true; tables.customer_email_sends.push({ idempotency_key: "preliminary_ineligible:job", status });
  await sendVerifiedIneligibleEmail("job"); expect(deliveries).toBe(0);
});