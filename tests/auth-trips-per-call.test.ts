// Task 4 (installer one second): network auth/DB trips the middleware chain makes per server function call.
// Runs the real supabase-js clients of `testOfficeBoundary` + `requireSupabaseAuth` against a fake Supabase that
// signs ES256 tokens like the live project (one EC key published in the JWKS) and counts every request it serves.
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

let currentRequest: Request | undefined;
mock.module("@tanstack/react-start", () => ({
  createMiddleware: () => ({ server: (server: unknown) => ({ server }) }),
}));
mock.module("@tanstack/react-start/server", () => ({ getRequest: () => currentRequest }));

const { testOfficeBoundary } = await import("../src/lib/qa-office-boundary");
const { requireSupabaseAuth } = await import("../src/integrations/supabase/auth-middleware");
const { TEST_OFFICE_UNAVAILABLE, qaOfficeClaimsMayBeTestOffice } = await import("../src/lib/qa-office-policy.core");

type Person = { id: string; email: string | null; confirmed: boolean; roles: string[] };
type Trips = { jwks: number; user: number; roles: number; other: number };
const KEY = "sb_publishable_trip_counter";
const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");

const issued = new Map<string, Person>();   // tokens the fake Auth server accepts on GET /user
let trips: Trips = { jwks: 0, user: 0, roles: 0, other: 0 };
let signer: CryptoKey, publicJwk: JsonWebKey, otherSigner: CryptoKey;
const KID = "13cbb243-test-kid";

async function token(person: Person, claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; alg?: string; kid?: string | null; exp?: number } = {}) {
  const header: Record<string, unknown> = { alg: opts.alg ?? "ES256", typ: "JWT" };
  if (opts.kid !== null) header["kid"] = opts.kid ?? KID;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: person.id, aud: "authenticated", role: "authenticated", iat: now, exp: opts.exp ?? now + 3600,
    email: person.email ?? undefined, is_anonymous: false, user_metadata: { email_verified: person.confirmed }, app_metadata: {},
    ...claims,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, opts.key ?? signer, new TextEncoder().encode(signingInput)));
  const jwt = `${signingInput}.${b64url(sig)}`;
  // The fake Auth server only honours what it issued itself, and never after expiry (like GoTrue).
  if (!opts.key || opts.key === signer) issued.set(jwt, person);
  return jwt;
}

function fakeSupabase(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const bearer = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  if (url.pathname === "/auth/v1/.well-known/jwks.json") { trips.jwks++; return json(200, { keys: [{ ...publicJwk, kid: KID, alg: "ES256", use: "sig" }] }); }
  if (url.pathname === "/auth/v1/user") {
    trips.user++;
    const person = issued.get(bearer);
    const exp = Number(JSON.parse(Buffer.from(bearer.split(".")[1] ?? "", "base64url").toString() || "{}").exp ?? 0);
    if (!person || exp * 1000 < Date.now()) return json(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    return json(200, { id: person.id, aud: "authenticated", role: "authenticated", email: person.email ?? "", email_confirmed_at: person.confirmed ? "2026-10-01T00:00:00Z" : null, app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" });
  }
  if (url.pathname === "/rest/v1/user_roles") {
    trips.roles++;
    const person = issued.get(bearer);
    const id = url.searchParams.get("user_id")?.replace(/^eq\./, "");
    if (!person || person.id !== id) return json(401, { message: "JWT invalid" });
    return json(200, person.roles.map(role => ({ role })));
  }
  trips.other++;
  return json(404, {});
}

const INSTALLER: Person = { id: "11111111-1111-4111-8111-111111111111", email: "sam@samsinsulation.com.au", confirmed: true, roles: ["installer"] };
const OFFICE: Person = { id: "22222222-2222-4222-8222-222222222222", email: "jo@homeinsulationvictoria.com.au", confirmed: true, roles: ["admin"] };
const TEST_OFFICE: Person = { id: "33333333-3333-4333-8333-333333333333", email: "office@hivic-test.example", confirmed: true, roles: ["qa_office"] };
const ALLOWED = { filename: "src/lib/office-screens.functions.ts", name: "getNeedsMePage" };
const NOT_ALLOWED = { filename: "src/lib/trade-view.functions.ts", name: "getTradeHome" };

type Mw = { server: (ctx: Record<string, unknown>) => Promise<unknown> };
/** One server function call through the global boundary and then the function's own requireSupabaseAuth. */
async function call(jwt: string | null, fn = NOT_ALLOWED): Promise<{ trips: Trips; result: "ok" | string }> {
  trips = { jwks: 0, user: 0, roles: 0, other: 0 };
  currentRequest = new Request("https://portal.example/_serverFn/x", { method: "POST", headers: jwt ? { authorization: `Bearer ${jwt}` } : {} });
  try {
    await (testOfficeBoundary as unknown as Mw).server({
      serverFnMeta: fn,
      next: () => (requireSupabaseAuth as unknown as Mw).server({ next: async () => "handler ran" }),
    });
    return { trips, result: "ok" };
  } catch (error) {
    return { trips, result: error instanceof Error ? error.message : String(error) };
  }
}
const middlewareTrips = (t: Trips) => t.jwks + t.user + t.roles + t.other;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  signer = pair.privateKey; publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  otherSigner = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])).privateKey;
  globalThis.fetch = fakeSupabase as typeof fetch;
  process.env["SUPABASE_URL"] = "https://tripcount.supabase.co";
  process.env["SUPABASE_PUBLISHABLE_KEY"] = KEY;
  await call(await token(INSTALLER));  // warm isolate: the JWKS is fetched once and cached for 10 minutes
});
beforeEach(() => { trips = { jwks: 0, user: 0, roles: 0, other: 0 }; });

