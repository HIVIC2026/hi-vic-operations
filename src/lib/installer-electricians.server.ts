// Jo 5 Nov 2026 (approved): the ONE server source for an installer business's electricians — the electrician businesses
// linked to it (partner_relationships, active) plus the electricians on its own Team — with one Main.
// `electriciansForInstaller` is the list; `readMainElectrician` is the ONE read of "this installer's Main electrician" that
// every server path uses where it used to read the old usual electrician. Rules live in installer-electricians.core.ts.
// Writes reuse existing tables: partner_relationships (link / unlink, the legacy is_primary marker kept in step) and
// append-only admin_config_events (Main choice + history). No sends here.
import { jobAdmin as admin } from "./job-facts.server"; // the admin client; inside the job page bundle it answers from the job's rows
import { WorkflowError } from "./workflow.server";
import {
  ELECTRICIAN_LINK_ADDED_EVENT, ELECTRICIAN_LINK_REMOVED_EVENT, MAIN_ELECTRICIAN_EVENT, buildInstallerElectricians, mainAsUsual, teamElectricianRow,
  type InstallerElectrician, type LinkedElectricianBusiness, type MainChoice, type TeamElectricianRow,
} from "./installer-electricians.core";
import type { UsualElectrician } from "./usual-electrician.core";

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new WorkflowError(`${what}: ${error.message}`);
  return data;
}

type TeamWorker = { id: string; full_legal_name: string; email: string | null; mobile: string | null; licence_number: string | null; rec_number: string | null; licence_expires_on: string | null; licence_verified_at: string | null; approval_status: string | null };

/** The installer's own Team electricians, with the same allowed/reason rule the Team pickers use (teamElectricianRow). */
async function teamRows(businessId: string): Promise<TeamElectricianRow[]> {
  const workers: TeamWorker[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = ((await must(admin.from("partner_workers").select("id,full_legal_name,email,mobile,licence_number,rec_number,licence_expires_on,licence_verified_at,approval_status")
      .eq("business_id", businessId).eq("trade_role", "electrician").is("removed_at", null).order("id").range(offset, offset + 199), "Couldn't read your Team electricians")) ?? []) as TeamWorker[];
    workers.push(...page);
    if (page.length < 200) break;
  }
  return workers.map(teamElectricianRow);
}

type LinkRow = { installer_business_id: string; electrician_business_id: string; is_primary: boolean | null };
type BizRow = { id: string; name: string | null; trading_name: string | null; rec_number: string | null; onboarding_status: string | null; is_active: boolean | null };
type WorkerLicence = { business_id: string; licence_number: string | null; created_at?: string | null };

/** The electrician businesses linked to these installers (active links), each with approval and approved licences. */
async function linkedRowsFor(installerIds: string[]): Promise<Map<string, LinkedElectricianBusiness[]>> {
  const out = new Map<string, LinkedElectricianBusiness[]>(installerIds.map((id) => [id, []]));
  if (!installerIds.length) return out;
  const rels: LinkRow[] = [];
  for (let i = 0; i < installerIds.length; i += 200) {
    rels.push(...(((await must(admin.from("partner_relationships").select("installer_business_id, electrician_business_id, is_primary").in("installer_business_id", installerIds.slice(i, i + 200)).eq("active", true), "Couldn't read the electricians")) ?? []) as LinkRow[]));
  }
  const ids = [...new Set(rels.filter((r) => !!r.electrician_business_id && r.electrician_business_id !== r.installer_business_id).map((r) => r.electrician_business_id))];
  if (!ids.length) return out;
  const bizs: BizRow[] = [], workers: WorkerLicence[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [b, w] = await Promise.all([
      must(admin.from("businesses").select("id, name, trading_name, rec_number, onboarding_status, is_active").in("id", chunk), "Couldn't read the electricians"),
      must(admin.from("partner_workers").select("business_id, licence_number, created_at").in("business_id", chunk).eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null).order("created_at"), "Couldn't read the electricians"),
    ]);
    bizs.push(...((b ?? []) as BizRow[])); workers.push(...((w ?? []) as WorkerLicence[]));
  }
  const { displayName } = await import("./display-name.core");
  for (const r of rels) {
    const id = r.electrician_business_id;
    if (!id || id === r.installer_business_id) continue;
    const list = out.get(r.installer_business_id) ?? [];
    if (list.some((l) => l.businessId === id)) continue;
    const b = bizs.find((x) => x.id === id);
    const ws = workers.filter((w) => w.business_id === id);
    list.push({
      businessId: id, name: displayName(b?.trading_name || b?.name) || "Electrician",
      approved: b?.onboarding_status === "approved" && b?.is_active === true && ws.length > 0,
      isPrimary: rels.some((x) => x.installer_business_id === r.installer_business_id && x.electrician_business_id === id && x.is_primary === true),
      licences: ws.map((w) => w.licence_number), recNumber: b?.rec_number ?? null,
    });
    out.set(r.installer_business_id, list);
  }
  return out;
}

