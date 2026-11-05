import { melbourneToday } from "./melbourne-time.core";
import { effectiveWorkerRole } from "./worker-role.core";
// Partners › People: "Approved" is worked out from three facts and is DISPLAY ONLY (Jo 5 Nov 2026).
// It never gates a job or booking; those rules stay in worker-compliance.core / crewClearance.
export type ApprovalFacts = { ciiVerified: boolean; noticeSigned: boolean; workerRole?: "lead"|"crew"|null|undefined; dateOfBirth: string | null | undefined };
export type Approval = { approved: boolean; label: "Approved" | "Not approved yet"; missing: string[]; missingLine: string | null };

export function personApproval(f: ApprovalFacts): Approval {
  const missing: string[] = [];
  if (!f.ciiVerified) missing.push("CII");
  if (!f.noticeSigned) missing.push("ESC notice");
  if (f.workerRole !== "crew" && !f.dateOfBirth) missing.push("date of birth");
  return missing.length
    ? { approved: false, label: "Not approved yet", missing, missingLine: `Missing: ${missing.join(", ")}` }
    : { approved: true, label: "Approved", missing, missingLine: null };
}

const fmtYmd = (ymd: string, withYear: boolean) =>
  new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).replace(",", "");

export const dobLabel = (dob: string | null | undefined) => (dob ? fmtYmd(dob, true) : "Not recorded");

/** Registration stamp is an ISO instant or a date; show the day only ("ESC registered · 5 Nov"). */
export const escRegisteredLabel = (at: string | null | undefined) => (at ? `ESC registered · ${fmtYmd(at.includes("T") ? melbourneToday(new Date(at)) : at, false)}` : "ESC registered");

/**
 * People list sections, always in this order. Same rule as everywhere else (worker-role.core): an installer with no role set
 * is Crew (Jo 5 Nov 2026); only a stored "lead" is a Lead Installer.
 */
export function groupPeople<T extends { role: string; workerRole?: "lead" | "crew" | null }>(people: readonly T[]) {
  const isLead = (p: T) => effectiveWorkerRole({ tradeRole: p.role, stored: p.workerRole }) === "lead";
  const isCrew = (p: T) => effectiveWorkerRole({ tradeRole: p.role, stored: p.workerRole }) === "crew";
  return [
    { key: "lead" as const, title: "Lead Installers", people: people.filter(isLead) },
    { key: "crew" as const, title: "Crew", people: people.filter(isCrew) },
    { key: "electricians" as const, title: "Electricians", people: people.filter((p) => p.role === "electrician") },
  ];
}

/**
 * Date sent when the office switches ESC registered on. The database function refuses any date after its own `current_date`,
 * which is the UTC date. Every Melbourne morning (until about 10-11am) the Melbourne date is already one day ahead of UTC and
 * would be refused, so we send the earlier of the two: in that window it records yesterday's date, never an error.
 */
export function escRegistrationDate(now: Date = new Date()): string {
  const utc = now.toISOString().slice(0, 10);
  const mel = melbourneToday(now);
  return mel < utc ? mel : utc;
}

/** What the ESC registered switch sends: switching on records the safe date, switching off clears it. */
export function escSwitchPayload(currentlyRegistered: boolean, now: Date = new Date()): { registered: boolean; date: string | null } {
  return currentlyRegistered ? { registered: false, date: null } : { registered: true, date: escRegistrationDate(now) };
}
