// Single path that writes a confirmed booking (direct booking or accepted appointment proposal).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, commercialBlocker, paymentGate, getStage, logEvent, piesaStatus, transition } from "./workflow.server";
import { installationDateBlocker, STAGE_LABEL, type Stage } from "./workflow";
import { setInstallDueDate } from "./invoice-dates.server";
import { autoAdvanceJob } from "./autoadvance.server";

export type BookingKind = "assessment" | "ready_check" | "rectification" | "installation";

export async function confirmBooking(jobId: string, kind: BookingKind, start: string, actorId: string, roleLabel: string, notes?: string | null) {
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
  }
  const [allowed, target] = map[kind];
  if (!allowed.includes(stage)) throw new WorkflowError(`A ${kind} booking can't be made at ${STAGE_LABEL[stage]}.`);
  const { data: contractor } = await admin.from("job_assignments").select("id, user_id, business_id, businesses(business_type, onboarding_status, is_active, capabilities)").eq("job_id", jobId).eq("role", need).eq("active", true).maybeSingle();
  if (!contractor) throw new WorkflowError(`No ${need} assigned yet.`);
  if (kind === "ready_check") {
    const business = contractor.businesses as { business_type: string; onboarding_status: string; is_active: boolean; capabilities: string[] | null } | null;
    if (!contractor.business_id || !business?.is_active || business.onboarding_status !== "approved" || (business.business_type !== "eec_installer" && !business.capabilities?.includes("installer")))
      throw new WorkflowError("The Ready Check must be assigned to an approved EEC Certified Insulation Installer.");
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
    // 30-day hard gate on every path: clearance date (PIESA, or Section C when rectification) + 30 days.
    const { installWindowDeadline, installDayOutsideWindow, NEW_PIESA_NEEDED } = await import("./install-days.core");
    const c0 = electricalClearance(await clearanceFacts(jobId));
    const dl = installWindowDeadline(c0.timingDate, (ps as { install_deadline?: string | null } | null)?.install_deadline ?? null);
    if (installDayOutsideWindow(start, dl)) throw new WorkflowError(dl ? `Installation must be on or before ${dl} (30 days from electrical clearance). If that has passed: ${NEW_PIESA_NEEDED}.` : "Installation cannot be booked: no electrical clearance date.");
    const { bookingLeadBlocker } = await import("./esc.core");
    const lead = bookingLeadBlocker(start, new Date().toISOString());
    if (lead) throw new WorkflowError(lead);
  }
  if (kind !== "ready_check") { const cb = await commercialBlocker(jobId); if (cb) throw new WorkflowError(`Blocked: ${cb}`); }
  if (kind !== "ready_check") { const g = await paymentGate(jobId); if (!g.cleared) throw new WorkflowError(`Blocked: ${g.blocker}`); }
  { const { jobDeletedBlocker } = await import("./job-live.server"); const del = await jobDeletedBlocker(jobId); if (del) throw new WorkflowError(del); }
  // Guard BEFORE writing: a booking must never exist when the job cannot enter the booked stage (e.g. Gate A not signed).
  // The only booking-dependent Ready Check blocker is excluded here because the booking is what we are about to write.
  if (stage !== target) {
    const { stageEntryBlockers, READY_CHECK_BOOKING_RECORD_BLOCKER } = await import("./workflow.server");
    const pre = (await stageEntryBlockers(jobId, target, actorId)).filter((b) => b !== READY_CHECK_BOOKING_RECORD_BLOCKER);
    if (pre.length) throw new WorkflowError(`Blocked: ${pre.join(" • ")}`);
  }
  await admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).eq("kind", kind).in("status", ["proposed", "confirmed"]);
  const { data: inserted, error: insertError } = await admin.from("bookings").insert({ job_id: jobId, kind, contractor_id: contractor.user_id, assignment_id: contractor.id, business_id: contractor.business_id, scheduled_start: start, booked_by: actorId, notes: notes ?? null, status: "confirmed" }).select("id").single();
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
    const { INSTALLER_PLANNING_NOTICE } = await import("./allocation.core");
    const { data: inst } = await admin.from("job_assignments").select("id, user_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
    if (inst) {
      await logEvent(jobId, actorId, "installer_planning_notice", INSTALLER_PLANNING_NOTICE, { assignment_id: inst.id, installer_user_id: inst.user_id, piesa_start: start });
      const { queueInstallerPlanningNotice } = await import("./allocation.server");
      await queueInstallerPlanningNotice(jobId, inst.id, start).catch((e) => console.error("planning notice outbox skipped", (e as Error).message));
    }
    const { recordBookingCompleted } = await import("./engagement.server");
    await recordBookingCompleted(jobId).catch((e) => console.error("engagement booking record failed", (e as Error).message));
  }
  if (kind === "assessment" || kind === "rectification") {
    const holds = await import("./install-holds.server");
    const mv = kind === "assessment" ? holds.moveHoldForPiesa : holds.moveHoldForRectification;
    await mv(jobId, start, actorId).catch((e) => console.error("install hold move skipped", (e as Error).message));
  }
  await autoAdvanceJob(jobId, actorId, "booking confirmed");
  return { ok: true };
}
