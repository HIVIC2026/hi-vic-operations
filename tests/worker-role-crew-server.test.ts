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
mock.module('../src/lib/in-house-suppression.server',()=>({readInHouseDispatchState:async()=>({held:new Set(),failed:false})}));
const sent: { via: string; to: string; subject?: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({ TEST_APP_BASE: "https://test", sendTestEmail: async (_c: unknown, to: string, subject: string) => { sent.push({ via: "test", to, subject }); return { status: "sent", detail: "fake" }; } }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string }) => { sent.push({ via: "real", to: p.to, subject: p.subject }); return { status: "blocked", detail: "fake" }; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async () => ({ status: "blocked", detail: "fake" }) }));

let isAdmin = false; let memberRole: string | null = null;
mock.module("../src/lib/worker-links.server", () => ({ WORKER_COLS: "*", isAdminCaller: async () => isAdmin, jobBusinesses: async () => [], workerLinksFor: async () => [] }));
const realPilot = await import("../src/lib/pilot.server");
mock.module("../src/lib/pilot.server", () => ({ ...realPilot, myBusinesses: async () => new Map(), requireMember: async (_u: string, _b: string, adminOnly?: boolean) => { if (!memberRole || (adminOnly && memberRole !== "business_admin")) throw new Error("Only your business admin can do this."); return memberRole; } }));
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
const events = () => (tables["admin_config_events"] ?? []);

const cert = (id: string) => ({ id: `c-${id}`, worker_id: id, worker_email: "", status: "verified" });
beforeEach(() => {
  sent.length = 0; calls.length = 0; isAdmin = false; memberRole = null;
  tables = {
    partner_workers: [
      { id: "00000000-0000-4000-8000-0000000000a1", email: null, mobile: null, full_legal_name: "Lee Lead", trade_role: "installer", worker_role: "lead", approved_at: "2026-11-03T11:00:00Z", approval_status: "approved", removed_at: null, profile_id: null, business_id: "b1" },
      { id: "00000000-0000-4000-8000-0000000000a2", email: null, mobile: "0412000111", full_legal_name: "Cam Crew", trade_role: "installer", worker_role: "crew", approved_at: "2026-11-03T11:00:00Z", approval_status: "approved", removed_at: null, profile_id: null, business_id: "b1" },
    ],
    businesses: [{ id: "b1", name: "Real Insulation", email: "Office@RealInsul.com.au", onboarding_notes: null }, { id: "bt", name: "TEST Insulation", email: "test@hivic.test", onboarding_notes: "[TEST PARTNER]" }],
    profiles: [], admin_config_events: [], workflow_events: [],
    partner_worker_certifications: [cert("00000000-0000-4000-8000-0000000000a1"), cert("00000000-0000-4000-8000-0000000000a2")],
    worker_certification_levels: [{ certification_id: "c-00000000-0000-4000-8000-0000000000a1", level: "full", expires_on: "2099-01-01" }, { certification_id: "c-00000000-0000-4000-8000-0000000000a2", level: "full", expires_on: "2099-01-01" }],
  };
});

describe("Mitti: Leads only, business email for a Lead with no email", () => {
  test("Jo 3 Nov 8:11pm: a Lead with no email waits for their own (no business-email fallback)", async () => {
    const r = await inv.onPartnerPersonApproved("00000000-0000-4000-8000-0000000000a1", "office", { switches: SW, call });
    expect(r).toEqual({ action: "skip", reason: "Mitti invite waiting for Lead's own email" });
    expect(calls).toEqual([]);
    expect(events().map((e) => e["event_type"])).toEqual(["mitti_invite_waiting_email"]);
  });
  test("a stored Crew is never searched or invited", async () => {
    const r = await inv.onPartnerPersonApproved("00000000-0000-4000-8000-0000000000a2", "office", { switches: SW, call });
    expect(r.action).toBe("skip");
    expect(calls).toEqual([]); expect(events()).toEqual([]);
    expect((await inv.workerRolesFor([{ id: "x", trade_role: "installer", worker_role: null, profile_id: null }])).get("x")).toBe("lead");
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
  test("switch to crew leaves Mitti alone", async () => {
    isAdmin = true;
    tables["admin_config_events"]!.push({ event_type: "mitti_user_invited", details: { worker_id: "00000000-0000-4000-8000-0000000000a1", email: "office@realinsul.com.au", mitti_user_id: "u1" } });
    expect(await setWorkerRole({ data: { id: "00000000-0000-4000-8000-0000000000a1", role: "crew" } })).toMatchObject({ changed: true, role: "crew" });
    expect(calls).toEqual([]);
    expect(events().map((e) => e["event_type"])).toEqual(["mitti_user_invited", "worker_role_changed"]);
  });
});

// Part 7 Task 8 (Jo 2 Nov 2026): the crew reminder sweep is retired (see tests/lead-installer-confirm.test.ts).
