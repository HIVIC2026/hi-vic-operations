// Part 2 (Jo 3 Nov 2026): the installer swaps the electrician on its own job before the safety check (PIESA) is done.
// Rules: electrician-swap.core.ts. A swap is the same as handing the job over again: a new active assignment, a NEW
// `own_job_piesa_handed` event with a fresh 2-business-day due date (so the clock and the "not booked" email restart),
// the old link switched off, and the new electrician texted their link. A booked safety check is cancelled (Jo's
// decision) and the new electrician books fresh. Nothing is sent to the owner: no approved wording exists for it yet.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { OWN_JOB_PIESA_HANDED_EVENT, ownJobHandoffKey } from "./own-job-piesa.core";
import {
  OWN_JOB_ELECTRICIAN_SWAPPED_EVENT, OWN_JOB_SWAP_FORM_NOT_MOVED_EVENT, OWN_JOB_SWAP_OLD_ELECTRICIAN_EMAIL_APPROVED,
  oldElectricianEmail, oldElectricianEmailKey, swapProblem,
} from "./electrician-swap.core";

const PIESA_STAGE = "piesa_and_install_window_pending";
const BOOKED_STAGE = "piesa_scheduled";

type ActiveRow = { id: string; business_id: string | null; user_id: string };

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new WorkflowError(`${what}: ${error.message}`);
  return data;
}

/** True once the safety check has been done: the job is past "PIESA booked", or this round's PIESA record exists. */
async function piesaDone(jobId: string, stage: string): Promise<boolean> {
  const { piesaDoneAtStage } = await import("./electrician-link.core");
  if (piesaDoneAtStage(stage)) return true;
  const since = await (await import("./repeat-piesa.server")).latestReopenAt(jobId);
  let q = admin.from("piesa_records").select("id").eq("job_id", jobId);
  if (since) q = q.gt("created_at", since);
  const rows = await must(q.limit(1), "The safety check couldn't be checked");
  return (rows ?? []).length > 0;
}

/** Linked to this installer and onboarded: an approved, active REC with an approved electrician who has a portal login. */
export async function eligibility(installerBusinessId: string, electricianBusinessId: string): Promise<{ linkedActive: boolean; onboarded: boolean; userId: string | null }> {
  const rel = await must(admin.from("partner_relationships").select("electrician_business_id").eq("installer_business_id", installerBusinessId).eq("electrician_business_id", electricianBusinessId).eq("active", true).limit(1), "The electrician couldn't be checked");
  const linkedActive = (rel ?? []).length > 0;
  if (!linkedActive) return { linkedActive, onboarded: false, userId: null };
  const [{ loadApprovedRecCandidates }, { approvedRecBlocker }, { electricianProfile }] = await Promise.all([import("./rec-onboarded.server"), import("./rec-onboarded.core"), import("./own-job-piesa.server")]);
  const cand = (await loadApprovedRecCandidates()).find((c) => c.business_id === electricianBusinessId) ?? null;
  const userId = cand && !approvedRecBlocker(cand, { rateNotNeeded: true }) ? await electricianProfile(electricianBusinessId) : null;
  return { linkedActive, onboarded: !!userId, userId };
}

/** The Mitti safety check form (if one exists) goes to the new electrician. A problem here never undoes the swap: one office item. */
async function moveMittiForm(jobId: string, userId: string, actorId: string, source: string | null, businessId: string) {
  try {
    const assessment = await must(admin.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle(), "Form lookup");
    const auditId = (assessment as { external_mitti_id?: string | null } | null)?.external_mitti_id;
    if (!auditId) return;
    const w = await must(admin.from("partner_workers").select("email").eq("business_id", businessId).eq("profile_id", userId).is("removed_at", null).limit(1).maybeSingle(), "Electrician lookup");
    const real = (w as { email?: string | null } | null)?.email?.trim();
    if (!real) throw new Error("the new electrician has no Mitti email");
    const mitti = await import("./mitti.server");
    const email = source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : real;
    const mittiUserId = await mitti.findMittiUserByEmail(email, mitti.realMittiCall);
    if (!mittiUserId) throw new Error("the new electrician isn't in Mitti yet");
    await mitti.reassignMittiFormTo({ jobId, auditId, kind: "piesa", mittiUserId, email, actorId }, mitti.realMittiCall);
  } catch (e) {
    const { logEvent } = await import("./workflow.server");
    await logEvent(jobId, actorId, OWN_JOB_SWAP_FORM_NOT_MOVED_EVENT, `The safety check form wasn't moved to the new electrician: ${(e as Error).message}. Needs Home Insulation Victoria`, { reason: (e as Error).message, needs_office: true }, { internal: true });
  }
}

