// Jo 3 Nov 2026: the one electrician question on a Mitti pickup (rules in mitti-electrician.core). Reads are batched for
// the installer home; the answer is a check-and-set on jobs.electrician_choice before the normal Add a job save
// (recordJobElectricianChoice); the safety-check fallback records its outcome once. Never sends anything.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import type { ElectricianPlan } from "./job-electrician.core";
import {
  MITTI_ELECTRICIAN_HELD_EVENT, MITTI_ELECTRICIAN_OFFICE_LINE, MITTI_USUAL_USED_EVENT,
  mittiElectricianFallback, mittiElectricianPlanProblem, mittiElectricianQuestionOpen,
} from "./mitti-electrician.core";

/** Which of these jobs still have the question open (only Mitti pickups can). Fails closed: a read error → none open. */
export async function openMittiElectricianQuestions(jobIds: string[]): Promise<Set<string>> {
  const open = new Set<string>();
  if (!jobIds.length) return open;
  const { data: jobs, error } = await admin.from("jobs").select("id, source, electrician_choice").in("id", jobIds.slice(0, 200)).eq("source", "installer_mitti");
  if (error || !jobs?.length) return open;
  const ids = jobs.map((j) => String(j.id));
  const [noms, asg, offers, used] = await Promise.all([
    admin.from("electrician_nominations").select("job_id").in("job_id", ids).is("ended_at", null),
    admin.from("job_assignments").select("job_id").in("job_id", ids).eq("role", "electrician").eq("active", true),
    admin.from("partner_offers").select("job_id").in("job_id", ids).eq("kind", "piesa"),
    admin.from("workflow_events").select("job_id").in("job_id", ids).eq("event_type", MITTI_USUAL_USED_EVENT),
  ]);
  if (noms.error || asg.error || offers.error || used.error) return open;
  const has = (rows: { job_id: string | null }[] | null, id: string) => (rows ?? []).some((r) => r.job_id === id);
  for (const j of jobs) {
    const id = String(j.id);
    if (mittiElectricianQuestionOpen({ source: j.source, electricianChoice: j.electrician_choice as string | null, hasNomination: has(noms.data, id), hasElectricianAssigned: has(asg.data, id), hasPiesaOffer: has(offers.data, id), usualUsed: has(used.data, id) })) open.add(id);
  }
  return open;
}

/** The installer business assigned to this job that the user belongs to; refuses anyone else. */
async function installerBusinessFor(jobId: string, userId: string): Promise<string> {
  const { data: asg, error } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true);
  if (error) throw new WorkflowError("Couldn't check this job. Please try again.");
  const ids = [...new Set((asg ?? []).map((a) => a.business_id).filter((x): x is string => !!x))];
  if (!ids.length) throw new WorkflowError("This isn't one of your jobs.");
  const { data: mem } = await admin.from("business_members").select("business_id").eq("user_id", userId).in("business_id", ids).limit(1);
  const biz = mem?.[0]?.business_id;
  if (!biz) throw new WorkflowError("This isn't one of your jobs.");
  return biz;
}

/** For the installer's job page: whether to ask, and the business whose electricians are offered. */
export async function mittiElectricianQuestionFor(jobId: string, userId: string): Promise<{ open: boolean; businessId: string | null }> {
  const open = (await openMittiElectricianQuestions([jobId])).has(jobId);
  if (!open) return { open: false, businessId: null };
  return { open: true, businessId: await installerBusinessFor(jobId, userId) };
}

/** Saves the answer once. Check-and-set first so a double tap or second device cannot record two choices. */
export async function answerMittiElectricianQuestion(jobId: string, userId: string, plan: ElectricianPlan) {
  const problem = mittiElectricianPlanProblem(plan);
  if (problem) throw new WorkflowError(problem);
  const biz = await installerBusinessFor(jobId, userId);
  if (!(await openMittiElectricianQuestions([jobId])).has(jobId)) throw new WorkflowError("The electrician for this job is already chosen.");
  const claim = plan.business_id ? "preferred" : "nominated";
  const { data: claimed, error } = await admin.from("jobs").update({ electrician_choice: claim }).eq("id", jobId).eq("source", "installer_mitti").is("electrician_choice", null).select("id");
  if (error) throw new WorkflowError("Couldn't save your electrician. Please try again.");
  if (!claimed?.length) throw new WorkflowError("The electrician for this job is already chosen.");
  try {
    const { recordJobElectricianChoice } = await import("./job-electrician.server");
    return await recordJobElectricianChoice(jobId, biz, plan, userId);
  } catch (e) {
    await admin.from("jobs").update({ electrician_choice: null }).eq("id", jobId).eq("electrician_choice", claim);
    throw e;
  }
}

/** The installer's approved usual electrician as an approved REC business id, or null (none saved / not onboarded). */
async function usualApprovedBusinessId(jobId: string): Promise<string | null> {
  const { data: asg } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  const { data: job } = await admin.from("jobs").select("originating_installer_business_id").eq("id", jobId).maybeSingle();
  const biz = (job?.originating_installer_business_id as string | null) ?? asg?.business_id ?? null;
  if (!biz) return null;
  const status = await (await import("./usual-electrician.server")).readUsualElectricianStatus(biz);
  if (!status.electrician || !status.onboarded) return null;
  const approved = await (await import("./rec-onboarded.server")).loadApprovedRecCandidates();
  return (await import("./our-lead-piesa-electrician.core")).ourLeadUsualRecId(status.electrician, approved);
}

/**
 * Safety-check time, Mitti pickups with no chosen electrician: the previously used usual electrician, or now the
 * approved usual electrician (recorded once), or hold with ONE office event. `proceed` = normal rules unchanged.
 */
export async function mittiElectricianAtSafetyCheck(jobId: string): Promise<{ action: "proceed" } | { action: "use_usual"; businessId: string } | { action: "hold" }> {
  const { data: prior } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", MITTI_USUAL_USED_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const priorId = (prior?.details as { business_id?: string } | null)?.business_id;
  if (priorId) return { action: "use_usual", businessId: priorId };
  const open = (await openMittiElectricianQuestions([jobId])).has(jobId);
  const step = mittiElectricianFallback({ questionOpen: open, usualApprovedBusinessId: open ? await usualApprovedBusinessId(jobId) : null });
  if (step.action === "use_usual") {
    await logEvent(jobId, null, MITTI_USUAL_USED_EVENT, "Usual electrician used: no answer given", { business_id: step.businessId }, { internal: true });
  } else if (step.action === "hold") {
    const { data: held } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", MITTI_ELECTRICIAN_HELD_EVENT).limit(1);
    if (!(held ?? []).length) await logEvent(jobId, null, MITTI_ELECTRICIAN_HELD_EVENT, MITTI_ELECTRICIAN_OFFICE_LINE, { needs_office: true }, { internal: true });
  }
  return step;
}
