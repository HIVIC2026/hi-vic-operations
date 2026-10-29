// Lead / Crew for installer people (Jo 28 Oct 2026). Pure rules only; persistence lives in mitti-invite.server.ts and
// worker-links.functions.ts. Stored in the existing partner_workers.worker_role column ('lead' | 'crew' | null).
// null = Lead (Jo 29 Oct); switching to Crew leaves Mitti alone. Only installers have a Lead/Crew role; electricians
// keep their existing Mitti rules.
export { CREW_SKIP as CREW_NO_MITTI } from "./mitti-invite.core";

export type WorkerRole = "lead" | "crew";
export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = { lead: "Lead", crew: "Crew" };
export const WORKER_ROLE_CHANGED_EVENT = "worker_role_changed";

/** The role that applies. Non-installers → null (no Lead/Crew). Crew only when stored; anything else is Lead. */
export function effectiveWorkerRole(p: { tradeRole: string; stored: string | null | undefined }): WorkerRole | null {
  if (p.tradeRole !== "installer") return null;
  return p.stored === "crew" ? "crew" : "lead";
}

/** Same key for comparing emails; empty/null → "" (never matches anything). */
export const workerEmailKey = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();
export const sameWorkerEmail = (a: string | null | undefined, b: string | null | undefined) => { const x = workerEmailKey(a); return !!x && x === workerEmailKey(b); };

/** PostgREST `.or()` filter for certification checks by worker id, plus email only when the person has one. */
export function certOrFilter(workers: { id: string; email: string | null | undefined }[]): string {
  const emails = [...new Set(workers.map((w) => workerEmailKey(w.email)).filter(Boolean))];
  const ids = workers.map((w) => w.id).join(",");
  return emails.length ? `worker_id.in.(${ids}),worker_email.in.(${emails.map((e) => `"${e}"`).join(",")})` : `worker_id.in.(${ids})`;
}

/** The email a Lead is invited or linked with: their own, else the business's own email. Crew → none. */
export function mittiEmailFor(p: { role: WorkerRole | null; ownEmail: string | null | undefined; businessEmail: string | null | undefined }): { email: string | null; source: "own" | "business" | null } {
  const own = workerEmailKey(p.ownEmail);
  if (own) return { email: own, source: "own" };
  if (p.role !== "lead") return { email: null, source: null };
  const biz = workerEmailKey(p.businessEmail);
  return biz ? { email: biz, source: "business" } : { email: null, source: null };
}

/** What a role switch does in Mitti: Crew → Lead → invite; anything else → nothing (Crew is never removed from Mitti). */
export function roleSwitchMittiAction(from: WorkerRole, to: WorkerRole): "invite" | "none" {
  return from === "crew" && to === "lead" ? "invite" : "none";
}

/** Who may change it: HIV admins and the business's own business_admin. */
export const canChangeWorkerRole = (p: { isAdmin: boolean; memberRole: string | null | undefined }) => p.isAdmin || p.memberRole === "business_admin";

export function roleChangeSummary(name: string, from: WorkerRole, to: WorkerRole) {
  return `${name}: ${WORKER_ROLE_LABEL[from]} → ${WORKER_ROLE_LABEL[to]}`;
}
