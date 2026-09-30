// Single path that writes a confirmed booking (direct booking or accepted appointment proposal).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, commercialBlocker, depositCleared, getStage, logEvent, piesaStatus, transition } from "./workflow.server";
import { installationDateBlocker, STAGE_LABEL, type Stage } from "./workflow";
import { setInstallDueDate } from "./xero.server";
import { autoAdvanceJob } from "./autoadvance.server";

export type BookingKind = "assessment" | "ready_check" | "rectification" | "installation";

export async function confirmBooking(jobId: string, kind: BookingKind, start: string, actorId: string, roleLabel: string, notes?: string | null) {
  const need = kind === "installation" || kind === "ready_check" ? "installer" : "electrician";
  const stage = await getStage(jobId);
  const map: Record<BookingKind, [Stage[], Stage]> = {
    assessment: [["assessment_booking", "assessment_booked"], "assessment_booked"],
    ready_check: [["ready_check_ready_to_schedule", "ready_check_scheduled"], "ready_check_scheduled"],
    rectification: [["rectification_scheduling", "rectification_booked"], "rectification_booked"],
    installation: [["installation_scheduling", "installation_booked"], "installation_booked"],
  };
  const [allowed, target] = map[kind];
  if (!allowed.includes(stage)) throw new WorkflowError(`A ${kind} booking can't be made at ${STAGE_LABEL[stage]}.`);
  const { data: contractor } = await admin.from("job_assignments").select("id, user_id, business_id, businesses(business_type, onboarding_status, is_active, capabilities)").eq("job_id", jobId).eq("role", need).eq("active", true).maybeSingle();
  if (!contractor) throw new WorkflowError(`No ${need} assigned yet.`);
  if (kind === "ready_check") {
    const business = contractor.businesses as { business_type: string; onboarding_status: string; is_active: boolean; capabilities: string[] | null } | null;
    if (!contractor.business_id || !business?.is_active || business.onboarding_status !== "approved" || (business.business_type !== "eec_installer" && !business.capabilities?.includes("installer")))
      throw new WorkflowError("The Ready Check must be assigned to an approved EEC Certified Insulation Installer.");
  }
  if (kind === "installation") {
    const blocked = installationDateBlocker(await piesaStatus(jobId), start);
    if (blocked) throw new WorkflowError(blocked);
    const { bookingLeadBlocker } = await import("./esc.core");
    const lead = bookingLeadBlocker(start, new Date().toISOString());
    if (lead) throw new WorkflowError(lead);
  }
  if (kind !== "assessment") { const cb = await commercialBlocker(jobId); if (cb) throw new WorkflowError(`Blocked: ${cb}`); }
  if (kind !== "assessment" && !(await depositCleared(jobId))) throw new WorkflowError("Blocked: the 50% deposit has not been paid.");
  await admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).eq("kind", kind).in("status", ["proposed", "confirmed"]);
  await admin.from("bookings").insert({ job_id: jobId, kind, contractor_id: contractor.user_id, assignment_id: contractor.id, business_id: contractor.business_id, scheduled_start: start, booked_by: actorId, notes: notes ?? null, status: "confirmed" });
  const nowIso = new Date().toISOString();
  await admin.from("job_assignments").update({ booking_confirmed_at: nowIso }).eq("id", contractor.id).is("booking_confirmed_at", null);
  await admin.from("job_assignments").update({ first_response_at: nowIso }).eq("id", contractor.id).is("first_response_at", null);
  if (kind === "installation") {
    await setInstallDueDate(jobId, start, actorId);
    const { regenerateEscNotification } = await import("./esc.server");
    await regenerateEscNotification(jobId, actorId);
    const { reevaluateIntelligence } = await import("./intelligence.server");
    await reevaluateIntelligence(jobId, actorId, "installation date set");
  }
  const when = new Date(start).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
  if (stage === target) await logEvent(jobId, actorId, "booking_rescheduled", `${kind === "ready_check" ? "Ready Check" : kind} rescheduled to ${when} by ${roleLabel}`, { assignment_id: contractor.id, installer_user_id: contractor.user_id, installer_business_id: contractor.business_id });
  else await transition(jobId, target, actorId, `${kind === "ready_check" ? "Ready Check" : kind.charAt(0).toUpperCase() + kind.slice(1)} booked for ${when} by ${roleLabel}`, { assignment_id: contractor.id, installer_user_id: contractor.user_id, installer_business_id: contractor.business_id, scheduled_start: start });
  if (kind === "assessment") {
    const { recordBookingCompleted } = await import("./engagement.server");
    await recordBookingCompleted(jobId).catch((e) => console.error("engagement booking record failed", (e as Error).message));
  }
  await autoAdvanceJob(jobId, actorId, "booking confirmed");
  return { ok: true };
}
