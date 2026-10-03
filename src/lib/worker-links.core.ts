// Worker magic links: one company account, approved workers listed under it, and a
// per-job secure link per worker. Pure rules only — persistence in worker-links.server.ts.

export const LINK_DAYS = 30;
const DAY = 86_400_000;

export type WorkerLike = { approval_status: string; removed_at: string | null; business_id: string; trade_role?: string | null; certification_status?: string | null };

/** Installers need an office-verified EEC CII certification; free-text qualification never counts. */
export const certificationBlocker = (w: Pick<WorkerLike, "trade_role" | "certification_status">): string | null =>
  w.trade_role === "installer" && w.certification_status !== "verified"
    ? (w.certification_status === "rejected" ? "This installer's CII certification was not accepted by Home Insulation Victoria." : "This installer's CII certification hasn't been verified by Home Insulation Victoria yet.")
    : null;
export type LinkLike = { revoked_at: string | null; expires_at: string };

/** 32 random bytes, base64url — unguessable; only its hash is stored. */
export function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const isTokenShape = (t: string) => /^[A-Za-z0-9_-]{40,64}$/.test(t);

export function linkState(l: LinkLike, now: number): "active" | "revoked" | "expired" {
  if (l.revoked_at) return "revoked";
  return new Date(l.expires_at).getTime() <= now ? "expired" : "active";
}

export const linkExpiry = (now: number) => new Date(now + LINK_DAYS * DAY).toISOString();

/** Why a worker can't be given a job link (null = OK). */
export function assignBlocker(w: WorkerLike, assignedBusinessIds: string[]): string | null {
  if (w.removed_at) return "This worker has been removed from the company.";
  if (w.approval_status === "pending") return "This worker is waiting for Home Insulation Victoria approval.";
  if (w.approval_status !== "approved") return "This worker wasn't approved by Home Insulation Victoria.";
  const cert = certificationBlocker(w);
  if (cert) return cert;
  if (!assignedBusinessIds.includes(w.business_id)) return "This worker's company isn't assigned to this job.";
  return null;
}

/** Company edits to identity/licence fields send the worker back for office approval. */
export const REAPPROVAL_FIELDS = ["full_legal_name", "licence_number", "qualification", "trade_role"] as const;
export function needsReapproval(before: Record<string, unknown>, after: Record<string, unknown>) {
  return REAPPROVAL_FIELDS.some((k) => k in after && (after[k] ?? null) !== (before[k] ?? null));
}

export const senderLabel = (workerName: string, businessName: string | null) =>
  businessName ? `${workerName} — ${businessName}` : workerName;

export const firstName = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] || null;
