// "I'm at the property now – start a Ready Check" persistence (Jo, 7 Oct 2026).
// Creates the installer-supplied job the same way Upload jobs does (always a new owner, stage Ready Check ready to schedule),
// books the Ready Check for now through confirmBooking (all its guards, incl. owner paperwork A),
// then creates the installer's Mitti Ready Check form through the existing createAssignMittiAudit.
// Mitti stays hidden until the office ticks "Mitti account invited" for the business.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { ONSITE_CONSENT_SOURCE, TEST_MITTI_ASSIGNEE, onsiteProblems, onsiteState, type OnsiteInput, type OnsiteState } from "./onsite-ready-check.core";
import type { ElectricianPlan } from "./job-electrician.core";
import type { MittiCall } from "./mitti.core";
import { laterReadyCheckProblems, type LaterReadyCheck } from "./later-ready-check.core";

export async function startOnsiteReadyCheckFor(userId: string, businessId: string, input: OnsiteInput, electrician: ElectricianPlan | null, call?: MittiCall, later?: LaterReadyCheck) {
  const { requireMember, requireApprovedPartner, intakeSourceFor } = await import("./pilot.server");
  await requireMember(userId, businessId, true); // same rule as Add one job: business owner only
  await requireApprovedPartner(businessId);
  const problems = onsiteProblems(input);
  if (later) problems.push(...laterReadyCheckProblems(later));
  const { electricianPlanBlocker, READY_CHECK_CONTACT_PERMISSION } = await import("./job-electrician.core");
  const eb = electricianPlanBlocker(electrician); if (eb) problems.push(eb);
  if (problems.length) throw new WorkflowError(problems.join(" • "));

  const email = input.email.trim().toLowerCase();
  const { createInstallerOwner } = await import("./installer-owner.server");
  const owner = await createInstallerOwner(admin, businessId, { full_name: input.full_name.trim(), email, phone: input.phone.trim() });
  const { data: prop, error: pe } = await admin.from("properties").insert({ owner_id: owner.id, address_line: input.address_line.trim(), suburb: input.suburb.trim(), postcode: input.postcode.trim(), state: "VIC" }).select("id").single();
  if (pe || !prop) throw new WorkflowError(pe?.message ?? "Property could not be saved.");
  const { todayMelbourne } = await import("./eligibility.server");
  const source = await intakeSourceFor(userId, businessId, "installer_onsite");
  const { data: job, error: je } = await admin.from("jobs").insert({
    owner_id: owner.id, property_id: prop.id, stage: "ready_check_ready_to_schedule", source, business_unit: "hivic", installer_led: true,
    channel: "installer_sourced", originating_installer_business_id: businessId, originating_installer_user_id: userId,
    external_enquiry_id: `onsite:${crypto.randomUUID()}`, customer_relationship_owner: "installer",
    installer_site_check: later ? "no" : "yes", installer_site_check_date: later ? null : todayMelbourne(), installer_quoted: later ? "no" : null,
    ...(later ? { external_refs: { supplied_ready_check: { ...later, measurements_status: "unverified" } } } : {}),
    next_action: later ? "Confirm supplied Ready Check appointment" : "Ready Check on site now",
  }).select("id, job_number").single();
  if (je || !job) throw new WorkflowError(je?.message ?? "Job could not be saved.");
  await admin.from("job_assignments").insert({ job_id: job.id, user_id: userId, role: "installer", business_id: businessId, assigned_by: userId, first_response_at: new Date().toISOString() });
  await (await import("./job-electrician.server")).recordJobElectricianChoice(job.id, businessId, electrician ?? { mode: "hivic" }, userId);
  await logEvent(job.id, userId, later ? "installer_later_job_added" : "onsite_ready_check_started", later ? "Installer supplied a Ready Check appointment and optional unverified measurements" : "Installer added this customer while at the property and started the Ready Check", { business_id: businessId, ...(later ? { supplied_ready_check: later } : {}) });
  // Gate A on site (Jo, 8 Oct): owner ticked on the installer's phone, or the installer confirmed the owner's consent.
  const { gateDoc } = await import("./owner-gates.core");
  const byOwner = input.consent_by === "owner";
  const text = byOwner ? gateDoc("contact_privacy").body : READY_CHECK_CONTACT_PERMISSION;
  const now = new Date().toISOString();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const { error: ce } = await admin.from("owner_contact_consents").insert({ job_id: job.id, owner_id: owner.id, source: ONSITE_CONSENT_SOURCE, consent_key: byOwner ? "owner_ticked" : "installer_confirmed", consent_status: "granted", contact_consent: true, consented_at: now, snapshot: { by: byOwner ? "owner" : "installer", text, recorded_by: userId }, sha256: hash });
  if (ce) throw new WorkflowError(`Consent could not be saved: ${ce.message}`);
  await logEvent(job.id, userId, "installer_contact_permission", byOwner ? "Owner ticked contact and privacy consent on the installer's phone" : "Installer confirmed the owner gave consent", { wording: text, by: byOwner ? "owner" : "installer" }, { internal: true });

  // Book "now" through the normal guarded booking (owner paperwork A, approved EEC installer, stage).
  let booking: "confirmed" | "blocked" | "waiting_paperwork" = "waiting_paperwork";
  {
    const { confirmBooking } = await import("./booking.server");
    try {
      await confirmBooking(job.id, "ready_check", later?.startsAt ?? new Date().toISOString(), userId, later ? "installer (supplied appointment)" : "installer (on site now)");
      booking = "confirmed";
      await admin.from("jobs").update({ next_action: later ? "Attend booked Ready Check" : "Ready Check on site now" }).eq("id", job.id);
      if (later) await (await import("./mitti-create.server")).onReadyCheckBooked(job.id, userId).catch((e) => console.error("ready check form not scheduled", (e as Error).message)); // T3: confirmed booking starts the form in the background
    } catch (error) {
      if (!later) throw error;
      booking = "blocked";
      await logEvent(job.id, userId, "installer_later_booking_blocked", "Supplied appointment not confirmed: existing booking checks blocked it", { reason: error instanceof Error ? error.message : "Booking checks blocked confirmation", starts_at: later.startsAt }, { internal: true });
    }
  }
  if (later) return { jobId: job.id, jobNumber: job.job_number, booking, state: { kind: "office" as const, message: "Job added. Check the appointment status on the job." } };
  // T3: never wait for Mitti inside the installer's save. Read the state; if a form is needed, create it in the background.
  const state = await onsiteFormFor(job.id, userId, call, true);
  return { jobId: job.id, jobNumber: job.job_number, booking, state };
}

