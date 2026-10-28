// Mitti access for partner people (decision 188, Jo 24 Oct 2026; extended by decision 331, Jo 25 Oct 2026: "work out how
// everyone gets Mitti access automatically"). PURE: no network, no database. Mitti seats are billed, so a person is never
// invited twice, and a removed person's seat is deactivated.
//
// How it works (docs/MITTI_ACCESS.md):
//  - Switch: env MITTI_AUTO_INVITE_ENABLED=true (default OFF → approvals/removals do nothing Mitti-related).
//  - FIND/LINK an existing Mitti user by email — `POST /users/search` (already used by Check Mitti access).
//  - CREATE / ADD TO GROUP / DEACTIVATE — the Mitti (SafetyCulture) user endpoints in MITTI_USER_API. Their paths come from
//    the public reference (sources below) but the request bodies could not be confirmed against a live token, so these
//    calls stay refused until MITTI_USER_API_VERIFIED is set to true after one probe on a real (non-synthetic) address.
//    Until then the portal links found users and records "invite needed" / "deactivate by hand" for the office.
//  - TEST people (@hivic.test etc. or a TEST partner) are skipped: Mitti rejects synthetic emails and TEST forms go to the
//    test assignee.
import { mjEmail, esc } from "./mail-mjml.core";
import { plainText } from "./email-kit.core";

/** Default when the env switch is not set. */
export const MITTI_AUTO_INVITE_ENABLED = false as boolean;
export const MITTI_AUTO_INVITE_ENV = "MITTI_AUTO_INVITE_ENABLED";
/** Env switch: only the exact word "true" switches it on. */
export const autoInviteEnabled = (v: string | null | undefined): boolean => (v ?? "").trim().toLowerCase() === "true";

/**
 * The create/group/deactivate request bodies below are taken from the public reference but were NOT exercised against
 * Mitti (no token in the build environment). Set to true only after a developer has run one probe with the real token on a
 * real address and confirmed (1) the user is created with the configured seat, (2) Mitti emails them to set a password,
 * (3) group add and deactivate work. False = never create/group/deactivate; the office does those steps by hand.
 */
export const MITTI_USER_API_VERIFIED = false as boolean;

export type MittiSeat = "full" | "lite" | "free";
/** Seat requested per trade. Decision 340 (Jo 25 Oct 2026): Lite seats for installers AND electricians; see docs/MITTI_ACCESS.md for the limits. */
export const MITTI_SEAT_FOR_ROLE = { installer: "lite", electrician: "lite" } as const satisfies Record<string, MittiSeat>;
/** Decision 340: Home Insulation Victoria pays for every trade seat — never charged back to the partner business. */
export const MITTI_SEATS_PAID_BY = "Home Insulation Victoria" as const;
/** Decision 188 default seat (kept for the office to-do wording). */
export const MITTI_DEFAULT_SEAT: MittiSeat = "lite";
export type MittiTradeRole = keyof typeof MITTI_SEAT_FOR_ROLE;
/** One Mitti group for every trade (decision 331). Its Mitti ID comes from env MITTI_TRADES_GROUP_ID (never guessed). */
export const MITTI_TRADES_GROUP = "HIV trades";
export const MITTI_TRADES_GROUP_ENV = "MITTI_TRADES_GROUP_ID";

/** Mitti (SafetyCulture) user endpoints. Base https://api.mitti.com (api.safetyculture.io still serves the same API). */
export const MITTI_USER_API = {
  search: { method: "POST", path: "/users/search", source: "https://developer.mitti.com/reference/thepubservice_searchusers" },
  create: { method: "POST", path: "/users", source: "https://developer.mitti.com/reference/thepubservice_adduser" },
  addToGroup: { method: "POST", path: "/groups/{group_id}/users", source: "https://developer.mitti.com/reference/thepubservice_addnewusertogroup" },
  update: { method: "PUT", path: "/users/{user_id}", source: "https://developer.safetyculture.com/reference/thepubservice_updateuser" },
} as const;

/** Body for the (legacy, deprecated but live) "Create a user" call. The password is a throwaway the portal never stores
 *  or logs; Mitti ignores it when the user already exists, and the person sets their own. */
