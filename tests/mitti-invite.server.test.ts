// Mitti access persistence (decisions 188/331) against an in-memory fake database and a fake Mitti client (no network, no
// real writes, nothing sent): switch off = nothing read; on = one search per person, link / create + group + one message /
// "invite needed", one append-only record each; removal deactivates; failures = one office item; office "done" closes it.
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
// The real messenger is checked against fake senders: nothing can reach Twilio or the email service.
const sent: { via: string; input: Record<string, unknown> }[] = [];
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (input: Record<string, unknown>) => { sent.push({ via: "sms", input }); return { status: "blocked", detail: "fake" }; } }));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (input: Record<string, unknown>) => { sent.push({ via: "email", input }); return { status: "blocked", detail: "fake" }; } }));
// Fake Mitti: user search, create, group add and status update; anything else fails the test.
const calls: string[] = [];
const searches: string[] = [];
let found: string | null = null;
let failCreate = false;
const call = async (method: string, path: string, body?: unknown) => {
  calls.push(`${method} ${path}`);
  if (method === "POST" && path === "/users/search") {
    const email = (body as { email: string[] }).email[0]!;
    searches.push(email);
    return { users: found ? [{ id: found, email }] : [] };
  }
  if (method === "POST" && path === "/users") {
    if (failCreate) throw new Error("Mitti rejected the request (400)");
    expect(body).toMatchObject({ firstname: "Real", lastname: "Sparky", email: "real@sparks.com.au", seat_type: "lite" });
    return { user_id: "user_new" };
  }
  if (method === "POST" && path === "/groups/group_trades/users") return { ok: true };
  if (method === "PUT" && path.startsWith("/users/")) return { ok: true };
  throw new Error(`Unexpected Mitti call ${method} ${path}`);
};
const messages: string[] = [];
const message = async (p: { workerId: string }) => { messages.push(p.workerId); return "text sent"; };

const { onPartnerPersonApproved, onPartnerPersonRemoved, listOpenMittiInvites, confirmMittiInviteDone, realInviteMessenger } = await import("../src/lib/mitti-invite.server");
const ON = { enabled: true, apiVerified: false, groupId: null }; // calls not verified: link or office item only
const LIVE = { enabled: true, apiVerified: true, groupId: "group_trades" };
const events = () => (tables["admin_config_events"] ?? []).map((e) => e["event_type"]);

beforeEach(() => {
  reads.length = 0; searches.length = 0; calls.length = 0; messages.length = 0; found = null; failCreate = false;
  tables = {
    partner_workers: [
      { id: "w-test", email: "sparky@hivic.test", mobile: "0400000000", full_legal_name: "Test Sparky", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: "p1", business_id: "b1" },
      { id: "w-real", email: "real@sparks.com.au", mobile: "0412345678", full_legal_name: "Real Sparky", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: "p2", business_id: "b2" },
    ],
    businesses: [{ id: "b1", name: "TEST Sparks", onboarding_notes: "[TEST PARTNER]" }, { id: "b2", name: "Real Sparks", onboarding_notes: null }],
    profiles: [
      { id: "p1", email: "sparky@hivic.test", mitti_user_id: null, mitti_checked_email: null, mitti_checked_at: null },
      { id: "p2", email: "real@sparks.com.au", mitti_user_id: null, mitti_checked_email: null, mitti_checked_at: null },
    ],
    admin_config_events: [],
  };
});

