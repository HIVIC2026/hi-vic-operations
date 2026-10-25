// R05 (external review 25 Oct 2026): two separate owner rows (two properties) with the same mobile must both be able to
// verify by text code. The REAL owner-verify.server runs on PGlite (secure links, hashed codes, attempts, sessions);
// the auth admin API is a fake that ENFORCES phone/email uniqueness like Supabase Auth (`phone_exists`). Access is
// checked with the baseline `is_job_owner` rule (owners.user_id). TEST jobs only: the code comes back on screen and
// nothing is sent. No live database or network.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { embedShim, type Rels } from "./helpers/pglite-embed-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE owners (id uuid primary key default gen_random_uuid(), full_name text, email text, phone text, user_id uuid);
CREATE TABLE jobs (id uuid primary key default gen_random_uuid(), source text, owner_id uuid);
CREATE TABLE profiles (id uuid primary key, email text);
CREATE TABLE user_roles (user_id uuid, role text, unique (user_id, role));
CREATE TABLE customer_estimate_links (id uuid primary key default gen_random_uuid(), job_id uuid, token text, purpose text, status text, expires_at timestamptz);
CREATE TABLE owner_link_codes (id uuid primary key default gen_random_uuid(), job_id uuid, channel text, destination_masked text, code_hash text, attempts int not null default 0,
  expires_at timestamptz, verified_at timestamptz, session_hash text, session_expires_at timestamptz, owner_user_id uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb);