describe("trips per call (warm isolate)", () => {
  test("normal installer: no Auth or user_roles trip before the handler", async () => {
    const r = await call(await token(INSTALLER));
    expect(r.result).toBe("ok");
    expect(r.trips).toEqual({ jwks: 0, user: 0, roles: 0, other: 0 });
  });
  test("real office user: no Auth or user_roles trip before the handler", async () => {
    const r = await call(await token(OFFICE), { filename: "src/lib/office-settings.functions.ts", name: "saveOfficeSettings" });
    expect(r.result).toBe("ok");
    expect(middlewareTrips(r.trips)).toBe(0);
  });
  test("TEST office: keeps today's full check (getUser + user_roles) and its allowlist", async () => {
    const allowed = await call(await token(TEST_OFFICE), ALLOWED);
    expect(allowed.result).toBe("ok");
    expect(allowed.trips).toEqual({ jwks: 0, user: 1, roles: 1, other: 0 });
    const denied = await call(await token(TEST_OFFICE), NOT_ALLOWED);
    expect(denied.result).toBe(TEST_OFFICE_UNAVAILABLE);
    expect(denied.trips).toEqual({ jwks: 0, user: 1, roles: 1, other: 0 });
  });
  test("cold isolate fetches the JWKS once, then verifies locally", async () => {
    process.env["SUPABASE_URL"] = "https://tripcold.supabase.co";
    try {
      const first = await call(await token(INSTALLER));
      expect(first.result).toBe("ok");
      expect(first.trips).toEqual({ jwks: 1, user: 0, roles: 0, other: 0 });
      const second = await call(await token(OFFICE));
      expect(middlewareTrips(second.trips)).toBe(0);
    } finally { process.env["SUPABASE_URL"] = "https://tripcount.supabase.co"; }
  });
});

