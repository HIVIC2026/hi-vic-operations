// Worker compliance rules: electrician licence expiry + installer EEC/CII
// certificate. PURE: no I/O. EEC status is office-verified only; a worker-uploaded file is "awaiting_check"
// until the office verifies it (certification_status stays 'unverified' until then).
import { COLLECTION_NOTICE_BLOCK_MESSAGE } from "./trade-shared-consts.core";

export type WorkerCompliance = {
  trade_role: "electrician" | "installer" | string;
  licence_expires_on?: string | null;
  certification_status?: "unverified" | "verified" | "rejected" | null;
  certification?: { eec_upload?: { path?: string | null } | null } | null;
  /** ESC collection notice (decision 130): false = this person has not acknowledged it (from esc-collection-notice statuses). Undefined = not loaded. */
  collection_notice_acknowledged?: boolean | null;
  /** Decision 153: latest recorded CII level/expiry for the verified certificate. Undefined = not loaded (no flag); null = none recorded. */
  cii_level?: string | null;
  cii_expires_on?: string | null;
};

export type EecState = "not_applicable" | "missing" | "awaiting_check" | "verified" | "rejected";
/** EEC/CII certificate state for installers. A file being present is NOT verification. */
export function eecState(w: Pick<WorkerCompliance, "trade_role" | "certification_status" | "certification">): EecState {
  if (w.trade_role !== "installer") return "not_applicable";
  if (w.certification_status === "verified") return "verified";
  if (w.certification_status === "rejected") return "rejected";
  return w.certification?.eec_upload?.path ? "awaiting_check" : "missing";
}
/** Business-owner-facing label (no internal paths, no office-only data). */
export const EEC_TEAM_LABEL: Record<Exclude<EecState, "not_applicable">, string> = {
  missing: "EEC/CII certificate missing — the worker needs to upload it.",
  awaiting_check: "Certificate uploaded — office checking.",
  verified: "Certificate verified.",
  rejected: "Certificate was not accepted — ask the office.",
};

const days = (iso: string, today: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);

export type LicenceState = "missing" | "expired" | "lapses_30" | "lapses_60" | "ok";
export function licenceState(expiry: string | null | undefined, today: string): LicenceState {
  if (!expiry) return "missing";
  const d = days(expiry, today);
  return d < 0 ? "expired" : d <= 30 ? "lapses_30" : d <= 60 ? "lapses_60" : "ok";
}

/** Office approval flags (inform, never block approval). */
export function approvalFlags(w: WorkerCompliance, today: string): string[] {
  const out: string[] = [];
  if (w.trade_role === "electrician") {
    const s = licenceState(w.licence_expires_on, today);
    if (s === "missing") out.push("Licence expiry missing");
    if (s === "expired") out.push("Licence expired");
    if (s === "lapses_30" || s === "lapses_60") out.push("Licence expires within 60 days");
  }
  if (w.trade_role === "installer") {
    const e = eecState(w);
    if (e === "missing") out.push("EEC certificate missing");
    if (e === "awaiting_check") out.push("EEC certificate to verify");
    if (e === "rejected") out.push("EEC certificate rejected");
    if (e === "verified" && w.cii_level !== undefined) {
      const c = crewClearance({ certStatus: "verified", level: w.cii_level ?? null, expiresOn: w.cii_expires_on ?? null }, today);
      if (c.reason === CREW_CLEARANCE_REASON.noLevel) out.push("CII level and expiry to record");
      if (c.reason === CREW_CLEARANCE_REASON.expired) out.push("CII certificate expired");
    }
    if (w.collection_notice_acknowledged === false) out.push("ESC notice not acknowledged");
    // Decision 319: existing people with no White Card are shown as missing (an office item), never auto-blocked here.
    const wc = whiteCardState(w);
    if (wc === "missing" || wc === "awaiting_check" || wc === "rejected") out.push(WHITE_CARD_OFFICE_FLAG[wc]);
  }
  return out;
}

/** Warning shown to the trade and office from 30 days before lapse. */
export function licenceWarning(w: WorkerCompliance, today: string): string | null {
  if (w.trade_role !== "electrician") return null;
  const s = licenceState(w.licence_expires_on, today);
  if (s === "expired") return "Licence expired. No new jobs until you add the new expiry date.";
  if (s === "lapses_30") return `Licence expires in ${days(w.licence_expires_on!, today)} days. Add your new expiry date.`;
  return null;
}

/** Why this worker can't be offered new jobs (null = can be offered). Fails closed. */
export function workerOfferBlocker(w: WorkerCompliance, today: string): string | null {
  if (w.trade_role === "electrician") {
    const s = licenceState(w.licence_expires_on, today);
    if (s === "expired") return "Electrical licence has expired.";
    if (s === "missing") return null; // existing partners: shown as "missing" with an Add it prompt; not yet a block
  }
  // Decision 130: an installer who has not acknowledged the ESC collection notice cannot be lead or crew on any installation.
  if (w.trade_role === "installer" && w.collection_notice_acknowledged === false) return COLLECTION_NOTICE_BLOCK_MESSAGE;
  return null;
}

