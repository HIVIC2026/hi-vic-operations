/** Exact, case-insensitive match for PostgREST ilike: escapes the % _ and \\ wildcards so "a_b@x" never matches "axb@x". */
export function exactLike(value: string): string {
  return value.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}
