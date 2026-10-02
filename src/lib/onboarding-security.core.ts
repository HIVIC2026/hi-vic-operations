// Pure security rules for public partner onboarding (electrician + installer).
// No network or database access here; tested by tests/onboarding-security.test.ts.

/** Application-start limits (Jo-approved 2026-10-02). */
export const START_LIMITS = {
  perFingerprint15Min: 3,
  perFingerprint24h: 5,
  activeDraftsPerContactAndTrade: 2,
} as const;

/** One message for every refusal so nothing reveals whether an email/mobile exists. */
export const START_LIMIT_MESSAGE =
  "We can't start or save another application from here right now. Please try again later, or contact Home Insulation Victoria and we'll help you finish it.";

export type Trade = "rec" | "installer";

/** Rolling-window decision given the start timestamps (ms) already recorded for one fingerprint. */
export function startAllowed(previousStarts: number[], now: number): boolean {
  const in15 = previousStarts.filter((t) => now - t < 15 * 60_000).length;
  const in24 = previousStarts.filter((t) => now - t < 24 * 3_600_000).length;
  return in15 < START_LIMITS.perFingerprint15Min && in24 < START_LIMITS.perFingerprint24h;
}

/** Contact cap: a third simultaneous draft for the same email/mobile + trade is refused. */
export function contactDraftAllowed(otherActiveDrafts: number): boolean {
  return otherActiveDrafts < START_LIMITS.activeDraftsPerContactAndTrade;
}

export function normaliseEmail(e: string | null | undefined): string | null {
  const v = (e ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/** Australian mobile → 04XXXXXXXX, or null. */
export function normaliseMobile(m: string | null | undefined): string | null {
  let v = (m ?? "").replace(/[\s()-]/g, "");
  if (v.startsWith("+61")) v = "0" + v.slice(3);
  else if (v.startsWith("61") && v.length === 11) v = "0" + v.slice(2);
  return /^04\d{8}$/.test(v) ? v : null;
}

/** Wider per-network backstop so clearing the visitor cookie can't bypass limits (rolling, never permanent). */
export const NETWORK_LIMITS = { per15Min: 12, per24h: 20 } as const;
export const VISITOR_COOKIE = "hv_ob";
export const FP_KEY_VERSION = "v1";
export function isVisitorId(v: string | null | undefined): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(v);
}

/**
 * Limiter keys (before HMAC). The visitor key uses the server-issued first-party identifier; the network
 * key uses the edge-reported IP only when present. Nothing here is stored raw.
 */
export function limiterKeys(visitorId: string, ip: string | null, trade: Trade): { kind: "visitor" | "network"; source: string }[] {
  const keys: { kind: "visitor" | "network"; source: string }[] = [{ kind: "visitor", source: `${FP_KEY_VERSION}|visitor|${trade}|${visitorId}` }];
  if (ip && ip.trim()) keys.push({ kind: "network", source: `${FP_KEY_VERSION}|network|${trade}|${ip.trim()}` });
  return keys;
}

// ---------- Test / office authorisations ----------

export type AuthPurpose = "qa_test" | "office_recovery";
export const AUTH_TOKEN_TTL_HOURS = 24;

/** Public request bodies must never carry their own test/sample switch. */
export const FORBIDDEN_PUBLIC_FLAGS = ["test", "test_mode", "sample", "preview", "qa", "is_test"] as const;
export function hasForbiddenFlag(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return FORBIDDEN_PUBLIC_FLAGS.some((k) => k in (body as Record<string, unknown>));
}

/**
 * Signing check. Required-step validation only relaxes for a QA authorisation that
 * explicitly allows incomplete signing; the services confirmation is handled separately
 * by the caller and is never relaxed.
 */
export function mayRelaxRequiredSteps(app: { test_mode: boolean; allow_incomplete_sign: boolean | null }): boolean {
  return app.test_mode === true && app.allow_incomplete_sign === true;
}

// ---------- Insurance file verification ----------

export const INSURANCE_MAX_BYTES = 10 * 1024 * 1024;
export type InsuranceType = "pdf" | "png" | "jpg";
export const INSURANCE_MIME: Record<InsuranceType, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" };
export const SCAN_RESULT_NO_SCANNER = "strict_type_check_passed_no_malware_scanner_available";

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
function lastIndexOfAscii(b: Uint8Array, needle: string, window: number): number {
  const start = Math.max(0, b.length - window);
  return ascii(b, start, b.length).lastIndexOf(needle);
}

export type InsuranceVerdict = { ok: true; type: InsuranceType } | { ok: false; reason: string };

/** Verify actual bytes. Claimed MIME must match the detected type. */
export function verifyInsuranceBytes(b: Uint8Array, claimedMime: string | null): InsuranceVerdict {
  if (b.length === 0) return { ok: false, reason: "The file is empty." };
  if (b.length > INSURANCE_MAX_BYTES) return { ok: false, reason: "The file is larger than 10 MB." };
  let type: InsuranceType | null = null;
  if (ascii(b, 0, 5) === "%PDF-") {
    if (lastIndexOfAscii(b, "%%EOF", 2048) < 0) return { ok: false, reason: "The PDF looks incomplete or damaged." };
    // Active content is never needed in a certificate of currency.
    const body = new TextDecoder("latin1").decode(b);
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(body)) return { ok: false, reason: "This PDF contains active content and can't be accepted. Please upload a plain PDF or a photo." };
    type = "pdf";
  } else if (b.length >= 33 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a && ascii(b, 12, 16) === "IHDR") {
    if (ascii(b, b.length - 8, b.length - 4) !== "IEND") return { ok: false, reason: "The image looks incomplete or damaged." };
    type = "png";
  } else if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    if (!(b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9)) return { ok: false, reason: "The image looks incomplete or damaged." };
    type = "jpg";
  }
  if (!type) return { ok: false, reason: "Only PDF, PNG or JPEG files are accepted." };
  // Polyglot guard: an image or PDF must not also carry an HTML/script payload.
  const head = new TextDecoder("latin1").decode(b.subarray(0, Math.min(b.length, 4096))).toLowerCase();
  if (/<(script|html|svg|iframe)\b/.test(head)) return { ok: false, reason: "This file can't be accepted." };
  if (claimedMime && claimedMime !== INSURANCE_MIME[type]) return { ok: false, reason: "The file type doesn't match its contents." };
  return { ok: true, type };
}

/** Original filenames are only checked, never used for storage. */
export function safeOriginalName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n || n.length > 200 || /[\\/]|\.\.|\0/.test(n)) return false;
  const parts = n.toLowerCase().split(".");
  if (parts.length !== 2) return false; // rejects double extensions and no extension
  return ["pdf", "png", "jpg", "jpeg"].includes(parts[1]!);
}

export const quarantinePrefix = (folder: string, appId: string) => `quarantine/${folder}/${appId}/`;
export function isOwnQuarantinePath(path: string, folder: string, appId: string): boolean {
  const p = quarantinePrefix(folder, appId);
  return path.startsWith(p) && /^[0-9a-f-]{36}$/.test(path.slice(p.length));
}

// ---------- Browser helpers (no secrets) ----------

/** Random resume token generated in the browser, so a replayed start returns the same draft. */
export function newResumeToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Reads a staff link (?staff=...) once and removes it from the address bar and history. */
export function takeStaffLink(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  const v = url.searchParams.get("staff");
  if (v === null) return undefined;
  url.searchParams.delete("staff");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  return /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : undefined;
}
