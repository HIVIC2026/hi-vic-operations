// Part 3 Task 3 (Jo 3 Nov 2026, docs/superpowers/specs/2026-11-03-certificate-later-design.md): the Certificate of
// Electrical Safety can come up to 30 days after the electrical upgrades. Pure rules only: the job's certificate STATE, the
// status lines the installer and office job pages print, the electrician link's upgrades-day / certificate checks, the
// upload path rule, and the held wording of the "add your certificate" text. Facts come from certificate-later.server.ts.
// No imports: the electrician's phone page bundles this file (the Part C merge lives in fixes-day.core with its sibling).

/**
 * none_needed            – the safety check found no electrical upgrades (or no safety check yet).
 * upgrades_pending       – upgrades needed, Part C not recorded yet (day not entered, or the A4 / same-day Part C not done).
 * waiting_for_certificate – Part C recorded, no certificate FILE on the job yet (a number typed alone never counts), or the
 *                           office REJECTED the current file (the electrician must add a new one).
 * certificate_in         – a file is on the job, not ticked yet (AI or office check pending / with the office).
 * clear                  – the certificate is ticked.
 */
export type CertificateState = "none_needed" | "upgrades_pending" | "waiting_for_certificate" | "certificate_in" | "clear";

export type CertificateStateFacts = {
  upgradesNeeded: boolean;
  /** Melbourne date the upgrades were recorded done (Part C), null until then. */
  upgradesDoneAt: string | null;
  partCRecorded: boolean;
  /** When the certificate FILE arrived on the job (null = no file). */
  certificateFileAt: string | null;
  certificateTicked: boolean;
  /** The office rejected the current certificate (coes_rejected is its newest event): the note, or "" when none. Null/undefined = not rejected. */
  certificateRejectedWhy?: string | null;
};

export function certificateState(f: CertificateStateFacts): CertificateState {
  if (!f.upgradesNeeded) return "none_needed";
  if (!f.partCRecorded) return "upgrades_pending";
  if (!f.certificateFileAt || f.certificateRejectedWhy != null) return "waiting_for_certificate";
  return f.certificateTicked ? "clear" : "certificate_in";
}

/** The link's line when the office rejected the current certificate (fix round 1). */
export const certificateRejectedLine = (why: string | null | undefined) => `The office couldn't accept that certificate${why?.trim() ? `: ${why.trim().slice(0, 200)}` : ""}. Add a new one.`;

// ---------- Status lines (installer job page + office job page) ----------
export const UPGRADES_DAY_NOT_SET_LINE = "Upgrades day not set yet";
export const waitingForCertificateLine = (electrician: string | null) => `Waiting for ${electrician?.trim() ? `${electrician.trim()}'s` : "the electrician's"} Certificate of Electrical Safety`;

/** The one status line for the job pages, or null when nothing needs saying. */
export function certificateStatusLine(f: { state: CertificateState; electrician: string | null; upgradesDaySet: boolean }): string | null {
  if (f.state === "waiting_for_certificate") return waitingForCertificateLine(f.electrician);
  if (f.state === "upgrades_pending" && !f.upgradesDaySet) return UPGRADES_DAY_NOT_SET_LINE;
  return null;
}

// ---------- Part 3 Task 4: the install can be booked, not started, without the certificate ----------
/** The certificate as the day-before pre-start check reads it (prestart.core `PrestartFacts.certificate`). */
export type PrestartCertificate = "not_needed" | "missing" | "unchecked" | "ticked";
/** The line every install booking records and shows while the certificate is outstanding (booking is never blocked by it). */
export const INSTALL_CERTIFICATE_WARNING = "Certificate of Electrical Safety still to come — the install can't start without it";
/** Fix 1: the line when a certificate file is on the job but not ticked yet ("still to come" only when there is no file). */
export const INSTALL_CERTIFICATE_UNCHECKED_WARNING = "Certificate of Electrical Safety not checked yet — the install can't start until it's ticked.";
/** The booking warning for the pre-start certificate fact: no file → still to come; a file not ticked → not checked yet. */
export function installCertificateWarning(c: PrestartCertificate): string | null {
  return c === "missing" ? INSTALL_CERTIFICATE_WARNING : c === "unchecked" ? INSTALL_CERTIFICATE_UNCHECKED_WARNING : null;
}
/** Fix 1: the live start lock (prestart.server `requirePrestartClear`) — the PIISA send and install evidence stay locked. */
export function prestartCertificateBlocker(c: PrestartCertificate, why: string | null): string | null {
  if (c === "missing") return "Not cleared to start: Certificate of Electrical Safety not in yet.";
  if (c === "unchecked") return `Not cleared to start: check the electrical certificate — ${why?.trim() || "not checked yet"}.`;
  return null;
}
/** Fix 1: an in-house job's install form (PIISA Mitti audit) is held while the certificate is outstanding — one event per job. */
export const IN_HOUSE_INSTALL_FORM_HELD_EVENT = "in_house_install_form_held";
export const IN_HOUSE_INSTALL_FORM_HELD = "Install form held until the Certificate of Electrical Safety is ticked";
/** Logged once per install start when the install is booked with the certificate outstanding. */
export const INSTALL_CERTIFICATE_WARNING_EVENT = "install_booked_certificate_outstanding";
/** Office wording when the certificate facts could not be read (the pre-start fails closed). */
export const CERTIFICATE_UNREADABLE = "the certificate couldn't be read — check the job";

