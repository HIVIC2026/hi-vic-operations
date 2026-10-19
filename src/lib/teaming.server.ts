// Team-up persistence helpers (service role). Callers must authorise first.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { pickTeamElectrician } from "./teaming.core";
import { rankElectricians, type ElecCandidate, type BusinessLike } from "./pilot.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { getStage, logEvent, transition } from "./workflow.server";

type Db = SupabaseClient<Database>;

/** Links every accepted nomination whose installer AND electrician businesses are both Home Insulation Victoria-approved. Idempotent. */
export async function syncTeamUps(db: Db, actorId: string | null): Promise<number> {
  const { data: noms } = await db.from("electrician_nominations").select("id, installer_application_id, electrician_application_id, is_primary")
    .is("job_id", null).not("accepted_at", "is", null).is("teamed_at", null).is("ended_at", null).is("declined_at", null)
    .not("installer_application_id", "is", null).not("electrician_application_id", "is", null);
  if (!noms?.length) return 0;
  const appIds = [...new Set(noms.flatMap((n) => [n.installer_application_id!, n.electrician_application_id!]))];
  const { data: acts } = await db.from("partner_activations").select("application_id, business_id").in("application_id", appIds);
  const biz = new Map((acts ?? []).map((a) => [a.application_id, a.business_id]));
  let linked = 0;
  for (const n of noms) {
    const inst = biz.get(n.installer_application_id!), elec = biz.get(n.electrician_application_id!);
    if (!inst || !elec) {
      await db.from("electrician_nominations").update({ status: "awaiting_approval", updated_at: new Date().toISOString() }).eq("id", n.id);
      continue;
    }
    if (n.is_primary) await db.from("partner_relationships").update({ is_primary: false }).eq("installer_business_id", inst).neq("electrician_business_id", elec);
    const { error } = await db.from("partner_relationships").upsert({ installer_business_id: inst, electrician_business_id: elec, preferred: true, active: true, is_primary: n.is_primary, source: "team_up", created_by: actorId }, { onConflict: "installer_business_id,electrician_business_id" });
    if (error) continue;
    await db.from("electrician_nominations").update({ status: "teamed", teamed_at: new Date().toISOString(), business_id: elec, nominating_business_id: inst }).eq("id", n.id);
    linked++;
  }
  return linked;
}

/**
 * Installer-sourced job needs an electrician: assign the teamed Main (or backup) when approved + in area.
 * Returns the chosen business id or null (Home Insulation Victoria matching continues). Never touches QA test jobs.
 */
export async function autoAssignTeamElectrician(
  db: Db, jobId: string, ranked: { id: string; eligible: boolean; inArea: boolean }[], installerBiz: string | null,
): Promise<{ businessId: string; userId: string; via: "primary" | "backup" } | null> {
  if (!installerBiz) return null;
  const { data: job } = await db.from("jobs").select("channel, source").eq("id", jobId).single();
  if (!job || job.channel !== "installer_sourced" || job.source === "qa_test") return null;
  const { data: rels } = await db.from("partner_relationships").select("electrician_business_id, is_primary, preferred, active").eq("installer_business_id", installerBiz);
  const pick = pickTeamElectrician(rels ?? [], ranked);
  if (!pick) return null;
  const { data: m } = await db.from("business_members").select("user_id").eq("business_id", pick.id).eq("active", true).order("created_at").limit(1).maybeSingle();
  if (!m) return null;
  return { businessId: pick.id, userId: m.user_id, via: pick.via };
}

