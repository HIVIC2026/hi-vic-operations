// Portal speed Task 2: office checks reuse the boundary middleware's check of THIS request (context.boundary)
// instead of re-reading getUser + user_roles + is_admin (3 sequential round trips). Same decisions, same wording.
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";

let currentRequest: Request | undefined;
mock.module("@tanstack/react-start", () => ({ createMiddleware: () => ({ server: (server: unknown) => ({ server }) }) }));
mock.module("@tanstack/react-start/server", () => ({ getRequest: () => currentRequest }));
// Same body as the real requireAdmin (workflow.server pulls in the service client).
mock.module("../src/lib/workflow.server", () => ({ requireAdmin: async (sb: SupabaseClient) => {
  const { data, error } = await sb.rpc("is_admin");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admin only.");
} }));
let privilegedReads = 0;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  privilegedReads++;
  const result = () => ({ data: table === "jobs" ? { source: "qa_test", deleted_at: null, qa_archived_at: null, owner_id: "owner", property_id: "property", originating_installer_business_id: null, originating_installer_user_id: null }
    : table === "owners" ? { email: "owner@hivic-test.example", user_id: null }
    : table === "properties" ? { owner_id: "owner", managed_by_business_id: null } : [], error: null });
  const q = { select: () => q, eq: () => q, in: () => q, maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
  return q;
} } }));

const { requireOfficeIdentity, requireOfficeJob } = await import("../src/lib/qa-office-access.server");
const { verifiedOfficeBoundary } = await import("../src/lib/office-boundary-context");
const { testOfficeBoundary } = await import("../src/lib/qa-office-boundary");
const { requireSupabaseAuth } = await import("../src/integrations/supabase/auth-middleware");

type Person = { id: string; email: string | null; confirmed: boolean; roles: string[] };
const OFFICE: Person = { id: "22222222-2222-4222-8222-222222222222", email: "jo@homeinsulationvictoria.com.au", confirmed: true, roles: ["admin"] };
const TEST_OFFICE: Person = { id: "33333333-3333-4333-8333-333333333333", email: "office@hivic-test.example", confirmed: true, roles: ["qa_office"] };
const INSTALLER: Person = { id: "11111111-1111-4111-8111-111111111111", email: "sam@samsinsulation.com.au", confirmed: true, roles: ["installer"] };
const REAL_EMAIL_QA: Person = { id: "55555555-5555-4555-8555-555555555555", email: "renamed@gmail.com", confirmed: true, roles: ["qa_office"] };
const MIXED_QA: Person = { ...TEST_OFFICE, roles: ["qa_office", "admin"] };

// ---- Unit: a counting stand-in for the request's Supabase client (what today's path reads). ----
let calls: string[] = [];
let dbPerson: Person = OFFICE;
const client = {
  auth: { getUser: async () => { calls.push("getUser"); return { data: { user: { id: dbPerson.id, email: dbPerson.email, email_confirmed_at: dbPerson.confirmed ? "2026-10-27" : null } }, error: null }; } },
  from: (table: string) => ({ select: () => ({ eq: async () => { calls.push(table); return { data: dbPerson.roles.map(role => ({ role })), error: null }; } }) }),
  rpc: async (name: string, args?: { _job?: string }) => {
    calls.push(name);
    if (name === "is_admin") return { data: dbPerson.roles.includes("admin"), error: null };
    return { data: args?._job === "test-job", error: null };
  },
} as unknown as SupabaseClient<Database>;
const identityCalls = () => calls.filter(c => c === "getUser" || c === "user_roles" || c === "is_admin");
const boundaryOf = (p: Person) => verifiedOfficeBoundary({ userId: p.id, roles: p.roles, email: p.email, emailVerified: p.confirmed });
const ctxOf = (p: Person) => ({ userId: p.id, boundary: boundaryOf(p) });
async function outcome<T>(run: () => Promise<T>): Promise<T | string> {
  try { return await run(); } catch (error) { return `refused: ${error instanceof Error ? error.message : String(error)}`; }
}
beforeEach(() => { calls = []; privilegedReads = 0; });