export function createUserBody(p: { fullName: string | null; email: string; seat: MittiSeat; password: string }) {
  const { first, last } = splitName(p.fullName, p.email);
  return { firstname: first, lastname: last, email: p.email.trim().toLowerCase(), password: p.password, seat_type: p.seat };
}
export const addToGroupBody = (mittiUserId: string) => ({ user_id: mittiUserId });
export const userStatusBody = (status: "active" | "inactive") => ({ status });
export const groupPath = (groupId: string) => MITTI_USER_API.addToGroup.path.replace("{group_id}", encodeURIComponent(groupId));
export const userPath = (mittiUserId: string) => MITTI_USER_API.update.path.replace("{user_id}", encodeURIComponent(mittiUserId));
/** Mitti's create response carries the new user's id as `user_id` (legacy) or `id`. */
export function createdUserId(res: unknown): string | null {
  const r = (res ?? {}) as Record<string, unknown>;
  const v = r["user_id"] ?? r["id"] ?? (r["user"] as Record<string, unknown> | undefined)?.["id"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function splitName(full: string | null | undefined, email: string): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { first: parts[0]!, last: parts.slice(1).join(" ") };
  if (parts.length === 1) return { first: parts[0]!, last: "-" };
  return { first: email.split("@")[0] || "Trade", last: "-" };
}

/** Decision 331: the one message to a newly invited person (text if they have a mobile, else email). Approved route. */
export const MITTI_INVITE_MESSAGE = "You've been invited to Mitti, the app you'll use for Home Insulation Victoria job forms. Check your email from Mitti, set your password, and download the Mitti app.";
export const MITTI_INVITE_SUBJECT = "You've been invited to Mitti";
export const mittiInviteMessageKey = (workerId: string) => `mitti-invite-message:v1:${workerId}`;

/** The invite as an email (MJML design docs/templates/mjml/installer_mitti-invite.mjml, Jo 26 Oct 2026): the same words as
 *  MITTI_INVITE_MESSAGE, with the three steps as a numbered list. Sent by mitti-invite.server when there is no mobile. */
export function renderMittiInviteEmail(i: { name: string | null; test?: boolean }) {
  const first = i.name?.trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first},` : "Hello,";
  const lead = "Mitti is the app you'll use for Home Insulation Victoria job forms.";
  const steps = ["Check your email from Mitti", "Set your password", "Download the Mitti app"];
  const reply = "Just reply to this email if you have any questions.";
  const row = (t: string, n: number) => { const pad = n === steps.length - 1 ? 12 : 14; return `<tr><td width="32" valign="top" style="padding:2px 0 ${pad}px;"><span class="num">${n + 1}</span></td><td style="padding:0 0 ${pad}px;">${esc(t)}</td></tr>`; };
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(MITTI_INVITE_SUBJECT)}</mj-text><mj-text>${esc(lead)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">To get started</mj-text><mj-table padding="0 18px 6px">${steps.map(row).join("")}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(reply)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject: MITTI_INVITE_SUBJECT, preview: "Look for the email from Mitti to set your password.", body, unsubscribe: null, testLabel: i.test === true });
  const text = plainText([hi, "", MITTI_INVITE_SUBJECT, "", lead, "", "TO GET STARTED", ...steps.map((t, n) => `${n + 1}. ${t}`), "", reply], { testLabel: i.test === true });
  return { subject: MITTI_INVITE_SUBJECT, html, text };
}

/** Decision 188/331: template access is through the HIV trades group (share the templates with that group once in Mitti). */
export const MITTI_TEMPLATE_ACCESS_NOTE = `Template access comes from the ${MITTI_TRADES_GROUP} group: share the A1–A5 templates with that group once in Mitti.`;

export const MITTI_INVITE_EVENTS = {
  needed: "mitti_invite_needed", // no Mitti user and the portal may not create one yet: office invites by hand
  linked: "mitti_invite_linked", // decision 188 history: an existing Mitti user was linked
  userLinked: "mitti_user_linked", // decision 331: an existing Mitti user was linked (group added when possible)
  invited: "mitti_user_invited", // decision 331: the portal created the Mitti user and sent the one message
  reactivated: "mitti_user_reactivated", // re-approved after a deactivation
  deactivated: "mitti_user_deactivated", // removed/rejected in the portal → Mitti seat deactivated
  failed: "mitti_access_failed", // one office item with the plain reason
  done: "mitti_invite_office_done", // office confirmed it was finished in Mitti
} as const;
export type MittiInviteEventType = (typeof MITTI_INVITE_EVENTS)[keyof typeof MITTI_INVITE_EVENTS];
const HAS_MITTI_USER: MittiInviteEventType[] = [MITTI_INVITE_EVENTS.linked, MITTI_INVITE_EVENTS.userLinked, MITTI_INVITE_EVENTS.invited, MITTI_INVITE_EVENTS.reactivated];

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
  /** Installers (Jo 28 Oct): true = Crew, never invited (worker-role.core decides). Absent = Lead. */
  crew?: boolean;
};
/** Latest stored record for this worker (any of MITTI_INVITE_EVENTS), or null. `mittiUserId` = the latest one known. */
export type PriorInvite = { type: MittiInviteEventType; at: string; mittiUserId?: string | null; email?: string | null } | null;
export type InviteSwitches = { enabled: boolean; apiVerified?: boolean; groupId?: string | null };

type Base = { group: string; seat: MittiSeat; key: string };
export type InviteStep =
  | { action: "skip"; reason: string }
  | ({ action: "lookup" } & Base)
  | ({ action: "record_linked"; mittiUserId: string; addToGroup: string | null } & Base)
  | ({ action: "record_needed" } & Base)
  | ({ action: "create"; addToGroup: string | null } & Base)
  | ({ action: "reactivate"; mittiUserId: string } & Base)
  | ({ action: "fail"; reason: string } & Base);

/** One invite per partner worker, ever (seats are billed). */
export const inviteKey = (workerId: string) => `mitti-invite:${workerId}`;

export const CREW_SKIP = "Crew — only Lead installers get Mitti access.";
export const TEST_SKIP = "TEST person: TEST forms go to the test assignee and Mitti rejects synthetic emails.";

/** Is this approved partner person someone who should be in Mitti? Installers once their CII is verified (decision 153),
 *  electricians once approved. Null = yes; otherwise the reason not. */
export function inviteEligibility(p: InvitePerson): string | null {
  if (p.removedAt) return "Removed from the business.";
  if (p.approvalStatus !== "approved") return "Not approved by the office yet.";
  if (p.tradeRole !== "installer" && p.tradeRole !== "electrician") return `No Mitti access for the ${p.tradeRole} role.`;
  if (p.tradeRole === "installer" && p.crew) return CREW_SKIP;
  if (p.tradeRole === "installer" && !p.ciiCleared) return "Installer's CII certificate is not verified and current yet.";
  if (!p.email?.trim()) return "No email on file — Mitti invites go to an exact email address.";
  return null;
}

/**
 * The next step for one approved person. `lookup` undefined = the Mitti search has not run yet (the server runs it and
 * calls again); `{ mittiUserId: null }` = searched and not found. Order: switch → TEST → eligibility → earlier record →
 * already a member → search → link existing / create (API verified) / record "invite needed".
 */
export function mittiInviteStep(p: InvitePerson, prior: PriorInvite, sw: InviteSwitches, lookup?: { mittiUserId: string | null }): InviteStep {
  if (!sw.enabled) return { action: "skip", reason: "Mitti auto-invite is switched off." };
  if (p.isTest) return { action: "skip", reason: TEST_SKIP };
  const why = inviteEligibility(p);
  if (why) return { action: "skip", reason: why };
  const role = p.tradeRole as MittiTradeRole;
  const base: Base = { group: MITTI_TRADES_GROUP, seat: MITTI_SEAT_FOR_ROLE[role], key: inviteKey(p.workerId) };
  const group = sw.apiVerified && sw.groupId?.trim() ? sw.groupId.trim() : null;
  if (prior?.mittiUserId && prior.email?.trim().toLowerCase() !== p.email?.trim().toLowerCase())
    return { action: "fail", ...base, reason: "This person's email no longer matches the recorded Mitti identity — the office must check their account before reusing it." };
  if (prior?.type === MITTI_INVITE_EVENTS.deactivated) {
    if (!prior.mittiUserId) return { action: "fail", ...base, reason: "Their Mitti user was deactivated earlier but its ID is not on file — reactivate them in Mitti by hand." };
    if (!sw.apiVerified) return { action: "fail", ...base, reason: "Their Mitti user was deactivated earlier — reactivate them in Mitti by hand (the portal's Mitti user calls are not verified yet)." };
    return { action: "reactivate", ...base, mittiUserId: prior.mittiUserId };
  }
  // A failure is the only earlier record that may be retried (the search runs first, so nothing is created twice).
  if (prior && prior.type !== MITTI_INVITE_EVENTS.failed) return { action: "skip", reason: `Already handled (${prior.type.replace(/_/g, " ")}) — never invited twice.` };
  if (p.mittiAccess === "member") return { action: "skip", reason: "Already in Mitti." };
  if (lookup === undefined) return { action: "lookup", ...base };
  if (lookup.mittiUserId) return { action: "record_linked", ...base, mittiUserId: lookup.mittiUserId, addToGroup: group };
  return sw.apiVerified ? { action: "create", ...base, addToGroup: group } : { action: "record_needed", ...base };
}

export type RemovalPerson = { workerId: string; email: string | null; isTest: boolean; removedAt: string | null; approvalStatus: string; stillActiveElsewhere: boolean;
  /** Jo 28 Oct: switched from Lead to Crew while still active in the portal. */
  demoted?: boolean };
export type RemovalStep = { action: "skip"; reason: string } | { action: "deactivate"; mittiUserId: string } | { action: "fail"; reason: string; mittiUserId: string };

/** A person removed (or rejected) in the portal → deactivate the Mitti user the portal invited or linked for them. Never
 *  touches a TEST person, someone still active for another business, or a Mitti user the portal has no record of. */
export function mittiRemovalStep(p: RemovalPerson, prior: PriorInvite, sw: InviteSwitches): RemovalStep {
  if (!sw.enabled) return { action: "skip", reason: "Mitti auto-invite is switched off." };
  if (p.isTest) return { action: "skip", reason: TEST_SKIP };
  if (!p.demoted && !p.removedAt && p.approvalStatus === "approved") return { action: "skip", reason: "Still active in the portal." };
  if (prior?.type === MITTI_INVITE_EVENTS.deactivated) return { action: "skip", reason: "Already deactivated in Mitti." };
  if (!prior?.mittiUserId) return { action: "skip", reason: "No Mitti user is recorded for this person." };
  if (prior.email?.trim().toLowerCase() !== p.email?.trim().toLowerCase()) return { action: "fail", mittiUserId: prior.mittiUserId, reason: "This person's email does not match the recorded Mitti identity — the office must check it before deactivation." };
  if (p.stillActiveElsewhere) return { action: "skip", reason: p.demoted ? "The same email still belongs to another active Lead — Mitti seat kept." : "The same email is still an active trade for another business — Mitti seat kept." };
  if (!sw.apiVerified) return { action: "fail", mittiUserId: prior.mittiUserId, reason: `Deactivate ${p.email ?? "this person"} in Mitti by hand so the seat can be released (the portal's Mitti user calls are not verified yet).` };
  return { action: "deactivate", mittiUserId: prior.mittiUserId };
}

export type InviteRecord = { workerId: string; type: MittiInviteEventType; at: string; email: string | null; name: string | null; business: string | null; group: string | null; mittiUserId: string | null; groupAdded?: boolean; reason?: string | null };
export type OpenInvite = InviteRecord & { todo: string[] };

/** What the office still has to do in Mitti for this record (empty = nothing). */
export function inviteTodo(r: Pick<InviteRecord, "type" | "email" | "group"> & { groupAdded?: boolean; reason?: string | null }): string[] {
  const E = MITTI_INVITE_EVENTS;
  if (r.type === E.done || r.type === E.deactivated) return [];
  if (r.type === E.failed) return [r.reason ?? "Mitti set-up failed — finish it in Mitti by hand."];
  const t: string[] = [];
  if (r.type === E.needed) t.push(`Invite ${r.email ?? "this person"} to Mitti with that exact email (${MITTI_DEFAULT_SEAT} seat).`);
  if (!r.groupAdded) t.push(`Add them to the ${r.group ?? MITTI_TRADES_GROUP} group in Mitti.`);
  if (t.length && (r.type === E.needed || r.type === E.linked)) t.push(MITTI_TEMPLATE_ACCESS_NOTE);
  return t;
}

/** People tab list: the latest record per worker that still needs the office, newest first. */
export function openInvites(records: InviteRecord[]): OpenInvite[] {
  const latest = new Map<string, InviteRecord>();
  for (const r of records) {
    const cur = latest.get(r.workerId);
    if (!cur || r.at > cur.at) latest.set(r.workerId, r);
  }
  return [...latest.values()].map((r) => ({ ...r, todo: inviteTodo(r) })).filter((r) => r.todo.length > 0).sort((a, b) => b.at.localeCompare(a.at));
}

/** The latest stored record for one worker (idempotency input), with the latest Mitti user id the portal knows. */
export function priorInviteFor(workerId: string, records: Pick<InviteRecord, "workerId" | "type" | "at" | "mittiUserId" | "email">[]): PriorInvite {
  const mine = records.filter((r) => r.workerId === workerId).sort((a, b) => b.at.localeCompare(a.at));
  if (!mine[0]) return null;
  const known = mine.find((r) => r.mittiUserId && (HAS_MITTI_USER.includes(r.type) || r.type === MITTI_INVITE_EVENTS.deactivated || r.type === MITTI_INVITE_EVENTS.failed || r.type === MITTI_INVITE_EVENTS.done));
  return { type: mine[0].type, at: mine[0].at, mittiUserId: known?.mittiUserId ?? null, email: known?.email ?? mine[0].email };
}

/** Plain reason for an office item from a Mitti error (never a token or a provider body). */
export function plainMittiReason(e: unknown, what: string): string {
  const m = e instanceof Error ? e.message : String(e);
  return `${what}: ${m.replace(/Bearer\s+\S+/gi, "").slice(0, 200)}`;
}
