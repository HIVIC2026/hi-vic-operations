// Server-only enforcement for public onboarding: start limits, staff-issued links, verified insurance files.
// Pure rules live in onboarding-security.core.ts. Requires staged migration 0079; fails closed without it.
import {
  INSURANCE_MIME, SCAN_RESULT_NO_SCANNER, START_LIMIT_MESSAGE, contactDraftAllowed, limiterKeys,
  isOwnQuarantinePath, normaliseEmail, normaliseMobile, quarantinePrefix, verifyInsuranceBytes, type Trade,
} from "./onboarding-security.core";
import { FP_KEY_VERSION as FP_KEY_VERSION_CONTACT } from "./onboarding-security.core";

export class StartLimitError extends Error {
  constructor() { super(START_LIMIT_MESSAGE); this.name = "StartLimitError"; }
}

export async function sha256Hex(s: string | Uint8Array) {
  const bytes = typeof s === "string" ? new TextEncoder().encode(s) : s;
  const b = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// The generated database types predate 0079, so these narrow, loosely typed views are used here.
type Db = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  storage: { from: (b: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** HMAC-SHA256 with the server-held ONBOARDING_FP_SECRET. Fails closed if the secret is missing. */
export async function keyedHash(source: string) {
  const secret = process.env["ONBOARDING_FP_SECRET"];
  if (!secret || secret.length < 32) throw new StartLimitError();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(source));
  return Array.from(new Uint8Array(sig)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Consumes one start from the visitor allowance, then the wider network backstop. Fails closed. */
export async function consumeStart(db: Db, visitorId: string, ip: string | null, trade: Trade) {
  for (const k of limiterKeys(visitorId, ip, trade)) {
    const { data, error } = await db.rpc("consume_onboarding_start", { _fp: await keyedHash(k.source), _trade: trade, _kind: k.kind });
    if (error || data !== true) throw new StartLimitError();
  }
}

export type Authorisation = { id: string; purpose: "qa_test" | "office_recovery"; allow_incomplete_sign: boolean };

/** Single-purpose staff link. Returns null (real mode) when absent; throws when presented but invalid. */
export async function consumeAuthorisation(db: Db, raw: string | undefined, trade: Trade): Promise<Authorisation | null> {
  if (!raw) return null;
  const { data, error } = await db.rpc("consume_onboarding_authorisation", { _hash: await sha256Hex(raw), _trade: trade });
  const row = Array.isArray(data) ? (data[0] as Authorisation | undefined) : undefined;
  if (error || !row) throw new Error("This staff link has expired or has already been used. Ask Home Insulation Victoria for a new one.");
  return row;
}

/** Hash of the normalised business email (or mobile) for the per-contact draft cap. */
export async function contactHash(data: { business_email?: string | null; business_phone?: string | null }, trade: Trade) {
  const key = normaliseEmail(data.business_email) ?? normaliseMobile(data.business_phone);
  return key ? keyedHash(`${FP_KEY_VERSION_CONTACT}|contact|${trade}|${key}`) : null;
}

/** Refuses a save that would make a third active draft for the same contact + trade. Same generic message. */
export async function enforceContactCap(db: Db, appId: string, trade: Trade, hash: string | null) {
  if (!hash) return;
  const { count, error } = await db.from("rec_onboarding_applications").select("id", { count: "exact", head: true })
    .eq("contact_hash", hash).eq("partner_type", trade).eq("status", "draft").eq("test_mode", false).neq("id", appId);
  if (error || !contactDraftAllowed(count ?? 0)) throw new StartLimitError();
}

const BUCKET = "partner-files";

/** New quarantine slot; abandoned quarantine files for this application are removed first. */
export async function quarantineSlot(db: Db, folder: string, appId: string) {
  const prefix = quarantinePrefix(folder, appId);
  const { data: old } = await db.storage.from(BUCKET).list(prefix.slice(0, -1));
  const stale = (old ?? []).map((f: { name: string }) => prefix + f.name);
  if (stale.length) await db.storage.from(BUCKET).remove(stale);
  const path = prefix + crypto.randomUUID();
  const { data: signed, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !signed) throw new Error("Could not prepare the upload. Please try again.");
  return { path, token: signed.token as string };
}

/**
 * Reads the stored bytes, verifies them, moves them to a server-named final path and records
 * type/size/SHA-256/verification. Any failure deletes the quarantined file and leaves evidence incomplete.
 */
export async function verifyAndPromote(db: Db, folder: string, appId: string, path: string, claimedMime: string) {
  if (!isOwnQuarantinePath(path, folder, appId)) throw new Error("Invalid upload.");
  const bucket = db.storage.from(BUCKET);
  const reject = async (msg: string): Promise<never> => { await bucket.remove([path]); throw new Error(msg); };
  const { data: blob } = await bucket.download(path);
  if (!blob) return reject("Upload not found. Please try again.");
  const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
  const verdict = verifyInsuranceBytes(bytes, claimedMime);
  if (!verdict.ok) return reject(verdict.reason);
  const sha = await sha256Hex(bytes);
  const finalPath = `${folder}/${appId}/insurance-${crypto.randomUUID()}.${verdict.type}`;
  const { error: moveError } = await bucket.move(path, finalPath);
  if (moveError) return reject("Could not store the certificate. Please try again.");
  const { data: updated, error } = await db.from("rec_onboarding_applications").update({
    insurance_certificate_path: finalPath, insurance_file_type: verdict.type, insurance_file_bytes: bytes.length,
    insurance_file_sha256: sha, insurance_verified_at: new Date().toISOString(), insurance_scan_result: SCAN_RESULT_NO_SCANNER,
  }).eq("id", appId).eq("status", "draft").select("updated_at").single();
  if (error || !updated) { await bucket.remove([finalPath]); throw new Error("Could not attach the certificate. Please try again."); }
  return { finalPath, mime: INSURANCE_MIME[verdict.type], updated_at: String(updated.updated_at) };
}
