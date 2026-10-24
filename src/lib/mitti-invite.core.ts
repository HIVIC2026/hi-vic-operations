// Mitti auto-invite on partner-person approval (decision 188, Jo 24 Oct 2026). PURE: no network, no database.
// "Build behind a switch (office confirm per person, lite seat default, TEST probe first)." Mitti seats are billed, so a
// person is never invited twice: one invite record per partner worker, ever. Template access stays a manual office step.
//
// What is real vs not yet possible (the Mitti endpoints the portal knows are in mitti.core.ts `mittiApi`):
//  - FIND/LINK an existing Mitti user by email — real (`POST /users/search`, already used by Check Mitti access).
//  - CREATE a Mitti user (lite seat) and ADD them to a group — no endpoint in the code or docs, so the portal records
//    "invite needed" for the office instead (MITTI_INVITE_MISSING_ENDPOINTS). Nothing is guessed.

/** Master switch. OFF: approvals do nothing Mitti-related (no lookups, no records). */
export const MITTI_AUTO_INVITE_ENABLED = false as boolean;
/** TEST probe first (decision 188): until a TEST person has gone through once and Jo confirms, only TEST people are processed. */
export const MITTI_AUTO_INVITE_PROBE_DONE = false as boolean;
/** Decision 188: lite seat by default (the seat type a create-user call would request; billed per seat). */
export const MITTI_DEFAULT_SEAT = "lite" as const;
/** The Mitti group each trade belongs in. Names only — the Mitti group IDs are not known to the portal (no groups endpoint). */
export const MITTI_GROUP_FOR_ROLE = { installer: "Installers", electrician: "Electricians" } as const;
export type MittiTradeRole = keyof typeof MITTI_GROUP_FOR_ROLE;

/** Endpoints the portal would need to invite automatically; none is present in mitti.core.ts or the docs. */
export const MITTI_INVITE_MISSING_ENDPOINTS = [
  "Create a Mitti user with a seat type (lite) for an email address",
  "List Mitti groups (to resolve the Installers / Electricians group ID)",
  "Add a Mitti user to a group",
] as const;
/** Always manual, by decision: which templates the person can open in Mitti. */
export const MITTI_TEMPLATE_ACCESS_NOTE = "Template access stays manual: give the person access to the right Mitti templates in Mitti.";

export const MITTI_INVITE_EVENTS = {
  needed: "mitti_invite_needed", // portal found no Mitti user: office must invite (create user + group)
  linked: "mitti_invite_linked", // an existing Mitti user was found and linked; group add still manual
  done: "mitti_invite_office_done", // office confirmed the invite/group/templates were done in Mitti
} as const;
export type MittiInviteEventType = (typeof MITTI_INVITE_EVENTS)[keyof typeof MITTI_INVITE_EVENTS];

export type InvitePerson = {
  workerId: string;
  tradeRole: string;
  approvalStatus: string;
  removedAt: string | null;
  email: string | null;
  /** Installers: decision 153 crew clearance from the office-verified CII check (worker-compliance.core `crewClearance`). */
  ciiCleared: boolean;
  /** Mitti membership derived by mitti-membership.core `mittiAccessOf` on the linked profile; null = no portal profile yet. */
  mittiAccess: "member" | "not_found" | "unchecked" | "email_changed" | null;
  /** TEST person (test email or TEST partner business). */
  isTest: boolean;
};
/** Latest invite record already stored for this worker (any of MITTI_INVITE_EVENTS), or null. */
export type PriorInvite = { type: MittiInviteEventType; at: string } | null;
export type InviteSwitches = { enabled: boolean; probeDone: boolean };

export type InviteStep =
  | { action: "skip"; reason: string }
  | { action: "lookup"; group: string; seat: typeof MITTI_DEFAULT_SEAT; key: string }
  | { action: "record_linked"; group: string; seat: typeof MITTI_DEFAULT_SEAT; key: string; mittiUserId: string }
  | { action: "record_needed"; group: string; seat: typeof MITTI_DEFAULT_SEAT; key: string };

/** One invite per partner worker, ever (seats are billed). */
export const inviteKey = (workerId: string) => `mitti-invite:${workerId}`;

