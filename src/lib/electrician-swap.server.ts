// Part 2 (Jo 3 Nov 2026): the installer swaps the electrician on its own job before the safety check (PIESA) is done.
// Rules: electrician-swap.core.ts. A swap is the same as handing the job over again: a new active assignment, a NEW
// `own_job_piesa_handed` event with a fresh 2-business-day due date (so the clock and the "not booked" email restart),
// the old link switched off, and the new electrician texted their link. A booked safety check is cancelled (Jo's
// decision) and the new electrician books fresh. The owner is emailed once per cancelled booking (message 7, approved by Jo 3 Nov 2026).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { OWN_JOB_PIESA_HANDED_EVENT, ownJobHandoffKey } from "./own-job-piesa.core";
import {
  OWN_JOB_ELECTRICIAN_SWAPPED_EVENT, OWN_JOB_SWAP_FORM_NOT_MOVED_EVENT, OWN_JOB_SWAP_OLD_ELECTRICIAN_EMAIL_APPROVED,
  OWN_JOB_SWAP_OWNER_EMAIL_APPROVED, OWN_JOB_SWAP_OWNER_PURPOSE, SWAP_SAME, oldElectricianEmail, oldElectricianEmailKey, ownerSwapCancelledEmail, ownerSwapEmailKey, swapProblem,
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

/** The Mitti safety check form (if one exists) goes to the new electrician. Returns why it could not (null = moved or none). Never throws. */
async function moveMittiForm(jobId: string, userId: string, actorId: string, source: string | null, businessId: string): Promise<string | null> {
  try {
    const assessment = await must(admin.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle(), "Form lookup");
    const auditId = (assessment as { external_mitti_id?: string | null } | null)?.external_mitti_id;
    if (!auditId) return null;
    const w = await must(admin.from("partner_workers").select("email").eq("business_id", businessId).eq("profile_id", userId).is("removed_at", null).limit(1).maybeSingle(), "Electrician lookup");
    const real = (w as { email?: string | null } | null)?.email?.trim();
    if (!real) throw new Error("the new electrician has no Mitti email");
    const mitti = await import("./mitti.server");
    const email = source === "qa_test" ? (await import("./onsite-ready-check.core")).TEST_MITTI_ASSIGNEE : real;
    const mittiUserId = await mitti.findMittiUserByEmail(email, mitti.realMittiCall);
    if (!mittiUserId) throw new Error("the new electrician isn't in Mitti yet");
    await mitti.reassignMittiFormTo({ jobId, auditId, kind: "piesa", mittiUserId, email, actorId }, mitti.realMittiCall);
    return null;
  } catch (e) { return (e as Error).message || "unknown problem"; }
}

/** Email the old electrician once ("You're no longer on {address}"). Never throws. */
async function emailOldElectrician(jobId: string, oldBusinessId: string, oldAssignmentId: string, approved: boolean): Promise<string> {
  try {
    const { data: ov } = await admin.from("job_overview").select("property_address, job_number").eq("id", jobId).maybeSingle();
    const address = (ov?.property_address as string | null | undefined) || (ov?.job_number as string | null | undefined) || "this job";
    const mail = oldElectricianEmail({ address });
    const { emailInstallerOffice } = await import("./own-job-piesa-notices.server");
    return (await emailInstallerOffice({ jobId, businessId: oldBusinessId, key: oldElectricianEmailKey(oldAssignmentId), subject: mail.subject, text: mail.text, approved })).status;
  } catch (e) { console.error("old electrician email skipped", jobId, (e as Error).message); return "error"; }
}

/** Email the owner once per cancelled booking (message 7) through the guarded owner-email sender (opt-outs, TEST routing). Never throws. */
async function emailOwnerBookingCancelled(jobId: string, bookingId: string, approved: boolean): Promise<string> {
  try {
    if (!approved) return "not_approved";
    const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", jobId).maybeSingle();
    if (!job?.owner_id) return "no_owner";
    const { data: owner } = await admin.from("owners").select("full_name, email").eq("id", job.owner_id as string).maybeSingle();
    const to = (owner?.email as string | null | undefined)?.trim();
    if (!to) return "no_owner_email";
    const source = (job.source as string | null) ?? null;
    if (source !== "qa_test") {
      const { assertCustomerDeliveryAllowed } = await import("./comms.server");
      try { await assertCustomerDeliveryAllowed(jobId, "Safety check cancelled email"); } catch (e) { return `held: ${(e as Error).message}`; }
    }
    const { data: ov } = await admin.from("job_overview").select("property_address, job_number").eq("id", jobId).maybeSingle();
    const address = (ov?.property_address as string | null | undefined) || (ov?.job_number as string | null | undefined) || "your home";
    const { firstName } = await import("./worker-links.core");
    const first = firstName(owner?.full_name as string | null | undefined);
    return await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({
      jobId, jobSource: source, to, purpose: OWN_JOB_SWAP_OWNER_PURPOSE, key: ownerSwapEmailKey(bookingId), explainBlock: true,
      build: (unsubscribeUrl) => ownerSwapCancelledEmail({ firstName: first, address, unsubscribeUrl, test: source === "qa_test" }),
    });
  } catch (e) { console.error("owner swap email skipped", jobId, (e as Error).message); return "error"; }
}

export const OWN_JOB_SWAP_STARTED_EVENT = "own_job_swap_started";
type OldRow = { id: string; business_id: string | null };
type Resume = { assignmentId: string; old: OldRow[]; bookingIds: string[] };
type SwapFacts = { stage: string; source: string | null; current: string | null; active: ActiveRow[]; userId: string | null; problem: string | null; resume: Resume | null };

/** A swap that got as far as adding the new electrician but didn't finish (so a retry completes it instead of refusing). */
async function unfinishedSwap(jobId: string, stage: string, active: ActiveRow[], newBusinessId: string): Promise<Resume | null> {
  if ((stage !== PIESA_STAGE && stage !== BOOKED_STAGE) || active.length !== 1 || active[0]!.business_id !== newBusinessId) return null;
  const a = active[0]!;
  const started = await must(admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", OWN_JOB_SWAP_STARTED_EVENT).contains("details", { new_assignment_id: a.id }).limit(1), "The swap couldn't be checked");
  if (!(started ?? []).length) return null;
  const finished = await must(admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", OWN_JOB_ELECTRICIAN_SWAPPED_EVENT).contains("details", { assignment_id: a.id }).limit(1), "The swap couldn't be checked");
  if ((finished ?? []).length) return null;
  const d = started![0]!.details as { old?: OldRow[]; confirmed_booking_ids?: string[] } | null;
  return { assignmentId: a.id, old: d?.old ?? [], bookingIds: d?.confirmed_booking_ids ?? [] };
}

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
  // At the PIESA stages "current" is the ACTIVE electrician only: after "can't do this one" there is none (the nomination stays open), so the same electrician can be picked again. Before the hand-over there is no assignment, so the choice is the current one.
  const current = active[0]?.business_id ?? (stage === PIESA_STAGE || stage === BOOKED_STAGE ? null : await (await import("./job-electrician.server")).jobChosenElectrician(jobId));
  const el = await eligibility(installerBusinessId, newElectricianBusinessId);
  const problem = swapProblem({ piesaDone: done, linkedActive: el.linkedActive, onboarded: el.onboarded, same: current === newElectricianBusinessId });
  const resume = problem === SWAP_SAME ? await unfinishedSwap(jobId, stage, active, newElectricianBusinessId) : null;
  return { stage, source: (job.source as string | null) ?? null, current, active, userId: el.userId, problem: resume ? null : problem, resume };
}

/**
 * Change the electrician on the installer's own job. Everything is checked before anything is written. If it stops part
 * way, the job is either unchanged or waiting for the new electrician; a retry with the same electrician FINISHES the
 * swap (every step after adding the new electrician can be repeated without doing anything twice).
 */
export async function installerSwapElectrician(jobId: string, installerBusinessId: string, newElectricianBusinessId: string, actorId: string, opts: { now?: Date; oldEmailApproved?: boolean; ownerEmailApproved?: boolean; afterInsert?: () => Promise<void> } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const f = await swapPreflight(jobId, installerBusinessId, newElectricianBusinessId);
  if (f.problem) throw new WorkflowError(f.problem);
  const { stage, active, current } = f;
  const userId = f.userId as string;
  const { logEvent } = await import("./workflow.server");
  const { recordJobElectricianChoice } = await import("./job-electrician.server");
  const summary = "Installer changed the electrician";

  // The choice: add the new one, then end the ones that were open before. Repeating it is harmless.
  const choose = async () => {
    const open = ((await must(admin.from("electrician_nominations").select("id, business_id").eq("job_id", jobId).is("ended_at", null), "Nominations couldn't be read")) ?? []) as { id: string; business_id: string | null }[];
    const older = open.filter((n) => n.business_id !== newElectricianBusinessId).map((n) => n.id);
    if (!open.some((n) => n.business_id === newElectricianBusinessId)) await recordJobElectricianChoice(jobId, installerBusinessId, { mode: "mine", business_id: newElectricianBusinessId }, actorId, { summary });
    if (older.length) { const t = now.toISOString(); await must(admin.from("electrician_nominations").update({ ended_at: t, updated_at: t }).in("id", older).select("id"), "The old choice couldn't be ended"); }
  };

  // Not handed over yet (earlier stage): only the choice changes; the normal hand-over uses it.
  if (stage !== PIESA_STAGE && stage !== BOOKED_STAGE) {
    await choose();
    await logEvent(jobId, actorId, OWN_JOB_ELECTRICIAN_SWAPPED_EVENT, "Installer changed the electrician before the safety check (PIESA) was handed over", { from: current, to: newElectricianBusinessId }, { internal: true });
    return;
  }

  let newAssignmentId: string;
  let old: OldRow[];
  let cancelledCount = 0;
  let cancelledConfirmed: string[] = []; // confirmed bookings this swap cancelled: the owner is told once for each
  if (f.resume) {
    newAssignmentId = f.resume.assignmentId; old = f.resume.old;
    if (f.resume.bookingIds.length) cancelledConfirmed = ((await must(admin.from("bookings").select("id").in("id", f.resume.bookingIds).eq("status", "cancelled"), "Bookings couldn't be read")) ?? []).map((b) => b.id as string);
  }
  else {
    old = active.map((a) => ({ id: a.id, business_id: a.business_id }));
    newAssignmentId = crypto.randomUUID();
    const confirmedIds = stage === BOOKED_STAGE ? ((await must(admin.from("bookings").select("id").eq("job_id", jobId).eq("kind", "assessment").eq("status", "confirmed"), "The safety check booking couldn't be read")) ?? []).map((b) => b.id as string) : [];
    // A marker so a retry can finish this swap if it stops part way.
    await logEvent(jobId, actorId, OWN_JOB_SWAP_STARTED_EVENT, "Installer is changing the electrician", { new_assignment_id: newAssignmentId, to: newElectricianBusinessId, old, confirmed_booking_ids: confirmedIds }, { internal: true });
    // 1. A booked safety check is cancelled and the job goes back to "to book". Stage first: if it fails nothing else has changed.
    if (stage === BOOKED_STAGE) await (await import("./workflow.server")).transition(jobId, PIESA_STAGE, actorId, "Electrician changed by the installer: the safety check (PIESA) booking is cancelled and the new electrician books it", { own_job: true });
    const cancelled = (await must(admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).eq("kind", "assessment").in("status", ["proposed", "confirmed"]).select("id"), "The safety check booking couldn't be cancelled")) ?? [];
    cancelledCount = cancelled.length;
    cancelledConfirmed = cancelled.map((c) => c.id as string).filter((x) => confirmedIds.includes(x));
    if (old.length) await must(admin.from("job_assignments").update({ booking_confirmed_at: null }).in("id", old.map((a) => a.id)).select("id"), "The booking marker couldn't be cleared");
    // 2. End the old assignment(s), add the new one (put the old back if adding fails).
    if (old.length) await must(admin.from("job_assignments").update({ active: false, ended_at: now.toISOString(), end_reason: "reassigned (installer changed the electrician)" }).in("id", old.map((a) => a.id)).eq("active", true).select("id"), "The old electrician couldn't be ended");
    const { error: ie } = await admin.from("job_assignments").insert({ id: newAssignmentId, job_id: jobId, role: "electrician", business_id: newElectricianBusinessId, user_id: userId, active: true });
    if (ie) {
      if (old.length) await admin.from("job_assignments").update({ active: true, ended_at: null, end_reason: null }).in("id", old.map((a) => a.id));
      throw new WorkflowError(`The new electrician couldn't be added: ${ie.message}`);
    }
    // Two people changing it at once: the earliest new row wins, the other removes its own and stops.
    const rows = (await must(admin.from("job_assignments").select("id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).order("assigned_at").order("id"), "The electrician couldn't be checked")) ?? [];
    if (rows[0]?.id !== newAssignmentId) {
      await admin.from("job_assignments").delete().eq("id", newAssignmentId);
      throw new WorkflowError("Someone else just changed the electrician — refresh.");
    }
  }

  // From here every step can be repeated. 3. The choice; the old electrician loses the link, the owner's contact details and open proposed times.
  await choose();
  const { revokeElectricianLinks } = await import("./electrician-link.server");
  for (const bid of new Set(old.map((o) => o.business_id).filter((b): b is string => !!b && b !== newElectricianBusinessId))) await revokeElectricianLinks(jobId, "swapped", { electricianBusinessId: bid }, now);
  if (old.length) await must(admin.from("contact_releases").update({ revoked_at: now.toISOString() }).in("assignment_id", old.map((o) => o.id)).is("revoked_at", null).select("id"), "The old electrician's access couldn't be ended");
  await must(admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "assessment").eq("status", "proposed").select("id"), "Open times couldn't be cleared");
  // 4. A NEW hand-over event: fresh 2-business-day due date (restarts the clock and the "not booked" email). Once per new assignment.
  const [{ addMelbourneBusinessDays }, { latestReopenAt }] = await Promise.all([import("./melbourne-time.core"), import("./repeat-piesa.server")]);
  const handed = await must(admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", OWN_JOB_PIESA_HANDED_EVENT).contains("details", { assignment_id: newAssignmentId }).limit(1), "The hand-over couldn't be checked");
  if (!(handed ?? []).length) {
    const key = ownJobHandoffKey(jobId, await latestReopenAt(jobId));
    await logEvent(jobId, actorId, OWN_JOB_PIESA_HANDED_EVENT, "Safety check (PIESA) handed to the installer's new electrician to book within 2 business days",
      { key, assignment_id: newAssignmentId, electrician_business_id: newElectricianBusinessId, electrician_user_id: userId, due_at: addMelbourneBusinessDays(now.toISOString(), 2), swapped: true, previous_electrician_business_id: current }, { internal: true });
  }
  // 5. The Mitti form moves; a problem is one office item (logged after the hand-over so it stays the newest item).
  const formProblem = await moveMittiForm(jobId, userId, actorId, f.source, newElectricianBusinessId);
  if (formProblem) {
    const { data: b } = await admin.from("businesses").select("name, trading_name").eq("id", newElectricianBusinessId).maybeSingle();
    const name = (b?.trading_name as string | null | undefined) || (b?.name as string | null | undefined) || "the new electrician";
    await logEvent(jobId, actorId, OWN_JOB_SWAP_FORM_NOT_MOVED_EVENT, `The safety check form wasn't moved to ${name}: ${formProblem}. Needs Home Insulation Victoria`, { reason: formProblem, electrician_name: name, electrician_business_id: newElectricianBusinessId, needs_office: true }, { internal: true })
      .catch((e) => console.error("form-not-moved item not logged", jobId, (e as Error).message));
  }
  // 6. The old electrician is emailed once (held wording).
  const oldBusiness = old.find((o) => o.business_id && o.business_id !== newElectricianBusinessId) ?? null;
  const oldEmail = oldBusiness ? await emailOldElectrician(jobId, oldBusiness.business_id as string, oldBusiness.id, opts.oldEmailApproved ?? OWN_JOB_SWAP_OLD_ELECTRICIAN_EMAIL_APPROVED) : "no_old_electrician";
  // 6b. The owner is told once for each confirmed booking this swap cancelled (stable key per booking). Never fails the swap.
  const ownerEmails: string[] = [];
  for (const bid of cancelledConfirmed) ownerEmails.push(await emailOwnerBookingCancelled(jobId, bid, opts.ownerEmailApproved ?? OWN_JOB_SWAP_OWNER_EMAIL_APPROVED));
  // 7. Done marker (a retry stops finishing once this exists), then the new electrician's text with their link.
  await logEvent(jobId, actorId, OWN_JOB_ELECTRICIAN_SWAPPED_EVENT, summary + (cancelledCount ? " (the booked safety check was cancelled)" : ""),
    { assignment_id: newAssignmentId, from: current, to: newElectricianBusinessId, booking_cancelled: cancelledCount > 0, old_electrician_email: oldEmail, owner_email: ownerEmails.length ? ownerEmails : "no_booking_cancelled" }, { internal: true });
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
  const stage = job.stage as string;
  const current = (active?.[0]?.business_id as string | null | undefined) ?? (stage === PIESA_STAGE || stage === BOOKED_STAGE ? null : await (await import("./job-electrician.server")).jobChosenElectrician(jobId)); // at the PIESA stages: active electrician only
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
