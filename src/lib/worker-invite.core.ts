// Worker invites: the business owner signs up the business, then sends each person who
// works for them a personal invite link. Pure rules only — persistence in worker-invite.functions.ts.

export const INVITE_DAYS = 14;
const DAY = 86_400_000;

export const inviteExpiry = (now: number) => new Date(now + INVITE_DAYS * DAY).toISOString();

export type InviteLike = { expires_at: string; used_at: string | null; revoked_at: string | null };

export function inviteState(i: InviteLike, now: number): "active" | "used" | "revoked" | "expired" {
  if (i.revoked_at) return "revoked";
  if (i.used_at) return "used";
  return new Date(i.expires_at).getTime() <= now ? "expired" : "active";
}

export const INVITE_STATE_MESSAGE: Record<"used" | "revoked" | "expired", string> = {
  used: "This invite link has already been used. If you need to change your details, ask the business owner for a new link.",
  revoked: "This invite link was cancelled. Ask the business owner to send you a new one.",
  expired: "This invite link has expired. Ask the business owner to send you a new one.",
};

// ---- Invite modes: "registration" creates a new worker; "completion" lets an existing worker
// (invite already carries worker_id) upload their own missing EEC/CII certificate. Same token table,
// same single-use rules — a completion link never inserts a second worker record.
export type InviteMode = "registration" | "completion";
export const inviteMode = (invitee: { worker_id?: string | null }): InviteMode => (invitee.worker_id ? "completion" : "registration");

/** EEC/CII certificate upload metadata stored on partner_workers.certification (jsonb), preserving other fields. */
export type EecUploadMeta = { eec_upload: { path: string; uploaded_at: string; number: string | null } };
export function eecUploadMeta(path: string, uploadedAt: string, number?: string | null): EecUploadMeta {
  return { eec_upload: { path, uploaded_at: uploadedAt, number: (number ?? "").trim() || null } };
}
/** Merge EEC upload metadata into the existing certification JSON without dropping earlier fields. */
export function mergeEec(certification: unknown, meta: EecUploadMeta): Record<string, unknown> {
  const base = certification && typeof certification === "object" && !Array.isArray(certification) ? (certification as Record<string, unknown>) : {};
  return { ...base, ...meta };
}
/** The only storage path shape a worker's certificate upload may use. */
export const inviteCertPath = (inviteId: string, ext: string) => `worker-invites/${inviteId}/eec-${ext}`;
export const isInviteCertPath = (inviteId: string, path: string) => path.startsWith(`worker-invites/${inviteId}/eec-`) && !path.includes("..");

type Opt<T> = T | undefined;
export type WorkerSubmission = {
  full_legal_name?: Opt<string>; mobile?: Opt<string>; email?: Opt<string>;
  licence_number?: Opt<string>; qualification?: Opt<string>;
  certificate_path?: Opt<string>; certificate_number?: Opt<string>;
};

const txt = (s?: string | null) => !!s && s.trim().length > 0;

/** Jo 5 Nov 2026: the sign-up link asks for details only (no promises to tick, no signature). */
export function workerSubmissionErrors(trade: "electrician" | "installer", s: WorkerSubmission): string[] {
  const e: string[] = [];
  if (!txt(s.full_legal_name) || s.full_legal_name!.trim().length < 2) e.push("Enter your full name.");
  if (!/^(\+?61|0)4\d{8}$/.test((s.mobile ?? "").replace(/[\s()-]/g, ""))) e.push("Enter a valid Australian mobile.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s.email ?? "").trim())) e.push("Enter a valid email address.");
  if (trade === "electrician" && !txt(s.licence_number)) e.push("Enter your Victorian electrician licence number.");
  if (trade === "installer" && !txt(s.qualification)) e.push("Enter your training or qualification (e.g. Cert III, or 'Experienced installer').");
  // Installers must upload their own EEC / Certified Insulation Installer certificate — free text never counts.
  if (trade === "installer" && !txt(s.certificate_path)) e.push("Upload the EEC / Certified Insulation Installer certificate.");
  return e;
}

/** Completion link (existing worker): the certificate only, and only when one is needed (Jo 5 Nov 2026: no declarations). */
export function completionErrors(s: { certificate_path?: Opt<string> }, need: { cert: boolean } = { cert: true }): string[] {
  const e: string[] = [];
  if (need.cert && !txt(s.certificate_path)) e.push("Upload the EEC / Certified Insulation Installer certificate.");
  return e;
}

/** A certificate is still needed from this person: an installer, not verified, and either nothing uploaded yet or the
 *  office did not accept the last one. */
export function completionNeedsCert(w: { trade_role: string; certification_status: string | null; certification: unknown }): boolean {
  if (w.trade_role !== "installer" || w.certification_status === "verified") return false;
  return w.certification_status === "rejected" || !hasEecUpload(w.certification);
}

/** Why the boss can't make this person's completion link (null = can): certificate links are for installers whose
 *  certificate isn't verified yet. */
export function signLinkBlocker(w: { trade_role: string; email: string | null; mobile: string | null; certification_status: string | null }): string | null {
  if (w.trade_role !== "installer") return "Certificate completion links are only for installer workers.";
  if (w.certification_status === "verified") return "This worker's certificate is already verified.";
  return null;
}

/** The person already uploaded their EEC / CII certificate (`certification.eec_upload.path` set). */
export function hasEecUpload(certification: unknown): boolean {
  const u = (certification as { eec_upload?: { path?: unknown } } | null)?.eec_upload;
  return typeof u?.path === "string" && u.path.length > 0;
}
