// Pure, runtime-agnostic helpers for the Base44 -> portal enquiry handoff (no DB, no env). Tested in tests/enquiry.core.test.ts.

/** Trusted Base44 Ed25519 public key (SPKI DER, base64). Public by design — no secret required. */
export const BASE44_PUBLIC_KEY_SPKI_B64 = "MCowBQYDK2VwAyEA4ZW3Pv8Mb6v9e684gaMN3HHB8qGLvW6LCMOPU7ki6U0=";
export const BASE44_KEY_ID = "base44-v1";

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const s = b64.trim();
    if (!s || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Verify an Ed25519 signature (base64) over the exact raw UTF-8 body. Never throws; false on any problem. */
export async function verifyEd25519(rawBody: string, signatureB64: string | null | undefined, publicKeySpkiB64 = BASE44_PUBLIC_KEY_SPKI_B64): Promise<boolean> {
  if (!signatureB64) return false;
  const sig = b64ToBytes(signatureB64);
  const der = b64ToBytes(publicKeySpkiB64);
  if (!sig || sig.length !== 64 || !der) return false;
  try {
    const key = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, new TextEncoder().encode(rawBody));
  } catch {
    return false;
  }
}

export const SIGNED_WEBHOOK_TIMESTAMP_WINDOW_MS = 5 * 60_000;
export const WEBHOOK_NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function signedWebhookMessage(rawBody: string, timestamp: string, nonce: string) {
  return `${timestamp}.${nonce}.${rawBody}`;
}

export function signedWebhookTimestampOk(timestamp: string | null | undefined, now = Date.now(), windowMs = SIGNED_WEBHOOK_TIMESTAMP_WINDOW_MS): boolean {
  if (!timestamp) return false;
  const trimmed = timestamp.trim();
  const n = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  const ms = n < 10_000_000_000 ? n * 1000 : n;
  return Number.isFinite(ms) && Math.abs(now - ms) <= windowMs;
}

export async function verifySignedWebhook(rawBody: string, headers: Headers, publicKeySpkiB64 = BASE44_PUBLIC_KEY_SPKI_B64, now = Date.now()): Promise<{ ok: true; timestamp: string; nonce: string } | { ok: false; reason: "missing" | "stale" | "bad_nonce" | "bad_signature" }> {
  const timestamp = headers.get("x-hivic-timestamp");
  const nonce = headers.get("x-hivic-nonce");
  if (!timestamp || !nonce) return { ok: false, reason: "missing" };
  if (!signedWebhookTimestampOk(timestamp, now)) return { ok: false, reason: "stale" };
  if (!WEBHOOK_NONCE_RE.test(nonce)) return { ok: false, reason: "bad_nonce" };
  const ok = await verifyEd25519(signedWebhookMessage(rawBody, timestamp, nonce), headers.get("x-hivic-signature"), publicKeySpkiB64);
  return ok ? { ok: true, timestamp, nonce } : { ok: false, reason: "bad_signature" };
}

export type Base44WebhookVerification =
  | { ok: true; protocol: "timestamped"; timestamp: string; nonce: string }
  | { ok: true; protocol: "legacy" }
  | { ok: false; reason: "missing" | "stale" | "bad_nonce" | "bad_signature" };

/** Backward-compatible Base44 verifier.
 * Legacy Base44 signs the exact raw body. The new protocol signs timestamp.nonce.body and adds DB replay protection.
 */
export async function verifyBase44Webhook(rawBody: string, headers: Headers, publicKeySpkiB64 = BASE44_PUBLIC_KEY_SPKI_B64, now = Date.now()): Promise<Base44WebhookVerification> {
  const hasTimestampedHeaders = !!headers.get("x-hivic-timestamp") || !!headers.get("x-hivic-nonce");
  if (hasTimestampedHeaders) {
    const signed = await verifySignedWebhook(rawBody, headers, publicKeySpkiB64, now);
    return signed.ok ? { ...signed, protocol: "timestamped" } : signed;
  }
  return await verifyEd25519(rawBody, headers.get("x-hivic-signature"), publicKeySpkiB64) ? { ok: true, protocol: "legacy" } : { ok: false, reason: "bad_signature" };
}

export type PreliminaryEligibility = "likely_eligible" | "needs_onsite_confirmation" | "does_not_appear_eligible";

