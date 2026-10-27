// No-login owner verification (Jo-approved 5 Oct): 6-digit code by SMS or email unlocks signing on the secure link.
export const CODE_TTL_MIN = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const CODES_PER_HOUR = 5;
export const SESSION_TTL_MIN = 30;

export function newCode(rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32): string {
  return String(Math.floor(rand() * 1_000_000)).padStart(6, "0");
}

export function maskContact(channel: "sms" | "email", v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (channel === "sms") { const d = s.replace(/\D/g, ""); return d.length < 6 ? null : `•••• ••• ${d.slice(-3)}`; }
  const [u, dom] = s.split("@");
  if (!u || !dom) return null;
  return `${u.slice(0, 1)}•••@${dom}`;
}

export type CodeRow = { attempts: number; expires_at: string; verified_at: string | null };

/** Why this code can't be checked any more (null = may check). */
export function codeBlocker(r: CodeRow | null, now = Date.now()): string | null {
  if (!r) return "Please ask for a new code.";
  if (r.verified_at) return "That code has already been used. Ask for a new one.";
  if (Date.parse(r.expires_at) <= now) return "That code has expired. Ask for a new one.";
  if (r.attempts >= CODE_MAX_ATTEMPTS) return "Too many tries. Ask for a new code.";
  return null;
}

export function requestBlocker(sentLastHour: number): string | null {
  return sentLastHour >= CODES_PER_HOUR ? "You've asked for a lot of codes. Please wait an hour and try again." : null;
}

export function sessionUsable(r: { session_expires_at: string | null } | null, now = Date.now()): boolean {
  return !!r?.session_expires_at && Date.parse(r.session_expires_at) > now;
}

export const isCode = (v: unknown): v is string => typeof v === "string" && /^\d{6}$/.test(v);

/** Jo 27 Oct 13:15: TEST-only stored code copy for the screen walk-through. Persisted qa_test job + reserved TEST-domain
 * owner email + email channel only; every real owner returns false, so nothing extra is stored. */
export function qaOwnerCodeCopyAllowed(persistedSource: string | null | undefined, channel: "sms" | "email", ownerEmail: string | null | undefined): boolean {
  return persistedSource === "qa_test" && channel === "email" && /^[^@\s]+@(?:[a-z0-9-]+\.)*hivic-test\.example$/i.test((ownerEmail ?? "").trim());
}
