// Jo 28 Oct 2026: installer people are a Lead or Crew (partner_workers.worker_role). Pure rules only.
// A blank role counts as Crew, except people who already have Mitti access today — they count as Lead so nobody loses access.
// Electricians are not split into Lead/Crew and keep today's behaviour (treated as Lead for Mitti).

export type WorkerRole = "lead" | "crew";
export const WORKER_ROLE_EVENT = "worker_role_changed";
export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = { lead: "Lead", crew: "Crew" };

/** Lower-case trimmed email, or null when there is none (people may now be saved without an email). */
export function workerEmailKey(e: string | null | undefined): string | null {
  const t = (e ?? "").trim().toLowerCase();
  return t || null;
}

/** Does this person have Mitti access today? Linked Mitti user on their login, or a portal-recorded Mitti user not deactivated since. */
export function hasMittiAccessToday(p: { profileMittiUserId?: string | null; prior?: { type: string; mittiUserId?: string | null } | null }): boolean {
  if (p.profileMittiUserId) return true;
  return !!p.prior?.mittiUserId && p.prior.type !== "mitti_user_deactivated";
}

export function effectiveWorkerRole(w: { trade_role: string; worker_role: string | null | undefined }, hasMittiAccess: boolean): WorkerRole {
  if (w.trade_role !== "installer") return "lead";
  if (w.worker_role === "lead" || w.worker_role === "crew") return w.worker_role;
  return hasMittiAccess ? "lead" : "crew";
}

/** The email Mitti should use for a Lead: their own, else the business's own email. */
export function mittiEmailFor(workerEmail: string | null | undefined, businessEmail: string | null | undefined): string | null {
  return workerEmailKey(workerEmail) ?? workerEmailKey(businessEmail);
}

/** A certification row belongs to a worker by id, or by email only when the worker has one. */
export function certMatchesWorker(cert: { worker_id?: string | null; worker_email?: string | null }, w: { id: string; email: string | null | undefined }): boolean {
  if (cert.worker_id && cert.worker_id === w.id) return true;
  const k = workerEmailKey(w.email);
  return !!k && workerEmailKey(cert.worker_email) === k;
}

/** PostgREST `.or()` filter for certifications by worker ids plus any emails (blank emails are left out). */
export function certOrFilter(ids: string[], emails: (string | null | undefined)[]): string {
  const es = [...new Set(emails.map(workerEmailKey).filter((e): e is string => !!e))];
  const byId = `worker_id.in.(${ids.join(",")})`;
  return es.length ? `${byId},worker_email.in.(${es.map((e) => `"${e}"`).join(",")})` : byId;
}

export function roleChangeSummary(name: string, from: WorkerRole, to: WorkerRole): string {
  return `${name}: ${WORKER_ROLE_LABEL[from]} → ${WORKER_ROLE_LABEL[to]}`;
}

/** Who may switch a person: HIV admins, or that business's own business_admin. */
export function canChangeWorkerRole(c: { isAdmin: boolean; memberRole: string | null }): boolean {
  return c.isAdmin || c.memberRole === "business_admin";
}