export async function electricianCandidates(jobId: string) {
  const { data: j } = await admin.from("jobs").select("originating_installer_business_id, properties(postcode, suburb)").eq("id", jobId).single();
  const { data: inst } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const installerBiz = inst?.business_id ?? j?.originating_installer_business_id ?? null;
  const { data: bizs } = await admin.from("businesses").select("*").or("business_type.eq.rec,capabilities.cs.{electrician}");
  const ids = (bizs ?? []).map((b) => b.id);
  const [{ data: creds }, { data: rels }, { data: cards }, { data: load }] = await Promise.all([
    admin.from("business_credentials").select("business_id,kind,label,expires_at,critical,verification").in("business_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    installerBiz ? admin.from("partner_relationships").select("electrician_business_id, preferred").eq("installer_business_id", installerBiz).eq("active", true) : Promise.resolve({ data: [] as { electrician_business_id: string; preferred: boolean }[] }),
    admin.from("rate_cards").select("business_id").eq("kind", "electrical").eq("is_active", true),
    admin.from("job_assignments").select("business_id").eq("role", "electrician").eq("active", true),
  ]);
  const cands: ElecCandidate[] = (bizs ?? []).map((b) => ({
    ...(b as unknown as BusinessLike), id: b.id, name: b.trading_name || b.name, weekly_capacity: b.weekly_capacity, lead_time_days: b.lead_time_days,
    credentials: (creds ?? []).filter((c) => c.business_id === b.id), preferred: !!rels?.some((r) => r.electrician_business_id === b.id && r.preferred),
    hasRates: !!cards?.some((c) => c.business_id === b.id), activeJobs: (load ?? []).filter((l) => l.business_id === b.id).length,
  }));
  const p = j?.properties as { postcode: string | null; suburb: string | null } | null;
  return { cands, site: { postcode: p?.postcode ?? null, suburb: p?.suburb ?? null }, installerBiz };
}


/** Team-up auto-assignment (DB only, no messaging): installer-sourced job needs an electrician and none is active. */
export async function tryTeamAssign(jobId: string, actorId: string | null): Promise<boolean> {
  const stage = await getStage(jobId);
  if (stage !== "piesa_and_install_window_pending") return false; // legacy awaiting_electrician retired
  const { data: active } = await admin.from("job_assignments").select("id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  if (active) return false;
  // A job where the installer picked an electrician (or invited one) goes to that electrician as an offer, never auto-assigned.
  const { count: chosen } = await admin.from("electrician_nominations").select("id", { count: "exact", head: true }).eq("job_id", jobId).is("ended_at", null);
  if (chosen) return false;
  const { cands, site, installerBiz } = await electricianCandidates(jobId);
  const pick = await autoAssignTeamElectrician(admin as never, jobId, rankElectricians(cands, site), installerBiz);
  if (!pick) return false;
  
  // Phase 1 compliance: enforce electrician work eligibility before team assignment
  const { electricianWorkEligibility } = await import("./pilot.core");
  const [{ data: business }, { data: creds }, { data: workers }] = await Promise.all([
    admin.from("businesses").select("*").eq("id", pick.businessId).maybeSingle(),
    admin.from("business_credentials").select("kind,label,expires_at,critical,verification").eq("business_id", pick.businessId),
    admin.from("partner_workers").select("trade_role,licence_expires_on,approval_status,removed_at").eq("business_id", pick.businessId).eq("trade_role", "electrician"),
  ]);
  const blocker = electricianWorkEligibility(business as any, creds as any, workers as any);
  if (blocker) {
    // Assignment rejected — log and return false without creating job_assignment
    await logEvent(jobId, actorId, "team_assign_rejected", `Team electrician assignment rejected: ${blocker}`, { businessId: pick.businessId, via: pick.via }, { internal: true });
    return false;
  }
  
  const name = cands.find((c) => c.id === pick.businessId)?.name ?? "team electrician";
  await admin.from("jobs").update({ electrician_choice: "preferred" }).eq("id", jobId);
  await admin.from("job_assignments").insert({ job_id: jobId, user_id: pick.userId, role: "electrician", business_id: pick.businessId, assigned_by: actorId ?? pick.userId });
  await logEvent(jobId, actorId, "contractor_assigned", `Electrician assigned: ${name} (auto-assigned via team-up, ${pick.via === "primary" ? "Main" : "backup"} electrician)`);
  return true;
}