export const PRELIM_NEXT_ACTION: Record<PreliminaryEligibility, string> = {
  likely_eligible: "Review Gate 1 and arrange electrician assessment",
  needs_onsite_confirmation: "Review Gate 1 and confirm onsite checks",
  does_not_appear_eligible: "Review Gate 1 before closing enquiry",
};

/** Job fields for a preliminary (website) eligibility result. Information only — never sets the pipeline stage, never auto-passes. */
export function preliminaryEligibilityFields(outcome: PreliminaryEligibility | null | undefined, reason: string | null | undefined, now: Date = new Date()) {
  if (!outcome) return null;
  return {
    eligibility_outcome: outcome,
    eligibility_reason: reason ?? null,
    eligibility_set_at: now.toISOString(),
    eligibility_set_by: null,
    next_action: PRELIM_NEXT_ACTION[outcome],
  };
}

/** Operational stage + next action for every NEW Base44 job. Admin confirms Gate 1 and moves it forward. */
export const BASE44_NEW_STAGE = "new_enquiry" as const;
export const BASE44_NEW_NEXT_ACTION = "Review website screening and Gate 1";

export type LifeSupportStatus = "yes" | "no" | "unknown";

/** Sanitize reasons: strip control chars, collapse whitespace, drop empties/dupes, cap 20 x 300 chars, joined ≤2000. */
export function joinReasons(reasons: readonly string[] | null | undefined): string | null {
  if (!reasons?.length) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of reasons.slice(0, 20)) {
    const c = String(r).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); }
  }
  return out.length ? out.join("; ").slice(0, 2000) : null;
}

export type Base44Fields = {
  external_enquiry_id?: string | null | undefined; source_reference?: string | null | undefined;
  life_support?: boolean | null | undefined; life_support_status?: LifeSupportStatus | null | undefined;
  preliminary_outcome?: PreliminaryEligibility | null | undefined; preliminary_reasons?: string[] | null | undefined;
  eligibility_outcome?: PreliminaryEligibility | null | undefined; eligibility_reason?: string | null | undefined;
};

/** life_support is true ONLY for an explicit "yes"; "unknown" is kept as a status (never a silent confirmed no). */
export function resolveLifeSupport(i: Pick<Base44Fields, "life_support" | "life_support_status">): { life_support: boolean; status: LifeSupportStatus } {
  if (i.life_support_status) return { life_support: i.life_support_status === "yes", status: i.life_support_status };
  if (i.life_support === true) return { life_support: true, status: "yes" };
  if (i.life_support === false) return { life_support: false, status: "no" };
  return { life_support: false, status: "unknown" };
}

/**
 * Pure plan for a Base44 enquiry against the (possibly) existing job for the same external_enquiry_id.
 * existing = null -> create in new_enquiry; otherwise update the SAME job. Never changes an existing job's stage.
 */
export function planBase44Job(input: Base44Fields, existing: { stage: string } | null, now: Date = new Date()) {
  const outcome = input.preliminary_outcome ?? input.eligibility_outcome ?? null;
  const reason = joinReasons(input.preliminary_reasons) ?? input.eligibility_reason ?? null;
  const ls = resolveLifeSupport(input);
  const prelim = preliminaryEligibilityFields(outcome, reason, now);
  const patch: Record<string, unknown> = { life_support: ls.life_support, ...(prelim ?? {}) };
  if (existing) delete patch["next_action"]; // repeat sync: information only, leave workflow untouched
  else patch["next_action"] = BASE44_NEW_NEXT_ACTION;
  const moveTo = null;
  void existing?.stage;
  const details = {
    external_enquiry_id: input.external_enquiry_id ?? null, source_reference: input.source_reference ?? null,
    preliminary: true, preliminary_outcome: outcome, preliminary_reasons: reason,
    life_support_status: ls.status, life_support_unconfirmed: ls.status === "unknown",
  };
  return { kind: existing ? ("update" as const) : ("create" as const), patch, moveTo, details, outcome };
}

