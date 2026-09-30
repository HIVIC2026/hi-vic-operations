// Preferred-electrician team-ups. Pure rules only (persistence in teaming.functions.ts).
// A team-up is live only when: installer nominated + electrician accepted + Home Insulation Victoria approved BOTH businesses.
export const INVITE_DAYS = 14;

export type PreferredElectrician = { name?: string; email?: string; mobile?: string; business_name?: string; licence_number?: string; rec_number?: string; is_primary?: boolean };
export type ElectricianChoice = "have" | "match" | "later";

const txt = (s?: string) => (s ?? "").trim().length > 0;
const email = (s?: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((s ?? "").trim());
const mobile = (s?: string) => /^(\+?61|0)4\d{8}$/.test((s ?? "").replace(/[\s()-]/g, ""));

/** Errors for the installer onboarding "Your electrician" step. */
export function electricianStepErrors(d: { electrician_choice?: ElectricianChoice | null; preferred_electricians?: PreferredElectrician[]; electrician_contact_consent?: boolean }): string[] {
  const e: string[] = [];
  if (!d.electrician_choice) { e.push("Tell us whether you have a preferred electrician."); return e; }
  if (d.electrician_choice !== "have") return e;
  const list = d.preferred_electricians ?? [];
  if (list.length === 0) e.push("Add at least one electrician, or choose another option.");
  const seen = new Set<string>();
  list.forEach((p, i) => {
    const n = `Electrician ${i + 1}`;
    if (!txt(p.name)) e.push(`${n}: enter their name.`);
    if (!email(p.email)) e.push(`${n}: enter a valid email.`);
    else { const k = p.email!.trim().toLowerCase(); if (seen.has(k)) e.push(`${n}: this email is already listed.`); seen.add(k); }
    if (!mobile(p.mobile)) e.push(`${n}: enter a valid Australian mobile.`);
  });
  if (list.length > 0 && list.filter((p) => p.is_primary).length !== 1) e.push("Choose one electrician as your Main electrician.");
  if (list.length > 0 && d.electrician_contact_consent !== true) e.push("Confirm your electrician(s) have agreed to be contacted by Home Insulation Victoria.");
  return e;
}

export type NominationRow = {
  status: string; invite_expires_at?: string | null; invite_sent_at?: string | null; invite_link_issued_at?: string | null; opened_at?: string | null;
  accepted_at?: string | null; declined_at?: string | null; teamed_at?: string | null; ended_at?: string | null; electrician_application_id?: string | null;
};
export type TeamStatus = "invite_drafted" | "sent" | "opened" | "signed_up" | "awaiting_approval" | "teamed" | "declined" | "expired" | "ended";
export const TEAM_STATUS_LABEL: Record<TeamStatus, string> = {
  invite_drafted: "Invite drafted", sent: "Sent", opened: "Opened", signed_up: "Signed up – finishing onboarding", awaiting_approval: "Awaiting Home Insulation Victoria approval",
  teamed: "Teamed up", declined: "Declined", expired: "Invite expired", ended: "Team-up ended",
};

/** One status per nomination. electricianSubmitted = their onboarding application has been signed. */
export function teamStatus(n: NominationRow, electricianSubmitted = false, now = new Date()): TeamStatus {
  if (n.ended_at) return "ended";
  if (n.teamed_at) return "teamed";
  if (n.declined_at) return "declined";
  if (n.accepted_at) return electricianSubmitted ? "awaiting_approval" : "signed_up";
  if (n.invite_expires_at && Date.parse(n.invite_expires_at) < now.getTime()) return "expired";
  if (n.opened_at) return "opened";
  if (n.invite_sent_at) return "sent";
  return "invite_drafted";
}

/** Invite link state: usable only while not expired and not already answered. */
export function inviteUsable(n: NominationRow, now = new Date()): { ok: boolean; reason?: string } {
  if (n.ended_at) return { ok: false, reason: "This team-up has ended." };
  if (n.declined_at) return { ok: false, reason: "This invitation was declined." };
  if (n.invite_expires_at && Date.parse(n.invite_expires_at) < now.getTime() && !n.accepted_at) return { ok: false, reason: "This invitation has expired. Ask the installer or Home Insulation Victoria to send a new one." };
  return { ok: true };
}

export type TeamRel = { electrician_business_id: string; is_primary: boolean; preferred: boolean; active: boolean };
export type RankedElec = { id: string; eligible: boolean; inArea: boolean };
/**
 * Which electrician a new installer-sourced job goes to: Main if approved + in area, else a backup that is,
 * else null (Home Insulation Victoria matching). Never returns an ineligible or out-of-area electrician.
 */
export function pickTeamElectrician(rels: TeamRel[], ranked: RankedElec[]): { id: string; via: "primary" | "backup" } | null {
  const ok = (id: string) => ranked.find((r) => r.id === id && r.eligible && r.inArea);
  const live = rels.filter((r) => r.active && r.preferred);
  const main = live.find((r) => r.is_primary);
  if (main && ok(main.electrician_business_id)) return { id: main.electrician_business_id, via: "primary" };
  for (const r of ranked) if (r.eligible && r.inArea && live.some((l) => !l.is_primary && l.electrician_business_id === r.id)) return { id: r.id, via: "backup" };
  return null;
}

/** Plain-English status line for the installer's dashboard. */
export function installerTeamLine(name: string, s: TeamStatus): string {
  const first = name.trim().split(/\s+/)[0] || "your electrician";
  switch (s) {
    case "teamed": return `Teamed up with ${name}`;
    case "awaiting_approval": return `${first} has signed up – Home Insulation Victoria is checking their details`;
    case "signed_up": return `${first} accepted – finishing their onboarding`;
    case "opened": return `${first} has opened the invite`;
    case "sent": return `Waiting for ${first} to sign up`;
    case "invite_drafted": return `Invite to ${first} being prepared by Home Insulation Victoria`;
    case "declined": return `${first} declined – add another electrician or let Home Insulation Victoria match you`;
    case "expired": return `Invite to ${first} expired – Home Insulation Victoria will send a new one`;
    case "ended": return `Team-up with ${name} ended`;
  }
}
