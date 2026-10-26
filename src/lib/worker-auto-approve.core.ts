// Decision 402 (Jo 26 Oct 2026): when the office approves/activates a partner business, every person listed on it whose
// certification is already office-verified gets their login approved in the same action; everyone else stays pending.
// PURE: who qualifies. Persistence in worker-approval.server.ts.
import { crewClearance } from "./worker-compliance.core";

export const AUTO_APPROVE_DECISION = 402;
export const AUTO_APPROVE_SUMMARY = "Worker approved automatically with the business (decision 402)";

export type AutoApprovePerson = {
  id: string;
  trade_role: string;
  approval_status: string;
  removed_at: string | null;
  /** partner_workers.certification_status (installers: office CII check; null for electricians). */
  certification_status: string | null;
  /** Latest office CII check for the person + the level/expiry recorded against it (decision 153). Null = none recorded. */
  cii: { certStatus: string | null; level: string | null; expiresOn: string | null } | null;
};

export const AUTO_APPROVE_SKIP = {
  removed: "Removed from the business.",
  notPending: "Not pending (already approved or rejected by the office).",
  electrician: "Electricians have no office-verified certification on their person record, so the office approves them in Needs me.",
  otherRole: "Only installers are approved automatically.",
  unverified: "CII certificate not verified by the office yet.",
} as const;

/**
 * Null = approve this person's login now; otherwise why they stay as they are.
 * Installers: pending, not removed, `certification_status = 'verified'` (the live 0082 guard) AND cleared by `crewClearance`
 * (latest office check verified + level and expiry recorded + not expired). Rejected / removed / approved people are never touched.
 * Electricians: never automatic (no person-level office verification exists for them; licence details are declared only).
 */
export function autoApproveSkipReason(p: AutoApprovePerson, today: string): string | null {
  if (p.removed_at) return AUTO_APPROVE_SKIP.removed;
  if (p.approval_status !== "pending") return AUTO_APPROVE_SKIP.notPending;
  if (p.trade_role === "electrician") return AUTO_APPROVE_SKIP.electrician;
  if (p.trade_role !== "installer") return AUTO_APPROVE_SKIP.otherRole;
  if (p.certification_status !== "verified") return AUTO_APPROVE_SKIP.unverified;
  const c = crewClearance({ removed_at: p.removed_at, certStatus: p.cii?.certStatus ?? null, level: p.cii?.level ?? null, expiresOn: p.cii?.expiresOn ?? null }, today);
  return c.cleared ? null : c.reason;
}

export function selectAutoApprove<T extends AutoApprovePerson>(people: T[], today: string): { approve: T[]; left: { person: T; reason: string }[] } {
  const approve: T[] = [];
  const left: { person: T; reason: string }[] = [];
  for (const p of people) {
    const reason = autoApproveSkipReason(p, today);
    if (reason) left.push({ person: p, reason });
    else approve.push(p);
  }
  return { approve, left };
}
