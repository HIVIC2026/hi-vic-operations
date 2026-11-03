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
const sent: string[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string }) => { sent.push(`email ${p.to}`); return { status: "blocked", detail: "fake" }; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { to: string }) => { sent.push(`text ${p.to}`); return { status: "blocked", detail: "fake" }; } }));
let paused: string | null = null;
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => paused }));

const calls: string[] = [];
const call = async (method: string, path: string, body?: unknown) => {
  calls.push(`${method} ${path}${body && (body as { email?: string[] }).email ? ` ${(body as { email: string[] }).email[0]}` : ""}`);
  if (path === "/users/search") return { users: [] };
  if (method === "POST" && path === "/users") return { user_id: "m-new" };
  throw new Error(`Unexpected Mitti call ${method} ${path}`);
};
const OFF = { enabled: false, apiVerified: true, groupId: null };
const SW = { enabled: true, apiVerified: false, groupId: null };
const LIVE = { enabled: true, apiVerified: true, groupId: null };
const inv = await import("../src/lib/mitti-invite.server");
const core = await import("../src/lib/mitti-invite.core");
const events = () => (tables["admin_config_events"] ?? []);
const types = () => events().map((e) => e["event_type"]);
const LEAD = "00000000-0000-4000-8000-0000000000a1";
const cert = (id: string) => ({ id: `c-${id}`, worker_id: id, worker_email: "", status: "verified" });
const lead = () => tables["partner_workers"]![0]!;

beforeEach(() => {
  sent.length = 0; calls.length = 0; paused = null;
  tables = {
    partner_workers: [{ id: LEAD, email: null, mobile: "0412000111", full_legal_name: "Wayne Lead", trade_role: "installer", worker_role: "lead", approval_status: "approved", removed_at: null, profile_id: null, business_id: "b1" }],
    businesses: [{ id: "b1", name: "Real Insulation", email: "Office@RealInsul.com.au", onboarding_notes: null }],
    profiles: [], admin_config_events: [], workflow_events: [],
    partner_worker_certifications: [cert(LEAD)],
    worker_certification_levels: [{ certification_id: `c-${LEAD}`, level: "full", expires_on: "2099-01-01" }],
  };
});

describe("Q3 (Jo 3 Nov 8:11pm): a Lead with no own email waits — no business-email fallback", () => {
  test("switch off: nothing read, called, recorded or sent", async () => {
    expect(await inv.onPartnerPersonApproved(LEAD, "office", { switches: OFF, call })).toMatchObject({ action: "skip" });
    expect(calls).toEqual([]); expect(events()).toEqual([]); expect(sent).toEqual([]);
  });
  test("no own email → one waiting record, never the business email, no Mitti call", async () => {
    const r = await inv.onPartnerPersonApproved(LEAD, "office", { switches: LIVE, call });
    expect(r).toEqual({ action: "skip", reason: core.MITTI_WAITING_EMAIL });
    expect(calls).toEqual([]); expect(sent).toEqual([]);
    expect(types()).toEqual(["mitti_invite_waiting_email"]);
    await inv.onPartnerPersonApproved(LEAD, "office", { switches: LIVE, call });
    expect(types()).toEqual(["mitti_invite_waiting_email"]);
  });
  test("once the boss adds the Lead's own email, the invite goes to that email only", async () => {
    await inv.onPartnerPersonApproved(LEAD, "office", { switches: SW, call });
    lead()["email"] = "wayne@own.com.au";
    const r = await inv.onPartnerPersonApproved(LEAD, "office", { switches: SW, call });
    expect(r).toMatchObject({ action: "record_needed" });
    expect(calls).toEqual(["POST /users/search wayne@own.com.au"]);
    expect(types()).toEqual(["mitti_invite_waiting_email", "mitti_invite_needed"]);
  });
  test("office list shows the plain waiting line", () => {
    expect(core.inviteTodo({ type: "mitti_invite_waiting_email", email: null, group: null })).toEqual([core.MITTI_WAITING_EMAIL]);
    expect(core.MITTI_WAITING_EMAIL).toBe("Mitti invite waiting for Lead's own email");
  });
});

describe("Q5 (Jo 3 Nov 8:11pm): approved while trade messages are paused", () => {
  beforeEach(() => { lead()["email"] = "wayne@own.com.au"; paused = "Trade messages are paused"; });
  test("no Mitti user, no message; one waiting record", async () => {
    const r = await inv.onPartnerPersonApproved(LEAD, "office", { switches: LIVE, call });
    expect(r).toEqual({ action: "skip", reason: core.MITTI_WAITING_PAUSE });
    expect(calls).toEqual(["POST /users/search wayne@own.com.au"]); expect(sent).toEqual([]);
    expect(types()).toEqual(["mitti_invite_waiting_pause"]);
    await inv.onPartnerPersonApproved(LEAD, "office", { switches: LIVE, call });
    expect(types()).toEqual(["mitti_invite_waiting_pause"]);
  });
  test("unpausing alone sends nothing: automatic paths keep waiting for Jo to confirm", async () => {
    await inv.onPartnerPersonApproved(LEAD, "office", { switches: LIVE, call });
    paused = null; calls.length = 0;
    const r = await inv.onPartnerPersonApproved(LEAD, "office", { switches: LIVE, call });
    expect(r).toMatchObject({ action: "skip" });
    expect(calls).toEqual([]); expect(sent).toEqual([]); expect(types()).toEqual(["mitti_invite_waiting_pause"]);
  });
  test("office confirm while still paused sends nothing", async () => {
    await inv.onPartnerPersonApproved(LEAD, "office", { switches: LIVE, call });
    const r = await inv.sendWaitingMittiInvite(LEAD, "jo", { switches: LIVE, call });
    expect(r).toEqual({ action: "skip", reason: core.MITTI_WAITING_PAUSE });
    expect(calls.filter((c) => c.startsWith("POST /users ") || c === "POST /users")).toEqual([]); expect(sent).toEqual([]);
  });
  test("after unpause, Jo's confirm creates once and sends the one message", async () => {
    await inv.onPartnerPersonApproved(LEAD, "office", { switches: LIVE, call });
    paused = null;
    const r = await inv.sendWaitingMittiInvite(LEAD, "jo", { switches: LIVE, call, password: () => "x" });
    expect(r).toMatchObject({ action: "create", mittiUserId: "m-new" });
    expect(sent).toEqual(["text +61412000111"]);
    expect(types()).toEqual(["mitti_invite_waiting_pause", "mitti_user_invited"]);
    await expect(inv.sendWaitingMittiInvite(LEAD, "jo", { switches: LIVE, call })).rejects.toThrow();
    expect(sent.length).toBe(1);
  });
  test("confirm refuses anyone not waiting for the pause", async () => {
    await expect(inv.sendWaitingMittiInvite(LEAD, "jo", { switches: LIVE, call })).rejects.toThrow(/not waiting/);
  });
  test("Needs me: one row per Lead waiting for the pause, with the exact title", () => {
    const rows = core.mittiWaitingPauseItems([
      { workerId: "w1", type: "mitti_invite_waiting_pause", at: "2026-11-03T09:00:00Z", email: "a@b.au", name: "Wayne", business: "Reinsulate", group: null, mittiUserId: null },
      { workerId: "w2", type: "mitti_invite_waiting_email", at: "2026-11-03T09:00:00Z", email: null, name: "X", business: "Y", group: null, mittiUserId: null },
    ]);
    expect(rows.map((r) => [r.key, r.title])).toEqual([["mitti-pause:w1", "Mitti invite waiting for pause to lift"]]);
  });
});
