// Jo 26 Oct 2026: which jobs' safety check we pay to the INSTALLER instead of the electrician (rules in
// installer-paid-electricians.core.ts). Read-only, batched by job id; read errors throw (fail closed upstream).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { installerPaysOwnElectricians, safetyCheckPayee, type InstallerPaidElectricians } from "./installer-paid-electricians.core";

/** Per job: the installer we pay for the safety check, or null (we pay the electrician as usual). */
export async function safetyCheckPayeesFor(jobs: { id: string; originating_installer_business_id: string | null }[]): Promise<Map<string, InstallerPaidElectricians | null>> {
  const out = new Map<string, InstallerPaidElectricians | null>(jobs.map((j) => [j.id, null]));
  const candidates = jobs.filter((j) => installerPaysOwnElectricians(j.originating_installer_business_id));
  if (!candidates.length) return out;
  const { data, error } = await admin.from("workflow_events").select("job_id, details, created_at").in("job_id", candidates.map((j) => j.id))
    .eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false });
  if (error) throw new Error(`Could not read the Ready Check electrician choices: ${error.message}`);
  const choice = new Map<string, string | null>();
  for (const e of (data ?? []) as { job_id: string; details: { choice?: string | null } | null }[]) if (!choice.has(e.job_id)) choice.set(e.job_id, e.details?.choice ?? null);
  for (const j of candidates) out.set(j.id, safetyCheckPayee({ installerBusinessId: j.originating_installer_business_id, electricianChoice: choice.get(j.id) ?? null }));
  return out;
}
