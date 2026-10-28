// Jo 28 Oct 2026 spec against an in-memory fake database, a fake Mitti client and fake senders (no network, nothing live):
// Lead-only invites with the business-email fallback, Lead → Crew deactivation, the role switch (permission + one
// admin_config_events row) and the crew reminder sweep (TEST path once per job + date; real installers nothing yet).
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  let rows = [...(tables[t] ?? [])];
  let op: "select" | "insert" | "update" = "select"; let patch: Row = {}; let head = false;
  const q: Record<string, unknown> = {};
  const apply = () => { if (op === "update") for (const r of tables[t] ?? []) if (rows.includes(r)) Object.assign(r, patch); };
  Object.assign(q, {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] !== v); return q; },
    gte: (k: string, v: string) => { rows = rows.filter((r) => String(r[k]) >= v); return q; },
    lte: (k: string, v: string) => { rows = rows.filter((r) => String(r[k]) <= v); return q; },
    is: (k: string, v: unknown) => { rows = rows.filter((r) => (r[k] ?? null) === v); return q; },
    ilike: (k: string, v: string) => { rows = rows.filter((r) => String(r[k] ?? "").toLowerCase() === v.toLowerCase()); return q; },
    in: (k: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[k])); return q; },
    or: () => q, order: () => q, limit: () => q,
    contains: (k: string, v: Row) => { rows = rows.filter((r) => Object.entries(v).every(([kk, vv]) => (r[k] as Row | undefined)?.[kk] === vv)); return q; },
    update: (p: Row) => { op = "update"; patch = p; return q; },
    insert: (r: Row) => { op = "insert"; (tables[t] ??= []).push({ created_at: new Date(Date.now() + (tables[t]?.length ?? 0)).toISOString(), ...r }); return q; },
    maybeSingle: async () => { apply(); return { data: op === "select" ? rows[0] ?? null : null, error: null }; },
    single: async () => { apply(); return { data: rows[0] ?? null, error: null }; },
    then: (res: (v: unknown) => unknown) => { apply(); return res({ data: op === "insert" ? null : rows, count: rows.length, error: null, ...(head ? { data: null } : {}) }); },
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
const sent: { via: string; to: string; subject?: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({ TEST_APP_BASE: "https://test", sendTestEmail: async (_c: unknown, to: string, subject: string) => { sent.push({ via: "test", to, subject }); return { status: "sent", detail: "fake" }; } }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string }) => { sent.push({ via: "real", to: p.to, subject: p.subject }); return { status: "blocked", detail: "fake" }; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async () => ({ status: "blocked", detail: "fake" }) }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  logEvent: async (job_id: string, actor_id: string | null, event_type: string, summary: string, details: Row) => { (tables["workflow_events"] ??= []).push({ job_id, actor_id, event_type, summary, details }); },
  requireAdmin: async () => {},
}));
let isAdmin = false; let memberRole: string | null = null;
mock.module("../src/lib/worker-links.server", () => ({ WORKER_COLS: "*", isAdminCaller: async () => isAdmin, jobBusinesses: async () => [], workerLinksFor: async () => [] }));
mock.module("../src/lib/pilot.server", () => ({ myBusinesses: async () => new Map(), requireMember: async (_u: string, _b: string, adminOnly?: boolean) => { if (!memberRole || (adminOnly && memberRole !== "business_admin")) throw new Error("Only your business admin can do this."); return memberRole; } }));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => { let v: (d: unknown) => unknown = (d) => d; const b = { middleware: () => b, inputValidator: (f: typeof v) => { v = f; return b; }, handler: (h: (a: { data: unknown; context: unknown }) => unknown) => (a: { data: unknown }) => h({ data: v(a.data), context: { userId: "u-boss", supabase: {} } }) }; return b; },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const calls: string[] = [];
const call = async (method: string, path: string, body?: unknown) => {
  calls.push(`${method} ${path}${body && (body as { email?: string[] }).email ? ` ${(body as { email: string[] }).email[0]}` : ""}`);
  if (path === "/users/search") return { users: [] };
  if (method === "PUT") return { ok: true };
  throw new Error(`Unexpected Mitti call ${method} ${path}`);
};
const SW = { enabled: true, apiVerified: false, groupId: null };
const LIVE = { enabled: true, apiVerified: true, groupId: null };

const inv = await import("../src/lib/mitti-invite.server");
const { setWorkerRole } = await import("../src/lib/worker-links.functions");
const { sweepCrewReminders } = await import("../src/lib/crew-reminder.server");
const events = () => (tables["admin_config_events"] ?? []);

