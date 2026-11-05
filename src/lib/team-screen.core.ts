// Team (installer screens Task 10; approved mock-up team-phone.png, Jo 2 Nov 2026): one line per person from recorded
// facts, the Add a person roles and checks, and the boss-only "Can see Money" words. Pure: no database, no network.
// Privacy (AGENTS.md): a date of birth never reaches this screen — only whether one is on file (hasDob).
import { crewClearance } from "./worker-compliance.core";
import { tradeRoleOf, seesMoney } from "./trade-access-role.core";
import { dateOfBirthProblem } from "./worker-identity.core";
import type { TeamMemberView } from "./trade-view.core";

// Wording. Lines from the plan's Global Constraints are approved; every DRAFT line is listed for Jo (Task 12 paste).
export const TEAM_INTRO = "Lead Installers and Crew: mobile, date of birth, CII/EEC certificate. Office: mobile and email. Electricians: mobile, email, licence and REC.";
export const TEAM_WORDS = {
  title: "Team", // approved
  intro: TEAM_INTRO, // approved
  addPerson: "Add a person", // approved
  canSeeMoney: "Can see Money", // approved (plan Global Constraints: the boss turned "Can see Money" on)
  canSeeMoneyNote: "Office people always see and enter prices. Money shows them what's coming to you and what's been paid.", // DRAFT
  moneyNeedsLogin: "This person doesn't have a portal login yet. Ask the office to send one first.", // DRAFT
  dobOnFile: "Date of birth on file ✓", // DRAFT
  dobSaved: "Date of birth on file ✓", // DRAFT (after the boss saves one — the date itself is never shown back)
  addDob: "Add date of birth", // DRAFT (Task 10b: boss-only action for an existing person)
  dobNote: "Kept privately for ESC registration. It isn't shown on any screen once saved.", // DRAFT
  dobMissing: "Date of birth missing — the office needs it for ESC registration", // DRAFT
  escRegistered: "ESC registered ✓", // approved (team-phone.png)
  escPending: "ESC registration pending", // DRAFT
  needsCii: "needs CII certificate", // approved (team-phone.png)
  needsLicenceRec: "needs licence + REC check", // DRAFT
  needsDob: "needs date of birth", // DRAFT
  needsMobile: "needs mobile", // DRAFT
  roleHelp: {
    office: "Works the portal for you: sees and enters prices.",
    lead: "Runs install days and fills in the Mitti forms. Gets a Mitti login.",
    crew: "Works with a Lead on install days. Can also do Ready Checks.",
    electrician: "Does the safety check (PIESA) on your jobs.",
  },
  dob: "Date of birth", // DRAFT (field label)
  mobile: "Mobile", // DRAFT (field label)
  email: "Email (optional)", // existing (TEAM_ADD_SHEET.email)
  /** Go-live 5 Nov 2026: electricians need their Mitti email at Add. */
  emailElectrician: "Email (the one they use for Mitti)",
  rec: "REC number", // DRAFT (field label)
  closeSheet: "Close", // DRAFT
} as const;

// ---- Roles for Add a person --------------------------------------------------------------------------------------------
export type AddPersonRole = "office" | "lead" | "crew" | "electrician";
export const ADD_PERSON_ROLES: readonly AddPersonRole[] = ["office", "lead", "crew", "electrician"];
export const ADD_PERSON_ROLE_LABEL: Record<AddPersonRole, string> = { office: "Office", lead: "Lead Installer", crew: "Crew", electrician: "Electrician" }; // approved (team-phone.png / decisions)

export type AddPersonInput = { name: string; role: AddPersonRole; mobile: string | null; dateOfBirth: string | null; licenceNumber: string | null; recNumber: string | null; email?: string | null; certificateNumber?: string | null; certificatePath?: string | null; hasDob?: boolean; requireCertificate?: boolean };
/** Everything missing before a person can be added, in field order. Mobile and date of birth for every role (approved
 *  rule); licence + REC for electricians. Empty = fine. Mobile format is checked by the server (crewMobileInput). */
