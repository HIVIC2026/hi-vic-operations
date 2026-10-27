// Pure: decide whether ONE Mitti call made by the running portal is a TEST call that must go to the persistent
// simulated Mitti (Jo 27 Oct). Anything not positively identified as TEST returns null and goes to real Mitti exactly
// as before. No I/O here.
import { TEST_MITTI_ASSIGNEE } from "./onsite-ready-check.core";

export const TEST_EMAIL_DOMAIN = "hivic-test.example";
export const SIM_ID_PREFIX = "sim_";

/** TEST people: anyone on the reserved TEST domain, or the Mitti user TEST partners are assigned to. */
export function isTestMittiEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  if (!e) return false;
  return e.endsWith(`@${TEST_EMAIL_DOMAIN}`) || e === TEST_MITTI_ASSIGNEE.toLowerCase();
}

export const isSimId = (id: unknown) => typeof id === "string" && id.startsWith(SIM_ID_PREFIX);

/** Audit id a path addresses (/audits/{id}[/…] or /inspections/v1/inspections/{id}/owner), else null. */
export function auditIdOfPath(path: string): string | null {
  const p = path.split("?")[0]!;
  const m = /^\/audits\/([^/]+)/.exec(p) ?? /^\/inspections\/v1\/inspections\/([^/]+)/.exec(p);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Every string anywhere in a request body (emails, user ids, share ids). */
function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out);
  else if (x && typeof x === "object") for (const v of Object.values(x)) strings(v, out);
  return out;
}

const EMAIL_IN_TEXT = /[^\s"'<>(),;:]+@[^\s"'<>(),;:]+/g;

/**
 * Reason this call is TEST, or null (real Mitti). `storedSim` = audit ids already stored as simulated.
 * - users search / audit create whose body names a TEST person;
 * - any call whose path addresses a sim_ audit or a stored simulated audit;
 * - share / owner calls handing a form to a sim_ user.
 * Template reads carry no person, so they are routed by the flow that made them (see mitti.server `mittiCallFor`).
 */
export function testMittiRoute(method: string, path: string, body: unknown, storedSim: (id: string) => boolean = () => false): string | null {
  const audit = auditIdOfPath(path);
  if (audit && (isSimId(audit) || storedSim(audit))) return `simulated audit ${audit}`;
  const vals = strings(body);
  if (vals.some((v) => isSimId(v))) return "simulated Mitti user";
  const emails = vals.flatMap((v) => v.match(EMAIL_IN_TEXT) ?? []);
  if (emails.some(isTestMittiEmail)) return `TEST person in ${method} ${path.split("?")[0]}`;
  return null;
}
