// Lead / Crew for installer people (Jo 28 Oct 2026). Pure rules only; persistence lives in mitti-invite.server.ts and
// worker-links.functions.ts. Stored in the existing partner_workers.worker_role column ('lead' | 'crew' | null).
// A null role counts as Crew, except for someone who already has Mitti access today: they count as Lead so nobody
// loses access. Only installers have a Lead/Crew role; electricians keep their existing Mitti rules.
import { MITTI_INVITE_EVENTS } from "./mitti-invite.core";
export { CREW_SKIP as CREW_NO_MITTI } from "./mitti-invite.core";

export type WorkerRole = "lead" | "crew";
export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = { lead: "Lead", crew: "Crew" };
export const WORKER_ROLE_CHANGED_EVENT = "worker_role_changed";

/** Mitti records that mean the person has Mitti access today (the latest record wins). */
const ACCESS_RECORDS = new Set<string>([MITTI_INVITE_EVENTS.linked, MITTI_INVITE_EVENTS.userLinked, MITTI_INVITE_EVENTS.invited, MITTI_INVITE_EVENTS.reactivated, MITTI_INVITE_EVENTS.done]);

/** Has Mitti access today: their linked login is a Mitti member, or the latest portal Mitti record gave them access. */
export function hasMittiAccessToday(latestInviteRecord: string | null | undefined, profileIsMember: boolean): boolean {
  return profileIsMember || (!!latestInviteRecord && ACCESS_RECORDS.has(latestInviteRecord));
}

/** The role that applies. Non-installers → null (no Lead/Crew). */
export function effectiveWorkerRole(p: { tradeRole: string; stored: string | null | undefined; hasMittiAccess: boolean }): WorkerRole | null {
  if (p.tradeRole !== "installer") return null;
  if (p.stored === "lead" || p.stored === "crew") return p.stored;
  return p.hasMittiAccess ? "lead" : "crew";
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

/** What a role switch does in Mitti: to Lead → invite; Lead → Crew → deactivate; no change → nothing. */
export function roleSwitchMittiAction(from: WorkerRole, to: WorkerRole): "invite" | "deactivate" | "none" {
  if (from === to) return "none";
  return to === "lead" ? "invite" : "deactivate";
}

/** Who may change it: HIV admins and the business's own business_admin. */
export const canChangeWorkerRole = (p: { isAdmin: boolean; memberRole: string | null | undefined }) => p.isAdmin || p.memberRole === "business_admin";

/** Lead → Crew keeps the Mitti user when the same Mitti email still belongs to another active Lead. Null roles of
 *  others count as Lead here (fails towards keeping someone's access, never towards removing it). */
export function emailStillUsedByAnotherLead(selfId: string, email: string | null, others: { id: string; mittiEmail: string | null; tradeRole: string; workerRole: string | null; removedAt: string | null; approvalStatus: string }[]): boolean {
  if (!email) return false;
  return others.some((o) => o.id !== selfId && !o.removedAt && o.approvalStatus === "approved" && o.tradeRole === "installer" && o.workerRole !== "crew" && sameWorkerEmail(o.mittiEmail, email));
}

export function roleChangeSummary(name: string, from: WorkerRole, to: WorkerRole) {
  return `${name}: ${WORKER_ROLE_LABEL[from]} → ${WORKER_ROLE_LABEL[to]}`;
}
