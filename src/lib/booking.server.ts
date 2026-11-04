// Single path that writes a confirmed booking (direct booking or accepted appointment proposal).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, commercialBlocker, paymentGate, getStage, logEvent, piesaStatus, transition } from "./workflow.server";
import { installationDateBlocker, STAGE_LABEL, type Stage } from "./workflow";
import { installEndAt } from "./install-days.core";
import { setInstallDueDate } from "./invoice-dates.server";
import { autoAdvanceJob } from "./autoadvance.server";

export type BookingKind = "assessment" | "ready_check" | "rectification" | "installation";

export async function validateBooking(jobId: string, kind: BookingKind, start: string, actorId: string | null, proposedWorkerId?: string) {
  const need = kind === "installation" || kind === "ready_check" ? "installer" : "electrician";
  const stage = await getStage(jobId);
  const map: Record<BookingKind, [Stage[], Stage]> = {
    // "assessment" booking kind = the PIESA visit (legacy enum name). Only after the PIESA gate.
    assessment: [["piesa_and_install_window_pending", "piesa_scheduled"], "piesa_scheduled"],
    ready_check: [["ready_check_ready_to_schedule", "ready_check_scheduled"], "ready_check_scheduled"],
    rectification: [["rectification_scheduling", "rectification_booked"], "rectification_booked"],
    installation: [["installation_scheduling", "installation_booked"], "installation_booked"],
  };
  if (kind === "assessment" && !["piesa_and_install_window_pending", "piesa_scheduled"].includes(stage)) throw new WorkflowError("The PIESA can only be booked after the confirmed quote is approved and the payment option is cleared.");
  if (kind === "assessment") {
    const { piesaRequestFacts } = await import("./workflow.server");
    const { piesaRequestBlockers } = await import("./payment-gate.core");
    const gate = piesaRequestBlockers(await piesaRequestFacts(jobId));
    if (gate.length) throw new WorkflowError(`The PIESA cannot be booked yet: ${gate.join(" ")}`);
    if(!proposedWorkerId){const teamBlocker = await (await import("./in-house-electrician.server")).inHousePiesaBookingBlockerFor(jobId);
    if (teamBlocker) throw new WorkflowError(teamBlocker);}
  }
  const [allowed, target] = map[kind];
  if (!allowed.includes(stage)) throw new WorkflowError(`A ${kind} booking can't be made at ${STAGE_LABEL[stage]}.`);
  const { data: contractor } = await admin.from("job_assignments").select("id, user_id, business_id, businesses(business_type, onboarding_status, is_active, capabilities)").eq("job_id", jobId).eq("role", need).eq("active", true).maybeSingle();
  if (!contractor && !proposedWorkerId) throw new WorkflowError(`No ${need} assigned yet.`);
  if (kind === "ready_check") {
    if(!contractor)throw new WorkflowError('No installer assigned yet.');
    const business = contractor.businesses as { business_type: string; onboarding_status: string; is_active: boolean; capabilities: string[] | null } | null;
    if (!contractor.business_id || !business?.is_active || business.onboarding_status !== "approved" || (business.business_type !== "eec_installer" && !business.capabilities?.includes("installer")))
      throw new WorkflowError("The Ready Check must be assigned to an approved installer.");
    const { requireApprovedPartner } = await import("./pilot.server");
    await requireApprovedPartner(contractor.business_id);
  }
  if (kind === "installation") {
    const { clearanceFacts } = await import("./allocation.server");
    const { electricalClearance, installationCoordinationBlocker } = await import("./allocation.core");
    const cb0 = installationCoordinationBlocker(electricalClearance(await clearanceFacts(jobId)));
    if (cb0) throw new WorkflowError(cb0);
    const ps = await piesaStatus(jobId);
    const blocked = installationDateBlocker(ps, start);
    if (blocked) throw new WorkflowError(blocked);
    // 30-day hard gate on every path: official PIESA date + 30 days (decision 316: never the fixes / Section C date).
    const { installWindowDeadline, installDayOutsideWindow, NEW_PIESA_NEEDED } = await import("./install-days.core");
    const c0 = electricalClearance(await clearanceFacts(jobId));
    const dl = installWindowDeadline(c0.timingDate, (ps as { install_deadline?: string | null } | null)?.install_deadline ?? null);
    if (installDayOutsideWindow(start, dl)) throw new WorkflowError(dl ? `Installation must be on or before ${dl} (30 days from the safety check (PIESA)). If that has passed: ${NEW_PIESA_NEEDED}.` : "Installation cannot be booked: no electrical clearance date.");
    const { bookingLeadBlocker } = await import("./esc.core");
    const lead = bookingLeadBlocker(start, new Date().toISOString());
    if (lead) throw new WorkflowError(lead);
    // Decision 296: no install day (first booking or a move) until the owner has confirmed the current PIESA on their secure link.
    const ob = await (await import("./piesa-owner-confirm.server")).ownerPiesaConfirmationBlockerFor(jobId);
    if (ob) throw new WorkflowError(ob);
  }
  // Part 9 Task 8 (Jo 2 Nov 2026): insurance is a hard block on EVERY booking kind — the trade business's public liability
  // ($5m+, office-verified) and workers comp must be in order (business-docs.server, fails closed on a read error); and the
  // safety check's electrician must hold a verified, unexpired licence + REC (electricianVerified) on every job, not only
  // the in-house path. Part 9 Task 9: the people on the booking must be on file (DOB + mobile, CII / licence).
  await bookingComplianceGate(jobId, kind, contractor?.business_id ?? null, proposedWorkerId ?? null, { reschedule: stage === target, start });
  if (kind !== "ready_check") { const cb = await commercialBlocker(jobId); if (cb) throw new WorkflowError(`Blocked: ${cb}`); }
  if (kind !== "ready_check") { const g = await paymentGate(jobId); if (!g.cleared) throw new WorkflowError(`Blocked: ${g.blocker}`); }
  // Decision 366 (audit F03): the electrical fixes are paid in full before their visit is booked (every booking path).
  if (kind === "rectification") {
    const { readInHouseDispatchState } = await import("./in-house-suppression.server");
    const { partnerBillsRectification } = await import("./in-house.core");
    const state = await readInHouseDispatchState([jobId]);
    if (state.failed) throw new WorkflowError("Couldn't check the job's partner — please try again.");
    let partnerBilled = false;
    if (state.held.has(jobId)) {
      const { data: installer, error } = await admin.from("job_assignments").select("businesses(in_house, rectification_billed_by)").eq("job_id", jobId).eq("role", "installer").eq("active", true).single();
      if (error || !installer?.businesses) throw new WorkflowError("Couldn't check the job's partner — please try again.");
      partnerBilled = partnerBillsRectification(installer.businesses as unknown as import("./in-house.core").InHouseBusiness);
    }
    if (!partnerBilled) { const blocker = await (await import("./payments.server")).fixesPaymentBlockerFor(jobId); if (blocker) throw new WorkflowError(`Blocked: ${blocker}`); }
  }
  // Jo 26 Oct 2026: the install is booked only after the 10% install deposit is paid (the PIESA fee never unlocks it).
  if (kind === "installation") { const db = await (await import("./payments.server")).installDepositBlockerFor(jobId); if (db) throw new WorkflowError(`Blocked: ${db}`); }
  { const { jobDeletedBlocker } = await import("./job-live.server"); const del = await jobDeletedBlocker(jobId); if (del) throw new WorkflowError(del); }
  // Guard BEFORE writing: a booking must never exist when the job cannot enter the booked stage (e.g. Gate A not signed).
  // The only booking-dependent Ready Check blocker is excluded here because the booking is what we are about to write.
  if (stage !== target) {
    const { stageEntryBlockers, READY_CHECK_BOOKING_RECORD_BLOCKER } = await import("./workflow.server");
    const pre = (await stageEntryBlockers(jobId, target, actorId)).filter((b) => b !== READY_CHECK_BOOKING_RECORD_BLOCKER);
    if (pre.length) throw new WorkflowError(`Blocked: ${pre.join(" • ")}`);
  }
  return {stage,target};
}
export async function confirmBooking(jobId: string, kind: BookingKind, start: string, actorId: string | null, roleLabel: string, notes?: string | null) {
  const {stage,target}=await validateBooking(jobId,kind,start,actorId);
  const need=kind==='installation'||kind==='ready_check'?'installer':'electrician';
  const {data:contractor,error:contractorError}=await admin.from('job_assignments').select('id,user_id,business_id').eq('job_id',jobId).eq('role',need).eq('active',true).maybeSingle();
  if(contractorError||!contractor)throw new WorkflowError('Assigned contractor could not be read.');
  // Decision 325: a direct reschedule of a booked install day (O42) needs the start it replaces.
  const priorInstallStart = kind === "installation" && stage === target
    ? (await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle()).data?.scheduled_start ?? null
    : null;
  await admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).eq("kind", kind).in("status", ["proposed", "confirmed"]);
  // Jo 27 Oct 2026 (install-days rule): an install day runs 8am–4pm Melbourne; the installer picks the exact arrival
  // time, so scheduled_end is always the day's 4pm end — set on every install booking, create or move.
  const { data: inserted, error: insertError } = await admin.from("bookings").insert({ job_id: jobId, kind, contractor_id: contractor.user_id, assignment_id: contractor.id, business_id: contractor.business_id, scheduled_start: start, scheduled_end: kind === "installation" ? installEndAt(start) : null, booked_by: actorId, notes: notes ?? null, status: "confirmed" }).select("id").single();
  if (insertError || !inserted) throw new Error(`Booking could not be saved: ${insertError?.message ?? "no row returned"}`);
  const nowIso = new Date().toISOString();
  await admin.from("job_assignments").update({ booking_confirmed_at: nowIso }).eq("id", contractor.id).is("booking_confirmed_at", null);
  if (kind === "installation") {
    await setInstallDueDate(jobId, start, actorId);
    const { regenerateEscNotification } = await import("./esc.server");
    await regenerateEscNotification(jobId, actorId);
  }
  const when = new Date(start).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
  if (stage === target) await logEvent(jobId, actorId, "booking_rescheduled", `${kind === "ready_check" ? "Ready Check" : kind === "assessment" ? "PIESA" : kind} rescheduled to ${when} by ${roleLabel}`, { assignment_id: contractor.id, installer_user_id: contractor.user_id, installer_business_id: contractor.business_id });
  else {
    try { await transition(jobId, target, actorId, `${kind === "ready_check" ? "Ready Check" : kind === "assessment" ? "PIESA" : kind.charAt(0).toUpperCase() + kind.slice(1)} booked for ${when} by ${roleLabel}`, { assignment_id: contractor.id, installer_user_id: contractor.user_id, installer_business_id: contractor.business_id, scheduled_start: start }); }
    catch (e) {
      // The stage could not move: withdraw the booking just written so no "booked but not scheduled" state remains.
      await admin.from("bookings").update({ status: "cancelled" }).eq("id", inserted.id);
      await admin.from("job_assignments").update({ booking_confirmed_at: null }).eq("id", contractor.id).eq("booking_confirmed_at", nowIso);
      throw e;
    }
  }
  if (kind === "assessment") {
    // Installer planning visibility only — never an installation booking.
    const held=await (await import('./in-house-suppression.server')).readInHouseDispatchState([jobId]);
    if(held.failed)throw new WorkflowError('Could not check electrician booking notice.');
    if(held.held.has(jobId))await (await import('./in-house-electrician-booked.server')).notifyInHouseElectricianBooked(jobId,inserted.id).catch(e=>console.error('Electrician booked notice pending',e));
    const { INSTALLER_PLANNING_NOTICE } = await import("./allocation.core");
    const { data: inst } = await admin.from("job_assignments").select("id, user_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
    // F13: no outbox row. The installer is told the date on the job (event only): the decision 376 I71 email + text and the
    // decision 186 clearance "offer install days" message were retired 2 Nov 2026 (Part 4 Task 14; the installer calls the owner to book).
    if (inst) await logEvent(jobId, actorId, "installer_planning_notice", INSTALLER_PLANNING_NOTICE, { assignment_id: inst.id, installer_user_id: inst.user_id, piesa_start: start });
    const { recordBookingCompleted } = await import("./engagement.server");
    await recordBookingCompleted(jobId).catch((e) => console.error("engagement booking record failed", (e as Error).message));
    // Part 4 Task 14: the old O26 "safety check booked" owner email is gone; in-house jobs get the "You're booked" PIESA message
    // from in-house-booking.server (notifyOwnerBooked).
    // Decision 398: the electrician's A3 PIESA Mitti form is made now, through the office "Create Mitti form" path (never
    // twice; a failure is one Needs me row and the office button stays as the backup). Never a booking failure.
    await (await import("./piesa-autoform.server")).onPiesaBooked(jobId, inserted.id, actorId).catch((e) => console.error("PIESA form creation skipped", (e as Error).message));
  }
  // Decision 325: O42 "Your install day has changed" when a confirmed install day is moved directly (stage already booked). Best-effort.
  if (kind === "installation" && priorInstallStart) {
    await (await import("./owner-email-triggers.server")).onInstallBookingRescheduled(jobId, start, priorInstallStart).catch((e) => console.error("install day changed email skipped", (e as Error).message));
  }
  if (kind === "assessment" || kind === "rectification") {
    const holds = await import("./install-holds.server");
    const mv = kind === "assessment" ? holds.moveHoldForPiesa : holds.moveHoldForRectification;
    await mv(jobId, start, actorId).catch((e) => console.error("install hold move skipped", (e as Error).message));
  }
  // Decision 293: a booked electrical fixes visit gets the electrician's "A4 – Electrical fixes" Mitti form (one per visit,
  // only when the PIESA left repair work for a later visit). Any problem is an office item, never a booking failure.
  if (kind === "rectification") {
    await (await import("./fixes-day.server")).onRectificationBooked(jobId, inserted.id, actorId).catch((e) => console.error("fixes form creation skipped", (e as Error).message));
  }
  // Stage 5 (Jo 23 Oct): a rescheduled (or re-confirmed) Ready Check updates the booked date on the job's
  // existing Mitti form. A no-op when no form exists yet — the form is created with the booked date.
  // Decision 327: the A3 needs the electrician at the start of the install day → ask them for THIS booking (a moved day is a
  // new booking, so it is asked again), or auto-confirm a day they already said they can do. Never a booking failure.
  if (kind === "installation") {
    await (await import("./install-attendance.server")).onInstallBooked(jobId, actorId).catch((e) => console.error("electrician attendance skipped", (e as Error).message));
  }
  if (kind === "ready_check") {
    await (await import("./mitti-pickup.server")).updateMittiFormDate(jobId, start, actorId).catch((e) => console.error("mitti form date update skipped", (e as Error).message));
  }
  try {
    const forms = await import("./in-house-forms.server");
    if (await forms.isInHouseFormJob(jobId)) {
      if (kind === "installation") await forms.ensureInstallForm(jobId, actorId);
      await forms.syncInHouseForms(jobId, "date", actorId);
    }
  } catch (e) {
    await logEvent(jobId, actorId, "in_house_form_sync_failed", "In-house forms need office attention", { reason: e instanceof Error ? e.message : "Form update failed", needs_office: true }, { internal: true });
  }
  await autoAdvanceJob(jobId, actorId, "booking confirmed");
  return { ok: true };
}

