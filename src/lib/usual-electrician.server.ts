// Business-scoped settings and job-owned compliance snapshots; no schema change or partner assignment.
import { jobAdmin as admin } from "./job-facts.server"; // speed (Task 11): the admin client; inside the job page bundle it answers from the job's rows
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
 *  Victoria's. Task 5: an electrician PICKED for the job (its nomination) is resolved from that business first.
 *  Installer-supplied jobs only; our leads return null as before. */
export async function mittiElectricianForJob(jobId: string, actorId: string | null, entries: { label: string; value: string | null }[], auditId: string) {
  const answers = contactAnswersFromEntries(entries);
  const { data: job, error } = await admin.from("jobs").select("channel, originating_installer_business_id, source, job_number").eq("id", jobId).maybeSingle();
  if (error) throw new Error("Could not check the installer for this job.");
  if (job?.channel !== "installer_sourced") return null;
  const { resolveElectricianChoice } = await import("./electrician-choice.core");
  const { choice: recorded, workerId: recordedWorkerId } = await (await import("./electrician-choice.server")).readElectricianChoiceRecord(jobId);
  const saved = job.originating_installer_business_id ? await readUsualElectrician(job.originating_installer_business_id) : null;
  const resolvedChoice = resolveElectricianChoice({ recorded, legacy: answers.electricianChoice, usual: saved?.electrician ?? null });
  // Old HIV defaults are kept as history only. Installer quotes use their own usual electrician, or hold.
  const choice = resolvedChoice === "hivic" ? (saved?.electrician ? "usual" : null) : resolvedChoice;
  // Decision 302: HIV's electrician = the standard owner PIESA line from retail settings (349 when unset).
  const { data: rs } = await admin.from("retail_estimator_settings").select("piesa_assessment_inc_gst").eq("is_current", true).maybeSingle();
  const legacy = resolveMittiElectrician({ choice, usual: saved?.electrician ?? null,
    different: { name: answers.electricianName, licence: answers.electricianLicence, priceIncGst: answers.electricianPriceIncGst },
    standardPiesaIncGst: rs?.piesa_assessment_inc_gst == null ? null : Number(rs.piesa_assessment_inc_gst) });
  // Decision 303: a usual / legacy "different" electrician is READY only as an approved REC (price = their onboarded PIESA
  // rate); otherwise the quote holds "Electrician not onboarded: <name>" and the tick issues ONE onboarding invite.
  const { onboardedElectricianResolution, chosenRecResolution, teamElectricianResolution, ELECTRICIAN_ONBOARDING_NEEDED_EVENT } = await import("./rec-onboarded.core");
  // Join ruling (4 Nov 2026): the Team electrician on the job — the one put on it (latest `in_house_electrician_allocated`,
  // the job page's "choose again" included), else the one picked at Add a job — IS the installer's own electrician.
  const teamWorkerId = (await (await import("./in-house-electrician.server")).allocatedWorkerId(jobId)) ?? recordedWorkerId;
  const teamWorker = teamWorkerId && job.originating_installer_business_id ? await teamElectricianFor(teamWorkerId, job.originating_installer_business_id) : null;
  // Task 5 (3 Nov 2026): an electrician PICKED for this job (the nomination the hand-over and the swap use) wins over the
  // saved usual one — a non-usual pick names the right electrician, and an installer with no saved usual is not held.
  const chosenId = teamWorkerId ? null : await (await import("./job-electrician.server")).jobChosenElectrician(jobId);
  const candidates = !teamWorkerId && (chosenId || !(legacy.choice === "hivic" || legacy.needsProfile)) ? await (await import("./rec-onboarded.server")).loadApprovedRecCandidates() : [];
  const chosen = chosenId ? candidates.find((c) => c.business_id === chosenId) ?? null : null;
  // pays_own_electricians OR in_house → the business's flat PIESA line, no REC rate needed; not a held-visit decision.
  const paysOwn = await (await import("./installer-paid-electricians.server")).readInstallerPaidElectricians(job.originating_installer_business_id);
  const resolvedRaw = paysOwn?.release_hold_reason
    ? { ...legacy, ready: false, priceIncGst: null, reasons: [paysOwn.release_hold_reason], needsProfile: false, notOnboarded: null }
    : teamWorkerId ? teamElectricianResolution(legacy, teamWorker)
    : chosen ? chosenRecResolution(legacy, chosen, paysOwn?.piesaIncGst ?? null)
    : onboardedElectricianResolution({ legacy, usual: saved?.electrician ?? null, candidates, flatPiesaIncGst: paysOwn?.piesaIncGst ?? null });
  const listPrice = await (await import("./installer-paid-electricians.server")).installerSafetyCheckPrice(job.originating_installer_business_id);
  const priced = (await import("./safety-check-price.core")).withOwnerSafetyCheckPrice(resolvedRaw, rs?.piesa_assessment_inc_gst ?? null, job.channel, listPrice);
  const resolved = listPrice == null
    ? { ...priced, ready: false, priceIncGst: null, reasons: [(await import("./installer-paid-electricians.core")).IN_HOUSE_PIESA_HOLD_REASON] }
    : priced;
  if (resolved.notOnboarded && job.originating_installer_business_id) {
    const need = { installer_business_id: job.originating_installer_business_id, name: resolved.notOnboarded.name, licence: resolved.notOnboarded.licence, email: resolved.notOnboarded.email, choice: resolved.choice };
    const { data: lastNeed, error: ne } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", ELECTRICIAN_ONBOARDING_NEEDED_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ne) throw new Error("Could not check the job's electrician onboarding history.");
    const same = lastNeed && ["installer_business_id", "name", "licence", "email", "choice"].every((k) => ((lastNeed.details as Record<string, unknown> | null)?.[k] ?? null) === ((need as Record<string, unknown>)[k] ?? null));
    if (!same) await logEvent(jobId, actorId, ELECTRICIAN_ONBOARDING_NEEDED_EVENT, `${resolved.reasons[0]} — REC onboarding invite to be issued once (decision 303)`, need, { internal: true });
  }
  const details = { audit_id: auditId, ...resolved, profile_revision: !chosen && !teamWorkerId && choice === "usual" ? saved?.revision ?? null : null, choice_source: teamWorkerId ? "team_electrician" : chosen ? "add_job_pick" : recorded ? "add_job" : answers.electricianChoice ? "legacy_answer" : "default", declared_not_verified: resolved.source !== "approved_rec" && resolved.source !== "team_worker" };
  const { data: previous, error: pe } = await admin.from("workflow_events").select("details").eq("job_id", jobId)
    .eq("event_type", "mitti_electrician_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pe) throw new Error("Could not check the job's electrician history.");
  const keys = Object.keys(details).sort();
  const signature = (value: unknown) => JSON.stringify(keys.map((k) => [k, (value as Record<string, unknown> | null)?.[k] ?? null]));
  if (signature(previous?.details) !== signature(details)) await logEvent(jobId, actorId, "mitti_electrician_recorded", resolved.ready ? "Ready Check electrician details recorded for compliance (declared, not verified)" : resolved.reasons.join(" · "), details, { internal: true });
  return resolved;
}
/** The Team electrician (partner_workers row on the installer's own business) the quote names; null when they left the Team. */
async function teamElectricianFor(workerId: string, businessId: string) {
  const { data: w, error } = await admin.from("partner_workers").select("id, business_id, full_legal_name, licence_number, rec_number, licence_expires_on, licence_verified_at, approval_status").eq("id", workerId).eq("business_id", businessId).eq("trade_role", "electrician").is("removed_at", null).maybeSingle();
  if (error) throw new Error("Could not check the job's Team electrician.");
  if (!w) return null;
  const { electricianVerified } = await import("./worker-compliance.core");
  return { id: w.id, name: w.full_legal_name, licence: w.licence_number?.trim() || null, businessId: w.business_id, approved: w.approval_status === "approved", verified: electricianVerified(w) };
}
/** A3: the saved usual electrician and whether they are onboarded (approved REC; flat-paid installers need no rate).
 *  Reads candidates only when one is saved. */
export async function readUsualElectricianStatus(businessId: string): Promise<{ electrician: import("./usual-electrician.core").UsualElectrician | null; onboarded: boolean }> {
  const { electrician } = await readUsualElectrician(businessId);
  if (!electrician) return { electrician: null, onboarded: false };
  const candidates = await (await import("./rec-onboarded.server")).loadApprovedRecCandidates();
  const paysOwn = await (await import("./installer-paid-electricians.server")).readInstallerPaidElectricians(businessId);
  if (paysOwn?.release_hold_reason) return { electrician, onboarded: false };
  const flat = paysOwn?.piesaIncGst ?? null;
  const { usualIsOnboarded } = await import("./rec-onboarded.core");
  return { electrician, onboarded: usualIsOnboarded(electrician, candidates, flat) };
}