const cert = (id: string) => ({ id: `c-${id}`, worker_id: id, worker_email: "", status: "verified" });
beforeEach(() => {
  sent.length = 0; calls.length = 0; isAdmin = false; memberRole = null;
  tables = {
    partner_workers: [
      { id: "00000000-0000-4000-8000-0000000000a1", email: null, mobile: null, full_legal_name: "Lee Lead", trade_role: "installer", worker_role: "lead", approval_status: "approved", removed_at: null, profile_id: null, business_id: "b1" },
      { id: "00000000-0000-4000-8000-0000000000a2", email: null, mobile: "0412000111", full_legal_name: "Cam Crew", trade_role: "installer", worker_role: null, approval_status: "approved", removed_at: null, profile_id: null, business_id: "b1" },
    ],
    businesses: [{ id: "b1", name: "Real Insulation", email: "Office@RealInsul.com.au", onboarding_notes: null }, { id: "bt", name: "TEST Insulation", email: "test@hivic.test", onboarding_notes: "[TEST PARTNER]" }],
    profiles: [], admin_config_events: [], workflow_events: [],
    partner_worker_certifications: [cert("00000000-0000-4000-8000-0000000000a1"), cert("00000000-0000-4000-8000-0000000000a2")],
    worker_certification_levels: [{ certification_id: "c-00000000-0000-4000-8000-0000000000a1", level: "full", expires_on: "2099-01-01" }, { certification_id: "c-00000000-0000-4000-8000-0000000000a2", level: "full", expires_on: "2099-01-01" }],
  };
});

describe("Mitti: Leads only, business email for a Lead with no email", () => {
  test("a Lead with no email is searched / recorded with the business's own email", async () => {
    const r = await inv.onPartnerPersonApproved("00000000-0000-4000-8000-0000000000a1", "office", { switches: SW, call });
    expect(r.action).toBe("record_needed");
    expect(calls).toEqual(["POST /users/search office@realinsul.com.au"]);
    expect(events().map((e) => [e["event_type"], (e["details"] as Row)["email"], (e["details"] as Row)["email_source"]])).toEqual([["mitti_invite_needed", "office@realinsul.com.au", "business"]]);
  });
  test("a null-role person with no Mitti access is Crew: never searched or invited", async () => {
    const r = await inv.onPartnerPersonApproved("00000000-0000-4000-8000-0000000000a2", "office", { switches: SW, call });
    expect(r).toEqual({ action: "skip", reason: "Crew — only Lead installers get Mitti access." });
    expect(calls).toEqual([]); expect(events()).toEqual([]);
  });
  test("a null-role person who already has Mitti access counts as Lead", async () => {
    tables["admin_config_events"]!.push({ event_type: "mitti_user_linked", details: { worker_id: "00000000-0000-4000-8000-0000000000a2", email: "office@realinsul.com.au", mitti_user_id: "u9" } });
    expect((await inv.workerRolesFor(tables["partner_workers"] as never)).get("00000000-0000-4000-8000-0000000000a2")).toBe("lead");
  });
});