describe("requireOfficeIdentity with the boundary's check of this request", () => {
  test("real office: no getUser / user_roles / is_admin, same answer as today", async () => {
    dbPerson = OFFICE;
    const today = await outcome(() => requireOfficeIdentity(client));
    expect(identityCalls()).toEqual(["getUser", "user_roles", "is_admin"]);
    calls = [];
    expect(await outcome(() => requireOfficeIdentity(client, ctxOf(OFFICE)))).toBe(today);
    expect(today).toBe("admin");
    expect(calls).toEqual([]);
  });
  test("TEST office: no reads, still the separate qa_office capability", async () => {
    dbPerson = TEST_OFFICE;
    expect(await requireOfficeIdentity(client, ctxOf(TEST_OFFICE))).toBe("qa_office");
    expect(calls).toEqual([]);
  });
  test("every refusal is word-for-word today's (non-admin, real-email TEST office, mixed roles, unconfirmed)", async () => {
    for (const person of [INSTALLER, REAL_EMAIL_QA, MIXED_QA, { ...TEST_OFFICE, confirmed: false }, { ...OFFICE, roles: [] }]) {
      dbPerson = person;
      const today = await outcome(() => requireOfficeIdentity(client));
      expect(String(today)).toStartWith("refused: ");
      expect(await outcome(() => requireOfficeIdentity(client, ctxOf(person)))).toBe(today);
    }
  });
  test("non-admin still asks is_admin (the same source of truth refuses), never getUser/user_roles", async () => {
    dbPerson = INSTALLER;
    expect(await outcome(() => requireOfficeIdentity(client, ctxOf(INSTALLER)))).toBe("refused: Admin only.");
    expect(identityCalls()).toEqual(["is_admin"]);
  });
  test("context missing → today's 3-step check", async () => {
    dbPerson = OFFICE;
    expect(await requireOfficeIdentity(client, undefined)).toBe("admin");
    expect(await requireOfficeIdentity(client, {})).toBe("admin");
    expect(identityCalls()).toEqual(["getUser", "user_roles", "is_admin", "getUser", "user_roles", "is_admin"]);
  });
  test("a boundary for another user than this request's verified token → today's check (the DB decides)", async () => {
    dbPerson = INSTALLER;   // the request's token is the installer's
    expect(await outcome(() => requireOfficeIdentity(client, { userId: INSTALLER.id, boundary: boundaryOf(OFFICE) }))).toBe("refused: Admin only.");
    expect(identityCalls()).toEqual(["getUser", "user_roles", "is_admin"]);
    calls = [];
    expect(await outcome(() => requireOfficeIdentity(client, { boundary: boundaryOf(INSTALLER) }))).toBe("refused: Admin only.");
    expect(identityCalls()).toEqual(["getUser", "user_roles", "is_admin"]);
  });
  test("a look-alike boundary (e.g. sent by a browser in the request context) is never trusted", async () => {
    dbPerson = INSTALLER;
    const forged = { userId: INSTALLER.id, roles: ["admin"], email: OFFICE.email, emailVerified: true };
    for (const boundary of [forged, Object.freeze({ ...boundaryOf(INSTALLER), roles: ["admin"] }), JSON.parse(JSON.stringify(boundaryOf(OFFICE)))]) {
      calls = [];
      expect(await outcome(() => requireOfficeIdentity(client, { userId: INSTALLER.id, boundary }))).toBe("refused: Admin only.");
      expect(identityCalls()).toEqual(["getUser", "user_roles", "is_admin"]);
    }
  });
  test("the boundary record cannot be changed after the check", () => {
    const b = boundaryOf(INSTALLER) as unknown as { roles: string[]; userId: string };
    expect(() => { b.roles.push("admin"); }).toThrow();
    expect(() => { b.userId = OFFICE.id; }).toThrow();
  });
});

