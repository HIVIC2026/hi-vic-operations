// Business-scoped settings and job-owned compliance snapshots; no schema change or partner assignment.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { USUAL_ELECTRICIAN_EVENT, usualElectrician, resolveMittiElectrician } from "./usual-electrician.core";
import { contactAnswersFromEntries } from "./mitti.core";
import { logEvent } from "./workflow.server";

export async function readUsualElectrician(businessId: string) {
  const { data, error } = await admin.from("admin_config_events").select("id, details")
    .eq("event_type", USUAL_ELECTRICIAN_EVENT).contains("details", { business_id: businessId })
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Could not load your usual electrician.");
  return { electrician: usualElectrician((data?.details as { electrician?: unknown } | null)?.electrician), revision: data?.id ?? null };
}

/** Decision 289 (Jo 25 Oct 2026): the electrician is chosen once at Add a job (`electrician_choice_set`, latest wins) and
 *  never asked in Mitti or on the price card. Resolution order: the recorded choice → an old form / old price-card answer
 *  (forms before 25 Oct could say "a different electrician") → the usual electrician when saved → Home Insulation
 *  Victoria's. Installer-supplied jobs only; our leads return null as before. */
export async function mittiElectricianForJob(jobId: string, actorId: string | null, entries: { label: string; value: string | null }[], auditId: string) {
  const answers = contactAnswersFromEntries(entries);
  const { data: job, error } = await admin.from("jobs").select("channel, originating_installer_business_id, source, job_number").eq("id", jobId).maybeSingle();
  if (error) throw new Error("Could not check the installer for this job.");
  if (job?.channel !== "installer_sourced") return null;
  const { resolveElectricianChoice } = await import("./electrician-choice.core");
  const recorded = await (await import("./electrician-choice.server")).readElectricianChoice(jobId);
  const saved = job.originating_installer_business_id ? await readUsualElectrician(job.originating_installer_business_id) : null;
  const choice = resolveElectricianChoice({ recorded, legacy: answers.electricianChoice, usual: saved?.electrician ?? null });
  const resolved = resolveMittiElectrician({ choice, usual: saved?.electrician ?? null,
    different: { name: answers.electricianName, licence: answers.electricianLicence, priceIncGst: answers.electricianPriceIncGst } });
  const details = { audit_id: auditId, ...resolved, profile_revision: choice === "usual" ? saved?.revision ?? null : null, choice_source: recorded ? "add_job" : answers.electricianChoice ? "legacy_answer" : "default", declared_not_verified: true };
  const { data: previous, error: pe } = await admin.from("workflow_events").select("details").eq("job_id", jobId)
    .eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pe) throw new Error("Could not check the job's electrician history.");
  const keys = Object.keys(details).sort();
  const signature = (value: unknown) => JSON.stringify(keys.map((k) => [k, (value as Record<string, unknown> | null)?.[k] ?? null]));
  if (signature(previous?.details) !== signature(details)) await logEvent(jobId, actorId, "mitti_electrician_recorded", resolved.ready ? "Ready Check electrician details recorded for compliance (declared, not verified)" : resolved.reasons.join(" · "), details, { internal: true });
  return resolved;
}