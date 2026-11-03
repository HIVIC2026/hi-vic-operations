// Jo 3 Nov 2026, 2:37pm: required details when a business adds a team member (replaces the 29 Oct "no email needed,
// mobile can come later" rule). Installers: Australian mobile + date of birth; email optional.
// Electricians: Australian mobile + date of birth + email. Pure; shared by the Team form, every server add path and the
// Team page "Add …" prompts for existing people.
import { crewMobileInput } from "./swms-sign-text.core";
import { dateOfBirthProblem } from "./worker-identity.core";

export type TeamKind = "installer" | "electrician";
export const TEAM_ERRORS = {
  mobile: "Add their Australian mobile, like 0412 345 678.",
  email: "Add their email address. Electricians need one.",
  badEmail: "That email doesn't look right. Check it and try again.",
} as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** First plain problem, or the cleaned values to save. */
export function teamMemberDetails(kind: TeamKind, p: { mobile: string | null | undefined; email: string | null | undefined; dateOfBirth: string | null | undefined }, today: string):
  { ok: true; mobile: string; email: string | null; dateOfBirth: string } | { ok: false; error: string } {
  const rawMobile = (p.mobile ?? "").trim();
  if (!rawMobile) return { ok: false, error: TEAM_ERRORS.mobile };
  const m = crewMobileInput(rawMobile);
  if (!m.ok || !m.mobile) return { ok: false, error: m.ok ? TEAM_ERRORS.mobile : m.error };
  const dob = dateOfBirthProblem(p.dateOfBirth, today);
  if (dob) return { ok: false, error: dob };
  const email = (p.email ?? "").trim().toLowerCase() || null;
  if (kind === "electrician" && !email) return { ok: false, error: TEAM_ERRORS.email };
  if (email && !EMAIL.test(email)) return { ok: false, error: TEAM_ERRORS.badEmail };
  return { ok: true, mobile: m.mobile, email, dateOfBirth: p.dateOfBirth! };
}

/** Which required details an existing person is missing (owner rows excluded by the caller). */
export function teamMissingDetails(kind: TeamKind, w: { mobile: string | null; email: string | null; hasDateOfBirth: boolean }): string[] {
  const out: string[] = [];
  if (!(w.mobile ?? "").trim()) out.push("mobile");
  if (!w.hasDateOfBirth) out.push("date of birth");
  if (kind === "electrician" && !(w.email ?? "").trim()) out.push("email");
  return out;
}

/** "Add Wayne's mobile" / "Add Liam's mobile and date of birth" / "Add Jo's mobile, date of birth and email". */
export function teamMissingPrompt(name: string, missing: string[]): string | null {
  if (!missing.length) return null;
  const first = name.trim().split(/\s+/)[0] || "their";
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`;
  return `Add ${first}'s ${list}`;
}

/** The boss fills a missing private date of birth or email for either trade. Installer email stays optional.
 *  Never overwrites a saved value. */
export function teamFillMissing(_kind: TeamKind, current: { hasDateOfBirth: boolean; email: string | null },
  p: { dateOfBirth?: string | null; email?: string | null }, today: string):
  { ok: true; dateOfBirth: string | null; email: string | null } | { ok: false; error: string } {
  const dobIn = (p.dateOfBirth ?? "").trim() || null;
  const emailIn = (p.email ?? "").trim().toLowerCase() || null;
  if (!dobIn && !emailIn) return { ok: false, error: "Add the missing detail first." };
  if (dobIn) {
    if (current.hasDateOfBirth) return { ok: false, error: "Their date of birth is already saved." };
    const bad = dateOfBirthProblem(dobIn, today);
    if (bad) return { ok: false, error: bad };
  }
  if (emailIn) {
    if ((current.email ?? "").trim()) return { ok: false, error: "Their email is already saved." };
    if (!EMAIL.test(emailIn)) return { ok: false, error: TEAM_ERRORS.badEmail };
  }
  return { ok: true, dateOfBirth: dobIn, email: emailIn };
}

/** Jo 3 Nov ~3pm: the worker's own sign-up link asks their date of birth (required), worded to them. */
export function joinDateOfBirthProblem(value: string | null | undefined, today: string): string | null {
  const v = (value ?? "").trim();
  if (!v) return "Add your date of birth.";
  const bad = dateOfBirthProblem(v, today);
  if (!bad) return null;
  return bad === "Date of birth must be before today." ? "Your date of birth must be before today." : bad;
}