describe("requireOfficeJob reuses the same check; TEST isolation unchanged", () => {
  test("admin: no identity reads, no TEST reads", async () => {
    dbPerson = OFFICE;
    expect(await requireOfficeJob(client, "real-job", ctxOf(OFFICE))).toBe("admin");
    expect(calls).toEqual([]);
    expect(privilegedReads).toBe(0);
  });
  test("TEST office: skips identity reads but still runs the job scope RPC + graph check", async () => {
    dbPerson = TEST_OFFICE;
    expect(await requireOfficeJob(client, "test-job", ctxOf(TEST_OFFICE))).toBe("qa_office");
    expect(calls).toEqual(["qa_office_job_allowed"]);
    expect(privilegedReads).toBeGreaterThan(0);
    calls = [];
    expect(await outcome(() => requireOfficeJob(client, "real-job", ctxOf(TEST_OFFICE)))).toBe("refused: Only fully isolated TEST jobs are available to TEST office.");
  });
  test("refusals match today's for non-admin / real-email TEST office / mixed roles", async () => {
    for (const person of [INSTALLER, REAL_EMAIL_QA, MIXED_QA]) {
      dbPerson = person;
      const today = await outcome(() => requireOfficeJob(client, "test-job"));
      expect(String(today)).toStartWith("refused: ");
      expect(await outcome(() => requireOfficeJob(client, "test-job", ctxOf(person)))).toBe(today);
    }
  });
  test("context missing → today's reads", async () => {
    dbPerson = OFFICE;
    expect(await requireOfficeJob(client, "real-job")).toBe("admin");
    expect(identityCalls()).toEqual(["getUser", "user_roles", "is_admin"]);
  });
});