/** The latest saved Main choice for this installer (null = never ticked). */
export async function readMainChoice(businessId: string): Promise<MainChoice | null> {
  const row = await must(admin.from("admin_config_events").select("id, details").eq("event_type", MAIN_ELECTRICIAN_EVENT).eq("details->>business_id", businessId).order("created_at", { ascending: false }).limit(1).maybeSingle(), "Couldn't read the Main electrician");
  const r = row as { id?: string; details?: { electrician_business_id?: string | null; worker_id?: string | null } | null } | null;
  return r?.details ? { electricianBusinessId: r.details.electrician_business_id ?? null, workerId: r.details.worker_id ?? null, eventId: r.id ?? null } : null;
}

/** The latest Main choice per installer, for many installers at once (office Partners board). */
async function mainChoicesFor(installerIds: string[]): Promise<Map<string, MainChoice>> {
  const out = new Map<string, MainChoice>();
  for (let i = 0; i < installerIds.length; i += 200) {
    for (let offset = 0; ; offset += 200) {
      const page = ((await must(admin.from("admin_config_events").select("id, details, created_at").eq("event_type", MAIN_ELECTRICIAN_EVENT).in("details->>business_id", installerIds.slice(i, i + 200)).order("created_at", { ascending: false }).range(offset, offset + 199), "Couldn't read the Main electricians")) ?? []) as { id: string; details: { business_id?: string; electrician_business_id?: string | null; worker_id?: string | null } | null }[];
      for (const r of page) { const b = r.details?.business_id; if (b && !out.has(b)) out.set(b, { electricianBusinessId: r.details?.electrician_business_id ?? null, workerId: r.details?.worker_id ?? null, eventId: r.id }); }
      if (page.length < 200) break;
    }
  }
  return out;
}

/** The old saved usual electrician (the never-ticked fallback). */
async function legacyUsual(businessId: string): Promise<{ electrician: UsualElectrician | null; revision: string | null }> {
  return (await import("./usual-electrician.server")).readUsualElectrician(businessId);
}

/** THE list for this installer business. Read errors throw (pickers fail closed, never show "none"). `team` / `choice`:
 *  rows the caller already read (no second read). */
export async function electriciansForInstaller(businessId: string, opts: { team?: TeamElectricianRow[]; choice?: MainChoice | null } = {}): Promise<InstallerElectrician[]> {
  const [linked, team, choice] = await Promise.all([
    linkedRowsFor([businessId]).then((m) => m.get(businessId) ?? []), opts.team ?? teamRows(businessId), opts.choice !== undefined ? opts.choice : readMainChoice(businessId),
  ]);
  // The old usual electrician only decides Main while none was ever ticked.
  const usual = choice ? null : (await legacyUsual(businessId)).electrician;
  return buildInstallerElectricians({ linked, team, mainChoice: choice, usual });
}

export type MainElectrician = {
  /** The Main in the old usual-electrician shape (name + licence); null = none. */
  electrician: UsualElectrician | null;
  /** Changes whenever the Main changes (quote snapshots record it). */
  revision: string | null;
  /** False = never ticked: `electrician` is the old saved usual electrician, unchanged. */
  ticked: boolean;
  /** The Main's electrician business (linked) or Team worker, when ticked. */
  electricianBusinessId: string | null;
  workerId: string | null;
  entry: InstallerElectrician | null;
};

/**
 * Jo 5 Nov 2026: THE read of "this installer's Main electrician" — every server path that used to read the old usual
 * electrician reads this. Ticked Main → that electrician (linked business or Team person). Never ticked → the old saved
 * usual electrician exactly as before, so nothing changes for that installer until they tick one. Read errors throw.
 */
