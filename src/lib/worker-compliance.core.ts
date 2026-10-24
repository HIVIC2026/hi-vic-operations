// Worker compliance rules: electrician licence expiry + installer PIISA training + installer EEC/CII
// certificate. PURE: no I/O. EEC status is office-verified only; a worker-uploaded file is "awaiting_check"
// until the office verifies it (certification_status stays 'unverified' until then).
import { COLLECTION_NOTICE_BLOCK_MESSAGE } from "./esc-collection-notice.core";

export type WorkerCompliance = {
  trade_role: "electrician" | "installer" | string;
  licence_expires_on?: string | null;
  piisa_status?: "done" | "not_done" | null;
  piisa_certificate_path?: string | null;
  piisa_verified_at?: string | null;
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

export type PiisaState = "missing" | "not_done" | "awaiting_check" | "verified";
export function piisaState(w: WorkerCompliance): PiisaState {
  if (w.piisa_verified_at && w.piisa_certificate_path) return "verified";
  if (w.piisa_status === "not_done") return "not_done";
  if (w.piisa_status === "done" && w.piisa_certificate_path) return "awaiting_check";
  return "missing";
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
    const s = piisaState(w);
    if (s === "not_done") out.push("PIISA training not done");
    if (s === "missing") out.push("PIISA training missing");
    if (s === "awaiting_check") out.push("PIISA certificate to verify");
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
  // Existing partners who were never asked show "missing" (Add it prompt) and are not blocked yet.
  if (w.trade_role === "installer" && w.piisa_status && piisaState(w) !== "verified") return "PIISA training not uploaded and verified.";
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
export function missingItems(w: WorkerCompliance): ("licence_expiry" | "piisa" | "esc_notice")[] {
  const m: ("licence_expiry" | "piisa" | "esc_notice")[] = [];
  if (w.trade_role === "electrician" && !w.licence_expires_on) m.push("licence_expiry");
  if (w.trade_role === "installer" && (piisaState(w) === "missing" || piisaState(w) === "not_done")) m.push("piisa");
  if (w.trade_role === "installer" && w.collection_notice_acknowledged === false) m.push("esc_notice");
  return m;
}
