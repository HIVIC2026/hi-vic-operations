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

export type MittiElectricianJobRow = { id: string; source: string | null; channel: string | null; electrician_choice: string | null };

/** Which of these jobs still have the question open (only Mitti pickups can). Fails closed: a read error → none open. */
export async function openMittiElectricianQuestions(jobIds: string[]): Promise<Set<string>> {
  if (!jobIds.length) return new Set<string>();
  const { data: jobs, error } = await admin.from("jobs").select("id, source, channel, electrician_choice").in("id", jobIds.slice(0, 200)).eq("channel", "installer_sourced");
  if (error) return new Set<string>();
  return openMittiElectricianQuestionsForJobs((jobs ?? []) as MittiElectricianJobRow[]);
}

/** Speed (portal speed step 2B): the same answer from job rows the caller already holds (the installer home's assignment
 *  read carries them) — the installer-sourced rows only, as the read above gives; one round instead of two. */
export async function openMittiElectricianQuestionsForJobs(rows: MittiElectricianJobRow[]): Promise<Set<string>> {
  const open = new Set<string>();
  const jobs = rows.filter((j) => j.channel === "installer_sourced");
  if (!jobs.length) return open;
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
    if (mittiElectricianQuestionOpen({ source: j.source, channel: j.channel, electricianChoice: j.electrician_choice as string | null, hasNomination: has(noms.data, id), hasElectricianAssigned: has(asg.data, id), hasPiesaOffer: has(offers.data, id), usualUsed: has(used.data, id) })) open.add(id);
  }
  return open;
}

/** The installer business assigned to this job that the user belongs to; refuses anyone else. */
async function installerBusinessFor(jobId: string, userId: string): Promise<string> {
  const { data: asg, error } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true);
  if (error) throw new WorkflowError("Couldn't check this job. Please try again.");
  const ids = [...new Set((asg ?? []).map((a) => a.business_id).filter((x): x is string => !!x))];
  if (!ids.length) throw new WorkflowError("This isn't one of your jobs.");
  const { data: mem } = await admin.from("business_members").select("business_id").eq("user_id", userId).eq("active", true).in("business_id", ids).limit(1);
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
  const { data: before } = await admin.from("jobs").select("electrician_choice").eq("id", jobId).single();
  const current = before?.electrician_choice ?? null;
  const claimQuery = admin.from("jobs").update({ electrician_choice: claim }).eq("id", jobId).eq("channel", "installer_sourced");
  const { data: claimed, error } = await (current === null ? claimQuery.is("electrician_choice", null) : claimQuery.eq("electrician_choice", current)).select("id");
  if (error) throw new WorkflowError("Couldn't save your electrician. Please try again.");
  if (!claimed?.length) throw new WorkflowError("The electrician for this job is already chosen.");
  try {
    const { recordJobElectricianChoice } = await import("./job-electrician.server");
    return await recordJobElectricianChoice(jobId, biz, plan, userId);
  } catch (e) {
    await admin.from("jobs").update({ electrician_choice: current }).eq("id", jobId).eq("electrician_choice", claim);
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
  return (await import("./our-lead-piesa-electrician.core")).ourLeadUsualRecId(status.electrician, await withoutOtherInstallersElectricians(approved, biz));
}

/** Part 2b (final review minor 5): an electrician another installer added is that installer's only. The saved usual is
 *  matched by name/licence, so it must never land on an installer-added REC unless THIS installer is actively linked to it.
 *  The added-by column is pending SQL: when it is missing nobody is installer-added. Any other read error fails closed (none kept). */
async function withoutOtherInstallersElectricians<T extends { business_id: string }>(candidates: T[], installerBusinessId: string): Promise<T[]> {
  if (!candidates.length) return candidates;
  const ids = candidates.map((c) => c.business_id);
  const added = (await admin.from("businesses").select("id, added_by_installer_business_id").in("id", ids).not("added_by_installer_business_id", "is", null)) as unknown as { data: { id: string }[] | null; error: { message: string; code?: string } | null };
  if (added.error) { const { isMissingDbObject } = await import("./schema-compat.core"); return isMissingDbObject(added.error) ? candidates : []; }
  const addedIds = new Set((added.data ?? []).map((b) => b.id));
  if (!addedIds.size) return candidates;
  const rels = await admin.from("partner_relationships").select("electrician_business_id").eq("installer_business_id", installerBusinessId).eq("active", true).in("electrician_business_id", [...addedIds]);
  if (rels.error) return [];
  const linked = new Set((rels.data ?? []).map((r) => r.electrician_business_id as string));
  return candidates.filter((c) => !addedIds.has(c.business_id) || linked.has(c.business_id));
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