export const ELECTRICIAN_EMAIL_NEEDED = "Add their email — the safety check form goes to them in Mitti.";
export function addPersonProblems(p: AddPersonInput, today: string): string[] {
  const out: string[] = [];
  if ((p.name ?? "").trim().length < 2) out.push("Add their full name."); // existing (trade-view.server)
  if (!(p.mobile ?? "").trim()) out.push("Add their mobile number."); // existing (trade-view.server)
  const dob = (p.role === "lead" || p.role === "crew") && !p.hasDob ? dateOfBirthProblem(p.dateOfBirth, today) : null;
  if (dob) out.push(dob); // existing (worker-identity.core)
  if (p.role === "office" && !(p.email ?? "").trim()) out.push("Add their email address.");
  if (p.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) out.push("Check their email address.");
  if (p.requireCertificate && (p.role === "lead" || p.role === "crew")) {
    if (!p.certificateNumber?.trim()) out.push("Add their CII/EEC certificate number.");
    if (!p.certificatePath?.trim()) out.push("Upload a photo of their CII/EEC certificate.");
  }
  if (p.role === "electrician") {
    if (!(p.licenceNumber ?? "").trim()) out.push("Add their electrical licence number."); // existing (trade-view.server)
    if (!(p.recNumber ?? "").trim()) out.push("Add their REC number."); // DRAFT
    // Go-live 5 Nov 2026 (James Spark): the safety check form is handed to the electrician in Mitti by email, so picking an
    // electrician without one fails "Electrician needs a Mitti email" — ask for it at Add, not after.
    if (p.email !== undefined && !(p.email ?? "").trim()) out.push(ELECTRICIAN_EMAIL_NEEDED);
  }
  return out;
}

// ---- The row line ------------------------------------------------------------------------------------------------------
export type TeamRowFacts = Pick<TeamMemberView, "name" | "role" | "workerRole" | "mobile" | "cii"> & {
  /** Office stamp (partner_workers.esc_registered); Lead Installers only. */
  escRegistered: boolean;
  /** electricianVerified(...).ok — licence number, REC, unexpired, office-verified. */
  licenceAndRec: boolean;
  /** Office people only: the boss turned "Can see Money" on (business_members.can_see_money). */
  canSeeMoney: boolean;
  /** true/false = a private date of birth is / isn't on file; null = unknown (no staff row, or the table couldn't be read). */
  hasDob: boolean | null;
};
export type TeamRow = { name: string; line: string; warn: boolean };

export const moneySwitchLine = (on: boolean) => `Money: ${on ? "On" : "Off"}`; // approved (team-phone.png)

/** Role word + checks, missing items last and orange, chevron at the end (team-phone.png). */
export function teamRow(m: TeamRowFacts, today: string): TeamRow {
  const parts: string[] = [];
  let warn = false;
  if (m.role === "owner") parts.push("Boss");
  else if (m.role === "office") {
    // Office always sees prices; Money only with the boss's switch (trade-access-role.core, one rule).
    const r = tradeRoleOf({ memberRole: "office", workerTradeRole: "office" });
    parts.push("Office", "prices ✓", moneySwitchLine(seesMoney(r, m.canSeeMoney)));
  } else if (m.role === "installer") {
    const lead = m.workerRole !== "crew"; // worker-role rule: null = Lead
    parts.push(lead ? "Lead Installer" : "Crew");
    const cleared = !!m.cii && crewClearance(m.cii, today).cleared;
    if (cleared) parts.push("CII ✓");
    else { parts.push(TEAM_WORDS.needsCii); warn = true; }
    if (lead) parts.push(m.escRegistered ? TEAM_WORDS.escRegistered : TEAM_WORDS.escPending);
  } else {
    parts.push("Electrician");
    if (m.licenceAndRec) parts.push("licence + REC ✓");
    else { parts.push(TEAM_WORDS.needsLicenceRec); warn = true; }
  }
  if (m.role === "installer" && m.hasDob === false) { parts.push(TEAM_WORDS.needsDob); warn = true; }
  if (!(m.mobile ?? "").trim()) { parts.push(TEAM_WORDS.needsMobile); warn = true; }
  return { name: m.name, line: `${parts.join(" · ")} ›`, warn };
}