export type Base44EvidenceInput = {
  declared_property_type?: string | null | undefined;
  declared_over_five_years?: "yes" | "no" | "unknown" | null | undefined;
  declared_previous_upgrade?: "yes" | "no" | "unknown" | null | undefined;
  property_research?: {
    status?: string | null | undefined; evidence_summary?: string | null | undefined; formatted_address?: string | null | undefined;
    state?: string | null | undefined; postcode?: string | null | undefined; premises_classification?: string | null | undefined;
    first_appearance_year?: number | null | undefined; age_evidence_source?: string | null | undefined;
    flat_roof_detected?: boolean | null | undefined; access_concern_detected?: boolean | null | undefined; verified_floor_plan_url?: string | null | undefined;
  } | null | undefined;
};

/**
 * Pure: Base44 Gate 1 evidence with provenance. Owner declarations live under `declared` and are never
 * promoted to verified. Research age is `age_verified` only when research is complete AND a first-appearance year exists.
 */
export function buildBase44Evidence(i: Base44EvidenceInput, now: Date = new Date()) {
  const r = i.property_research ?? null;
  const done = !!r?.status && ["complete", "completed", "verified", "success", "done"].includes(r.status.toLowerCase());
  return {
    source: "base44", received_at: now.toISOString(),
    declared: {
      basis: "owner_declaration",
      property_type: i.declared_property_type ?? null,
      over_five_years: i.declared_over_five_years ?? null,
      previous_upgrade: i.declared_previous_upgrade ?? null,
    },
    research: r ? {
      basis: "base44_property_research",
      status: r.status ?? null, evidence_summary: r.evidence_summary ?? null,
      formatted_address: r.formatted_address ?? null, state: r.state?.toUpperCase() ?? null, postcode: r.postcode ?? null,
      premises_classification: r.premises_classification ?? null,
      first_appearance_year: r.first_appearance_year ?? null, age_evidence_source: r.age_evidence_source ?? null,
      age_verified: done && r.first_appearance_year != null,
      flat_roof_detected: r.flat_roof_detected === true, access_concern_detected: r.access_concern_detected === true,
      verified_floor_plan_url: r.verified_floor_plan_url ?? null,
    } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Full Base44 intake (0028): raw snapshots, contact consent, media copy planning. Pure; tested in tests/intake.test.ts.

export type Base44Snapshots = {
  media?: readonly Base44Media[] | null | undefined;
  /** Base44 asserts the media list is the complete original upload list. Absent = unknown. */
  media_manifest_complete?: boolean | null | undefined;
  state?: string | null | undefined;
  base44_answers?: Record<string, unknown> | null | undefined;
  base44_screening?: Record<string, unknown> | null | undefined;
  base44_ai_observations?: Record<string, unknown> | null | undefined;
  property_research_raw?: Record<string, unknown> | null | undefined;
  contact_consent?: boolean | null | undefined; contact_consent_version?: string | null | undefined; contact_consented_at?: string | null | undefined;
  age_confirmed?: boolean | null | undefined; assistance?: string | null | undefined; contact_preference?: string | null | undefined;
};

/** Raw Base44 snapshots kept for audit. Everything here is Base44-provided; nothing is promoted to verified. */
export function buildBase44Raw(i: Base44Snapshots) {
  return {
    basis: "base44_snapshot",
    answers: i.base44_answers ?? null,
    // Preserve original attachment identities before copying, without expiring URLs.
    ...(Array.isArray(i.media) ? { media: i.media.map(({ source_id, name, mime_type }) => ({ source_id, name, mime_type })) } : {}),
    ...(Array.isArray(i.media) && i.media_manifest_complete === true ? { original_media_verification: { basis: "signed_base44_intake", complete: true, media_count: i.media.length } } : {}),
    screening: i.base44_screening ?? null,
    ai_observations: i.base44_ai_observations ?? null,
    research_raw: i.property_research_raw ?? null,
    contact: {
      consent: i.contact_consent ?? null, version: i.contact_consent_version ?? null, consented_at: i.contact_consented_at ?? null,
      age_confirmed: i.age_confirmed ?? null, assistance: i.assistance ?? null, preference: i.contact_preference ?? null,
    },
  };
}

/** Preserve original identities and legacy uncertainty; a later empty sync cannot prove original absence. */
export function retainOriginalMedia(previous: unknown, current: ReturnType<typeof buildBase44Raw>) {
  const old = previous && typeof previous === "object" && !Array.isArray(previous) ? previous as Record<string, unknown> : null;
  const prior = Array.isArray(old?.['media']) ? old['media'] as { source_id: string; name: string; mime_type: string }[] : [];
  const media = [...new Map([...prior, ...(current.media ?? [])].map((m) => [m.source_id, m])).values()];
  const uncertain = !!old && (!Array.isArray(old['media']) || old['original_media_manifest_uncertain'] === true);
  const oldAnswers = old?.['answers'] && typeof old['answers'] === "object" && !Array.isArray(old['answers']) ? old['answers'] as Record<string, unknown> : {};
  const originalReferences: Record<string, unknown> = {}, answerReferences: Record<string, unknown> = {};
  for (const key of ["photos", "videos", "attachments", "uploaded_files", "uploaded_photos", "uploaded_videos"]) {
    if (old && key in old) originalReferences[key] = old[key];
    if (key in oldAnswers) answerReferences[key] = oldAnswers[key];
  }
  const priorVerification = old?.['original_media_verification'];
  return { ...originalReferences, ...current, ...(priorVerification ? { original_media_verification: priorVerification } : {}), answers: { ...answerReferences, ...(current.answers ?? {}) }, ...(prior.length || Array.isArray(current.media) || Array.isArray(old?.['media']) ? { media } : {}), ...(uncertain ? { original_media_manifest_uncertain: true } : {}) };
}

/** Normalise a state code (VIC etc). Null when absent/blank. */
export function normaliseState(s: string | null | undefined): string | null {
  const t = (s ?? "").trim().toUpperCase();
  return t ? t.slice(0, 10) : null;
}

export type ConsentStatus = "granted" | "not_granted" | "unknown";

/** Pure consent plan. Missing consent never drops the enquiry: it records unknown/not_granted. */
export function planContactConsent(i: Base44Snapshots & { source_reference?: string | null | undefined; external_enquiry_id?: string | null | undefined }) {
  const status: ConsentStatus = i.contact_consent === true ? "granted" : i.contact_consent === false ? "not_granted" : "unknown";
  const snapshot = {
    contact_consent: i.contact_consent ?? null, contact_consent_version: i.contact_consent_version ?? null, contact_consented_at: i.contact_consented_at ?? null,
    age_confirmed: i.age_confirmed ?? null, assistance: i.assistance ?? null, contact_preference: i.contact_preference ?? null,
    external_enquiry_id: i.external_enquiry_id ?? null, source_reference: i.source_reference ?? null,
  };
  // Stable identity: same status/version/timestamp/assistance/preference => same row (retries never duplicate).
  const consent_key = [status, i.contact_consent_version ?? "-", i.contact_consented_at ?? "-", i.age_confirmed ?? "-", i.assistance ?? "-", i.contact_preference ?? "-"].join("|");
  return {
    consent_status: status, contact_consent: i.contact_consent ?? null, consent_version: i.contact_consent_version ?? null,
    consented_at: i.contact_consented_at ?? null, age_confirmed: i.age_confirmed ?? null, assistance: i.assistance ?? null,
    contact_preference: i.contact_preference ?? null, source_reference: i.source_reference ?? i.external_enquiry_id ?? null,
    consent_key, snapshot, externalContactPermitted: status === "granted",
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const MEDIA_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"] as const;
// Matches the live Base44 homeowner limits: <=6 persisted files (schema tolerates 10), 25 MB each, 40 MB total.
export const MEDIA_MAX_FILES = 10;
export const MEDIA_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MEDIA_MAX_IMAGE_BYTES = MEDIA_MAX_FILE_BYTES;
export const MEDIA_MAX_VIDEO_BYTES = MEDIA_MAX_FILE_BYTES;
export const MEDIA_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
export const MEDIA_FETCH_TIMEOUT_MS = 20_000;

export type Base44Media = { source_id: string; name: string; mime_type: string; signed_url: string };

export const maxBytesFor = (mime: string) => (mime.startsWith("video/") ? MEDIA_MAX_VIDEO_BYTES : MEDIA_MAX_IMAGE_BYTES);

/** Filenames: strip paths/control chars, keep [A-Za-z0-9._-], cap 120 chars, never empty. */
export function sanitizeFilename(name: string): string {
  const base = String(name).split(/[\\/]/).pop() ?? "";
  const clean = base.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "").slice(-120);
  return clean || "file";
}

/** Only direct HTTPS URLs (no credentials) are fetched. Private storage URIs (gs://, s3:// ...) are rejected. */
export function isFetchableMediaUrl(u: string): boolean {
  try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password; } catch { return false; }
}

/** Pure plan: which media to copy, which to skip (already imported) and which to reject (with reason). */
export function planMediaImport(media: readonly Base44Media[] | null | undefined, alreadyImported: ReadonlySet<string>) {
  const toCopy: Base44Media[] = []; const skipped: string[] = []; const rejected: { source_id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const m of (media ?? []).slice(0, MEDIA_MAX_FILES)) {
    if (seen.has(m.source_id)) continue; seen.add(m.source_id);
    if (alreadyImported.has(m.source_id)) { skipped.push(m.source_id); continue; }
    if (!(MEDIA_ALLOWED_MIME as readonly string[]).includes(m.mime_type)) { rejected.push({ source_id: m.source_id, reason: `type ${m.mime_type} not allowed` }); continue; }
    if (!isFetchableMediaUrl(m.signed_url)) { rejected.push({ source_id: m.source_id, reason: "not an HTTPS link" }); continue; }
    toCopy.push(m);
  }
  return { toCopy, skipped, rejected };
}

export function mediaStoragePath(jobId: string, sourceId: string, name: string) {
  const sid = String(sourceId).replace(/[^\w\-]+/g, "_").slice(0, 60) || "src";
  return `${jobId}/intake/base44/${sid}-${sanitizeFilename(name)}`;
}

// Base44 stores the homeowner answers under `answers.insulation` and `answers.top_floor`;
// older/alternative spellings are kept as fallbacks only.
const EXISTING_INSULATION_KEYS = ["insulation", "declared_existing_insulation", "existing_insulation", "has_existing_insulation", "current_insulation"];
const TOP_FLOOR_KEYS = ["top_floor", "declared_top_floor", "is_top_floor", "top_floor_unit", "top_storey"];
const answerText = (v: unknown): string | null => {
  if (v === true) return "yes"; if (v === false) return "no";
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
  return null;
};
/** Owner-declared existing insulation / top-floor answers from the Base44 answer snapshot (declared, never verified). */
export function declaredExtras(answers: Record<string, unknown> | null | undefined) {
  const pick = (keys: string[]) => { for (const k of keys) { const t = answerText(answers?.[k]); if (t) return t; } return null; };
  return { existing_insulation: pick(EXISTING_INSULATION_KEYS), top_floor: pick(TOP_FLOOR_KEYS) };
}

// Tidy customer-typed text at intake: proper capitals for names and addresses, collapsed spaces.
const LOWER_WORDS = new Set(["and", "of", "the", "on", "in", "at", "de", "van", "von", "le"]);
function capWord(w: string, first: boolean): string {
  if (!w) return w;
  const lower = w.toLowerCase();
  if (!first && LOWER_WORDS.has(lower)) return lower;
  // McX / MacX and O'X patterns
  if (/^mc[a-z]/.test(lower)) return "Mc" + lower.slice(2, 3).toUpperCase() + lower.slice(3);
  if (/^mac[a-z]{2,}/.test(lower) && !/^mack/.test(lower)) return "Mac" + lower.slice(3, 4).toUpperCase() + lower.slice(4);
  return lower.slice(0, 1).toUpperCase() + lower.slice(1);
}
function capPart(part: string, first: boolean): string {
  return part.split(/([-'])/).map((seg, i) => (seg === "-" || seg === "'" ? seg : capWord(seg, first && i === 0))).join("");
}
/** Proper-case a person's name: "jOANNAH  lowe" -> "Joannah Lowe"; handles Mc/Mac, hyphens, apostrophes. */
export function properName(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").split(" ").map((w, i) => capPart(w, i === 0)).join(" ");
}
/** Proper-case an address line or suburb; keeps unit/number tokens and all-caps state codes intact. */
export function properAddress(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").split(" ").map((w, i) => {
    if (/^[0-9]/.test(w) || /^[A-Z]{2,3}$/.test(w)) return w; // numbers, VIC etc.
    return capPart(w, i === 0);
  }).join(" ");
}
