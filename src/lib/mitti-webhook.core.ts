// Pure helpers for the instant "Mitti form changed" notice. No I/O.

export const MITTI_NOTICE_EVENTS = ["audit.updated", "audit.completed"] as const;

/** Constant-time check of the URL token against the configured token. Missing or empty fails closed. */
export function mittiNoticeTokenOk(urlToken: string | null, envToken: string | undefined): boolean {
  if (!envToken || urlToken === null) return false;
  if (urlToken.length !== envToken.length) return false;
  let diff = 0;
  for (let i = 0; i < envToken.length; i++) {
    diff |= urlToken.charCodeAt(i) ^ envToken.charCodeAt(i);
  }
  return diff === 0;
}

function auditIdOf(node: unknown): string | null {
  if (node === null || typeof node !== "object") return null;
  const id = (node as Record<string, unknown>)["audit_id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Reads a string `audit_id` from `$`, `$.data`, then `$.event.data`. Anything else is null. */
export function mittiNoticeAuditId(raw: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const event = root["event"];
  return (
    auditIdOf(root) ??
    auditIdOf(root["data"]) ??
    auditIdOf(event && typeof event === "object" ? (event as Record<string, unknown>)["data"] : undefined)
  );
}

/** Shape of a notice with no audit id, for one log line: top-level JSON key names only (never values), "not json"
 * when the body isn't JSON, and no keys for an array or scalar. Lets us learn Mitti's real body shape safely. */
export function mittiNoticeBodyKeys(raw: string): string[] | "not json" {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "not json";
  }
  return body !== null && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
}
