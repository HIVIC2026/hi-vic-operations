// Decision 303 addition (Jo 25 Oct 2026): a newly approved + rated REC is linked to every installer who named that
// electrician (rules in rec-auto-link.core.ts). Runs best-effort after the office approves a business or activates a
// PIESA rate (whichever comes last completes the picture; until both hold, nothing happens). Writes: the installer's
// usual-electrician config event (`source: auto_linked_on_approval`), one `rec_auto_linked` / `rec_link_conflict` config
// event per installer (Needs me Partner & system fold), and the normal quote re-draft through the existing pipeline
// (re-priced PIESA line, draft left on Quotes to check). Never sends; never overwrites a different nomination.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { AUTO_LINK_SOURCE, REC_AUTO_LINKED_EVENT, REC_LINK_CONFLICT_EVENT, autoLinkPlans, recConflictLine, recLinkedLine, type InstallerNominations } from "./rec-auto-link.core";
import { ELECTRICIAN_ONBOARDING_NEEDED_EVENT } from "./rec-onboarded.core";
import { USUAL_ELECTRICIAN_EVENT, usualElectrician } from "./usual-electrician.core";

/** Re-run the quote pipeline from the job's current Mitti form (same path as the price card); null = no form / Mitti down (the tick retries). */
async function redraftFromMitti(jobId: string, actorId: string | null): Promise<boolean | null> {
  try {
    const { data: m } = await admin.from("ceiling_measurements").select("external_source, external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle();
    if (m?.external_source !== "mitti" || !m.external_id) return null;
    const { mittiApi, parseAudit } = await import("./mitti.core");
    const a = await mittiApi(await (await import("./mitti.server")).mittiCallForJob(jobId)).getAudit(String(m.external_id));
    const entries = parseAudit(a).snapshot as { label: string; value: string | null }[];
    const d = await (await import("./installer-quote.server")).draftInstallerQuoteFromReadyCheck(jobId, actorId, entries, String(m.external_id));
    return d ? d.ready : null;
  } catch (e) {
    console.error("auto-link redraft skipped", jobId, (e as Error).message);
    return null;
  }
}

export async function autoLinkApprovedRec(recBusinessId: string, actorId: string | null): Promise<{ linked: number; conflicts: number; skipped: string | null }> {
  const { loadApprovedRecCandidates } = await import("./rec-onboarded.server");
  const rec = (await loadApprovedRecCandidates()).find((c) => c.business_id === recBusinessId);
  if (!rec) return { linked: 0, conflicts: 0, skipped: "not an electrician business" };
  const { approvedRecBlocker } = await import("./rec-onboarded.core");
  const blocker = approvedRecBlocker(rec);
  if (blocker) return { linked: 0, conflicts: 0, skipped: blocker };

  // (a) every installer's saved usual electrician (latest config event per business)
  const { data: usualEvs, error: ue } = await admin.from("admin_config_events").select("details, created_at").eq("event_type", USUAL_ELECTRICIAN_EVENT).order("created_at", { ascending: false }).limit(5000);
  if (ue) throw new Error("Could not read installers' usual electricians.");
  const usualBy = new Map<string, ReturnType<typeof usualElectrician>>();
  for (const e of usualEvs ?? []) {
    const d = e.details as { business_id?: string; electrician?: unknown } | null;
    if (d?.business_id && !usualBy.has(d.business_id)) usualBy.set(d.business_id, usualElectrician(d.electrician));
  }
  // (b) legacy electricians named on OPEN installer jobs: old price-card blocks and the pipeline's onboarding-needed facts
  const { data: jobs, error: je } = await admin.from("jobs").select("id, originating_installer_business_id, stage, deleted_at, qa_archived_at").eq("channel", "installer_sourced").not("originating_installer_business_id", "is", null).neq("stage", "complete").is("deleted_at", null).is("qa_archived_at", null).neq("stage", "cancelled").limit(5000);
  if (je) throw new Error("Could not read installer jobs.");
  const openJobs = jobs ?? [];
  const jobIds = openJobs.map((j) => j.id);
  const legacyBy = new Map<string, { jobId: string; name: string | null; licence: string | null }[]>();
  const push = (biz: string, l: { jobId: string; name: string | null; licence: string | null }) => { if (!legacyBy.has(biz)) legacyBy.set(biz, []); legacyBy.get(biz)!.push(l); };
  if (jobIds.length) {
    const prices = await (await import("./installer-price.server")).readInstallerPrices(jobIds);
    for (const j of openJobs) {
      const e = prices.get(j.id)?.electrician;
      if (e && e.choice !== "hivic" && (e.name || e.licence)) push(j.originating_installer_business_id!, { jobId: j.id, name: e.name, licence: e.licence });
    }
    const { data: needs } = await admin.from("workflow_events").select("job_id, details, created_at").in("job_id", jobIds).eq("event_type", ELECTRICIAN_ONBOARDING_NEEDED_EVENT).order("created_at", { ascending: false });
    const seen = new Set<string>();
    for (const n of needs ?? []) {
      if (!n.job_id || seen.has(n.job_id)) continue;
      seen.add(n.job_id);
      const d = n.details as { name?: string; licence?: string | null; installer_business_id?: string } | null;
      if (d?.installer_business_id && d.name) push(d.installer_business_id, { jobId: n.job_id, name: d.name, licence: d.licence ?? null });
    }
  }
  const installerIds = [...new Set([...usualBy.keys(), ...legacyBy.keys()])];
  if (!installerIds.length) return { linked: 0, conflicts: 0, skipped: null };
  const [{ data: bizs }, { data: done }] = await Promise.all([
    admin.from("businesses").select("id, name, trading_name").in("id", installerIds),
    admin.from("admin_config_events").select("details").in("event_type", [REC_AUTO_LINKED_EVENT, REC_LINK_CONFLICT_EVENT]).contains("details", { rec_business_id: recBusinessId }),
  ]);
  const alreadyDone = new Set((done ?? []).map((r) => String((r.details as { installer_business_id?: string } | null)?.installer_business_id ?? "")));
  const nameOf = (id: string) => { const b = (bizs ?? []).find((x) => x.id === id); return (b?.trading_name || b?.name) ?? null; };
  const installers: InstallerNominations[] = installerIds.filter((id) => !alreadyDone.has(id)).map((id) => ({ installerBusinessId: id, installerName: nameOf(id), usual: usualBy.get(id) ?? null, legacy: legacyBy.get(id) ?? [] }));
  const recName = rec.trading_name ?? rec.name ?? "The electrician";
  let linked = 0, conflicts = 0;
  for (const plan of autoLinkPlans(rec, installers)) {
    if (plan.action === "none") continue;
    const installerName = plan.installerName ?? "the installer";
    if (plan.action === "conflict") {
      conflicts++;
      await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: REC_LINK_CONFLICT_EVENT, summary: recConflictLine(recName, installerName), details: { rec_business_id: recBusinessId, rec_name: recName, installer_business_id: plan.installerBusinessId, installer_name: installerName, existing: plan.existing, job_ids: plan.jobIds, reason: plan.reason } });
      continue;
    }
    // Record the installer's usual electrician as the approved REC (append-only; latest wins for reads).
    const { error } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: USUAL_ELECTRICIAN_EVENT, summary: `Usual electrician linked to approved REC ${recName} on approval (decision 303)`, details: { business_id: plan.installerBusinessId, electrician: plan.electrician, source: AUTO_LINK_SOURCE, rec_business_id: recBusinessId, via: plan.via } });
    if (error) throw new Error("Could not link the installer's usual electrician.");
    // Lift the hold on this installer's open jobs by re-running the pipeline (re-priced PIESA line, draft stays on Quotes to check).
    const theirJobs = openJobs.filter((j) => j.originating_installer_business_id === plan.installerBusinessId).map((j) => j.id);
    let ready = 0;
    for (const jobId of theirJobs) if ((await redraftFromMitti(jobId, actorId)) === true) ready++;
    linked++;
    await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: REC_AUTO_LINKED_EVENT, summary: recLinkedLine(recName, installerName, ready), details: { rec_business_id: recBusinessId, rec_name: recName, installer_business_id: plan.installerBusinessId, installer_name: installerName, via: plan.via, job_ids: theirJobs, matched_job_ids: plan.jobIds, quotes_ready: ready } });
  }
  return { linked, conflicts, skipped: null };
}

/** Recent auto-link outcomes for the Needs me Partner & system fold (office line, one per installer). */
export async function recentRecLinkItems(days = 14): Promise<{ key: string; recName: string; line: string; since: string; conflict: boolean }[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await admin.from("admin_config_events").select("id, event_type, summary, created_at, details").in("event_type", [REC_AUTO_LINKED_EVENT, REC_LINK_CONFLICT_EVENT]).gte("created_at", since).order("created_at", { ascending: false }).limit(50);
  return (data ?? []).map((r) => ({ key: `reclink:${r.id}`, recName: String((r.details as { rec_name?: string } | null)?.rec_name ?? "REC"), line: r.summary ?? "", since: r.created_at, conflict: r.event_type === REC_LINK_CONFLICT_EVENT }));
}