export async function readMainElectrician(businessId: string): Promise<MainElectrician> {
  // ONE read (the job page's read budget): the latest Main tick sorts before any old usual-electrician event
  // ("installer_main…" < "installer_usual…"), so the first row is the latest tick, else the latest old usual electrician.
  const { USUAL_ELECTRICIAN_EVENT, usualElectrician } = await import("./usual-electrician.core");
  const read = await admin.from("admin_config_events").select("id, event_type, details").in("event_type", [MAIN_ELECTRICIAN_EVENT, USUAL_ELECTRICIAN_EVENT]).eq("details->>business_id", businessId)
    .order("event_type", { ascending: true }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (read.error) throw new WorkflowError("Could not load your Main electrician.");
  const row = read.data as { id: string; event_type: string; details: { electrician?: unknown; electrician_business_id?: string | null; worker_id?: string | null } | null } | null;
  if (row?.event_type !== MAIN_ELECTRICIAN_EVENT) {
    return { electrician: usualElectrician(row?.details?.electrician), revision: row?.id ?? null, ticked: false, electricianBusinessId: null, workerId: null, entry: null };
  }
  const choice: MainChoice = { electricianBusinessId: row.details?.electrician_business_id ?? null, workerId: row.details?.worker_id ?? null, eventId: row.id };
  const entry = (await electriciansForInstaller(businessId, { choice })).find((e) => e.main) ?? null;
  return { electrician: mainAsUsual(entry), revision: choice.eventId ?? null, ticked: true, electricianBusinessId: entry?.businessId ?? null, workerId: entry?.workerId ?? null, entry };
}

/** The office Partners board's "Main electrician" column, for many installers at once: the real Main (Team or linked), by
 *  the same rule as the list. Installers with no Main get no entry. */
export async function mainElectricianNamesFor(installerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!installerIds.length) return out;
  const [linked, choices] = await Promise.all([linkedRowsFor(installerIds), mainChoicesFor(installerIds)]);
  const { usualElectrician, USUAL_ELECTRICIAN_EVENT } = await import("./usual-electrician.core");
  // Never-ticked installers: their old saved usual electrician decides (latest event per business).
  const usual = new Map<string, UsualElectrician | null>();
  const untouched = installerIds.filter((id) => !choices.has(id));
  for (let i = 0; i < untouched.length; i += 200) {
    for (let offset = 0; ; offset += 200) {
      const page = ((await must(admin.from("admin_config_events").select("details, created_at").eq("event_type", USUAL_ELECTRICIAN_EVENT).in("details->>business_id", untouched.slice(i, i + 200)).order("created_at", { ascending: false }).range(offset, offset + 199), "Couldn't read the usual electricians")) ?? []) as { details: { business_id?: string; electrician?: unknown } | null }[];
      for (const r of page) { const b = r.details?.business_id; if (b && !usual.has(b)) usual.set(b, usualElectrician(r.details?.electrician)); }
      if (page.length < 200) break;
    }
  }
  // Team rows only for installers whose Main can be a Team person (ticked a worker, or a usual licence to match).
  const needTeam = installerIds.filter((id) => choices.get(id)?.workerId || (!choices.has(id) && usual.get(id)?.licence));
  const team = new Map<string, TeamElectricianRow[]>(needTeam.map((id) => [id, []]));
  for (let i = 0; i < needTeam.length; i += 200) {
    for (let offset = 0; ; offset += 200) {
      const page = ((await must(admin.from("partner_workers").select("id,business_id,full_legal_name,email,mobile,licence_number,rec_number,licence_expires_on,licence_verified_at,approval_status").in("business_id", needTeam.slice(i, i + 200)).eq("trade_role", "electrician").is("removed_at", null).order("id").range(offset, offset + 199), "Couldn't read the Team electricians")) ?? []) as (TeamWorker & { business_id: string })[];
      for (const w of page) team.get(w.business_id)?.push(teamElectricianRow(w));
      if (page.length < 200) break;
    }
  }
  for (const id of installerIds) {
    const choice = choices.get(id) ?? null;
    const main = buildInstallerElectricians({ linked: linked.get(id) ?? [], team: team.get(id) ?? [], mainChoice: choice, usual: choice ? null : usual.get(id) ?? null }).find((e) => e.main);
    if (main) out.set(id, main.name);
  }
  return out;
}