// is_admin() is decided by the same user_roles row the boundary reads. If a migration ever changes either
// function, or the user_roles self-read policy, this fails and the reuse must be re-proved.
test("is_admin() is exactly has_role(auth.uid(),'admin') over user_roles, and users can read their own roles", () => {
  const dir = new URL("../drizzle/migrations/", import.meta.url);
  const sql = readdirSync(dir).filter(f => f.endsWith(".sql")).sort().map(f => readFileSync(new URL(f, dir), "utf8")).join("\n");
  const defs = (name: string) => sql.match(new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${name}\\s*\\(`, "gi")) ?? [];
  expect(defs("is_admin")).toHaveLength(1);
  expect(defs("has_role")).toHaveLength(1);
  expect(sql).toMatch(/function public\.is_admin\(\) returns boolean language sql stable security definer set search_path = public as \$\$\s*select public\.has_role\(auth\.uid\(\), 'admin'\)\s*\$\$/);
  expect(sql).toMatch(/function public\.has_role\(_user_id uuid, _role public\.app_role\)\s*returns boolean language sql stable security definer set search_path = public as \$\$\s*select exists \(select 1 from public\.user_roles where user_id = _user_id and role = _role\)\s*\$\$/);
  expect(sql).toContain(`create policy "self_roles" on public.user_roles for select to authenticated using (user_id = auth.uid());`);
  expect(sql).not.toMatch(/drop\s+policy[^;]*self_roles/i);
  expect(sql).not.toMatch(/drop\s+function[^;]*(is_admin|has_role)/i);
  expect(sql).not.toMatch(/alter\s+function[^;]*(is_admin|has_role)/i);
});

// ---- End to end: the real boundary → real requireSupabaseAuth → handler, against a fake Supabase that counts trips.
const KEY = "sb_publishable_identity_reuse";
const KID = "identity-reuse-kid";
const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");
const issued = new Map<string, Person>();
let signer: CryptoKey, publicJwk: JsonWebKey;
let trips: string[] = [];
async function token(person: Person) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }))}.${b64url(JSON.stringify({ sub: person.id, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600, session_id: crypto.randomUUID(), email: person.email }))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, new TextEncoder().encode(input)));
  const jwt = `${input}.${b64url(sig)}`;
  issued.set(jwt, person);
  return jwt;
}
async function fakeSupabase(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const bearer = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
  const person = issued.get(bearer);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return json(200, { keys: [{ ...publicJwk, kid: KID, alg: "ES256", use: "sig" }] });
  trips.push(url.pathname.replace(/^\/(auth|rest)\/v1\//, ""));
  if (!person) return json(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
  if (url.pathname === "/auth/v1/user") return json(200, { id: person.id, aud: "authenticated", role: "authenticated", email: person.email ?? "", email_confirmed_at: person.confirmed ? "2026-10-01T00:00:00Z" : null, app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" });
  if (url.pathname === "/rest/v1/user_roles") return json(200, url.searchParams.get("user_id") === `eq.${person.id}` ? person.roles.map(role => ({ role })) : []);
  if (url.pathname === "/rest/v1/rpc/is_admin") return json(200, person.roles.includes("admin"));
  return json(404, {});
}
type Mw = { server: (ctx: Record<string, unknown>) => Promise<unknown> };
/** One office server call: global boundary, then requireSupabaseAuth, then the handler (context merged like Start does). */
async function call(jwt: string, clientContext: Record<string, unknown> = {}, reuse = true) {
  trips = [];
  currentRequest = new Request("https://portal.example/_serverFn/x", { method: "POST", headers: { authorization: `Bearer ${jwt}` } });
  const fn = { filename: "src/lib/office-screens.functions.ts", name: "getNeedsMePage" };
  try {
    const result = await (testOfficeBoundary as unknown as Mw).server({
      serverFnMeta: fn, context: clientContext,
      next: (a?: { context?: object }) => {
        const afterBoundary = { ...clientContext, ...a?.context };
        return (requireSupabaseAuth as unknown as Mw).server({ context: afterBoundary, next: (b?: { context?: object }) => {
          const context = { ...afterBoundary, ...b?.context } as { supabase: SupabaseClient<Database>; userId: string; boundary?: unknown };
          return requireOfficeIdentity(context.supabase, reuse ? context : undefined);
        } });
      },
    });
    return { result, trips };
  } catch (error) { return { result: `refused: ${error instanceof Error ? error.message : String(error)}`, trips }; }
}

describe("through the real middleware chain", () => {
  beforeAll(async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    signer = pair.privateKey; publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    globalThis.fetch = fakeSupabase as typeof fetch;
    process.env["SUPABASE_URL"] = "https://identityreuse.supabase.co";
    process.env["SUPABASE_PUBLISHABLE_KEY"] = KEY;
  });
  test("office call: only the boundary's one parallel round; the old path made 3 more trips", async () => {
    const jwt = await token(OFFICE);
    const old = await call(jwt, {}, false);
    expect(old.result).toBe("admin");
    expect(old.trips.sort()).toEqual(["rpc/is_admin", "user", "user", "user_roles", "user_roles"]);
    const now = await call(jwt);
    expect(now.result).toBe("admin");
    expect(now.trips.sort()).toEqual(["user", "user_roles"]);
  });
  test("TEST office call: same, and still qa_office", async () => {
    const r = await call(await token(TEST_OFFICE));
    expect(r.result).toBe("qa_office");
    expect(r.trips.sort()).toEqual(["user", "user_roles"]);
  });
  test("installer forging an admin boundary in the browser-sent context is refused exactly as today", async () => {
    const jwt = await token(INSTALLER);
    const forged = { userId: INSTALLER.id, boundary: { userId: INSTALLER.id, roles: ["admin"], email: OFFICE.email, emailVerified: true } };
    const today = await call(jwt, {}, false);
    expect(today.result).toBe("refused: Admin only.");
    expect((await call(jwt, forged)).result).toBe("refused: Admin only.");
    // a real boundary taken from another user's call is replaced by this request's own
    expect((await call(jwt, { boundary: boundaryOf(OFFICE) })).result).toBe("refused: Admin only.");
  });
  test("no bearer: the boundary hands on no identity (clears any browser-sent one)", async () => {
    currentRequest = new Request("https://portal.example/_serverFn/x", { method: "POST" });
    let handed: unknown = "not called";
    await (testOfficeBoundary as unknown as Mw).server({ serverFnMeta: {}, next: async (a?: { context?: { boundary?: unknown } }) => { handed = a?.context && "boundary" in a.context ? a.context.boundary : "absent"; return "ok"; } });
    expect(handed).toBeUndefined();
  });
});
