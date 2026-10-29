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

export const WORKER_DECLARATIONS_VERSION = "worker-v1";

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

export function workerDeclarations(trade: "electrician" | "installer", businessName: string) {
  const work = trade === "electrician" ? "electrical work" : "insulation work";
  return [
    { key: "own_behalf", text: `I am signing on my own behalf as a worker of ${businessName}, and ${businessName} has asked me to register under their business.` },
    { key: "customer_owner", text: "I understand the customer is Home Insulation Victoria's customer. I will not quote, invoice or accept payment from them separately for any work connected to a Home Insulation Victoria job, and I will not approach them for other work. All communication goes through the Home Insulation Victoria portal." },
    { key: "licence_current", text: trade === "electrician" ? "My Victorian electrician licence is current, and I will tell the business owner and Home Insulation Victoria straight away if it is suspended, cancelled or lapses." : "My training and any licences or cards I hold are current, and I will tell the business owner and Home Insulation Victoria straight away if that changes." },
    { key: "compliance", text: `I will carry out ${work} on Home Insulation Victoria jobs safely and in line with current VEU, Code of Conduct, electrical-safety and Home Insulation Victoria requirements.` },
    { key: "no_bypass", text: "I will not take any work identified through a Home Insulation Victoria job off-platform or deal with the customer directly about it." },
    { key: "true_info", text: "The details I have given are true and correct." },
  ];
}

type Opt<T> = T | undefined;
export type WorkerSubmission = {
  full_legal_name?: Opt<string>; mobile?: Opt<string>; email?: Opt<string>;
  licence_number?: Opt<string>; qualification?: Opt<string>;
  certificate_path?: Opt<string>; certificate_number?: Opt<string>;
  accepted?: Opt<string[]>; signed_name?: Opt<string>;
};

const txt = (s?: string | null) => !!s && s.trim().length > 0;

export function workerSubmissionErrors(trade: "electrician" | "installer", s: WorkerSubmission, keys: string[]): string[] {
  const e: string[] = [];
  if (!txt(s.full_legal_name) || s.full_legal_name!.trim().length < 2) e.push("Enter your full name.");
  if (!/^(\+?61|0)4\d{8}$/.test((s.mobile ?? "").replace(/[\s()-]/g, ""))) e.push("Enter a valid Australian mobile.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s.email ?? "").trim())) e.push("Enter a valid email address.");
  if (trade === "electrician" && !txt(s.licence_number)) e.push("Enter your Victorian electrician licence number.");
  if (trade === "installer" && !txt(s.qualification)) e.push("Enter your training or qualification (e.g. Cert III, or 'Experienced installer').");
  // Installers must upload their own EEC / Certified Insulation Installer certificate — free text never counts.
  if (trade === "installer" && !txt(s.certificate_path)) e.push("Upload the EEC / Certified Insulation Installer certificate.");
  const got = new Set(s.accepted ?? []);
  if (!keys.every((k) => got.has(k))) e.push("Tick every box before signing.");
  if (!txt(s.signed_name)) e.push("Type your full name to sign.");
  return e;
}

/** Completion link (existing worker): the certificate when `need.cert`, plus the worker declarations when they're due
 *  (people added on Team, Jo 29 Oct 2026) — same two signing errors as registration. */
export function completionErrors(s: { certificate_path?: Opt<string>; accepted?: Opt<string[]>; signed_name?: Opt<string> }, need: { cert: boolean; declarationKeys: string[] } = { cert: true, declarationKeys: [] }): string[] {
  const e: string[] = [];
  if (need.cert && !txt(s.certificate_path)) e.push("Upload the EEC / Certified Insulation Installer certificate.");
  if (need.declarationKeys.length) {
    const got = new Set(s.accepted ?? []);
    if (!need.declarationKeys.every((k) => got.has(k))) e.push("Tick every box before signing.");
    if (!txt(s.signed_name)) e.push("Type your full name to sign.");
  }
  return e;
}

/** Why the boss can't make this person's completion link yet (null = can). Declarations due (added on Team): any trade,
 *  but only once a mobile or email is on file. Otherwise today's certificate-only rules. */
export function signLinkBlocker(w: { trade_role: string; declarations_due: boolean; email: string | null; mobile: string | null; certification_status: string | null }): string | null {
  if (w.declarations_due) return txt(w.email) || txt(w.mobile) ? null : "Add their mobile or email first, then make their link.";
  if (w.trade_role !== "installer") return "Certificate completion links are only for installer workers.";
  if (w.certification_status === "verified") return "This worker's certificate is already verified.";
  return null;
}

/** The person already uploaded their EEC / CII certificate (`certification.eec_upload.path` set). */
export function hasEecUpload(certification: unknown): boolean {
  const u = (certification as { eec_upload?: { path?: unknown } } | null)?.eec_upload;
  return typeof u?.path === "string" && u.path.length > 0;
}
