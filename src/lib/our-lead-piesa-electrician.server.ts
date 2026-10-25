// Decisions 349/351/374: whose electrician is on a job (keys the decision-142 fixes margin). Reads only.
// Decision 374 (Jo 25 Oct 2026): on our leads (A2) WE always choose the electrician (nearest approved REC covering the
// postcode, `auto-offer`), so A2 is always "ours"; the decision-157 usual-electrician selection for A2 is retired.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

/** Decisions 349/351/374: whose electrician is on this job — the installer's own (usual / nominated) electrician, or ours.
 *  Our leads (A2, decision 374): always ours — we choose the electrician, even if it happens to be the installer's usual one.
 *  Installer-supplied jobs (A1, decision 351): the job's electrician choice (decision 289) — HIV's → ours; the installer's
 *  usual / nominated electrician → installer_usual when that electrician is the one assigned (`electricianSourceForA1`).
 *  No assignment / no installer / no usual saved → "ours". Read errors throw (no guessed margin). */
export async function electricianSourceForJob(jobId: string, electricianBusinessId: string | null): Promise<import("./our-lead-piesa-electrician.core").ElectricianSource> {
  const { electricianSourceForA1, electricianSourceForOurLead } = await import("./our-lead-piesa-electrician.core");
  if (!electricianBusinessId) return "ours";
  const READ_FAIL = "Could not check whose electrician is on this job.";
  const [{ data: job, error: je }, { data: inst, error: ie }] = await Promise.all([
    admin.from("jobs").select("channel, originating_installer_business_id").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
  ]);
  if (je || ie) throw new Error(READ_FAIL);
  if (!job) return "ours";
  if (job.channel !== "installer_sourced") return electricianSourceForOurLead();
  const installerBiz = job.originating_installer_business_id ?? inst?.business_id ?? null;
  const usual = installerBiz ? (await (await import("./usual-electrician.server")).readUsualElectrician(installerBiz)).electrician : null;
  const [{ data: b, error: be }, { data: workers, error: we }] = await Promise.all([
    admin.from("businesses").select("id, name, trading_name, rec_number").eq("id", electricianBusinessId).maybeSingle(),
    admin.from("partner_workers").select("licence_number").eq("business_id", electricianBusinessId).eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null),
  ]);
  if (be || we) throw new Error(READ_FAIL);
  const assigned = b ? { business_id: b.id, name: b.name ?? null, trading_name: b.trading_name ?? null, rec_number: b.rec_number ?? null, worker_licences: (workers ?? []).map((w) => w.licence_number) } : null;
  // A1: the recorded choice, then the last resolved Mitti electrician (old forms), then usual, then HIV (decision 289).
  const [recorded, { data: last, error: le }] = await Promise.all([
    (await import("./electrician-choice.server")).readElectricianChoice(jobId),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (le) throw new Error(READ_FAIL);
  const lastDetails = (last?.details ?? null) as { choice?: string | null; recBusinessId?: string | null } | null;
  const { resolveElectricianChoice } = await import("./electrician-choice.core");
  const choice = resolveElectricianChoice({ recorded, legacy: lastDetails?.choice ?? null, usual });
  return electricianSourceForA1({ choice, usual, nominatedBusinessIds: [lastDetails?.recBusinessId ?? null], assigned });
}