describe("Lead / Crew switch", () => {
  test("staff (not business_admin) cannot switch; business_admin can, one admin_config_events row with from → to", async () => {
    memberRole = "staff";
    await expect(setWorkerRole({ data: { id: "00000000-0000-4000-8000-0000000000a2", role: "lead" } })).rejects.toThrow(/business admin/);
    memberRole = "business_admin";
    expect(await setWorkerRole({ data: { id: "00000000-0000-4000-8000-0000000000a2", role: "lead" } })).toMatchObject({ changed: true, role: "lead" });
    expect(tables["partner_workers"]!.find((w) => w["id"] === "00000000-0000-4000-8000-0000000000a2")!["worker_role"]).toBe("lead");
    const ev = events().filter((e) => e["event_type"] === "worker_role_changed");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor_id: "u-boss", summary: "Cam Crew: Crew → Lead", details: { worker_id: "00000000-0000-4000-8000-0000000000a2", from: "crew", to: "lead" } });
  });
  test("HIV admin can switch; switching to the same role records nothing", async () => {
    isAdmin = true;
    expect(await setWorkerRole({ data: { id: "00000000-0000-4000-8000-0000000000a1", role: "lead" } })).toMatchObject({ changed: false });
    expect(events()).toEqual([]);
  });
  test("electricians have no Lead/Crew", async () => {
    isAdmin = true;
    tables["partner_workers"]!.push({ id: "00000000-0000-4000-8000-0000000000a4", trade_role: "electrician", business_id: "b1", full_legal_name: "E", removed_at: null });
    await expect(setWorkerRole({ data: { id: "00000000-0000-4000-8000-0000000000a4", role: "lead" } })).rejects.toThrow(/installers only/);
  });
  test("Lead → Crew deactivates the Mitti user (same record as removal) unless another active Lead uses that email", async () => {
    tables["admin_config_events"]!.push({ event_type: "mitti_user_invited", details: { worker_id: "00000000-0000-4000-8000-0000000000a1", email: "office@realinsul.com.au", mitti_user_id: "u1" } });
    tables["partner_workers"]!.push({ id: "00000000-0000-4000-8000-0000000000a3", email: null, trade_role: "installer", worker_role: "lead", approval_status: "approved", removed_at: null, business_id: "b1" });
    expect((await inv.onPartnerPersonDemoted("00000000-0000-4000-8000-0000000000a1", "office", { switches: LIVE, call })).action).toBe("skip"); // w-lead2 still a Lead on the business email
    expect(calls).toEqual([]);
    tables["partner_workers"]!.find((w) => w["id"] === "00000000-0000-4000-8000-0000000000a3")!["worker_role"] = "crew";
    expect((await inv.onPartnerPersonDemoted("00000000-0000-4000-8000-0000000000a1", "office", { switches: LIVE, call })).action).toBe("deactivate");
    expect(calls).toEqual(["PUT /users/u1"]);
    expect(events().at(-1)).toMatchObject({ event_type: "mitti_user_deactivated", details: { worker_id: "00000000-0000-4000-8000-0000000000a1", mitti_user_id: "u1", reason_kind: "switched_to_crew" } });
  });
});

describe("crew reminder sweep", () => {
  // Install 29 Oct 08:00 Melbourne; tick at 2:05pm on 28 Oct.
  const NOW = new Date("2026-10-28T03:05:00Z");
  const seedJob = (id: string, source: string, biz: string) => {
    (tables["jobs"] ??= []).push({ id, job_number: `HV-${id}`, source, deleted_at: null, properties: { address_line: "12 Wattle St", suburb: "Brighton", postcode: "3186" } });
    (tables["bookings"] ??= []).push({ id: `bk-${id}`, job_id: id, kind: "installation", status: "confirmed", scheduled_start: "2026-10-28T21:00:00Z" });
    (tables["job_assignments"] ??= []).push({ job_id: id, role: "installer", active: true, business_id: biz });
  };
  test("TEST job: one email through the test path, event recorded first, never twice", async () => {
    seedJob("t1", "qa_test", "bt");
    const r1 = await sweepCrewReminders(NOW);
    expect(r1.results).toEqual([{ jobId: "t1", outcome: "email (test) sent: fake" }]);
    expect(sent).toEqual([{ via: "test", to: "test@hivic.test", subject: "Pick the crew for tomorrow's install – 12 Wattle St, Brighton" }]);
    expect((tables["workflow_events"] ?? []).filter((e) => e["event_type"] === "crew_reminder_email")).toHaveLength(1);
    await sweepCrewReminders(new Date("2026-10-28T03:20:00Z"));
    expect(sent).toHaveLength(1);
  });
  test("real installer: nothing recorded or sent until Jo approves the wording", async () => {
    seedJob("r1", "base44", "b1");
    const r = await sweepCrewReminders(NOW);
    expect(r.results[0]!.outcome).toBe("skipped: wording not approved yet");
    expect(sent).toEqual([]); expect(tables["workflow_events"]).toEqual([]);
    const ok = await sweepCrewReminders(NOW, { approved: true });
    expect(ok.results[0]!.outcome).toBe("email blocked: fake");
    expect(sent).toEqual([{ via: "real", to: "office@realinsul.com.au", subject: "Pick the crew for tomorrow's install – 12 Wattle St, Brighton" }]);
  });
  test("crew already picked or before 2pm → nothing", async () => {
    seedJob("t2", "qa_test", "bt");
    expect((await sweepCrewReminders(new Date("2026-10-28T02:30:00Z"))).results[0]!.outcome).toBe("skipped: not due");
    tables["workflow_events"]!.push({ job_id: "t2", event_type: "piisa_crew_selected", details: {} });
    expect((await sweepCrewReminders(NOW)).results[0]!.outcome).toBe("skipped: crew already picked");
    expect(sent).toEqual([]);
  });
});