/** Is this approved partner person someone who should be in Mitti? Installers once their CII is verified (decision 153),
 *  electricians once approved. Null = yes; otherwise the reason not. */
export function inviteEligibility(p: InvitePerson): string | null {
  if (p.removedAt) return "Removed from the business.";
  if (p.approvalStatus !== "approved") return "Not approved by the office yet.";
  if (p.tradeRole !== "installer" && p.tradeRole !== "electrician") return `No Mitti group for the ${p.tradeRole} role.`;
  if (p.tradeRole === "installer" && !p.ciiCleared) return "Installer's CII certificate is not verified and current yet.";
  if (!p.email?.trim()) return "No email on file — Mitti invites go to an exact email address.";
  return null;
}

/**
 * The next step for one person. `lookup` = undefined means the Mitti search has not run yet (the server runs it and calls
 * again); `{ mittiUserId: null }` = searched and not found. Order: switch → TEST probe → eligibility → already handled →
 * already a member → search → link existing or record "invite needed". Never creates anything in Mitti.
 */
export function mittiInviteStep(p: InvitePerson, prior: PriorInvite, sw: InviteSwitches, lookup?: { mittiUserId: string | null }): InviteStep {
  if (!sw.enabled) return { action: "skip", reason: "Mitti auto-invite is switched off." };
  if (!sw.probeDone && !p.isTest) return { action: "skip", reason: "Waiting for the TEST probe: only TEST people are processed until Jo confirms it." };
  const why = inviteEligibility(p);
  if (why) return { action: "skip", reason: why };
  if (prior) return { action: "skip", reason: `Already handled (${prior.type.replace(/_/g, " ")}) — never invited twice.` };
  if (p.mittiAccess === "member") return { action: "skip", reason: "Already in Mitti." };
  const role = p.tradeRole as MittiTradeRole;
  const base = { group: MITTI_GROUP_FOR_ROLE[role], seat: MITTI_DEFAULT_SEAT, key: inviteKey(p.workerId) };
  if (lookup === undefined) return { action: "lookup", ...base };
  return lookup.mittiUserId ? { action: "record_linked", ...base, mittiUserId: lookup.mittiUserId } : { action: "record_needed", ...base };
}

export type InviteRecord = { workerId: string; type: MittiInviteEventType; at: string; email: string | null; name: string | null; business: string | null; group: string | null; mittiUserId: string | null };
export type OpenInvite = InviteRecord & { todo: string[] };

/** What the office still has to do in Mitti for this record. */
export function inviteTodo(r: Pick<InviteRecord, "type" | "email" | "group">): string[] {
  if (r.type === MITTI_INVITE_EVENTS.done) return [];
  const t: string[] = [];
  if (r.type === MITTI_INVITE_EVENTS.needed) t.push(`Invite ${r.email ?? "this person"} to Mitti with that exact email (${MITTI_DEFAULT_SEAT} seat).`);
  t.push(`Add them to the ${r.group ?? "right"} group in Mitti.`);
  t.push(MITTI_TEMPLATE_ACCESS_NOTE);
  return t;
}

/** People tab list: the latest record per worker, still open (not confirmed done by the office), newest first. */
export function openInvites(records: InviteRecord[]): OpenInvite[] {
  const latest = new Map<string, InviteRecord>();
  for (const r of records) {
    const cur = latest.get(r.workerId);
    if (!cur || r.at > cur.at) latest.set(r.workerId, r);
  }
  return [...latest.values()].filter((r) => r.type !== MITTI_INVITE_EVENTS.done).sort((a, b) => b.at.localeCompare(a.at)).map((r) => ({ ...r, todo: inviteTodo(r) }));
}

/** The latest stored record for one worker (idempotency input for `mittiInviteStep`). */
export function priorInviteFor(workerId: string, records: Pick<InviteRecord, "workerId" | "type" | "at">[]): PriorInvite {
  const mine = records.filter((r) => r.workerId === workerId).sort((a, b) => b.at.localeCompare(a.at));
  return mine[0] ? { type: mine[0].type, at: mine[0].at } : null;
}