/**
 * Status for "Getting your form ready…". T3: the status read (poll) is strictly read-only and never calls Mitti.
 * `request` (the explicit start / "Try again" action) schedules creation in the background and returns at once;
 * duplicates are prevented by the atomic claim inside createAssignMittiAudit.
 */
export async function onsiteFormFor(jobId: string, userId: string, call?: MittiCall, request = false): Promise<OnsiteState> {
  const { data: j } = await admin.from("jobs").select("channel, originating_installer_business_id, source").eq("id", jobId).maybeSingle();
  if (!j || j.channel !== "installer_sourced" || !j.originating_installer_business_id) throw new WorkflowError("This job isn't one of your customers.");
  const { requireMember } = await import("./pilot.server");
  await requireMember(userId, j.originating_installer_business_id);
  const facts = await factsFor(jobId, j.originating_installer_business_id);
  const state = onsiteState(facts);
  if (!request || (state.kind !== "preparing" && state.kind !== "retry")) return state;
  const { data: prof } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const { scheduleReadyCheckFormCreation } = await import("./mitti-create.server");
  await scheduleReadyCheckFormCreation(jobId, userId, { userId, fullName: prof?.full_name ?? null, email: j.source === "qa_test" ? TEST_MITTI_ASSIGNEE : prof?.email ?? "" }, call);
  return onsiteState({ ...facts, lastError: null });
}

async function factsFor(jobId: string, businessId: string) {
  const [{ data: b }, { data: ws }, { data: m }, { count: booked }, { gateAComplete }, { data: err }] = await Promise.all([
    admin.from("businesses").select("mitti_account_invited").eq("id", businessId).maybeSingle(),
    admin.from("workflow_settings").select("mitti_ready_check_priced_template_id, auto_send_mitti").eq("id", 1).maybeSingle(),
    admin.from("ceiling_measurements").select("external_source, external_id, status").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed"),
    import("./owner-gates.server"),
    admin.from("workflow_events").select("summary, created_at").eq("job_id", jobId).eq("event_type", "mitti_access_needed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    mittiInvited: b?.mitti_account_invited === true, templateSet: !!ws?.mitti_ready_check_priced_template_id?.trim(), autoSend: ws?.auto_send_mitti === true,
    gateADone: true, booked: !!booked,
    auditId: m?.external_source === "mitti" ? m.external_id ?? null : null,
    lastError: (err as { summary?: string } | null)?.summary ?? null,
  };
}
