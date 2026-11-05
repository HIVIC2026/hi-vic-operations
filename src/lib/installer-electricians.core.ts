// Jo 5 Nov 2026 (approved): ONE "Electricians" list per installer business. It holds the electrician businesses linked
// to the installer (partner_relationships, active) and the electricians on the installer's own Team, with ONE Main.
// Main = the default electrician everywhere (installer-electricians.server `readMainElectrician` is the one server read;
// `electriciansForInstaller` is the one list). PURE: no reads, no writes, no sends.
import { electricianVerified, type ElectricianVerification } from "./worker-compliance.core";
import type { UsualElectrician } from "./usual-electrician.core";

/** Append-only admin_config_events row that says which electrician is Main (latest wins → exactly one Main). */
export const MAIN_ELECTRICIAN_EVENT = "installer_main_electrician_set";
export const ELECTRICIAN_LINK_ADDED_EVENT = "installer_electrician_linked";
export const ELECTRICIAN_LINK_REMOVED_EVENT = "installer_electrician_unlinked";

export const ELECTRICIANS_WORDS = {
  title: "Electricians", // approved (Jo 5 Nov 2026)
  add: "Add electrician", // approved
  addPick: "Choose an approved electrician", // DRAFT
  remove: "Remove", // approved
  main: "Main", // approved
  approved: "Approved", // approved
  pending: "Pending", // approved
  none: "No electricians yet. Add one here.", // DRAFT
} as const;

export type LinkedElectricianBusiness = {
  businessId: string; name: string;
  /** Approved, active business with at least one approved electrician. */
  approved: boolean;
  /** Legacy Main marker (team-up sets it). */
  isPrimary: boolean;
  /** Licence numbers of the business's approved electricians (oldest first). */
  licences: (string | null)[];
  recNumber?: string | null;
};
export type TeamElectricianRow = {
  workerId: string; name: string; licence: string | null;
  /** Verified + office-approved (the list's Approved / Pending). */
  approved: boolean;
  /** May be put on a job now: approved AND has an email (main's no-email rule). */
  allowed: boolean; reason: string | null;
  email?: string | null; phone?: string | null;
};
export type MainChoice = { electricianBusinessId?: string | null; workerId?: string | null; eventId?: string | null };

export type InstallerElectrician = {
  key: string; kind: "business" | "team";
  businessId: string | null; workerId: string | null;
  name: string; licence: string | null;
  status: "approved" | "pending";
  main: boolean;
  /** Team rows: may be put on a job now; business rows: approved. */
  allowed: boolean; reason: string | null;
  email?: string | null; phone?: string | null;
};

/** Licence numbers compare without case, spaces or dashes ("a63-151" = "A63151"). Empty never matches. */
export const normLicence = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const sameLicence = (a: string | null | undefined, b: string | null | undefined) => !!normLicence(a) && normLicence(a) === normLicence(b);

export const businessKey = (id: string) => `business:${id}`;
export const teamKey = (id: string) => `team:${id}`;

type TeamWorkerFacts = ElectricianVerification & { id: string; full_legal_name: string; approval_status: string | null; email?: string | null; mobile?: string | null };
/** One Team electrician row. The same rule every Team picker uses (verified + office-approved + an email). */
export function teamElectricianRow(w: TeamWorkerFacts): TeamElectricianRow {
  const v = electricianVerified(w);
  const approved = v.ok && w.approval_status === "approved";
  const reason = v.reason ?? (w.approval_status !== "approved" ? "Waiting for office approval" : !w.email?.trim() ? "add their email on the Team page first" : null);
  return { workerId: w.id, name: w.full_legal_name, licence: w.licence_number?.trim() || null, approved, allowed: v.ok && !reason, reason, email: w.email?.trim() || null, phone: w.mobile?.trim() || null };
}

/** Which entry is Main. A saved Main choice decides (none if it no longer points at a listed electrician). Never ticked:
 *  the saved usual electrician with the same licence (Reinsulate: "Peter orlando" A63151 = ORLANDO POWERED); with no
 *  usual electrician saved, the legacy Main marker on a link (team-up). */
export function mainKeyFor(i: { linked: LinkedElectricianBusiness[]; team: TeamElectricianRow[]; mainChoice: MainChoice | null; usual: { licence: string | null } | null }): string | null {
  const keys = new Set([...i.linked.map((l) => businessKey(l.businessId)), ...i.team.map((t) => teamKey(t.workerId))]);
  if (i.mainChoice) {
    const k = i.mainChoice.workerId ? teamKey(i.mainChoice.workerId) : i.mainChoice.electricianBusinessId ? businessKey(i.mainChoice.electricianBusinessId) : null;
    return k && keys.has(k) ? k : null;
  }
  const licence = i.usual?.licence ?? null;
  if (normLicence(licence)) {
    const biz = i.linked.find((l) => sameLicence(l.recNumber, licence) || l.licences.some((x) => sameLicence(x, licence)));
    if (biz) return businessKey(biz.businessId);
    const worker = i.team.find((t) => sameLicence(t.licence, licence));
    return worker ? teamKey(worker.workerId) : null;
  }
  const primary = i.linked.find((l) => l.isPrimary);
  return primary ? businessKey(primary.businessId) : null;
}

