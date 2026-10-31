// Task 4 (installer one second): network auth/DB trips the middleware chain makes per server function call.
// Runs the real supabase-js clients of `testOfficeBoundary` + `requireSupabaseAuth` against a fake Supabase that
// signs ES256 tokens like the live project (one EC key published in the JWKS), counts every request it serves and
// records how many are in flight at once (sequential rounds vs one parallel round).
import { beforeAll, describe, expect, mock, test } from "bun:test";

let currentRequest: Request | undefined;
mock.module("@tanstack/react-start", () => ({
  createMiddleware: () => ({ server: (server: unknown) => ({ server }) }),
}));
mock.module("@tanstack/react-start/server", () => ({ getRequest: () => currentRequest }));

const { testOfficeBoundary } = await import("../src/lib/qa-office-boundary");
const { requireSupabaseAuth } = await import("../src/integrations/supabase/auth-middleware");
const { TEST_OFFICE_UNAVAILABLE } = await import("../src/lib/qa-office-policy.core");

type Person = { id: string; email: string | null; confirmed: boolean; roles: string[] };
type Trips = { jwks: number; user: number; roles: number; other: number; maxInFlight: number; rounds: number };
const KEY = "sb_publishable_trip_counter";
const b64url = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64url");
const zero = (): Trips => ({ jwks: 0, user: 0, roles: 0, other: 0, maxInFlight: 0, rounds: 0 });

const issued = new Map<string, Person>();   // tokens the fake Auth server issued itself
const signedOut = new Set<string>();         // sessions ended: GoTrue answers session_not_found
let userFault: null | "500" | "other-id" = null, rolesFault = false;
let trips = zero(), inFlight = 0;
let signer: CryptoKey, publicJwk: JsonWebKey, otherSigner: CryptoKey;
const KID = "13cbb243-test-kid";

async function token(person: Person, claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; alg?: string; kid?: string | null; exp?: number } = {}) {
  const header: Record<string, unknown> = { alg: opts.alg ?? "ES256", typ: "JWT" };
  if (opts.kid !== null) header["kid"] = opts.kid ?? KID;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: person.id, aud: "authenticated", role: "authenticated", iat: now, exp: opts.exp ?? now + 3600, session_id: crypto.randomUUID(),
    email: person.email ?? undefined, is_anonymous: false, user_metadata: { email_verified: person.confirmed }, app_metadata: {},
    ...claims,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, opts.key ?? signer, new TextEncoder().encode(signingInput)));
  const jwt = `${signingInput}.${b64url(sig)}`;
  if (!opts.key || opts.key === signer) issued.set(jwt, person);
  return jwt;
}