/** Email the old electrician once ("You're no longer on {address}"). Held until Jo approves the wording; never throws. */
async function emailOldElectrician(jobId: string, oldBusinessId: string, oldAssignmentId: string, approved: boolean): Promise<string> {
  try {
    const { data: ov } = await admin.from("job_overview").select("property_address, job_number").eq("id", jobId).maybeSingle();
    const address = (ov?.property_address as string | null | undefined) || (ov?.job_number as string | null | undefined) || "this job";
    const mail = oldElectricianEmail({ address });
    const { emailInstallerOffice } = await import("./own-job-piesa-notices.server");
    return (await emailInstallerOffice({ jobId, businessId: oldBusinessId, key: oldElectricianEmailKey(oldAssignmentId), subject: mail.subject, text: mail.text, approved })).status;
  } catch (e) { console.error("old electrician email skipped", jobId, (e as Error).message); return "error"; }
}

type SwapFacts = { stage: string; source: string | null; current: string | null; active: ActiveRow[]; userId: string | null; problem: string | null };

/** Read-only: everything the swap needs and the reason it can't go ahead (null = fine). Throws for "not your job". */
export async function swapPreflight(jobId: string, installerBusinessId: string, newElectricianBusinessId: string): Promise<SwapFacts> {
  const job = await must(admin.from("jobs").select("stage, deleted_at, source, originating_installer_business_id").eq("id", jobId).maybeSingle(), "The job couldn't be read");
  if (!job || job.deleted_at || job.originating_installer_business_id !== installerBusinessId) throw new WorkflowError("Only the installer who supplied this job can change the electrician.");
  const { ownJobCallAndBook } = await import("./own-job-piesa.server");
  const own = await ownJobCallAndBook(jobId);
  if (own === null) throw new WorkflowError("Couldn't check whose job this is — please try again.");
  if (!own) throw new WorkflowError("This is not your own job.");
  const stage = job.stage as string;
  const done = await piesaDone(jobId, stage);
  const active = ((await must(admin.from("job_assignments").select("id, business_id, user_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true), "The electrician couldn't be read")) ?? []) as ActiveRow[];
  const current = active[0]?.business_id ?? (await (await import("./job-electrician.server")).jobChosenElectrician(jobId));
  const el = await eligibility(installerBusinessId, newElectricianBusinessId);
  const problem = swapProblem({ piesaDone: done, linkedActive: el.linkedActive, onboarded: el.onboarded, same: current === newElectricianBusinessId });
  return { stage, source: (job.source as string | null) ?? null, current, active, userId: el.userId, problem };
}

/**
 * Change the electrician on the installer's own job. Everything is checked before anything is written. Retry-safe: a
 * failure part-way leaves the job waiting for an electrician to book (an old booking, if any, is already cancelled),
 * so the installer can simply try again.
 */
export async function installerSwapElectrician(jobId: string, installerBusinessId: string, newElectricianBusinessId: string, actorId: string, opts: { now?: Date; oldEmailApproved?: boolean } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const f = await swapPreflight(jobId, installerBusinessId, newElectricianBusinessId);
  if (f.problem) throw new WorkflowError(f.problem);
  const { stage, active, current } = f;
  const el = { userId: f.userId };
  const job = { source: f.source };
  const { logEvent } = await import("./workflow.server");

  // Not handed over yet (earlier stage): only the choice changes; the normal hand-over uses it.
  const handedOver = stage === PIESA_STAGE || stage === BOOKED_STAGE;
  const openNoms = ((await must(admin.from("electrician_nominations").select("id").eq("job_id", jobId).is("ended_at", null), "Nominations couldn't be read")) ?? []).map((n) => n.id as string);
  const endNominations = async () => { if (openNoms.length) { const t = now.toISOString(); await must(admin.from("electrician_nominations").update({ ended_at: t, updated_at: t }).in("id", openNoms).select("id"), "The old choice couldn't be ended"); } };
  const choose = async () => { await (await import("./job-electrician.server")).recordJobElectricianChoice(jobId, installerBusinessId, { mode: "mine", business_id: newElectricianBusinessId }, actorId); await endNominations(); };
  if (!handedOver) { await choose(); await logEvent(jobId, actorId, OWN_JOB_ELECTRICIAN_SWAPPED_EVENT, "Installer changed the electrician before the safety check (PIESA) was handed over", { from: current, to: newElectricianBusinessId }, { internal: true }); return; }

  // 1. A booked safety check is cancelled and the job goes back to "to book". Stage first: if it fails nothing else has changed.
  if (stage === BOOKED_STAGE) await (await import("./workflow.server")).transition(jobId, PIESA_STAGE, actorId, "Electrician changed by the installer: the safety check (PIESA) booking is cancelled and the new electrician books it", { own_job: true });
  const cancelled = (await must(admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).eq("kind", "assessment").in("status", ["proposed", "confirmed"]).select("id"), "The safety check booking couldn't be cancelled")) ?? [];
  if (active.length) await must(admin.from("job_assignments").update({ booking_confirmed_at: null }).in("id", active.map((a) => a.id)).select("id"), "The booking marker couldn't be cleared");
  // 2. The choice, then the assignment (end the old, add the new; put the old back if adding fails).
  await choose();
  const oldIds = active.map((a) => a.id);
  if (oldIds.length) await must(admin.from("job_assignments").update({ active: false, ended_at: now.toISOString(), end_reason: "reassigned (installer changed the electrician)" }).in("id", oldIds).eq("active", true).select("id"), "The old electrician couldn't be ended");
  const { data: ins, error: ie } = await admin.from("job_assignments").insert({ job_id: jobId, role: "electrician", business_id: newElectricianBusinessId, user_id: el.userId as string, active: true }).select("id").single();
  if (ie || !ins) {
    if (oldIds.length) await admin.from("job_assignments").update({ active: true, ended_at: null, end_reason: null }).in("id", oldIds);
    throw new WorkflowError(`The new electrician couldn't be added: ${ie?.message ?? "no row"}`);
  }
  // 3. The old electrician loses the link, the owner's contact details and any open proposed times.
  const { revokeElectricianLinks } = await import("./electrician-link.server");
  await revokeElectricianLinks(jobId, "swapped", {}, now);
  if (oldIds.length) await must(admin.from("contact_releases").update({ revoked_at: now.toISOString() }).in("assignment_id", oldIds).is("revoked_at", null).select("id"), "The old electrician's access couldn't be ended");
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "assessment").eq("status", "proposed");
  // 4. The Mitti form moves; a problem there is one office item.
  await moveMittiForm(jobId, el.userId as string, actorId, (job.source as string | null) ?? null, newElectricianBusinessId);
  // 5. A NEW hand-over event: fresh 2-business-day due date (restarts the clock and the "not booked" email).
  const [{ addMelbourneBusinessDays }, { latestReopenAt }] = await Promise.all([import("./melbourne-time.core"), import("./repeat-piesa.server")]);
  const key = ownJobHandoffKey(jobId, await latestReopenAt(jobId));
  await logEvent(jobId, actorId, OWN_JOB_PIESA_HANDED_EVENT, "Safety check (PIESA) handed to the installer's new electrician to book within 2 business days",
    { key, electrician_business_id: newElectricianBusinessId, electrician_user_id: el.userId, due_at: addMelbourneBusinessDays(now.toISOString(), 2), swapped: true, previous_electrician_business_id: current }, { internal: true });
  const oldBusiness = active.find((a) => a.business_id && a.business_id !== newElectricianBusinessId) ?? null;
  const oldEmail = oldBusiness ? await emailOldElectrician(jobId, oldBusiness.business_id as string, oldBusiness.id, opts.oldEmailApproved ?? OWN_JOB_SWAP_OLD_ELECTRICIAN_EMAIL_APPROVED) : "no_old_electrician";
  await logEvent(jobId, actorId, OWN_JOB_ELECTRICIAN_SWAPPED_EVENT, `Installer changed the electrician${cancelled.length ? " (the booked safety check was cancelled)" : ""}`,
    { from: current, to: newElectricianBusinessId, booking_cancelled: cancelled.length > 0, old_electrician_email: oldEmail }, { internal: true });
  // 6. The new electrician's text with their link (and the installer office email). Retried by the hand-over sweep if it fails.
  await (await import("./own-job-piesa-notices.server")).sendOwnJobPiesaNotices(jobId).catch((e) => console.error("own job safety check notices skipped", jobId, (e as Error).message));
}

/** For the job page: whether this installer business may change the electrician now, and who they could pick. Nothing throws for "no". */
export async function swapOptions(jobId: string, installerBusinessId: string): Promise<{ allowed: boolean; current: string | null; options: { businessId: string; name: string }[] }> {
  const no = { allowed: false, current: null, options: [] };
  const { data: job, error } = await admin.from("jobs").select("stage, deleted_at, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (error || !job || job.deleted_at || job.originating_installer_business_id !== installerBusinessId) return no;
  if ((await (await import("./own-job-piesa.server")).ownJobCallAndBook(jobId)) !== true) return no;
  if (await piesaDone(jobId, job.stage as string)) return no;
  const rels = (await must(admin.from("partner_relationships").select("electrician_business_id").eq("installer_business_id", installerBusinessId).eq("active", true), "Electricians couldn't be read")) ?? [];
  const names = rels.length ? (await must(admin.from("businesses").select("id, name, trading_name").in("id", rels.map((r) => r.electrician_business_id as string)), "Electricians couldn't be read")) ?? [] : [];
  const active = await must(admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true), "The electrician couldn't be read");
  const current = (active?.[0]?.business_id as string | null | undefined) ?? (await (await import("./job-electrician.server")).jobChosenElectrician(jobId));
  const { displayName } = await import("./display-name.core");
  const options: { businessId: string; name: string }[] = [];
  for (const r of rels) {
    const bid = r.electrician_business_id as string;
    if (bid === current) continue;
    if (!(await eligibility(installerBusinessId, bid)).onboarded) continue;
    const n = names.find((x) => x.id === bid);
    options.push({ businessId: bid, name: displayName(n?.trading_name || n?.name) || "Your electrician" });
  }
  return { allowed: true, current, options };
}