// ---------- Crew clearance (decision 153, Jo 24 Oct 2026) ----------
/**
 * Facts the clearance is DERIVED from: the latest office certification check for the person and the latest recorded
 * level/expiry against it. `partner_workers.approval_status` plays no part (it only gates logins/links, unchanged).
 */
export type CrewClearanceFacts = {
  removed_at?: string | null;
  /** Latest certification check status: "verified" | "rejected" | null (none recorded). */
  certStatus: string | null;
  /** Latest recorded level ("full" | "provisional" | legacy text) and expiry (YYYY-MM-DD) for that check. */
  level: string | null;
  expiresOn: string | null;
};
export type CrewClearance = { cleared: boolean; reason: string | null };
export const CREW_CLEARANCE_REASON = {
  removed: "No longer on the staff list.",
  withdrawn: "CII certificate was not accepted by the office.",
  unverified: "CII certificate not verified by the office yet.",
  noLevel: "CII certificate verified but the level and expiry date haven't been recorded yet.",
  expired: "CII certificate has expired — the office needs to verify the renewed certificate.",
} as const;
/**
 * Cleared for crews and offers = verified CII certificate + a recorded level + expiry on or after today, and not removed.
 * Expired, rejected/withdrawn or unrecorded → blocked again. Pure; fails closed on anything missing.
 */
export function crewClearance(f: CrewClearanceFacts, today: string): CrewClearance {
  if (f.removed_at) return { cleared: false, reason: CREW_CLEARANCE_REASON.removed };
  if (f.certStatus === "rejected") return { cleared: false, reason: CREW_CLEARANCE_REASON.withdrawn };
  if (f.certStatus !== "verified") return { cleared: false, reason: CREW_CLEARANCE_REASON.unverified };
  if (!f.level?.trim() || !f.expiresOn) return { cleared: false, reason: CREW_CLEARANCE_REASON.noLevel };
  if (f.expiresOn < today) return { cleared: false, reason: CREW_CLEARANCE_REASON.expired };
  return { cleared: true, reason: null };
}
// ---------- Business public liability insurance (compliance checklist H3, 24 Oct 2026) ----------
/**
 * Like the CII expiry: once the business's public liability insurance has lapsed (`expiresOn < today`), the business
 * gets no new offers and no install may start until a renewed certificate is uploaded. No date on file (older partners
 * never asked) is shown as missing on My business but is NOT a block here, exactly like the licence-expiry convention.
 */
export function publicLiabilityBlocker(expiresOn: string | null | undefined, today: string): string | null {
  if (!expiresOn) return null;
  if (expiresOn.slice(0, 10) < today) return `Public liability insurance expired on ${expiresOn.slice(0, 10)}. Upload the renewed certificate under My business.`;
  return null;
}

/** Melbourne calendar date, for callers that have no explicit "today". */
export const melbourneToday = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });

/** "Missing" items for the My business Add it prompt. */
export function missingItems(w: WorkerCompliance): ("licence_expiry" | "esc_notice" | "white_card")[] {
  const m: ("licence_expiry" | "esc_notice" | "white_card")[] = [];
  if (w.trade_role === "electrician" && !w.licence_expires_on) m.push("licence_expiry");
  if (w.trade_role === "installer" && w.collection_notice_acknowledged === false) m.push("esc_notice");
  // Decision 319: every installer person needs their own White Card on file (missing or not accepted → upload again).
  const wc = whiteCardState(w);
  if (wc === "missing" || wc === "rejected") m.push("white_card");
  return m;
}

// ---------- White Card per installer person (decision 319, Jo 25 Oct 2026) ----------
/**
 * Every installer PERSON uploads their own White Card (general construction induction card) at installer onboarding or
 * My business › Team, and the office verifies it once (same pattern as the CII certificate: a file present is NOT
 * verification). Stored on `partner_workers.certification.white_card` (existing jsonb column, no schema change); every
 * upload / verify / reject also writes an append-only `admin_config_events` row. White Cards do not expire, so a verified
 * card stays verified until a new file is uploaded (which resets the check).
 *
 * Who is blocked: an installer whose White Card is not verified cannot be the lead (pre-start check) or crew (crew
 * picker, install-day allocation) on an installation BOOKED ON OR AFTER `WHITE_CARD_ENFORCED_FROM` (00:00 26 Oct 2026
 * Melbourne, the day after the decision). Installations booked before then are never blocked by this rule: their people
 * show as "White Card missing" and the office gets an item to chase, but the booked job goes ahead. Crew work with no
 * installation booking yet counts as new work and is enforced.
 */
