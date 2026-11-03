// Decision 330 (Jo, 25 Oct 2026): after the A4 electrical fixes the owner confirms the FIXES on the secure link (one tick +
// typed name, no code): pure rules, the server facts/sign path. Part 4 Task 14 (Jo 2 Nov 2026): the request email O72, the
// `piesa_owner_fixes_confirm` text, the day 1/3 reminders and the P6F page are retired; the record and its readers stay
// (official form, Needs me history). Every sender is a recorder; nothing is sent anywhere.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const J = "00000000-0000-0000-0000-00000000000a", T = "00000000-0000-0000-0000-00000000000b", OWNER = "00000000-0000-0000-0000-0000000000c1", TOWNER = "00000000-0000-0000-0000-0000000000c2";
const POST = "00000000-0000-0000-0000-0000000000e9", TPOST = "00000000-0000-0000-0000-0000000000ea", ELEC = "00000000-0000-0000-0000-0000000000f1", BIZ = "00000000-0000-0000-0000-0000000000f2";
const LINK = "https://estimate.homeinsulationvictoria.com.au/my-job/tok-real";
const T0 = "2026-11-03T01:00:00Z";
let tables: Record<string, Row[]> = {};
let seq = 0;
function reset() {
  seq = 0;
  tables = {
    jobs: [
      { id: J, owner_id: OWNER, source: "website", job_number: "HV-3117", stage: "installation_scheduling", deleted_at: null },
      { id: T, owner_id: TOWNER, source: "qa_test", job_number: "HV-9001", stage: "installation_scheduling", deleted_at: null },
    ],
    owners: [{ id: OWNER, full_name: "Robert Ellis", email: "robert@example.com", phone: "0400111222" }, { id: TOWNER, full_name: "Jo Test", email: "jo@example.com", phone: "0400999888" }],
    piesa_records: [
      { id: "initial-1", job_id: J, kind: "initial", outcome: "fail", completed_date: "2026-10-28", created_at: "2026-10-28T03:00:00Z", signed_off_by: ELEC },
      { id: POST, job_id: J, kind: "post_rectification", outcome: "pass", completed_date: "2026-11-03", created_at: T0, signed_off_by: ELEC },
      { id: TPOST, job_id: T, kind: "post_rectification", outcome: "pass", completed_date: "2026-11-03", created_at: T0, signed_off_by: ELEC },
    ],
    job_assignments: [
      { job_id: J, role: "electrician", active: true, user_id: ELEC }, { job_id: T, role: "electrician", active: true, user_id: ELEC },
      { job_id: J, role: "installer", active: true, businesses: { onboarding_notes: null } }, { job_id: T, role: "installer", active: true, businesses: { onboarding_notes: "[TEST PARTNER]" } },
    ],
    profiles: [{ id: ELEC, full_name: "Sam Spark", business_id: BIZ }],
    businesses: [{ id: BIZ, name: "Spark Electrical", legal_name: "Spark Electrical Pty Ltd" }],
    workflow_events: [],
  };
}
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async (jobId: string) => (jobId === J ? LINK : jobId === T ? "https://estimate.homeinsulationvictoria.com.au/my-job/tok-test" : null) }));
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
    order: (c: string, o?: { ascending?: boolean }) => { orderCol = c; desc = o?.ascending === false; return b; }, limit: (n: number) => { lim = n; return b; }, range: (_from: number, to: number) => { lim = to + 1; return b; }, // batched sweep reads page from 0
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


const S = await import("../src/lib/piesa-fixes-confirm.server");
const C = await import("../src/lib/piesa-fixes-confirm.core");
const { SMS_MESSAGE_TYPES } = await import("../src/lib/sms.core");
const { needsCandidates } = await import("../src/lib/office-needs.core");
const events = (type: string, job = J) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type && e["job_id"] === job);
const signRobert = (job = J) => S.signOwnerFixesConfirmation({ jobId: job, fullName: "Robert Ellis", signatureName: "Robert Ellis", authority: "owner", confirmed: true, ip: "1.2.3.4", userAgent: "Safari" });

beforeEach(() => { reset(); guarded.length = 0; tests.length = 0; sms.length = 0; deliveryBlocked = null; });