describe("onPartnerPersonApproved", () => {
  test("switch off (the default) reads and writes nothing", async () => {
    const r = await onPartnerPersonApproved("w-real", "office", { call, message });
    expect(r.action).toBe("skip");
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
  });
  test("TEST people are skipped: no Mitti call, no record, no message", async () => {
    expect((await onPartnerPersonApproved("w-test", "office", { switches: LIVE, call, message })).action).toBe("skip");
    expect(calls).toEqual([]);
    expect(events()).toEqual([]);
  });
  test("API not verified: not found → one 'invite needed' office item; never creates; idempotent", async () => {
    expect(await onPartnerPersonApproved("w-real", "office", { switches: ON, call, message })).toMatchObject({ action: "record_needed", group: "HIV trades", seat: "lite" });
    expect(calls).toEqual(["POST /users/search"]);
    expect(events()).toEqual(["mitti_invite_needed"]);
    expect((await onPartnerPersonApproved("w-real", "office", { switches: ON, call, message })).action).toBe("skip");
    expect(searches).toHaveLength(1);
    expect(messages).toEqual([]);
    expect((await listOpenMittiInvites()).invites.map((i) => i.workerId)).toEqual(["w-real"]);
  });
  test("verified: not found → create (lite) + HIV trades group + profile link + ONE message, recorded before the message; never twice", async () => {
    const r = await onPartnerPersonApproved("w-real", "office", { switches: LIVE, call, message, password: () => "throwaway" });
    expect(r).toMatchObject({ action: "create", mittiUserId: "user_new", groupAdded: true, message: "text sent" });
    expect(calls).toEqual(["POST /users/search", "POST /users", "POST /groups/group_trades/users"]);
    expect(events()).toEqual(["mitti_user_invited"]);
    const d = tables["admin_config_events"]![0]!["details"] as Row;
    expect(d).toMatchObject({ mitti_user_id: "user_new", group_added: true, worker_id: "w-real" });
    expect(JSON.stringify(tables["admin_config_events"])).not.toContain("throwaway"); // the password is never stored
    expect(tables["profiles"]![1]).toMatchObject({ mitti_user_id: "user_new" });
    expect(messages).toEqual(["w-real"]);
    expect((await onPartnerPersonApproved("w-real", "office", { switches: LIVE, call, message })).action).toBe("skip");
    expect(calls).toHaveLength(3);
    expect(messages).toHaveLength(1);
    expect((await listOpenMittiInvites()).invites).toEqual([]); // nothing left for the office
  });
  test("verified: an existing Mitti user is linked and added to the group, no message", async () => {
    found = "user_77";
    expect(await onPartnerPersonApproved("w-real", "office", { switches: LIVE, call, message })).toMatchObject({ action: "record_linked", mittiUserId: "user_77" });
    expect(events()).toEqual(["mitti_user_linked"]);
    expect(tables["profiles"]![1]).toMatchObject({ mitti_user_id: "user_77", mitti_checked_email: "real@sparks.com.au" });
    expect(messages).toEqual([]);
  });
  test("create fails → ONE office item with the plain reason; a later approval retries via search", async () => {
    failCreate = true;
    const r = await onPartnerPersonApproved("w-real", "office", { switches: LIVE, call, message });
    expect(r).toMatchObject({ action: "fail", reason: expect.stringMatching(/invite them in Mitti by hand.*400/) });
    expect(events()).toEqual(["mitti_access_failed"]);
    expect(messages).toEqual([]);
    const open = (await listOpenMittiInvites()).invites;
    expect(open).toHaveLength(1);
    expect(open[0]!.todo[0]).toMatch(/could not create a user for real@sparks.com.au/);
    found = "user_made_by_office";
    expect((await onPartnerPersonApproved("w-real", "office", { switches: LIVE, call, message })).action).toBe("record_linked");
  });
  test("office closes a linked-by-hand item from the People list", async () => {
    found = "user_77";
    await onPartnerPersonApproved("w-real", "office", { switches: ON, call, message });
    const open = await listOpenMittiInvites();
    expect(open.invites[0]!.todo[0]).toMatch(/HIV trades group/);
    expect((await confirmMittiInviteDone("w-real", "office", call)).ok).toBe(true);
    expect((await listOpenMittiInvites()).invites).toEqual([]);
    await expect(confirmMittiInviteDone("w-real", "office", call)).rejects.toThrow(/no open Mitti invite/);
  });
});

describe("onPartnerPersonRemoved", () => {
  test("removed → the Mitti user the portal created is deactivated once; approved again → reactivated (same seat)", async () => {
    await onPartnerPersonApproved("w-real", "office", { switches: LIVE, call, message });
    tables["partner_workers"]![1]!["removed_at"] = "2026-10-25T00:00:00Z";
    expect(await onPartnerPersonRemoved("w-real", "office", { switches: LIVE, call })).toEqual({ action: "deactivate", mittiUserId: "user_new" });
    expect(calls.at(-1)).toBe("PUT /users/user_new");
    expect(events()).toEqual(["mitti_user_invited", "mitti_user_deactivated"]);
    expect((await onPartnerPersonRemoved("w-real", "office", { switches: LIVE, call })).action).toBe("skip");
    tables["partner_workers"]![1]!["removed_at"] = null;
    expect((await onPartnerPersonApproved("w-real", "office", { switches: LIVE, call, message })).action).toBe("reactivate");
    expect(events().at(-1)).toBe("mitti_user_reactivated");
    expect(messages).toHaveLength(1);
  });
  test("calls not verified → one office item to deactivate by hand; no Mitti user known → nothing", async () => {
    tables["partner_workers"]![1]!["removed_at"] = "2026-10-25T00:00:00Z";
    expect((await onPartnerPersonRemoved("w-real", "office", { switches: LIVE, call })).action).toBe("skip");
    expect(events()).toEqual([]);
    tables["admin_config_events"]!.push({ event_type: "mitti_user_linked", created_at: "2026-10-24T00:00:00Z", details: { worker_id: "w-real", email: "real@sparks.com.au", mitti_user_id: "user_9", group_added: true } });
    expect(await onPartnerPersonRemoved("w-real", "office", { switches: ON, call })).toMatchObject({ action: "fail" });
    expect(calls).toEqual([]);
    expect((await listOpenMittiInvites()).invites[0]!.todo[0]).toMatch(/Deactivate real@sparks.com.au in Mitti by hand/);
  });
  test("switch off → nothing read", async () => {
    expect((await onPartnerPersonRemoved("w-real", "office", { call })).action).toBe("skip");
    expect(reads).toEqual([]);
  });
});

describe("realInviteMessenger (existing partner senders, faked)", () => {
  test("a mobile → ONE text, type mitti_invite, keyed per person; no mobile → ONE email through sendOfficeEmail", async () => {
    sent.length = 0;
    await realInviteMessenger({ workerId: "w-real", businessId: "b2", to: { mobile: "0412 345 678", email: "real@sparks.com.au" }, name: "Real Sparky", at: "2026-10-25T00:00:00Z", actorId: "office" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ via: "sms", input: { type: "mitti_invite", idempotencyKey: "mitti-invite-message:v1:w-real", to: "+61412345678", businessId: "b2" } });
    expect(String(sent[0]!.input["body"])).toMatch(/^You've been invited to Mitti/);
    await realInviteMessenger({ workerId: "w-real", businessId: "b2", to: { mobile: null, email: "real@sparks.com.au" }, name: "Real Sparky", at: "2026-10-25T00:00:00Z", actorId: "office" });
    expect(sent[1]).toMatchObject({ via: "email", input: { recipient: "partner", to: "real@sparks.com.au", subject: "You've been invited to Mitti" } });
  });
});
