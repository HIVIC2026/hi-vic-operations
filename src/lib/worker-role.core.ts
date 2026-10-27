// Decision 411 (Jo 27 Oct 2026): installer workers are a Lead installer or Crew. PURE: no I/O.
//  - Every installer worker (lead OR crew) gives their CII number, expiry and certificate file; office approval unchanged.
//  - Only Lead installers go into Mitti (auto-invite) and only leads can be picked for an install day ("Who's doing this").
//  - Crew are picked on the install crew list. Lead + crew each get the 6:30am install-day text on their own mobile.
//  - Existing installer workers without a role show "Role needed" until their business sets one.
import { melbourneYmd } from "./melbourne-time.core";

export type WorkerRole = "lead" | "crew";
export const WORKER_ROLES: readonly WorkerRole[] = ["lead", "crew"] as const;
export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = { lead: "Lead installer", crew: "Crew" };
export const ROLE_NEEDED_LABEL = "Role needed";

export const asWorkerRole = (v: unknown): WorkerRole | null => (v === "lead" || v === "crew" ? v : null);

/** Team list label for an installer worker (electricians have no lead/crew role). */
export function workerRoleLabel(tradeRole: string, role: unknown): string | null {
  if (tradeRole !== "installer") return null;
  const r = asWorkerRole(role);
  return r ? WORKER_ROLE_LABEL[r] : ROLE_NEEDED_LABEL;
}

export const LEAD_ONLY_REASON = "Only Lead installers can be given an install day. Set their role on My business → Team.";
export const ROLE_NEEDED_REASON = "Role needed: set Lead installer or Crew on My business → Team.";

/** Install day picker: null = role allows it. */
export function installDayRoleBlocker(role: unknown): string | null {
  const r = asWorkerRole(role);
  if (r === "lead") return null;
  return r === "crew" ? LEAD_ONLY_REASON : ROLE_NEEDED_REASON;
}

/** Mitti auto-invite: Lead installers only (Jo 27 Oct). null = may be invited. */
export function mittiRoleSkip(tradeRole: string, role: unknown): string | null {
  if (tradeRole !== "installer") return "Mitti auto-invite is for Lead installers only.";
  const r = asWorkerRole(role);
  if (r === "lead") return null;
  return r === "crew" ? "Crew are not added to Mitti." : "Role needed before a Mitti invite (Lead installers only).";
}

/** CII details every installer worker must give (lead and crew). */
export function ciiDetailsErrors(d: { certificate_number?: string | null; certificate_expires_on?: string | null }, today: string): string[] {
  const e: string[] = [];
  if (!(d.certificate_number ?? "").trim()) e.push("Enter the CII certificate number.");
  const exp = (d.certificate_expires_on ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) e.push("Enter the CII certificate expiry date.");
  else if (exp < today) e.push("That CII certificate has expired.");
  return e;
}

// ---- Install-day text (wording approved by Jo 27 Oct 2026; the sender adds "Home Insulation Victoria: ") ----
export const INSTALL_DAY_CREW_SMS_TYPE = "install_day_crew" as const;
export const INSTALL_DAY_CREW_EVENT = "install_day_crew_texted" as const;

const firstName = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "there";
export function melbourneTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
}

export function installDayCrewText(f: { name: string | null; startIso: string; address: string | null; leadName: string | null; link: string }): string {
  return `Good morning ${firstName(f.name)}! Today's install: ${melbourneTime(f.startIso)}, ${f.address?.trim() || "see your job link"}. Lead: ${firstName(f.leadName)}. Safety docs (SWMS, PIESA, hazards): ${f.link}`;
}

/** One text per person per install date (never sent twice). */
export const installDayCrewKey = (jobId: string, workerId: string, startIso: string) => `install-day-crew:v1:${jobId}:${workerId}:${melbourneYmd(new Date(startIso))}`;

export type CrewPerson = { workerId: string; name: string; mobile: string | null; role: "lead" | "crew" };

/** Who gets the install-day text: the chosen lead + each chosen crew member with a worker record, once each. */
export function installDayRecipients(lead: CrewPerson | null, crew: CrewPerson[]): CrewPerson[] {
  const out: CrewPerson[] = [];
  const seen = new Set<string>();
  for (const p of [lead, ...crew]) {
    if (!p || seen.has(p.workerId)) continue;
    seen.add(p.workerId);
    out.push(p);
  }
  return out;
}

/** Due from the daily text time (default 6:30am) on the install's Melbourne date, until 8pm. */
export function installDayTextDue(startIso: string, nowIso: string, sendTime = "06:30"): boolean {
  const day = melbourneYmd(new Date(startIso));
  if (melbourneYmd(new Date(nowIso)) !== day) return false;
  const hm = new Date(nowIso).toLocaleTimeString("en-GB", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false });
  return hm >= sendTime && hm < "20:00";
}