/** Approved electrician businesses this installer could add (not already linked; never another installer's own electrician). */
export async function electricianBusinessesToAdd(installerBusinessId: string, list?: InstallerElectrician[]): Promise<{ id: string; name: string }[]> {
  const [{ loadApprovedRecCandidates }, { approvedRecBlocker }, { displayName }] = await Promise.all([import("./rec-onboarded.server"), import("./rec-onboarded.core"), import("./display-name.core")]);
  const [cands, linkedList] = await Promise.all([loadApprovedRecCandidates(), list ? Promise.resolve(list) : electriciansForInstaller(installerBusinessId)]);
  const linked = new Set(linkedList.map((e) => e.businessId).filter(Boolean));
  const ok = cands.filter((c) => c.business_id !== installerBusinessId && !linked.has(c.business_id) && !approvedRecBlocker(c, { rateNotNeeded: true }));
  if (!ok.length) return [];
  // Part 2b: an electrician another installer added works for that installer only. The column is pending SQL: missing = nobody.
  const added = (await admin.from("businesses").select("id, added_by_installer_business_id").in("id", ok.map((c) => c.business_id)).not("added_by_installer_business_id", "is", null)) as unknown as { data: { id: string; added_by_installer_business_id: string }[] | null; error: { message: string; code?: string } | null };
  if (added.error) { const { isMissingDbObject } = await import("./schema-compat.core"); if (!isMissingDbObject(added.error)) throw new WorkflowError("Couldn't read the approved electricians."); }
  const others = new Set((added.data ?? []).filter((b) => b.added_by_installer_business_id !== installerBusinessId).map((b) => b.id));
  return ok.filter((c) => !others.has(c.business_id)).map((c) => ({ id: c.business_id, name: displayName(c.trading_name || c.name) || "Electrician" })).sort((a, b) => a.name.localeCompare(b.name));
}

async function audit(actorId: string, eventType: string, summary: string, details: Record<string, unknown>) {
  await must(admin.from("admin_config_events").insert({ actor_id: actorId, event_type: eventType, summary, details: details as never }).select("id"), "Couldn't save the change");
}

/** Link an approved electrician business to this installer (as the old "Add" did: an active, preferred link). */
export async function addInstallerElectrician(actorId: string, installerBusinessId: string, electricianBusinessId: string): Promise<void> {
  const options = await electricianBusinessesToAdd(installerBusinessId);
  const pick = options.find((o) => o.id === electricianBusinessId);
  if (!pick) throw new WorkflowError("Pick an approved electrician that isn't on your list yet.");
  await must(admin.from("partner_relationships").upsert({ installer_business_id: installerBusinessId, electrician_business_id: electricianBusinessId, preferred: true, active: true, created_by: actorId } as never, { onConflict: "installer_business_id,electrician_business_id" }).select("id"), "Couldn't add the electrician");
  await audit(actorId, ELECTRICIAN_LINK_ADDED_EVENT, `Electrician ${pick.name} added`, { business_id: installerBusinessId, electrician_business_id: electricianBusinessId });
}

/** Unlink an electrician business. Jobs already handed to them are not touched. */
export async function removeInstallerElectrician(actorId: string, installerBusinessId: string, electricianBusinessId: string): Promise<void> {
  await must(admin.from("partner_relationships").update({ active: false, is_primary: false } as never).eq("installer_business_id", installerBusinessId).eq("electrician_business_id", electricianBusinessId).select("id"), "Couldn't remove the electrician");
  await audit(actorId, ELECTRICIAN_LINK_REMOVED_EVENT, "Electrician removed", { business_id: installerBusinessId, electrician_business_id: electricianBusinessId });
}

/** Tick Main. One append-only event decides (latest wins → exactly one Main); the legacy marker follows it. */
export async function setMainInstallerElectrician(actorId: string, installerBusinessId: string, key: string): Promise<void> {
  const list = await electriciansForInstaller(installerBusinessId);
  const e = list.find((x) => x.key === key);
  if (!e) throw new WorkflowError("That electrician isn't on your list.");
  await audit(actorId, MAIN_ELECTRICIAN_EVENT, `Main electrician: ${e.name}`, { business_id: installerBusinessId, electrician_business_id: e.businessId, worker_id: e.workerId });
  await must(admin.from("partner_relationships").update({ is_primary: false } as never).eq("installer_business_id", installerBusinessId).select("id"), "Couldn't save the Main electrician");
  if (e.businessId) await must(admin.from("partner_relationships").update({ is_primary: true } as never).eq("installer_business_id", installerBusinessId).eq("electrician_business_id", e.businessId).select("id"), "Couldn't save the Main electrician");
}

/** The legacy (non-Team) picker shape `bulkElectricianChoices` returns: linked businesses from the one list, Main = primary
 *  (the same rows and status line as before). */
export async function linkedChoicesForPicker(installerBusinessId: string): Promise<{ businessId: string; primary: boolean; name: string; status: string }[]> {
  return (await electriciansForInstaller(installerBusinessId)).filter((e) => e.kind === "business").map((e) => ({ businessId: e.businessId!, primary: e.main, name: e.name, status: "Already signed up ✓" }));
}
