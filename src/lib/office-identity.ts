// One verified identity per server call (speed fix #1, 27 Oct 2026).
// The global TEST-office boundary verifies the bearer token with Supabase auth and reads the caller's
// persisted roles ONCE; requireSupabaseAuth binds that identity to the request's Supabase client, and the
// office helpers reuse it instead of re-calling auth.getUser / user_roles / is_admin.
// Only objects issued here by the server are trusted: anything a browser sends in middleware context is a
// different object and is ignored. Clients without a bound identity (scripts, ticks) keep the old full path.
// No imports: safe to load from src/start.ts.

export type OfficeIdentity = Readonly<{
  token: string;
  userId: string;
  email: string | null;
  emailVerified: boolean;
  roles: readonly string[];
}>;

const issued = new WeakSet<object>();
const bound = new WeakMap<object, OfficeIdentity>();

/** Server boundary only: record an identity just verified against Supabase auth for this token. */
export function issueOfficeIdentity(identity: OfficeIdentity): OfficeIdentity {
  const frozen = Object.freeze({ ...identity, roles: Object.freeze([...identity.roles]) });
  issued.add(frozen);
  return frozen;
}

/** The identity only if this server issued it for exactly this bearer token. */
export function trustedOfficeIdentity(value: unknown, token: string): OfficeIdentity | null {
  if (!value || typeof value !== "object" || !issued.has(value)) return null;
  const identity = value as OfficeIdentity;
  return identity.token === token ? identity : null;
}

/** requireSupabaseAuth only: the request's client acts for this verified identity. */
export function bindOfficeIdentity(client: object, identity: OfficeIdentity): void {
  if (issued.has(identity)) bound.set(client, identity);
}

/** The verified identity bound to this request client, or null (callers then do the full check). */
export function officeIdentityFor(client: object): OfficeIdentity | null {
  return bound.get(client) ?? null;
}

/** The token's payload, decoded only (NOT verified); null when malformed. */
export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]*$/.test(part))) return null;
  try {
    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), c => c.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  } catch { return null; }
}

/** Claims of a token the auth server already verified for this identity; same local checks getClaims makes. */
export function verifiedTokenClaims(token: string, identity: OfficeIdentity): Record<string, unknown> & { sub: string } {
  const claims = decodeTokenPayload(token);
  if (!claims) throw new Error("Unauthorized: Invalid token");
  const exp = claims["exp"];
  if (typeof exp !== "number" || exp <= Math.floor(Date.now() / 1000)) throw new Error("Unauthorized: Invalid token");
  if (!claims["sub"]) throw new Error("Unauthorized: No user ID found in token");
  if (claims["sub"] !== identity.userId) throw new Error("Unauthorized: Invalid token");
  return claims as Record<string, unknown> & { sub: string };
}