/**
 * The pre-start certificate fact from the job's certificate state (Jo 3 Nov 2026):
 * - on-site-only (electrician at the start of the install day) → not_needed: clear after the PIESA;
 * - no upgrades → not_needed, unless the existing certificate check still asks for one (`legacyWhy`, fail closed);
 * - upgrades not recorded yet, or Part C recorded with no file → missing;
 * - the office rejected it, or a file that isn't ticked → unchecked, with the existing check's reason (`why`);
 * - ticked → ticked.
 */
export function prestartCertificate(f: { onsiteOnly: boolean; state: CertificateState; rejected: boolean; why: string | null; legacyWhy?: string | null }): { certificate: PrestartCertificate; why: string | null } {
  if (f.onsiteOnly) return { certificate: "not_needed", why: null };
  switch (f.state) {
    case "none_needed": return f.legacyWhy ? { certificate: "unchecked", why: f.legacyWhy } : { certificate: "not_needed", why: null };
    case "upgrades_pending": return { certificate: "missing", why: null };
    case "waiting_for_certificate": return f.rejected ? { certificate: "unchecked", why: f.why ?? "not checked yet" } : { certificate: "missing", why: null };
    case "certificate_in": return { certificate: "unchecked", why: f.why ?? "not checked yet" };
    case "clear": return { certificate: "ticked", why: null };
  }
}

// ---------- The electrician link's steps ----------
/** The upgrades day must be a real time ahead of now (the 30-day install clock is the installer's, not a limit here). */
export function upgradesDayProblem(startIso: string, now: Date): string | null {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return "That date and time isn't valid.";
  if (start <= now.getTime()) return "That time has already passed. Pick a time from now on.";
  return null;
}

/** The certificate step needs all three: number, date (not in the future) and the photo/PDF. */
export function certificateProblem(f: { number: string; date: string; hasFile: boolean; today: string }): string | null {
  if (!f.number.trim()) return "Enter the certificate number.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !Number.isFinite(Date.parse(`${f.date}T00:00:00Z`)) || new Date(`${f.date}T00:00:00Z`).toISOString().slice(0, 10) !== f.date) return "Enter the certificate date.";
  if (f.date > f.today) return "The certificate date can't be in the future.";
  if (!f.hasFile) return "Add a photo or PDF of the certificate.";
  return null;
}

export const CERTIFICATE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const CERTIFICATE_TOO_BIG = "That file is over 25 MB. Take a photo of the certificate instead.";
export const CERTIFICATE_WRONG_TYPE = "That file type isn't accepted. Upload a PDF, or a JPG or PNG photo, of the certificate.";
/** Only what the owner's copy can carry (coes-owner-copy.server): PDF, JPEG, PNG. */
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
/** The accepted certificate file types (PDF, JPG, PNG), by mime. Null = not accepted. */
export const certificateFileExt = (mime: string | null | undefined): string | null => EXT[String(mime ?? "").toLowerCase().split(";")[0]!.trim()] ?? null;
/** Where an electrician's certificate upload lives in the private `job-files` bucket. */
export const certificateUploadPath = (jobId: string, uploadId: string, mime: string) => `jobs/${jobId}/electrician-uploads/${uploadId}.${certificateFileExt(mime) ?? "bin"}`;
/** The upload id from a path, only when the path is this job's electrician-uploads file (no traversal, one segment). */
export function parseCertificateUploadPath(jobId: string, path: string): string | null {
  const m = new RegExp(`^jobs/${jobId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/electrician-uploads/([A-Za-z0-9-]{8,64})\\.(pdf|jpg|png)$`).exec(path);
  return m ? m[1]! : null;
}

// ---------- Held wording ----------
/** The "add your certificate" text (SMS type electrician_certificate_link — its `wordingApproved` is the one gate). HELD until Jo approves it. */
export function certificateAddLinkText(i: { first: string | null; address: string; url: string }): string {
  return `Hi ${i.first?.trim() || "there"}, thanks for doing the electrical upgrades at ${i.address}. When you have the Certificate of Electrical Safety, add a photo or PDF here: ${i.url}`;
}
/** Logged on the job (append-only) when the electrician adds the certificate through their link. */
export const CERTIFICATE_ADDED_EVENT = "certificate_added_by_link";
/** Claim (one per assignment and upgrades-booking round) before the upgrades day is booked from the link. */
export const UPGRADES_DAY_LINK_CLAIM_EVENT = "electrician_link_upgrades_day";
