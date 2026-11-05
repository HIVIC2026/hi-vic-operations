import { melbourneToday } from "./melbourne-time.core";
// Partners › People: "Approved" is worked out from three facts and is DISPLAY ONLY (Jo 5 Nov 2026).
// It never gates a job or booking; those rules stay in worker-compliance.core / crewClearance.
export type ApprovalFacts = { ciiVerified: boolean; noticeSigned: boolean; dateOfBirth: string | null | undefined };
export type Approval = { approved: boolean; label: "Approved" | "Not approved yet"; missing: string[]; missingLine: string | null };

export function personApproval(f: ApprovalFacts): Approval {
  const missing: string[] = [];
  if (!f.ciiVerified) missing.push("CII");
  if (!f.noticeSigned) missing.push("ESC notice");
  if (!f.dateOfBirth) missing.push("date of birth");
  return missing.length
    ? { approved: false, label: "Not approved yet", missing, missingLine: `Missing: ${missing.join(", ")}` }
    : { approved: true, label: "Approved", missing, missingLine: null };
}

const fmtYmd = (ymd: string, withYear: boolean) =>
  new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).replace(",", "");

export const dobLabel = (dob: string | null | undefined) => (dob ? fmtYmd(dob, true) : "Not recorded");

/** Registration stamp is an ISO instant or a date; show the day only ("ESC registered · 5 Nov"). */
export const escRegisteredLabel = (at: string | null | undefined) => (at ? `ESC registered · ${fmtYmd(at.includes("T") ? melbourneToday(new Date(at)) : at, false)}` : "ESC registered");

/** People list sections, always in this order. An installer is a Lead Installer only when their role is lead; anyone else who installs is Crew. */
export function groupPeople<T extends { role: string; workerRole?: "lead" | "crew" | null }>(people: readonly T[]) {
  const lead = people.filter((p) => p.role === "installer" && p.workerRole === "lead");
  const crew = people.filter((p) => p.role === "installer" && p.workerRole !== "lead");
  const electricians = people.filter((p) => p.role === "electrician");
  return [
    { key: "lead" as const, title: "Lead Installers", people: lead },
    { key: "crew" as const, title: "Crew", people: crew },
    { key: "electricians" as const, title: "Electricians", people: electricians },
  ];
}