describe("pure rules + approved wording", () => {
  test("retired 2 Nov 2026: the text type can never send again", () => {
    expect(SMS_MESSAGE_TYPES[C.PIESA_FIXES_CONFIRM_SMS_TYPE]).toMatchObject({ audience: "owner", wordingApproved: false, quietHours: true });
  });
  test("page: one tick 'The electrical fixes were completed on <date>' standing for the official declaration", () => {
    const p = C.piesaFixesConfirmPage({ recordId: POST, fixesDate: "2026-11-03", completedAt: T0, electrician: { name: "Sam Spark", recName: null }, confirmation: null });
    expect(p).toEqual({ fixesDate: "3 November 2026", electricianLine: "Sam Spark", tick: "The electrical fixes were completed on 3 November 2026", declaration: "I confirm that any electrical rectification works were completed on the above date.", confirmed: null });
  });
  test("validation: tick + full name + matching typed signature", () => {
    expect(C.validateOwnerFixesConfirmation({ fullName: "Robert Ellis", confirmed: true, signatureName: "robert ellis", authority: "owner" })).toEqual([]);
    expect(C.validateOwnerFixesConfirmation({ fullName: "Robert", confirmed: false, signatureName: "X", authority: "owner" })).toHaveLength(3);
  });
  test("only a confirmation of THIS fixes record counts; keys name the record", () => {
    const d = (rec: string, at: string) => ({ details: { piesa_record_id: rec, name: "A B", signed_at: at } });
    expect(C.fixesConfirmationFromEvents([d("other", "2026-11-04T00:00:00Z")], POST)).toBeNull();
    expect(C.fixesConfirmationFromEvents([d(POST, "2026-11-04T00:00:00Z"), d(POST, "2026-11-05T00:00:00Z")], POST)!.signedAt).toBe("2026-11-05T00:00:00Z");
    expect(C.piesaFixesConfirmKey(J, POST, "reminder_1")).toBe(`piesa-owner-fixes-confirm:v1:${J}:${POST}:reminder_1`);
  });
  test("Needs me row on day 5", () => {
    const rows = needsCandidates({ jobId: "1", jobNumber: "HV-1", surname: "Ellis", suburb: "Frankston", fixesOwnerUnsigned: { at: "2026-11-08T01:00:00Z", fixesDate: "2026-11-03" } } as never, 0);
    expect(rows.map((r: { kind: string }) => r.kind)).toContain("piesa_fixes_owner_unsigned");
    expect(rows.find((r: { kind: string; line: string }) => r.kind === "piesa_fixes_owner_unsigned")!.line).toContain("Owner hasn't confirmed the electrical fixes");
  });
});

describe("server: facts + sign", () => {
  test("facts = the latest post_rectification record; none = nothing to confirm", async () => {
    expect(await S.ownerFixesConfirmFacts(J)).toMatchObject({ recordId: POST, fixesDate: "2026-11-03", completedAt: T0, electrician: { name: "Sam Spark", recName: "Spark Electrical Pty Ltd" }, confirmation: null });
    tables["piesa_records"] = tables["piesa_records"]!.filter((r) => r["kind"] === "initial");
    expect(await S.ownerFixesConfirmFacts(J)).toBeNull();
    await expect(signRobert()).rejects.toThrow("no electrical fixes to confirm");
  });
  test("signs once (hashes, no raw IP/UA), idempotent, and feeds the official form", async () => {
    const r = await signRobert();
    expect(r.already).toBe(false);
    const ev = events(C.PIESA_FIXES_CONFIRMED_EVENT);
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toMatchObject({ version: "piesa-fixes-confirm-v1", piesa_record_id: POST, fixes_date: "2026-11-03", name: "Robert Ellis", authority: "owner" });
    expect(JSON.stringify(ev[0]!["details"])).not.toContain("1.2.3.4");
    expect((await signRobert()).already).toBe(true);
    expect(events(C.PIESA_FIXES_CONFIRMED_EVENT)).toHaveLength(1);
    expect(await S.ownerFixesConfirmationForExpand(J)).toEqual({ name: "Robert Ellis", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });
});
