// Who the boundary middleware (qa-office-boundary.ts) verified for THIS server call: passed on in the server-only
// middleware context so office checks don't re-read the same user and roles (3 round trips).
// A browser can put any plain object into the request context, so only records the boundary itself created are
// accepted (private WeakSet, not a field or a header), and only for the user this request's own token names.
export type OfficeBoundary = Readonly<{ userId: string; roles: readonly string[]; email: string | null; emailVerified: boolean }>;

const verified = new WeakSet<object>();

/** Only the boundary middleware calls this, after getClaims + getUser + user_roles for the request's bearer token. */
export function verifiedOfficeBoundary(record: { userId: string; roles: string[]; email: string | null; emailVerified: boolean }): OfficeBoundary {
  const boundary: OfficeBoundary = Object.freeze({ ...record, roles: Object.freeze([...record.roles]) });
  verified.add(boundary);
  return boundary;
}

/** The boundary's result if it was made by the boundary and is for the user this request's verified token names; else undefined (callers then run today's full check). */
export function officeBoundaryFor(ctx: { userId?: unknown; boundary?: unknown } | undefined): OfficeBoundary | undefined {
  const boundary = ctx?.boundary;
  if (!boundary || typeof boundary !== "object" || !verified.has(boundary)) return undefined;
  const record = boundary as OfficeBoundary;
  if (typeof ctx?.userId !== "string" || !ctx.userId || record.userId !== ctx.userId) return undefined;
  return record;
}