-- Baseline access rule (drizzle 0000): an owner sees a job only through owners.user_id.
CREATE FUNCTION is_job_owner(_job uuid, _user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM jobs j JOIN owners o ON o.id = j.owner_id WHERE j.id = _job AND o.user_id = _user) $$;`);

const rels: Rels = { jobs: { owners: { table: "owners", fk: "owner_id", on: "base" } } };
const shim = embedShim(db, rels);
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

// ---- fake Supabase Auth admin: unique phone/email, phones stored as digits ("61412345678") ----
type AuthUser = { id: string; phone: string; email: string };
let users: AuthUser[] = [];
let createCalls = 0;
let seq = 0;
const auth = {
  admin: {
    createUser: async (u: { email?: string; phone?: string }) => {
      createCalls++;
      const phone = (u.phone ?? "").replace(/\D/g, ""), email = (u.email ?? "").toLowerCase();
      if (phone && users.some((x) => x.phone === phone)) return { data: { user: null }, error: { code: "phone_exists", status: 422, message: "Phone number already registered by another user" } };
      if (email && users.some((x) => x.email === email)) return { data: { user: null }, error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" } };
      const user = { id: `50000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, phone, email };
      users.push(user);
      if (email) await q("insert into profiles (id, email) values ($1,$2)", [user.id, email]);
      return { data: { user }, error: null };
    },
    getUserById: async (id: string) => { const user = users.find((x) => x.id === id); return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "User not found" } }; },
    listUsers: async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number } = {}) => ({ data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null }),
  },
};
const admin = {
  ...shim,
  auth,
  rpc: async (name: string, a: Record<string, unknown>) => {
    if (name !== "issue_owner_link_code") return { data: null, error: { message: `unexpected rpc ${name}` } };
    const r = await q<{ id: string }>("insert into owner_link_codes (job_id, channel, destination_masked, code_hash, expires_at) values ($1,$2,$3,$4,$5) returning id", [a["_job"], a["_channel"], a["_masked"], a["_hash"], a["_expires"]]);
    return { data: r[0]!.id, error: null };
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await q("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
mock.module("../src/lib/owner-code-delivery.server", () => ({ deliverOwnerCode: async () => { throw new Error("TEST jobs never send"); } }));

const ov = await import("../src/lib/owner-verify.server");
const { newToken } = await import("../src/lib/worker-links.core");

async function property(name: string, phone: string, email: string | null = null) {
  const [o] = await q<{ id: string }>("insert into owners (full_name, email, phone) values ($1,$2,$3) returning id", [name, email, phone]);
  const [j] = await q<{ id: string }>("insert into jobs (source, owner_id) values ('qa_test', $1) returning id", [o!.id]);
  const token = newToken();
  await q("insert into customer_estimate_links (job_id, token, purpose, status, expires_at) values ($1,$2,'step3_estimate','active', now() + interval '7 days')", [j!.id, token]);
  return { ownerId: o!.id, jobId: j!.id, token };
}
async function verifyBy(p: { token: string }, channel: "sms" | "email" = "sms") {
  const { testCode } = await ov.requestOwnerCode(p.token, channel);
  const { session } = await ov.verifyOwnerCode(p.token, testCode!);
  return ov.ownerSession(p.token, session).then((s) => ({ ...s, session }));
}
const linked = async (ownerId: string) => (await q<{ user_id: string | null }>("select user_id from owners where id = $1", [ownerId]))[0]!.user_id;
const sees = async (jobId: string, userId: string) => (await q<{ ok: boolean }>("select is_job_owner($1, $2) as ok", [jobId, userId]))[0]!.ok;

beforeEach(async () => {
  await db.exec("truncate owners, jobs, profiles, user_roles, customer_estimate_links, owner_link_codes, workflow_events");
  users = []; createCalls = 0;
});

describe("R05: two properties, same mobile, separate owner rows", () => {
  test("both verify by text code and resolve to the one identity holding that mobile; a different mobile stays separate", async () => {
    const a = await property("Pat Owner", "0412 345 678");
    const b = await property("Pat Owner", "+61 412-345-678"); // same mobile, typed differently, second owner row
    const c = await property("Chris Other", "0499 888 777");

    const sa = await verifyBy(a);
    const sb = await verifyBy(b); // before the fix: "Could not record the owner's verified identity: Phone number already registered"
    const sc = await verifyBy(c);

    expect(sb.userId).toBe(sa.userId);
    expect(await linked(a.ownerId)).toBe(sa.userId);
    expect(await linked(b.ownerId)).toBe(sa.userId);
    expect(users).toHaveLength(2); // no duplicate identity was made for the shared mobile
    expect(sc.userId).not.toBe(sa.userId);

    // Same person by verified mobile sees both homes; the other mobile's owner sees only their own.
    expect(await sees(a.jobId, sa.userId)).toBe(true);
    expect(await sees(b.jobId, sa.userId)).toBe(true);
    expect(await sees(c.jobId, sa.userId)).toBe(false);
    expect(await sees(a.jobId, sc.userId)).toBe(false);
    expect(await sees(b.jobId, sc.userId)).toBe(false);
    expect(await sees(c.jobId, sc.userId)).toBe(true);

    // A signing session stays bound to its own secure link.
    await expect(ov.ownerSession(a.token, sb.session)).rejects.toThrow();
    await expect(ov.ownerSession(b.token, sa.session)).rejects.toThrow();
  });

  test("nothing is looked up or linked until the code matches", async () => {
    const a = await property("Pat Owner", "0412 345 678");
    const b = await property("Pat Owner", "0412345678");
    await verifyBy(a);
    const calls = createCalls;
    await ov.requestOwnerCode(b.token, "sms");
    await expect(ov.verifyOwnerCode(b.token, "000000")).rejects.toThrow(/doesn't match/);
    expect(await linked(b.ownerId)).toBeNull();
    expect(createCalls).toBe(calls);
  });

  test("a mobile registered to a staff/trade login is never linked to an owner row", async () => {
    await auth.admin.createUser({ phone: "+61412345678" });
    await q("insert into user_roles (user_id, role) values ($1, 'installer')", [users[0]!.id]);
    const b = await property("Pat Owner", "0412 345 678");
    await expect(verifyBy(b)).rejects.toThrow(/Could not record the owner's verified identity/);
    expect(await linked(b.ownerId)).toBeNull();
  });

  test("an owner identity with that mobile but no linked owner row yet is found by the bounded scan", async () => {
    await auth.admin.createUser({ phone: "+61412345678" });
    await q("insert into user_roles (user_id, role) values ($1, 'owner')", [users[0]!.id]);
    const b = await property("Pat Owner", "0412 345 678");
    const s = await verifyBy(b);
    expect(s.userId).toBe(users[0]!.id);
    expect(await linked(b.ownerId)).toBe(users[0]!.id);
  });

  test("an email-verified owner who merely has the same mobile TYPED on their row is not the mobile's identity", async () => {
    const a = await property("Pat Owner", "0412 345 678", "pat@example.com");
    const sa = await verifyBy(a, "email"); // identity by email; no auth phone
    const b = await property("Someone", "0412 345 678");
    const sb = await verifyBy(b); // first SMS identity for this mobile: a new user, never the email user
    expect(sb.userId).not.toBe(sa.userId);
    expect(await sees(a.jobId, sb.userId)).toBe(false);
    expect(await sees(b.jobId, sa.userId)).toBe(false);
  });
});

describe("R05: pure helpers", () => {
  test("phone_exists detection and same-number matching", () => {
    expect(ov.phoneAlreadyRegistered({ code: "phone_exists" })).toBe(true);
    expect(ov.phoneAlreadyRegistered({ message: "Phone number already registered by another user" })).toBe(true);
    expect(ov.phoneAlreadyRegistered({ code: "email_exists", message: "A user with this email address has already been registered" })).toBe(false);
    expect(ov.phoneAlreadyRegistered(null)).toBe(false);
    expect(ov.samePhone("0412 345 678", "+61412345678")).toBe(true);
    expect(ov.samePhone("+61 412-345-678", "+61412345678")).toBe(true);
    expect(ov.samePhone("0412 345 679", "+61412345678")).toBe(false);
    expect(ov.samePhone(null, "+61412345678")).toBe(false);
  });
});
