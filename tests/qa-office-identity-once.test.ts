// Speed fix #1: one verified identity read per server call, with every access decision unchanged.
// Runs the real global boundary -> requireSupabaseAuth -> office helpers chain on a counting fake Supabase.
import { beforeEach, expect, mock, test } from "bun:test";

let authorization: string | null = null;
let roles: string[] = ["admin"], email = "admin@example.com", verified = true, scopeAllowed = true, userId = "user-1";
let getUserCalls = 0, getClaimsCalls = 0, roleReads = 0, isAdminCalls = 0, scopeCalls = 0;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const tokenFor = (sub: string, exp = Math.floor(Date.now() / 1000) + 3600) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, exp, role: "authenticated" })}.c2ln`;

function fakeClient() {
  return {
    auth: {
      getUser: async () => { getUserCalls++; return { data: { user: { id: userId, email, email_confirmed_at: verified ? "2026-10-27" : null } }, error: null }; },
      getClaims: async (token: string) => { getClaimsCalls++; const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()); return { data: { claims: payload }, error: null }; },
    },
    from: (table: string) => {
      if (table === "user_roles") return { select: () => ({ eq: async () => { roleReads++; return { data: roles.map(role => ({ role })), error: null }; } }) };
      const q = { select: () => q, eq: () => q, is: () => q, order: () => q, ilike: () => q, like: () => q,
        range: async () => ({ data: table === "jobs" ? [{ id: "test-job-1" }, { id: "test-job-2" }, { id: "test-job-3" }] : [], error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
      return q;
    },
    rpc: async (name: string, args?: { _job?: string }) => {
      if (name === "is_admin") { isAdminCalls++; return { data: roles.includes("admin"), error: null }; }
      scopeCalls++; return { data: scopeAllowed && !!args?._job?.startsWith("test-job"), error: null };
    },
  };
}
mock.module("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));
mock.module("@tanstack/react-start/server", () => ({ getRequest: () => ({ headers: new Headers(authorization ? { authorization } : {}) }) }));
mock.module("../src/lib/workflow.server", () => ({ requireAdmin: async (sb: { rpc: (n: string) => Promise<{ data: unknown }> }) => {
  const { data } = await sb.rpc("is_admin"); if (!data) throw new Error("Admin only.");
} }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  const result = () => ({ data: table === "jobs" ? { source: "qa_test", deleted_at: null, qa_archived_at: null, owner_id: "owner", property_id: "property", originating_installer_business_id: null, originating_installer_user_id: null }
    : table === "owners" ? { email: "owner@hivic-test.example", user_id: null }
    : table === "properties" ? { owner_id: "owner", managed_by_business_id: null } : [], error: null });
  const q = { select: () => q, eq: () => q, in: () => q, maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
  return q;
} } }));

const { testOfficeBoundary } = await import("../src/lib/qa-office-boundary");
const { requireSupabaseAuth } = await import("../src/integrations/supabase/auth-middleware");
const access = await import("../src/lib/qa-office-access.server");

type Ctx = Record<string, unknown> & { supabase: never; userId?: string };
type Server = (args: Record<string, unknown>) => Promise<unknown>;
const serverOf = (m: unknown) => (m as { options: { server: Server } }).options.server;
const ALLOWED = { filename: "src/lib/office-screens.functions.ts", name: "getOfficeJobPage" };

/** One server call: global boundary, then the function's requireSupabaseAuth, then the handler. */
async function serverCall<T>(handler: (ctx: Ctx) => Promise<T>, clientContext: Record<string, unknown> = {}, meta = ALLOWED): Promise<T> {
  let out: { value: T } | undefined;
  await serverOf(testOfficeBoundary)({ context: clientContext, serverFnMeta: meta, next: async (a1: { context?: Record<string, unknown> } = {}) => {
    const afterBoundary = { ...clientContext, ...a1.context };
    return serverOf(requireSupabaseAuth)({ context: afterBoundary, next: async (a2: { context?: Record<string, unknown> } = {}) => {
      out = { value: await handler({ ...afterBoundary, ...a2.context } as Ctx) };
      return {};
    } });
  } });
  return out!.value;
}
const counts = () => ({ getUser: getUserCalls, getClaims: getClaimsCalls, roles: roleReads, isAdmin: isAdminCalls });
const settle = (p: Promise<unknown>) => p.then(v => ({ ok: v }), (e: Error) => ({ err: e.message }));

beforeEach(() => {
  roles = ["admin"]; email = "admin@example.com"; verified = true; scopeAllowed = true; userId = "user-1";
  authorization = `Bearer ${tokenFor(userId)}`;
  getUserCalls = 0; getClaimsCalls = 0; roleReads = 0; isAdminCalls = 0; scopeCalls = 0;
});

test("admin office list call: one getUser, one roles read, no getClaims or is_admin hops", async () => {
  expect(await serverCall(ctx => access.requireOfficeIdentity(ctx.supabase))).toBe("admin");
  expect(counts()).toEqual({ getUser: 1, getClaims: 0, roles: 1, isAdmin: 0 });
});

test("admin office job call: one identity read", async () => {
  expect(await serverCall(ctx => access.requireOfficeJob(ctx.supabase, "real-job"))).toBe("admin");
  expect(counts()).toEqual({ getUser: 1, getClaims: 0, roles: 1, isAdmin: 0 });
});

test("TEST office list over several TEST jobs: still one identity read (no per-job re-read)", async () => {
  roles = ["qa_office"]; email = "office@hivic-test.example";
  const ids = await serverCall(async ctx => { await access.requireOfficeIdentity(ctx.supabase); return access.officeTestJobIds(ctx.supabase); });
  expect(ids).toEqual(["test-job-1", "test-job-2", "test-job-3"]);
  expect(counts()).toEqual({ getUser: 1, getClaims: 0, roles: 1, isAdmin: 0 });
  expect(scopeCalls).toBe(3);
});

test("handler context exposes the same user id the token carries", async () => {
  expect(await serverCall(async ctx => ctx.userId)).toBe("user-1");
});

test("browser-sent officeIdentity context is never trusted", async () => {
  roles = ["owner"];
  const forged = { officeIdentity: { userId: "user-1", token: authorization!.slice(7), roles: ["admin"], email: "x@example.com", emailVerified: true } };
  await expect(serverCall(ctx => access.requireOfficeIdentity(ctx.supabase), forged)).rejects.toThrow("Admin only.");
  getUserCalls = 0; roleReads = 0; isAdminCalls = 0;
  // A raw client with no server-bound identity (scripts, ticks) does the full server-side check.
  await expect(access.requireOfficeIdentity(fakeClient() as never)).rejects.toThrow("Admin only.");
  expect(counts()).toEqual({ getUser: 1, getClaims: 0, roles: 1, isAdmin: 1 });
});

test("missing token still refused; boundary clears any browser-sent identity", async () => {
  authorization = null;
  let seen: unknown = "untouched";
  await serverOf(testOfficeBoundary)({ context: { officeIdentity: { roles: ["admin"] } }, serverFnMeta: ALLOWED, next: async (a: { context?: Record<string, unknown> } = {}) => { seen = a.context?.["officeIdentity"]; return {}; } });
  expect(seen).toBeNull();
  await expect(serverCall(ctx => access.requireOfficeIdentity(ctx.supabase))).rejects.toThrow("Unauthorized: No authorization header provided");
});

test("requireSupabaseAuth without a boundary identity keeps its own getClaims check", async () => {
  await serverOf(requireSupabaseAuth)({ context: {}, next: async () => ({}) });
  expect(getClaimsCalls).toBe(1);
});

test("identity issued for another token is not reused by requireSupabaseAuth", async () => {
  const issued: { id?: unknown } = {};
  await serverOf(testOfficeBoundary)({ context: {}, serverFnMeta: ALLOWED, next: async (a: { context?: Record<string, unknown> } = {}) => { issued.id = a.context?.["officeIdentity"]; return {}; } });
  authorization = `Bearer ${tokenFor("user-2")}`;
  let ctxUser: unknown;
  await serverOf(requireSupabaseAuth)({ context: { officeIdentity: issued.id }, next: async (a: { context?: Record<string, unknown> } = {}) => { ctxUser = a.context?.["userId"]; return {}; } });
  expect(getClaimsCalls).toBe(1); expect(ctxUser).toBe("user-2");
});

test("expired token is still refused before any handler work", async () => {
  authorization = `Bearer ${tokenFor(userId, Math.floor(Date.now() / 1000) - 10)}`;
  // The fake auth server accepts it, so this proves requireSupabaseAuth keeps its own exp check when reusing.
  const handler = mock(async () => "ran");
  await expect(serverCall(handler)).rejects.toThrow("Unauthorized: Invalid token");
  expect(handler).not.toHaveBeenCalled();
});

test("TEST office function allowlist still enforced at the boundary", async () => {
  roles = ["qa_office"]; email = "office@hivic-test.example";
  await expect(serverCall(async () => "ran", {}, { filename: "src/lib/office-settings.functions.ts", name: "saveOfficeSettings" })).rejects.toThrow("Not available for the TEST office login");
});

// Every access decision must match the old per-helper path (raw client, no context) exactly.
const scenarios: { roles: string[]; email: string; verified: boolean; scope?: boolean }[] = [
  { roles: ["admin"], email: "admin@example.com", verified: true },
  { roles: ["admin", "owner"], email: "admin@example.com", verified: false },
  { roles: ["qa_office"], email: "office@hivic-test.example", verified: true },
  { roles: ["qa_office"], email: "office@hivic-test.example", verified: true, scope: false },
  { roles: ["qa_office"], email: "office@hivic-test.example", verified: false },
  { roles: ["qa_office"], email: "office@example.com", verified: true },
  { roles: ["qa_office", "admin"], email: "office@hivic-test.example", verified: true },
  { roles: ["owner"], email: "owner@example.com", verified: true },
  { roles: ["installer", "electrician"], email: "trade@example.com", verified: true },
  { roles: [], email: "nobody@example.com", verified: true },
];
const ops: [string, (c: Parameters<typeof access.requireOfficeIdentity>[0]) => Promise<unknown>][] = [
  ["requireOfficeIdentity", c => access.requireOfficeIdentity(c)],
  ["requireOfficeJob real", c => access.requireOfficeJob(c, "real-job")],
  ["requireOfficeJob TEST", c => access.requireOfficeJob(c, "test-job-1")],
  ["officeTestJobIds", c => access.officeTestJobIds(c)],
  ["requireOfficeBusiness", c => access.requireOfficeBusiness(c, "biz")],
];
for (const s of scenarios) for (const [name, op] of ops) {
  test(`same decision ${name}: roles=[${s.roles}] verified=${s.verified} ${s.email}${s.scope === false ? " scope refused" : ""}`, async () => {
    roles = s.roles; email = s.email; verified = s.verified; scopeAllowed = s.scope ?? true;
    const before = await settle(op(fakeClient() as never));
    // The boundary itself refuses unverified/mixed TEST office before any handler, with the same identity message.
    const after = await settle(serverCall(ctx => op(ctx.supabase)));
    if ("err" in after && "ok" in before) throw new Error(`new path refused (${after.err}) where old path allowed`);
    if ("ok" in after) { expect(after).toEqual(before); return; }
    expect("err" in before).toBe(true);
    // Refusal text is the old helper's, or the boundary's own (unchanged) refusal for this identity.
    const boundaryOnly = await settle(serverCall(async () => "ran"));
    expect([(before as { err: string }).err, "err" in boundaryOnly ? boundaryOnly.err : null]).toContain(after.err);
  });
}
