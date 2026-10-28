import { beforeEach, expect, mock, test } from "bun:test";

const calls: unknown[][] = [];
let jobStage = "ready_check_scheduled";
let paid = false;
let payThrows = false;
let stageAfterFirstRead: string | null = null;
const logged: { type: string; opts: unknown }[] = [];
const events: string[] = [];
const rows: Record<string, unknown> = {
  customer_estimate_links: { job_id: "job-1", status: "active", expires_at: "2099-01-01" },
  bookings: [{ id: "b1", kind: "ready_check", status: "confirmed" }],
};
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  const q: any = { select() { return q; }, eq() { return q; }, in() { return q; }, is() { return q; }, order() { return q; }, limit() { return q; }, update() { return q; },
    maybeSingle() { return q; }, single() { return q; },
    then(resolve: (v: unknown) => void) { const d = table === "jobs" ? { stage: jobStage } : rows[table] ?? null; if (table === "jobs" && stageAfterFirstRead) { jobStage = stageAfterFirstRead; stageAfterFirstRead = null; } return resolve({ data: d, error: null }); } };
  return q;
} } }));
mock.module("../src/lib/office-actions.server", () => ({ cancelJobFully: async (...a: unknown[]) => { calls.push(a); jobStage = "cancelled"; } }));
mock.module("../src/lib/payments.server", () => ({ jobPaymentView: async () => { if (payThrows) throw new Error("boom"); return { steps: [{ key: "safety_check", state: paid ? "paid" : "not_yet" }] }; } }));
mock.module("../src/lib/mitti-pickup.server", () => ({ releaseReadyCheckFormOnCancel: async () => { events.push("mitti"); } }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, type: string, _s: string, _d: unknown, opts: unknown) => { logged.push({ type, opts }); } }));
const { ownerCanCancel } = await import("../src/lib/owner-myjob.core");
const { cancelOwnerJob } = await import("../src/lib/owner-myjob.server");
const token = "a".repeat(64);

beforeEach(() => { payThrows = false; stageAfterFirstRead = null; logged.length = 0; calls.length = 0; events.length = 0; jobStage = "ready_check_scheduled"; paid = false; });

test("ownerCanCancel is false once the safety check is paid", () => {
  expect(ownerCanCancel("measured_quote_accepted", [], true)).toBe(false);
  expect(ownerCanCancel("measured_quote_accepted", [], false)).toBe(true);
  expect(ownerCanCancel("ready_check_scheduled", ["ready_check"], false)).toBe(true);
});

test("cancelOwnerJob does the full clean-up once, and a double cancel does nothing more", async () => {
  expect(await cancelOwnerJob(token)).toEqual({ ok: true });
  expect(calls).toEqual([["job-1", "Owner cancelled from My job", null, { tell: { owner: false, installer: true } }]]);
  expect(events).toEqual(["mitti"]);
  expect(await cancelOwnerJob(token)).toEqual({ ok: true });
  expect(calls).toHaveLength(1);
});

test("cancelOwnerJob refuses with the existing wording when the safety check is paid", async () => {
  paid = true;
  const r = await cancelOwnerJob(token);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("Your Pre Insulation Electrical Safety Assessment (PIESA) is booked, so this can't be cancelled here. Reply to any of our emails and we'll help.");
  expect(calls).toHaveLength(0);
});

test("cancelOwnerJob refuses and cancels nothing when the payment check fails", async () => {
  payThrows = true;
  const origErr = console.error; console.error = () => undefined;
  const r = await cancelOwnerJob(token);
  console.error = origErr;
  expect(r.ok).toBe(false);
  expect(calls).toHaveLength(0);
});

test("one cancel records the stage move once (cancelJobFully owns it; the owner note carries no from/to)", async () => {
  await cancelOwnerJob(token);
  const note = logged.find((e) => e.type === "owner_cancelled_job");
  expect(note).toBeTruthy();
  expect(logged.filter((e) => { const o = (e.opts ?? {}) as { from?: unknown; to?: unknown }; return o.from !== undefined || o.to !== undefined; })).toHaveLength(0);
});

test("a stage that moves past cancellable just before the clean-up is refused with the 'just changed' message", async () => {
  stageAfterFirstRead = "piesa_scheduled";
  const r = await cancelOwnerJob(token);
  expect(r).toEqual({ ok: false, reason: "Your job has just changed. Refresh the page and try again." });
  expect(calls).toHaveLength(0);
});
