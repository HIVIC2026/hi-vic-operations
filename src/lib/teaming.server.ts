// Team-up persistence helpers (service role). Callers must authorise first.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { pickTeamElectrician } from "./teaming.core";

type Db = SupabaseClient<Database>;

/** Links every accepted nomination whose installer AND electrician businesses are both HI VIC-approved. Idempotent. */
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
 * Returns the chosen business id or null (HI VIC matching continues). Never touches QA test jobs.
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
