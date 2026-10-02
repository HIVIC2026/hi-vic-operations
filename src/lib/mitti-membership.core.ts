// PURE Mitti membership rules. No network, no database.
// Mitti can only hand a form to someone who is already a member of the Home Insulation
// Victoria Mitti organisation, so the portal records who was verified and when.
// Whether a person is "in Mitti" is derived here only – never stored as a free-text claim.

export type MittiMemberRow = {
  email?: string | null;
  mitti_user_id?: string | null;
  mitti_checked_email?: string | null;
  mitti_checked_at?: string | null;
};

export type MittiAccess = "member" | "not_found" | "unchecked" | "email_changed";

/** A person counts as in Mitti only when the last check found them AND the email still matches. */
export function mittiAccessOf(p: MittiMemberRow): MittiAccess {
  if (!p.mitti_checked_at) return "unchecked";
  if (!p.mitti_user_id) return "not_found";
  const checked = String(p.mitti_checked_email ?? "").trim().toLowerCase();
  const current = String(p.email ?? "").trim().toLowerCase();
  if (!checked || !current || checked !== current) return "email_changed";
  return "member";
}

export const MITTI_ACCESS_LABEL: Record<MittiAccess, string> = {
  member: "In Mitti",
  not_found: "Not in Mitti",
  unchecked: "Mitti not checked",
  email_changed: "Email changed since check",
};

/** The one instruction office is ever given when someone is missing: invite with that exact email. */
export function mittiInviteLine(email: string | null | undefined): string {
  const e = String(email ?? "").trim();
  return e
    ? `Invite ${e} to Mitti with that exact email, then press Check Mitti access.`
    : "This person has no email address on file – add it before checking Mitti access.";
}

/** Full blocker sentence used by the assignment guard. */
export function mittiAssignBlocker(role: string, name: string | null | undefined, email: string | null | undefined, access: MittiAccess): string {
  const who = name ? `${name} (${email ?? "no email"})` : `This ${role} (${email ?? "no email"})`;
  const fix = mittiInviteLine(email);
  if (access === "not_found") return `${who} is not in the Home Insulation Victoria Mitti organisation, so they cannot receive the ${role}'s Mitti forms. ${fix}`;
  if (access === "email_changed") return `The Mitti check for ${who} was run against a different email address, so it no longer proves access. ${fix}`;
  return `${who} has not been checked against the Home Insulation Victoria Mitti organisation yet. ${fix}`;
}

/** Office may still assign someone before their Mitti account exists – but only with a recorded reason. */
export function mittiOverrideAccepted(reason: string | null | undefined): boolean {
  return String(reason ?? "").trim().length >= 5;
}

export function mittiCheckedLabel(row: MittiMemberRow): string {
  if (!row.mitti_checked_at) return "never checked";
  const at = new Date(row.mitti_checked_at);
  if (Number.isNaN(at.getTime())) return "checked at an unreadable time";
  return `checked ${at.toISOString().slice(0, 10)}`;
}
