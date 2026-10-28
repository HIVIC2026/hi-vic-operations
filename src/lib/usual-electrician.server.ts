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
  // Decision 302: HIV's electrician = the standard owner PIESA line from retail settings (349 when unset).
  const { data: rs } = await admin.from("retail_estimator_settings").select("piesa_assessment_inc_gst").eq("is_current", true).maybeSingle();
  const legacy = resolveMittiElectrician({ choice, usual: saved?.electrician ?? null,
    different: { name: answers.electricianName, licence: answers.electricianLicence, priceIncGst: answers.electricianPriceIncGst },
    standardPiesaIncGst: rs?.piesa_assessment_inc_gst == null ? null : Number(rs.piesa_assessment_inc_gst) });
  // Decision 303: a usual / legacy "different" electrician is READY only as an approved REC (price = their onboarded PIESA
  // rate); otherwise the quote holds "Electrician not onboarded: <name>" and the tick issues ONE onboarding invite.
  const { onboardedElectricianResolution, ELECTRICIAN_ONBOARDING_NEEDED_EVENT } = await import("./rec-onboarded.core");
  const candidates = legacy.choice === "hivic" || legacy.needsProfile ? [] : await (await import("./rec-onboarded.server")).loadApprovedRecCandidates();
  // Jo 26 Oct 2026: an installer that pays its own electricians (Reinsulate) → flat owner line, no REC rate needed.
  const paysOwn = (await import("./installer-paid-electricians.core")).installerPaysOwnElectricians(job.originating_installer_business_id);
  const resolved = onboardedElectricianResolution({ legacy, usual: saved?.electrician ?? null, candidates, flatPiesaIncGst: paysOwn?.piesaIncGst ?? null });
  if (resolved.notOnboarded && job.originating_installer_business_id) {
    const need = { installer_business_id: job.originating_installer_business_id, name: resolved.notOnboarded.name, licence: resolved.notOnboarded.licence, email: resolved.notOnboarded.email, choice: resolved.choice };
    const { data: lastNeed, error: ne } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", ELECTRICIAN_ONBOARDING_NEEDED_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ne) throw new Error("Could not check the job's electrician onboarding history.");
    const same = lastNeed && ["installer_business_id", "name", "licence", "email", "choice"].every((k) => ((lastNeed.details as Record<string, unknown> | null)?.[k] ?? null) === ((need as Record<string, unknown>)[k] ?? null));
    if (!same) await logEvent(jobId, actorId, ELECTRICIAN_ONBOARDING_NEEDED_EVENT, `${resolved.reasons[0]} — REC onboarding invite to be issued once (decision 303)`, need, { internal: true });
  }
  const details = { audit_id: auditId, ...resolved, profile_revision: choice === "usual" ? saved?.revision ?? null : null, choice_source: recorded ? "add_job" : answers.electricianChoice ? "legacy_answer" : "default", declared_not_verified: resolved.source !== "approved_rec" };
  const { data: previous, error: pe } = await admin.from("workflow_events").select("details").eq("job_id", jobId)
    .eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pe) throw new Error("Could not check the job's electrician history.");
  const keys = Object.keys(details).sort();
  const signature = (value: unknown) => JSON.stringify(keys.map((k) => [k, (value as Record<string, unknown> | null)?.[k] ?? null]));
  if (signature(previous?.details) !== signature(details)) await logEvent(jobId, actorId, "mitti_electrician_recorded", resolved.ready ? "Ready Check electrician details recorded for compliance (declared, not verified)" : resolved.reasons.join(" · "), details, { internal: true });
  return resolved;
}
/** A3: the saved usual electrician and whether they are onboarded (approved REC; flat-paid installers need no rate).
 *  Reads candidates only when one is saved. */
export async function readUsualElectricianStatus(businessId: string): Promise<{ electrician: import("./usual-electrician.core").UsualElectrician | null; onboarded: boolean }> {
  const { electrician } = await readUsualElectrician(businessId);
  if (!electrician) return { electrician: null, onboarded: false };
  const candidates = await (await import("./rec-onboarded.server")).loadApprovedRecCandidates();
  const flat = (await import("./installer-paid-electricians.core")).installerPaysOwnElectricians(businessId)?.piesaIncGst ?? null;
  const { usualIsOnboarded } = await import("./rec-onboarded.core");
  return { electrician, onboarded: usualIsOnboarded(electrician, candidates, flat) };
}