// ── Part 9 Task 8: insurance + electrician licence gate on every booking kind (appended; called from validateBooking) ──
/** The electrician worker a safety check / upgrades booking is for: the proposed Team worker, else the job's allocated
 *  Team electrician, else null (the business as a whole is checked then). A read error throws (fail closed). */
async function bookedElectricianWorker(jobId: string, businessId: string | null, proposedWorkerId: string | null): Promise<{ id: string; business_id: string; full_legal_name: string | null; licence_number: string | null; rec_number: string | null; licence_expires_on: string | null; licence_verified_at: string | null; approval_status: string | null } | null> {
  const id = proposedWorkerId ?? (await (await import("./in-house-electrician.server")).allocatedWorkerId(jobId));
  if (!id) return null;
  const { data, error } = await admin.from("partner_workers").select("id, business_id, full_legal_name, licence_number, rec_number, licence_expires_on, licence_verified_at, approval_status").eq("id", id).maybeSingle();
  if (error) throw new WorkflowError(`Couldn't check the electrician: ${error.message}`);
  if (!data) throw new WorkflowError("The booked electrician is no longer on file.");
  if (businessId && data.business_id !== businessId) throw new WorkflowError("The booked electrician isn't on the assigned business's Team.");
  return data;
}

async function bookingComplianceGate(jobId: string, kind: BookingKind, assignedBusinessId: string | null, proposedWorkerId: string | null, move: { reschedule: boolean; start: string }): Promise<void> {
  // Part 9 Task 9: moving a booked install after the 5pm two-days-before Lead Installer lock is refused (LEAD_LOCKED_MESSAGE);
  // the current booking is read inside the check (completed installs ignored, read errors refuse — fail closed).
  if (kind === "installation" && move.reschedule) await (await import("./lead-installer-confirm.server")).assertLeadInstallerUnlocked(jobId, { newStart: move.start });
  // Part 9 Task 9: the people on the booking must be on file (DOB + mobile; Lead/crew CII; electrician licence + REC).
  await (await import("./people-on-file.server")).requirePeopleOnFileForBooking(jobId, kind, proposedWorkerId);
  const electrician = kind === "assessment" || kind === "rectification" ? await bookedElectricianWorker(jobId, assignedBusinessId, proposedWorkerId) : null;
  const businessId = assignedBusinessId ?? electrician?.business_id ?? null;
  if (!businessId) return; // no trade yet: the "No … assigned yet" refusal above already applies
  const { requireBusinessDocs } = await import("./business-docs.server");
  await requireBusinessDocs(businessId);
  if (kind === "assessment") {
    const { electricianVerified, melbourneToday } = await import("./worker-compliance.core");
    if (electrician) {
      const v = electricianVerified(electrician, melbourneToday());
      if (!v.ok) throw new WorkflowError(`Electrician not verified: ${electrician.full_legal_name ?? "electrician"} (${v.reason}).`);
    } else {
      const { data, error } = await admin.from("partner_workers").select("licence_number, rec_number, licence_expires_on, licence_verified_at").eq("business_id", businessId).eq("trade_role", "electrician").eq("approval_status", "approved").is("removed_at", null);
      if (error) throw new WorkflowError(`Couldn't check the electrician: ${error.message}`);
      const { inHouseElectricianBookingBlocker } = await import("./worker-compliance.core");
      const why = inHouseElectricianBookingBlocker((data ?? []) as import("./worker-compliance.core").ElectricianVerification[], melbourneToday());
      if (why) throw new WorkflowError(why);
    }
  }
}
