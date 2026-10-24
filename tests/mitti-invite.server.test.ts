// Mitti auto-invite persistence against an in-memory fake database and a fake Mitti search (no network, no real writes):
// switch off = nothing read; on = one Mitti search per person, ever, one append-only record; office "done" closes it.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
const reads: string[] = [];
function from(t: string) {
  reads.push(t);
  let rows = [...(tables[t] ?? [])];
  let op: "select" | "insert" | "update" = "select";
  let patch: Row = {};
  const q: Record<string, unknown> = {};
  const apply = () => { if (op === "update") for (const r of tables[t] ?? []) if (rows.includes(r)) Object.assign(r, patch); };
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
    in: (k: string, v: unknown[]) => { rows = rows.filter((r) => v.includes(r[k])); return q; },
    or: () => q,
    contains: (k: string, v: Row) => { rows = rows.filter((r) => Object.entries(v).every(([kk, vv]) => (r[k] as Row | undefined)?.[kk] === vv)); return q; },
    order: () => q, limit: () => q,
    update: (p: Row) => { op = "update"; patch = p; return q; },
    insert: (r: Row) => { op = "insert"; (tables[t] ??= []).push({ created_at: new Date(Date.now() + (tables[t]?.length ?? 0)).toISOString(), ...r }); return q; },
    maybeSingle: async () => { apply(); return { data: op === "select" ? rows[0] ?? null : null, error: null }; },
    then: (res: (v: unknown) => unknown) => { apply(); return res({ data: op === "select" ? rows : null, error: null }); },
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
// Fake Mitti: only the user search (POST /users/search) is ever called; anything else fails the test.
const searches: string[] = [];
let found: string | null = null;
const call = async (method: string, path: string, body?: unknown) => {
  if (method !== "POST" || path !== "/users/search") throw new Error(`Unexpected Mitti call ${method} ${path}`);
  const email = (body as { email: string[] }).email[0]!;
  searches.push(email);
  return { users: found ? [{ id: found, email }] : [] };
};

const { onPartnerPersonApproved, listOpenMittiInvites, confirmMittiInviteDone } = await import("../src/lib/mitti-invite.server");
const ON = { enabled: true, probeDone: false }; // TEST probe phase

beforeEach(() => {
  reads.length = 0; searches.length = 0; found = null;
  tables = {
    partner_workers: [
      { id: "w-test", email: "sparky+qa@hivic-test.example", full_legal_name: "Test Sparky", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: "p1", business_id: "b1" },
      { id: "w-real", email: "real@sparks.com.au", full_legal_name: "Real Sparky", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: null, business_id: "b2" },
    ],
    businesses: [{ id: "b1", name: "TEST Sparks", onboarding_notes: null }, { id: "b2", name: "Real Sparks", onboarding_notes: null }],
    profiles: [{ id: "p1", email: "sparky+qa@hivic-test.example", mitti_user_id: null, mitti_checked_email: null, mitti_checked_at: null }],
    admin_config_events: [],
  };
});

describe("onPartnerPersonApproved", () => {
  test("switch off (the default) reads and writes nothing", async () => {
    const r = await onPartnerPersonApproved("w-test", "office");
    expect(r.action).toBe("skip");
    expect(reads).toEqual([]);
    expect(searches).toEqual([]);
  });
  test("TEST probe: a real person is not processed; the TEST person gets one search and one 'invite needed' record", async () => {
    expect((await onPartnerPersonApproved("w-real", "office", { switches: ON, call })).action).toBe("skip");
    expect(searches).toEqual([]);
    const r = await onPartnerPersonApproved("w-test", "office", { switches: ON, call });
    expect(r).toMatchObject({ action: "record_needed", group: "Electricians", seat: "lite" });
    expect(searches).toEqual(["sparky+qa@hivic-test.example"]);
    const ev = tables["admin_config_events"]!;
    expect(ev.map((e) => e["event_type"])).toEqual(["mitti_invite_needed"]);
    expect((ev[0]!["details"] as Row)["missing_endpoints"]).toHaveLength(3);
    // Idempotent: approving again never searches or records again (seats are billed).
    expect((await onPartnerPersonApproved("w-test", "office", { switches: ON, call })).action).toBe("skip");
    expect(searches).toHaveLength(1);
    expect(tables["admin_config_events"]).toHaveLength(1);
  });
  test("an existing Mitti user is linked on the profile, then the office closes it from the People list", async () => {
    found = "user_77";
    expect((await onPartnerPersonApproved("w-test", "office", { switches: ON, call })).action).toBe("record_linked");
    expect(tables["profiles"]![0]).toMatchObject({ mitti_user_id: "user_77", mitti_checked_email: "sparky+qa@hivic-test.example" });
    const open = await listOpenMittiInvites();
    expect(open.invites.map((i) => i.workerId)).toEqual(["w-test"]);
    expect(open.invites[0]!.todo[0]).toMatch(/Electricians group/);
    expect((await confirmMittiInviteDone("w-test", "office", call)).access).toBe("member");
    expect(searches).toHaveLength(2); // the office "done" re-checks membership with the same search
    expect((await listOpenMittiInvites()).invites).toEqual([]);
    await expect(confirmMittiInviteDone("w-test", "office", call)).rejects.toThrow(/no open Mitti invite/);
  });
});