async function fakeSupabase(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const bearer = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (inFlight === 0) trips.rounds++;
  inFlight++; trips.maxInFlight = Math.max(trips.maxInFlight, inFlight);
  await new Promise(resolve => setTimeout(resolve, 5));   // network latency: a sequential caller cannot overlap
  inFlight--;
  if (url.pathname === "/auth/v1/.well-known/jwks.json") { trips.jwks++; return json(200, { keys: [{ ...publicJwk, kid: KID, alg: "ES256", use: "sig" }] }); }
  if (url.pathname === "/auth/v1/user") {
    trips.user++;
    if (userFault === "500") return json(500, { code: 500, msg: "upstream down" });
    const person = issued.get(bearer);
    const exp = Number(JSON.parse(Buffer.from(bearer.split(".")[1] ?? "", "base64url").toString() || "{}").exp ?? 0);
    if (!person || exp * 1000 < Date.now()) return json(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    if (signedOut.has(bearer)) return json(403, { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" });
    const id = userFault === "other-id" ? "99999999-9999-4999-8999-999999999999" : person.id;
    return json(200, { id, aud: "authenticated", role: "authenticated", email: person.email ?? "", email_confirmed_at: person.confirmed ? "2026-10-01T00:00:00Z" : null, app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" });
  }
  if (url.pathname === "/rest/v1/user_roles") {
    trips.roles++;
    if (rolesFault) return json(500, { message: "db down" });
    const person = issued.get(bearer);
    const id = url.searchParams.get("user_id")?.replace(/^eq\./, "");
    if (!person || person.id !== id) return json(200, []);   // RLS: other users' rows invisible
    return json(200, person.roles.map(role => ({ role })));
  }
  trips.other++;
  return json(404, {});
}

const INSTALLER: Person = { id: "11111111-1111-4111-8111-111111111111", email: "sam@samsinsulation.com.au", confirmed: true, roles: ["installer"] };
const OFFICE: Person = { id: "22222222-2222-4222-8222-222222222222", email: "jo@homeinsulationvictoria.com.au", confirmed: true, roles: ["admin"] };
const TEST_OFFICE: Person = { id: "33333333-3333-4333-8333-333333333333", email: "office@hivic-test.example", confirmed: true, roles: ["qa_office"] };
const REAL_EMAIL_QA: Person = { id: "44444444-4444-4444-8444-444444444444", email: "someone@gmail.com", confirmed: true, roles: ["qa_office", "installer"] };
const SOLO_REAL_EMAIL_QA: Person = { id: "55555555-5555-4555-8555-555555555555", email: "renamed@gmail.com", confirmed: true, roles: ["qa_office"] };
const ALLOWED = { filename: "src/lib/office-screens.functions.ts", name: "getNeedsMePage" };
const NOT_ALLOWED = { filename: "src/lib/trade-view.functions.ts", name: "getTradeHome" };
const SIGN_IN = "Office sign-in required.";
const MIXED = "A dedicated qa_office role is required; mixed roles are refused.";
const NOT_TEST_IDENTITY = "A verified TEST-domain office identity is required.";

type Mw = { server: (ctx: Record<string, unknown>) => Promise<unknown> };
/** One server function call through the global boundary and then the function's own requireSupabaseAuth. */
async function call(jwt: string | null, fn = NOT_ALLOWED): Promise<{ trips: Trips; result: "ok" | string }> {
  trips = zero();
  currentRequest = new Request("https://portal.example/_serverFn/x", { method: "POST", headers: jwt ? { authorization: `Bearer ${jwt}` } : {} });
  try {
    await (testOfficeBoundary as unknown as Mw).server({
      serverFnMeta: fn,
      next: () => (requireSupabaseAuth as unknown as Mw).server({ next: async () => "handler ran" }),
    });
    return { trips, result: "ok" };
  } catch (error) {
    return { trips, result: error instanceof Error ? error.message : String(error) };
  } finally { userFault = null; rolesFault = false; }
}
const ONE_ROUND = { jwks: 0, user: 1, roles: 1, other: 0, maxInFlight: 2, rounds: 1 };

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  signer = pair.privateKey; publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  otherSigner = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])).privateKey;
  globalThis.fetch = fakeSupabase as typeof fetch;
  process.env["SUPABASE_URL"] = "https://tripcount.supabase.co";
  process.env["SUPABASE_PUBLISHABLE_KEY"] = KEY;
  await call(await token(INSTALLER));  // warm isolate: the JWKS is fetched once and cached for 10 minutes
});

describe("every caller: getUser + user_roles both run, in one parallel round (warm isolate)", () => {
  test("normal installer", async () => {
    const r = await call(await token(INSTALLER));
    expect(r.result).toBe("ok");
    expect(r.trips).toEqual(ONE_ROUND);
  });
  test("real office user", async () => {
    const r = await call(await token(OFFICE), { filename: "src/lib/office-settings.functions.ts", name: "saveOfficeSettings" });
    expect(r.result).toBe("ok");
    expect(r.trips).toEqual(ONE_ROUND);
  });
  test("TEST office: allowlisted passes, everything else refused, same one round", async () => {
    const allowed = await call(await token(TEST_OFFICE), ALLOWED);
    expect(allowed.result).toBe("ok");
    expect(allowed.trips).toEqual(ONE_ROUND);
    const denied = await call(await token(TEST_OFFICE), NOT_ALLOWED);
    expect(denied.result).toBe(TEST_OFFICE_UNAVAILABLE);
    expect(denied.trips).toEqual(ONE_ROUND);
  });
  test("cold isolate: one JWKS fetch first, then the same single parallel round", async () => {
    process.env["SUPABASE_URL"] = "https://tripcold.supabase.co";
    try {
      const first = await call(await token(INSTALLER));
      expect(first.result).toBe("ok");
      expect(first.trips).toEqual({ jwks: 1, user: 1, roles: 1, other: 0, maxInFlight: 2, rounds: 2 });
      expect((await call(await token(OFFICE))).trips).toEqual(ONE_ROUND);
    } finally { process.env["SUPABASE_URL"] = "https://tripcount.supabase.co"; }
  });
});