describe("fail-closed: the claims can only skip the check for a confirmed non-TEST email", () => {
  test("TEST office spelled in upper case / with spaces still gets the full check and the allowlist", async () => {
    for (const email of ["OFFICE@HIVIC-TEST.EXAMPLE", " office@hivic-test.example "]) {
      const r = await call(await token(TEST_OFFICE, { email }), NOT_ALLOWED);
      expect(r.result).toBe(TEST_OFFICE_UNAVAILABLE);
      expect(r.trips.user + r.trips.roles).toBe(2);
    }
  });
  test("missing email claim falls back to the full check (TEST office still blocked)", async () => {
    for (const claims of [{ email: undefined }, { email: "" }, { email: null }, { email: 42 }]) {
      const r = await call(await token(TEST_OFFICE, claims), NOT_ALLOWED);
      expect(r.result).toBe(TEST_OFFICE_UNAVAILABLE);
      expect(r.trips).toEqual({ jwks: 0, user: 1, roles: 1, other: 0 });
    }
  });
  test("unconfirmed email claim falls back to the full check", async () => {
    const r = await call(await token(INSTALLER, { user_metadata: { email_verified: false } }));
    expect(r.result).toBe("ok");
    expect(r.trips).toEqual({ jwks: 0, user: 1, roles: 1, other: 0 });
    const meta = await call(await token(INSTALLER, { user_metadata: "not-an-object" }));
    expect(meta.trips.user + meta.trips.roles).toBe(2);
  });
  test("anonymous sign-in falls back to the full check", async () => {
    const r = await call(await token(INSTALLER, { is_anonymous: true }));
    expect(r.trips).toEqual({ jwks: 0, user: 1, roles: 1, other: 0 });
  });
  test("full check still decides on the server record: unconfirmed TEST office refused on allowlisted functions", async () => {
    const r = await call(await token({ ...TEST_OFFICE, confirmed: false }, { user_metadata: { email_verified: true } }), ALLOWED);
    expect(r.result).toBe("A verified TEST-domain office identity is required.");
  });
  test("mixed qa_office + admin roles stay refused", async () => {
    const r = await call(await token({ ...TEST_OFFICE, roles: ["qa_office", "admin"] }), ALLOWED);
    expect(r.result).toBe("A dedicated qa_office role is required; mixed roles are refused.");
  });
  test("pure predicate", () => {
    const ok = { sub: "x", email: "a@b.com", user_metadata: { email_verified: true } };
    expect(qaOfficeClaimsMayBeTestOffice(ok)).toBe(false);
    expect(qaOfficeClaimsMayBeTestOffice({ ...ok, user_metadata: {} })).toBe(false); // absent flag: not an explicit "unconfirmed"
    for (const bad of [
      { ...ok, email: "x@hivic-test.example" }, { ...ok, email: "x@sub.HIVIC-TEST.example" }, { ...ok, email: "hivic-test@gmail.com" },
      { ...ok, email: undefined }, { ...ok, email: "  " }, { ...ok, email: "no-at-sign" }, { ...ok, is_anonymous: true },
      { ...ok, user_metadata: { email_verified: false } }, { ...ok, user_metadata: { email_verified: "true" } }, { ...ok, user_metadata: null },
      null, undefined, "string",
    ]) expect(qaOfficeClaimsMayBeTestOffice(bad as never)).toBe(true);
  });
});

describe("invalid tokens are still refused", () => {
  test("expired token is refused before any handler runs", async () => {
    const r = await call(await token(INSTALLER, {}, { exp: Math.floor(Date.now() / 1000) - 60 }));
    expect(r.result).not.toBe("ok");
  });
  test("token signed by another key is refused", async () => {
    const r = await call(await token(INSTALLER, {}, { key: otherSigner }));
    expect(r.result).not.toBe("ok");
  });
  test("tampered payload is refused", async () => {
    const good = await token(INSTALLER);
    const [h, , s] = good.split(".");
    const forged = `${h}.${b64url(JSON.stringify({ sub: TEST_OFFICE.id, email: "boss@homeinsulationvictoria.com.au", exp: Math.floor(Date.now() / 1000) + 3600 }))}.${s}`;
    const r = await call(forged);
    expect(r.result).not.toBe("ok");
  });
  test("legacy HS256 / kid-less token falls back to Auth server verification", async () => {
    const r = await call(await token(INSTALLER, {}, { alg: "HS256", kid: null }));
    expect(r.trips.user).toBeGreaterThanOrEqual(1);   // getClaims -> getUser fallback, never trusted unverified
    const forged = await call(await token(INSTALLER, {}, { alg: "HS256", kid: null, key: otherSigner }));
    expect(forged.result).not.toBe("ok");
  });
  test("garbage bearer refused; no bearer leaves the boundary to the handler as today", async () => {
    expect((await call("not.a.jwt")).result).not.toBe("ok");
    const none = await call(null);
    expect(none.trips).toEqual({ jwks: 0, user: 0, roles: 0, other: 0 });
    expect(none.result).toBe("Unauthorized: No authorization header provided");
  });
});
