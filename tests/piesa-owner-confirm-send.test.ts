// Decision 296 (Jo, 25 Oct 2026): owner confirms the PIESA by secure link — the server path (facts, sign, gate, official
// form context) and the request/reminder/office-alert sweep, run against an in-memory database. Every sender (test-send,
// guarded owner email, real SMS) is a recorder, so nothing is sent anywhere. Style: tests/veec-emails-send.test.ts.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const J = "00000000-0000-0000-0000-00000000000a", T = "00000000-0000-0000-0000-00000000000b", OWNER = "00000000-0000-0000-0000-0000000000c1", TOWNER = "00000000-0000-0000-0000-0000000000c2";
const REC = "00000000-0000-0000-0000-0000000000e1", TREC = "00000000-0000-0000-0000-0000000000e2", ELEC = "00000000-0000-0000-0000-0000000000f1", BIZ = "00000000-0000-0000-0000-0000000000f2";
const LINK = "https://estimate.homeinsulationvictoria.com.au/my-job/tok-real";
const T0 = "2026-10-24T03:30:00Z";
let tables: Record<string, Row[]> = {};
let seq = 0;
function reset() {
  seq = 0;
  tables = {
    jobs: [
      { id: J, owner_id: OWNER, source: "website", job_number: "HV-3117", stage: "installation_scheduling", deleted_at: null },
      { id: T, owner_id: TOWNER, source: "qa_test", job_number: "HV-9001", stage: "installation_scheduling", deleted_at: null },
    ],
    owners: [{ id: OWNER, full_name: "Helen Yang", email: "helen@example.com", phone: "0400111222" }, { id: TOWNER, full_name: "Jo Test", email: "jo@example.com", phone: "0400999888" }],
    piesa_records: [
      { id: REC, job_id: J, kind: "initial", outcome: "pass", completed_date: "2026-10-24", created_at: T0, signed_off_by: ELEC, is_current: true },
      { id: TREC, job_id: T, kind: "initial", outcome: "pass", completed_date: "2026-10-24", created_at: T0, signed_off_by: ELEC, is_current: true },
    ],
    rectification_items: [],
    assessments: [{ job_id: J, mitti_raw_snapshot: [{ label: "Is any electrical repair work needed before insulation can be installed?", value: "No" }] }],
    job_assignments: [
      { job_id: J, role: "electrician", active: true, user_id: ELEC }, { job_id: T, role: "electrician", active: true, user_id: ELEC },
      { job_id: J, role: "installer", active: true, businesses: { onboarding_notes: null } }, { job_id: T, role: "installer", active: true, businesses: { onboarding_notes: "[TEST PARTNER]" } },
    ],
    profiles: [{ id: ELEC, full_name: "Sam Spark", business_id: BIZ }],
    businesses: [{ id: BIZ, name: "Spark Electrical", legal_name: "Spark Electrical Pty Ltd" }],
    official_form_signed_copies: [{ id: "copy-1", job_id: J, form_key: "piesa", status: "current", snapshot_sha256: "sha-1" }],
    customer_estimate_links: [{ job_id: J, purpose: "step3_estimate", status: "active", token: "tok-real", expires_at: "2099-01-01T00:00:00Z" }, { job_id: T, purpose: "step3_estimate", status: "active", token: "tok-test", expires_at: "2099-01-01T00:00:00Z" }],
    workflow_events: [],
  };
}
const inList = (v: unknown, list: string) => list.replace(/^\(|\)$/g, "").split(",").includes(String(v));
const containsObj = (row: unknown, want: Row) => !!row && typeof row === "object" && Object.entries(want).every(([k, v]) => (row as Row)[k] === v);
function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" = "select", patch: Row = {}, orderCol: string | null = null, desc = false, lim = Infinity, mode: "many" | "maybe" | "one" = "many", head = false, count = false;
  const rows = () => (tables[table] ??= []);
  const run = () => {
    if (op === "insert") { const row = { id: `${table}-${++seq}`, created_at: new Date().toISOString(), ...patch }; rows().push(row); return { data: mode === "many" ? [row] : row, error: null }; }
    let out = rows().filter((r) => filters.every((f) => f(r)));
    if (orderCol) out = [...out].sort((a, b) => (String(a[orderCol!]) < String(b[orderCol!]) ? -1 : 1) * (desc ? -1 : 1));
    out = out.slice(0, lim);
    if (count || head) return { data: null, count: out.length, error: null };
    return { data: mode === "many" ? out : out[0] ?? null, error: null };
  };
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { head = !!o?.head; count = o?.count === "exact"; return b; },
    insert: (p: Row) => { op = "insert"; patch = p; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; }, neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
    not: (c: string, o?: string, v?: unknown) => { filters.push((r) => (o === "in" ? !inList(r[c], String(v)) : r[c] != null)); return b; },
    contains: (c: string, v: Row) => { filters.push((r) => containsObj(r[c], v)); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { orderCol = c; desc = o?.ascending === false; return b; }, limit: (n: number) => { lim = n; return b; },
    maybeSingle: () => { mode = "maybe"; return b; }, single: () => { mode = "one"; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: builder } }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { (tables["workflow_events"] ??= []).push({ id: `ev-${++seq}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, created_at: new Date().toISOString() }); },
}));
mock.module("../src/lib/official-forms.server", () => ({
  currentCopy: async (jobId: string, key: string) => { const c = (tables["official_form_signed_copies"] ?? []).find((r) => r["job_id"] === jobId && r["form_key"] === key && r["status"] === "current"); return { copy: c ? { id: c["id"], status: "current", signatureDate: "2026-10-24", snapshot: {} } : null, unavailable: false }; },
}));
type Mail = { subject: string; html: string; text: string };
const guarded: { purpose: string; key: string; to: string; mail: Mail }[] = [];
const tests: { kind: "email" | "sms"; to: string; label: string; subject?: string; body: string }[] = [];
const sms: { type: string; idempotencyKey: string; to: string | null; body: string; jobId: string }[] = [];
let deliveryBlocked: string | null = null;
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { jobId: string; to: string; purpose: string; key: string; build: (u: string | null) => Mail }) => { if (guarded.some((g) => g.key === p.key)) return "already attempted — not resent"; guarded.push({ purpose: p.purpose, key: p.key, to: p.to, mail: p.build("https://u/x") }); return "sent"; },
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (ctx: { label: string }, to: string, subject: string, html: string) => { tests.push({ kind: "email", to, label: ctx.label, subject, body: html }); return { channel: "email", to, status: "sent", detail: "Resend accepted (test)" }; },
  sendTestSms: async (ctx: { label: string }, to: string, body: string) => { tests.push({ kind: "sms", to, label: ctx.label, body }); return { channel: "sms", to, status: "sent", detail: "Twilio accepted (test)" }; },
}));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string; to: string | null; body: string; jobId: string }) => { sms.push(p); return { status: "blocked", detail: "Wording not approved yet" }; } }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => { if (deliveryBlocked) throw new Error(deliveryBlocked); } }));

const S = await import("../src/lib/piesa-owner-confirm.server");
const { sendPiesaConfirmStep, sweepOwnerPiesaConfirmations, PIESA_CONFIRM_ACTIVE_STAGES } = await import("../src/lib/piesa-owner-confirm-send.server");
const { OWNER_PIESA_CONFIRMATION_BLOCKER, PIESA_OWNER_CONFIRMED_EVENT, PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT, PIESA_OWNER_CONFIRM_STEP_EVENT } = await import("../src/lib/piesa-owner-confirm.core");
const events = (type: string, job = J) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type && e["job_id"] === job);
const signHelen = (job = J) => S.signOwnerPiesaConfirmation({ jobId: job, userId: "user-1", codeId: "code-1", fullName: "Helen Yang", signatureName: "Helen Yang", authority: "owner", confirmed: true, ip: "1.2.3.4", userAgent: "Safari" });

beforeEach(() => { reset(); guarded.length = 0; tests.length = 0; sms.length = 0; deliveryBlocked = null; });

describe("facts + gate", () => {
  test("facts: the latest initial PIESA record, the electrician + REC, the current signed copy and no confirmation yet", async () => {
    const f = await S.ownerPiesaConfirmFacts(J);
    expect(f).toMatchObject({ piesaRecordId: REC, completedDate: "2026-10-24", completedAt: T0, outcome: "pass", rectificationRequired: false, electricianOnInstallDay: false, electrician: { name: "Sam Spark", recName: "Spark Electrical Pty Ltd" }, signedCopy: { id: "copy-1", sha: "sha-1" }, confirmation: null });
    expect(await S.ownerPiesaConfirmationBlockerFor(J)).toBe(OWNER_PIESA_CONFIRMATION_BLOCKER);
    expect(await S.ownerConfirmationForExpand(J)).toBeNull();
  });
  test("no PIESA record (or one not yet signed off) = nothing to confirm, no blocker", async () => {
    tables["piesa_records"] = [];
    expect(await S.ownerPiesaConfirmFacts(J)).toBeNull();
    expect(await S.ownerPiesaConfirmationBlockerFor(J)).toBeNull();
    tables["piesa_records"] = [{ id: REC, job_id: J, kind: "initial", outcome: "pass", completed_date: "2026-10-24", created_at: T0, signed_off_by: null, is_current: true }];
    expect(await S.ownerPiesaConfirmFacts(J)).toBeNull();
  });
  test("outcome facts: open repair items = repair needed; the three-way Mitti answer = electrician on install day", async () => {
    tables["rectification_items"] = [{ job_id: J, status: "required" }];
    expect((await S.ownerPiesaConfirmFacts(J))!.rectificationRequired).toBe(true);
    tables["rectification_items"] = [{ job_id: J, status: "removed" }];
    expect((await S.ownerPiesaConfirmFacts(J))!.rectificationRequired).toBe(false);
    tables["assessments"] = [{ job_id: J, mitti_raw_snapshot: [{ label: "Is any electrical repair work needed before insulation can be installed?", value: "Yes" }, { label: "Can the repair work be done before installation?", value: "No" }] }];
    expect((await S.ownerPiesaConfirmFacts(J))!.electricianOnInstallDay).toBe(true);
  });
  test("the owner signs once: event with name/time/session/hashes/copy; idempotent; the gate opens; the official form gets name + date", async () => {
    const r = await signHelen();
    expect(r.already).toBe(false);
    const ev = events(PIESA_OWNER_CONFIRMED_EVENT);
    expect(ev).toHaveLength(1);
    expect(ev[0]!["actor_id"]).toBe("user-1");
    expect(ev[0]!["details"]).toMatchObject({ version: "piesa-owner-confirm-v1", piesa_record_id: REC, completed_date: "2026-10-24", signed_copy_id: "copy-1", snapshot_sha256: "sha-1", name: "Helen Yang", authority: "owner", signed_at: r.signedAt, link_code_id: "code-1" });
    const d = ev[0]!["details"] as Row;
    expect(String(d["ip_hash"])).toMatch(/^[0-9a-f]{64}$/); expect(String(d["ua_hash"])).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(d)).not.toContain("1.2.3.4"); expect(JSON.stringify(d)).not.toContain("Safari");
    expect(await signHelen()).toMatchObject({ ok: true, already: true, signedAt: r.signedAt });
    expect(events(PIESA_OWNER_CONFIRMED_EVENT)).toHaveLength(1);
    expect(await S.ownerPiesaConfirmationBlockerFor(J)).toBeNull();
    expect(await S.ownerConfirmationForExpand(J)).toEqual({ name: "Helen Yang", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });
  test("validation refuses an unticked or half-named confirmation and writes nothing", async () => {
    await expect(S.signOwnerPiesaConfirmation({ jobId: J, userId: "u", codeId: "c", fullName: "Helen Yang", signatureName: "Helen Yang", authority: "owner", confirmed: false, ip: null, userAgent: null })).rejects.toThrow("Tick to confirm");
    await expect(S.signOwnerPiesaConfirmation({ jobId: J, userId: "u", codeId: "c", fullName: "Helen", signatureName: "Helen", authority: "owner", confirmed: true, ip: null, userAgent: null })).rejects.toThrow("full name");
    tables["piesa_records"] = [];
    await expect(signHelen()).rejects.toThrow("no electrical safety check to confirm yet");
    expect(events(PIESA_OWNER_CONFIRMED_EVENT)).toEqual([]);
  });
  test("a re-done PIESA (new initial record) needs a new confirmation; the old one stays as history", async () => {
    await signHelen();
    tables["piesa_records"]!.push({ id: "rec-new", job_id: J, kind: "initial", outcome: "pass", completed_date: "2026-11-30", created_at: "2026-11-30T03:00:00Z", signed_off_by: ELEC, is_current: true });
    const f = await S.ownerPiesaConfirmFacts(J);
    expect(f!.piesaRecordId).toBe("rec-new"); expect(f!.confirmation).toBeNull();
    expect(await S.ownerPiesaConfirmationBlockerFor(J)).toBe(OWNER_PIESA_CONFIRMATION_BLOCKER);
    expect(events(PIESA_OWNER_CONFIRMED_EVENT)).toHaveLength(1);
  });
});

describe("request + reminders (email O71 + text), recorded once per PIESA before any send", () => {
  test("real job (decision 311 approved): step recorded; email goes ONLY through the guarded owner sender (customer_comms_enabled lives there); the text goes to the one real sender", async () => {
    const r = await sendPiesaConfirmStep(J, "request");
    expect(r).toBe("email sent; sms blocked: Wording not approved yet");
    expect(guarded).toHaveLength(1);
    expect(sms).toEqual([{ type: "piesa_owner_confirm", idempotencyKey: `piesa-owner-confirm:v1:${J}:${REC}:request`, to: "0400111222", body: expect.stringContaining(LINK), jobId: J }]);
    expect(sms[0]!.body).toStartWith("Your electrical safety check is done.");
    const ev = events(PIESA_OWNER_CONFIRM_STEP_EVENT);
    expect(ev).toHaveLength(1); expect(ev[0]!["details"]).toEqual({ step: "request", piesa_record_id: REC });
    expect(tests).toEqual([]);
  });
  test("a step never repeats; reminders use the reminder text", async () => {
    await sendPiesaConfirmStep(J, "request");
    expect(await sendPiesaConfirmStep(J, "request")).toBe("already handled");
    await sendPiesaConfirmStep(J, "reminder_1");
    expect(sms).toHaveLength(2); expect(sms[1]!.body).toStartWith("Your install can't be booked until you confirm");
    expect(sms[1]!.idempotencyKey).toBe(`piesa-owner-confirm:v1:${J}:${REC}:reminder_1`);
    expect(events(PIESA_OWNER_CONFIRM_STEP_EVENT).map((e) => (e["details"] as Row)["step"])).toEqual(["request", "reminder_1"]);
  });
  test("once confirmed nothing more goes out", async () => {
    await signHelen();
    expect(await sendPiesaConfirmStep(J, "request")).toBe("already confirmed");
    expect(sms).toEqual([]); expect(events(PIESA_OWNER_CONFIRM_STEP_EVENT)).toEqual([]);
  });
  test("TEST job: email + text through test-send only, nothing on the real senders", async () => {
    const r = await sendPiesaConfirmStep(T, "request");
    expect(r).toBe("email sent: Resend accepted (test); sms sent: Twilio accepted (test)");
    expect(tests.map((t) => [t.kind, t.to, t.label])).toEqual([["email", "jo@example.com", "piesa_owner_confirm:request"], ["sms", "0400999888", "piesa_owner_confirm:request"]]);
    expect(tests[0]!.subject).toBe("Jo, please confirm your electrical safety check");
    expect(tests[0]!.body).toContain("TEST — only sent to Jo"); expect(tests[0]!.body).toContain("tok-test"); expect(tests[0]!.body).toContain("Sam Spark (Spark Electrical Pty Ltd)");
    expect(guarded).toEqual([]); expect(sms).toEqual([]);
  });
  test("no working owner link: recorded as not sent, nothing goes out", async () => {
    tables["customer_estimate_links"] = [];
    expect(await sendPiesaConfirmStep(J, "request")).toBe("not sent — owner link missing");
    expect(events("piesa_owner_confirm_not_sent")).toHaveLength(1); expect(sms).toEqual([]);
  });
  test("day-5 office alert: one event per PIESA record, never twice", async () => {
    expect(await sendPiesaConfirmStep(J, "office_alert_5")).toBe("office alerted");
    expect(await sendPiesaConfirmStep(J, "office_alert_5")).toBe("already alerted");
    const alerts = events(PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!["details"]).toEqual({ step: "office_alert_5", piesa_record_id: REC, completed_date: "2026-10-24" });
    expect(String(alerts[0]!["summary"])).toContain("Needs Home Insulation Victoria");
    expect(sms).toEqual([]);
  });
  test("sweep: one due step per unconfirmed job, in order over the days; confirmed and booked jobs are skipped", async () => {
    const day = (n: number) => new Date(Date.parse(T0) + n * 86400_000 + 60_000);
    expect([...PIESA_CONFIRM_ACTIVE_STAGES]).toEqual(["piesa_complete", "electrical_variation_pending", "awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling"]);
    expect(await sweepOwnerPiesaConfirmations(day(0))).toEqual({ checked: 2, sent: 2, alerts: 0 }); // request to both jobs
    expect(await sweepOwnerPiesaConfirmations(day(0))).toEqual({ checked: 2, sent: 0, alerts: 0 });
    await signHelen(T);
    expect(await sweepOwnerPiesaConfirmations(day(1))).toEqual({ checked: 2, sent: 1, alerts: 0 }); // reminder_1 to the real job only
    expect(await sweepOwnerPiesaConfirmations(day(3))).toEqual({ checked: 2, sent: 1, alerts: 0 });
    expect(await sweepOwnerPiesaConfirmations(day(5))).toEqual({ checked: 2, sent: 0, alerts: 1 });
    expect(await sweepOwnerPiesaConfirmations(day(9))).toEqual({ checked: 2, sent: 0, alerts: 0 });
    expect(events(PIESA_OWNER_CONFIRM_STEP_EVENT).map((e) => (e["details"] as Row)["step"])).toEqual(["request", "reminder_1", "reminder_3", "office_alert_5"]);
    expect(events(PIESA_OWNER_CONFIRM_STEP_EVENT, T).map((e) => (e["details"] as Row)["step"])).toEqual(["request"]);
    tables["jobs"]![0]!["stage"] = "installation_booked";
    expect(await sweepOwnerPiesaConfirmations(day(10))).toEqual({ checked: 1, sent: 0, alerts: 0 });
  });
});