describe("same deny outcomes as before", () => {
  test("signed-out (revoked session) but unexpired token is refused", async () => {
    for (const person of [INSTALLER, OFFICE, TEST_OFFICE]) {
      const jwt = await token(person);
      signedOut.add(jwt);
      expect((await call(jwt, ALLOWED)).result).toBe(SIGN_IN);
    }
  });
  test("qa_office on a real email is blocked everywhere, even allowlisted functions", async () => {
    for (const fn of [ALLOWED, NOT_ALLOWED]) {
      expect((await call(await token(REAL_EMAIL_QA), fn)).result).toBe(MIXED);
      expect((await call(await token(SOLO_REAL_EMAIL_QA), fn)).result).toBe(NOT_TEST_IDENTITY);
    }
  });
  test("TEST office outside the allowlist, whatever its token claims say", async () => {
    for (const claims of [{}, { email: undefined }, { email: "boss@homeinsulationvictoria.com.au" }, { user_metadata: { email_verified: false } }]) {
      // Signed by the project key, so this models stale claims (e.g. an email changed since issue); Auth's record decides.
      expect((await call(await token(TEST_OFFICE, claims), NOT_ALLOWED)).result).toBe(TEST_OFFICE_UNAVAILABLE);
    }
  });
  test("unconfirmed TEST office and mixed roles are refused on allowlisted functions", async () => {
    expect((await call(await token({ ...TEST_OFFICE, confirmed: false }, { user_metadata: { email_verified: true } }), ALLOWED)).result).toBe(NOT_TEST_IDENTITY);
    expect((await call(await token({ ...TEST_OFFICE, roles: ["qa_office", "admin"] }), ALLOWED)).result).toBe(MIXED);
  });
  test("getUser failure, or a getUser id that differs from the verified sub, is refused", async () => {
    userFault = "500";
    expect((await call(await token(INSTALLER))).result).toBe(SIGN_IN);
    userFault = "other-id";
    expect((await call(await token(INSTALLER))).result).toBe(SIGN_IN);
  });
  test("user_roles failure is refused", async () => {
    rolesFault = true;
    expect((await call(await token(INSTALLER))).result).toBe("Office permissions could not be checked.");
  });
  test("expired, other-key, tampered and garbage tokens are refused", async () => {
    expect((await call(await token(INSTALLER, {}, { exp: Math.floor(Date.now() / 1000) - 60 }))).result).toBe(SIGN_IN);
    expect((await call(await token(INSTALLER, {}, { key: otherSigner }))).result).toBe(SIGN_IN);
    const [h, , s] = (await token(INSTALLER)).split(".");
    const forged = `${h}.${b64url(JSON.stringify({ sub: OFFICE.id, email: OFFICE.email, exp: Math.floor(Date.now() / 1000) + 3600 }))}.${s}`;
    expect((await call(forged)).result).toBe(SIGN_IN);
    expect((await call("not.a.jwt")).result).not.toBe("ok");
  });
  test("legacy HS256 / kid-less token is verified by Auth (getClaims -> getUser) and still gets both checks", async () => {
    const r = await call(await token(INSTALLER, {}, { alg: "HS256", kid: null }));
    expect(r.result).toBe("ok");
    expect(r.trips.roles).toBe(1);
    expect(r.trips.user).toBeGreaterThanOrEqual(2);
    expect((await call(await token(TEST_OFFICE, {}, { alg: "HS256", kid: null }))).result).toBe(TEST_OFFICE_UNAVAILABLE);
    expect((await call(await token(INSTALLER, {}, { alg: "HS256", kid: null, key: otherSigner }))).result).toBe(SIGN_IN);
  });
  test("no bearer leaves the boundary to the handler as today", async () => {
    const none = await call(null);
    expect(none.trips).toEqual(zero());
    expect(none.result).toBe("Unauthorized: No authorization header provided");
  });
});