export type WhiteCardRecord = {
  path?: string | null; uploaded_at?: string | null; number?: string | null;
  verified_at?: string | null; verified_by?: string | null; rejected_at?: string | null; rejected_by?: string | null; rejected_reason?: string | null;
};
export type WhiteCardState = "not_applicable" | "missing" | "awaiting_check" | "verified" | "rejected";
export const WHITE_CARD_BLOCK_MESSAGE = "White Card not verified";
/** Jo 29 Oct 2026: people added on Team (`partner_workers.declarations_due`) can't go on any job until they sign by link. */
export const DECLARATIONS_DUE_MESSAGE = "Hasn't signed their worker declarations yet.";
/** 00:00 on 26 Oct 2026 in Melbourne (AEDT, UTC+11). Installation bookings created before this instant are never blocked. */
export const WHITE_CARD_ENFORCED_FROM = "2026-10-25T13:00:00.000Z";
export const WHITE_CARD_EVENTS = { uploaded: "white_card_uploaded", verified: "white_card_verified", rejected: "white_card_rejected" } as const;

/** The stored White Card record on a worker's certification JSON (null when none). */
export function whiteCardOf(certification: unknown): WhiteCardRecord | null {
  const c = certification && typeof certification === "object" && !Array.isArray(certification) ? (certification as { white_card?: unknown }).white_card : null;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as WhiteCardRecord) : null;
}

/** White Card state for installers. Verified only by an office check against an uploaded file; rejected until a new upload. */
export function whiteCardState(w: { trade_role?: string | null; certification?: unknown }): WhiteCardState {
  if (w.trade_role !== "installer") return "not_applicable";
  const r = whiteCardOf(w.certification);
  if (!r?.path) return "missing";
  if (r.verified_at) return "verified";
  if (r.rejected_at) return "rejected";
  return "awaiting_check";
}

/** Business-owner / worker facing line (no paths, no office-only data). */
export const WHITE_CARD_TEAM_LABEL: Record<Exclude<WhiteCardState, "not_applicable">, string> = {
  missing: "White Card missing — upload it so they can be lead or crew on new installs.",
  awaiting_check: "White Card uploaded — office checking.",
  verified: "White Card verified.",
  rejected: "White Card was not accepted — upload a clear copy of the card.",
};
/** Office flag text (approval flags / compliance list). */
export const WHITE_CARD_OFFICE_FLAG: Record<"missing" | "awaiting_check" | "rejected", string> = {
  missing: "White Card missing",
  awaiting_check: "White Card to verify",
  rejected: "White Card rejected",
};

/** Is the White Card rule enforced for an installation booked at `bookingCreatedAt`? No booking yet = new work = enforced. */
export function whiteCardEnforced(bookingCreatedAt: string | null | undefined): boolean {
  if (!bookingCreatedAt) return true;
  const t = Date.parse(bookingCreatedAt);
  return !Number.isFinite(t) || t >= Date.parse(WHITE_CARD_ENFORCED_FROM);
}

/** Why this person can't be lead or crew on this installation (null = allowed). Undefined/null state = not loaded → no block (older callers). */
export function whiteCardBlocker(state: WhiteCardState | null | undefined, bookingCreatedAt: string | null | undefined): string | null {
  if (state === undefined || state === null || state === "not_applicable" || state === "verified") return null;
  return whiteCardEnforced(bookingCreatedAt) ? WHITE_CARD_BLOCK_MESSAGE : null;
}

/** New upload: replaces the record (clears any earlier verification/rejection), preserving every other certification field. */
export function withWhiteCardUpload(certification: unknown, upload: { path: string; uploadedAt: string; number?: string | null }): Record<string, unknown> {
  const base = certification && typeof certification === "object" && !Array.isArray(certification) ? (certification as Record<string, unknown>) : {};
  const rec: WhiteCardRecord = { path: upload.path, uploaded_at: upload.uploadedAt, number: (upload.number ?? "").trim() || null };
  return { ...base, white_card: rec };
}

/** Office decision on the uploaded card. Refuses when no file is uploaded or the card is already verified. */
export function withWhiteCardDecision(certification: unknown, d: { verified: boolean; by: string; at: string; number?: string | null; reason?: string | null }): Record<string, unknown> {
  const base = certification && typeof certification === "object" && !Array.isArray(certification) ? (certification as Record<string, unknown>) : {};
  const cur = whiteCardOf(base);
  if (!cur?.path) throw new Error("No White Card uploaded to check.");
  if (cur.verified_at) throw new Error("This White Card is already verified.");
  const next: WhiteCardRecord = d.verified
    ? { ...cur, number: (d.number ?? cur.number ?? "").trim() || null, verified_at: d.at, verified_by: d.by, rejected_at: null, rejected_by: null, rejected_reason: null }
    : { ...cur, verified_at: null, verified_by: null, rejected_at: d.at, rejected_by: d.by, rejected_reason: (d.reason ?? "").trim() || null };
  return { ...base, white_card: next };
}

/** The storage path prefix a worker's own White Card upload must use (partner-files bucket). */
export const whiteCardPathPrefix = (workerId: string) => `workers/${workerId}/white-card-`;
