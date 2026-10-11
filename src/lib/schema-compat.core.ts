// Deployment compatibility (pure): recognise "this database object isn't deployed yet" errors from PostgREST/Postgres,
// so code that depends on a STAGED (not yet applied) migration degrades to the pre-migration behaviour instead of
// failing every request. Other errors (permission, constraint, duplicate) are never treated as "missing".
export type DbErrorLike = { code?: string | null; message?: string | null } | null | undefined;

const MISSING_CODES = new Set(["42P01", "42883", "PGRST202", "PGRST205"]); // undefined table, undefined function, PostgREST "not in schema cache"

export function isMissingDbObject(e: DbErrorLike): boolean {
  if (!e) return false;
  if (e.code && MISSING_CODES.has(e.code)) return true;
  return /could not find the (function|table)|does not exist|schema cache/i.test(e.message ?? "") && !/permission|violates/i.test(e.message ?? "");
}