/** The one list: Main first, then approved, then by name. Exactly one entry (or none) has `main`. */
export function buildInstallerElectricians(i: { linked: LinkedElectricianBusiness[]; team: TeamElectricianRow[]; mainChoice: MainChoice | null; usual: { licence: string | null } | null }): InstallerElectrician[] {
  const main = mainKeyFor(i);
  const rows: InstallerElectrician[] = [
    ...i.linked.map((l) => ({ key: businessKey(l.businessId), kind: "business" as const, businessId: l.businessId, workerId: null, name: l.name, licence: l.licences.find((x) => normLicence(x)) ?? l.recNumber ?? null,
      status: l.approved ? "approved" as const : "pending" as const, main: false, allowed: l.approved, reason: l.approved ? null : "Waiting for office approval", email: null, phone: null })),
    ...i.team.map((t) => ({ key: teamKey(t.workerId), kind: "team" as const, businessId: null, workerId: t.workerId, name: t.name, licence: t.licence,
      status: t.approved ? "approved" as const : "pending" as const, main: false, allowed: t.allowed, reason: t.reason, email: t.email ?? null, phone: t.phone ?? null })),
  ];
  for (const r of rows) r.main = r.key === main;
  return rows.sort((a, b) => Number(b.main) - Number(a.main) || Number(b.status === "approved") - Number(a.status === "approved") || a.name.localeCompare(b.name));
}

/** The Main entry in the shape every old "usual electrician" reader takes (name + licence, email/phone when known). */
export function mainAsUsual(e: InstallerElectrician | null | undefined): UsualElectrician | null {
  if (!e) return null;
  const name = e.name.trim(), licence = (e.licence ?? "").trim();
  if (!name || !licence) return null;
  return { name, licence, ...(e.email ? { email: e.email } : {}), ...(e.phone ? { phone: e.phone } : {}) };
}

/** The old "preferred" links on the ranking paths (teaming, allocation): once a Main is ticked, only a Main electrician
 *  business is preferred (a Team Main = none); never ticked = the old flags, unchanged. */
export function preferredWithMain<T extends { electrician_business_id: string; preferred?: boolean | null; is_primary?: boolean | null }>(rels: T[], main: { ticked: boolean; electricianBusinessId: string | null }): T[] {
  if (!main.ticked) return rels;
  return rels.map((r) => ({ ...r, preferred: r.electrician_business_id === main.electricianBusinessId, is_primary: r.electrician_business_id === main.electricianBusinessId }));
}

export type PickerEntry = { id: string; allowed: boolean; main?: boolean };
/** The default pick on a new job: the Main electrician when it can be picked here, else nothing. */
export function defaultPick(entries: PickerEntry[]): string | null {
  const m = entries.find((e) => e.main && e.allowed);
  return m ? m.id : null;
}

/** Quote hold (decision 303 / Jo 5 Nov 2026): the saved usual electrician is the same person when the LICENCE matches
 *  (case, spaces and dashes ignored). Names differ in practice ("ORLANDO POWERED" business vs "Peter orlando" person). */
export const USUAL_CHANGED_REASON = "Usual electrician profile changed or is missing — sync the Ready Check and prepare a new quote";
export function usualElectricianChangedBlocker(usual: { licence: string | null } | null | undefined, saved: { licence: string | null } | null | undefined): string | null {
  return usual && saved && sameLicence(usual.licence, saved.licence) ? null : USUAL_CHANGED_REASON;
}

export type ChangeResult = { ok: true; warnings?: string[] } | { ok: false; blockers: string[] };
export const CHANGE_PIESA_DONE = "The safety check is done, so the electrician can't change";
/** Shown with the success when the person saved but the Mitti hand-over didn't (DRAFT wording). */
export const HANDOVER_FAILED_WARNING = "Saved. The safety check form wasn't moved to them in Mitti yet — the office has been told.";

/**
 * Change the electrician on a job (Jo 5 Nov 2026): allowed until the safety check (PIESA) is done. The person and any time
 * are saved together by `save` (one write); ONLY after it saved does `after` run (the electrician's job-link text, the
 * Mitti PIESA form). A failed save leaves the old electrician and sends nothing. A failed `after` is never silent: it is
 * handed to `afterFailed` (the office's Needs me record) and the success carries a plain warning.
 */
export async function changeElectricianSaveFirst(d: { piesaDone: () => Promise<boolean>; save: () => Promise<ChangeResult>; after: () => Promise<void>; afterFailed: (message: string) => Promise<void> }): Promise<ChangeResult> {
  if (await d.piesaDone()) return { ok: false, blockers: [CHANGE_PIESA_DONE] };
  let r: ChangeResult;
  try { r = await d.save(); } catch (e) { return { ok: false, blockers: [e instanceof Error && e.message ? e.message : "Couldn't save. Please try again."] }; }
  if (!r.ok) return r;
  const warnings = [...(r.warnings ?? [])];
  try { await d.after(); } catch (e) {
    const message = e instanceof Error && e.message ? e.message : "Mitti hand-over failed";
    try { await d.afterFailed(message); } catch (le) { console.error("electrician change: failure not recorded", (le as Error).message); }
    warnings.push(HANDOVER_FAILED_WARNING);
  }
  return { ok: true, warnings };
}
