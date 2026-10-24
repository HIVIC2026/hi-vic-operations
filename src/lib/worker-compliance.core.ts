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

/** "Missing" items for the My business Add it prompt. */
export function missingItems(w: WorkerCompliance): ("licence_expiry" | "piisa" | "esc_notice")[] {
  const m: ("licence_expiry" | "piisa" | "esc_notice")[] = [];
  if (w.trade_role === "electrician" && !w.licence_expires_on) m.push("licence_expiry");
  if (w.trade_role === "installer" && (piisaState(w) === "missing" || piisaState(w) === "not_done")) m.push("piisa");
  if (w.trade_role === "installer" && w.collection_notice_acknowledged === false) m.push("esc_notice");
  return m;
}
