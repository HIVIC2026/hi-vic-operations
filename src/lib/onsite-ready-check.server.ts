// "I'm at the property now – start a Ready Check" persistence (Jo, 7 Oct 2026).
// Creates the installer-supplied job the same way Upload jobs does (always a new owner, stage Ready Check ready to schedule),
// books the Ready Check for now through confirmBooking (all its guards, incl. owner paperwork A),
// then creates the installer's Mitti Ready Check form through the existing createAssignMittiAudit.
// Mitti stays hidden until the office ticks "Mitti account invited" for the business.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { onsiteProblems, onsiteState, retryable, type OnsiteInput, type OnsiteState } from "./onsite-ready-check.core";
import type { ElectricianPlan } from "./job-electrician.core";
import type { MittiCall } from "./mitti.core";

export async function startOnsiteReadyCheckFor(userId: string, businessId: string, input: OnsiteInput, electrician: ElectricianPlan | null, call?: MittiCall) {
  const { requireMember, requireApprovedPartner, intakeSourceFor } = await import("./pilot.server");
  await requireMember(userId, businessId, true); // same rule as Add one job: business owner only
  await requireApprovedPartner(businessId);
  const problems = onsiteProblems(input);
  const { electricianPlanBlocker, OWNER_CONTACT_PERMISSION } = await import("./job-electrician.core");
  const eb = electricianPlanBlocker(electrician); if (eb) problems.push(eb);
  if (problems.length) throw new WorkflowError(problems.join(" • "));

  const email = input.email.trim().toLowerCase();
  const { data: owner, error: oe } = await admin.from("owners").insert({ full_name: input.full_name.trim(), email, phone: input.phone.trim() }).select("id").single();
  if (oe || !owner) throw new WorkflowError(oe?.message ?? "Owner could not be saved.");
  const { data: prop, error: pe } = await admin.from("properties").insert({ owner_id: owner.id, address_line: input.address_line.trim(), suburb: input.suburb.trim(), postcode: input.postcode.trim(), state: "VIC" }).select("id").single();
  if (pe || !prop) throw new WorkflowError(pe?.message ?? "Property could not be saved.");
  const { todayMelbourne } = await import("./eligibility.server");
  const source = await intakeSourceFor(userId, businessId, "installer_onsite");
  const { data: job, error: je } = await admin.from("jobs").insert({
    owner_id: owner.id, property_id: prop.id, stage: "ready_check_ready_to_schedule", source, business_unit: "hivic", installer_led: true,
    channel: "installer_sourced", originating_installer_business_id: businessId, originating_installer_user_id: userId,
    external_enquiry_id: `onsite:${crypto.randomUUID()}`, customer_relationship_owner: "installer",
    installer_site_check: "yes", installer_site_check_date: todayMelbourne(), installer_quoted: null,
    next_action: "Ready Check on site now",
  }).select("id, job_number").single();
  if (je || !job) throw new WorkflowError(je?.message ?? "Job could not be saved.");
  await admin.from("job_assignments").insert({ job_id: job.id, user_id: userId, role: "installer", business_id: businessId, assigned_by: userId, first_response_at: new Date().toISOString() });
  await (await import("./job-electrician.server")).recordJobElectricianChoice(job.id, businessId, electrician ?? { mode: "hivic" }, userId);
  await logEvent(job.id, userId, "onsite_ready_check_started", "Installer added this customer while at the property and started the Ready Check", { business_id: businessId });
  await logEvent(job.id, userId, "installer_contact_permission", "Installer confirmed the owner agreed to Home Insulation Victoria contacting them", { wording: OWNER_CONTACT_PERMISSION }, { internal: true });

  // Book "now" through the normal guarded booking (owner paperwork A, approved EEC installer, stage).
  const { gateAComplete } = await import("./owner-gates.server");
  if (await gateAComplete(job.id)) {
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(job.id, "ready_check", new Date().toISOString(), userId, "installer (on site now)");
    await admin.from("jobs").update({ next_action: "Ready Check on site now" }).eq("id", job.id);
  } else {
    await admin.from("jobs").update({ next_action: "Owner to sign paperwork A, then the Ready Check can start" }).eq("id", job.id);
    await logEvent(job.id, userId, "onsite_waiting_paperwork_a", "On-site Ready Check held: the owner hasn't signed paperwork A yet", {}, { internal: true });
  }
  const state = await onsiteFormFor(job.id, userId, call);
  return { jobId: job.id, jobNumber: job.job_number, state };
}

/** Status for "Getting your form ready…". Creates the Mitti form once; afterwards only reads what's stored. */
export async function onsiteFormFor(jobId: string, userId: string, call?: MittiCall, force = false): Promise<OnsiteState> {
  const { data: j } = await admin.from("jobs").select("channel, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (!j || j.channel !== "installer_sourced" || !j.originating_installer_business_id) throw new WorkflowError("This job isn't one of your customers.");
  const { requireMember } = await import("./pilot.server");
  await requireMember(userId, j.originating_installer_business_id);
  const facts = await factsFor(jobId, j.originating_installer_business_id);
  let state = onsiteState(facts);
  if (state.kind !== "preparing" && !(state.kind === "retry" && (force || (facts.lastError && retryable(facts.lastError))))) return state;
  const { data: prof } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  try {
    const { createAssignMittiAudit, realMittiCall } = await import("./mitti.server");
    const r = await createAssignMittiAudit(jobId, userId, call ?? realMittiCall, { readyCheck: true, assignee: { userId, fullName: prof?.full_name ?? null, email: prof?.email ?? "" } });
    state = onsiteState({ ...facts, auditId: r.auditId, lastError: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mitti error";
    await logEvent(jobId, userId, "mitti_access_needed", `On-site Ready Check form could not be created: ${msg}`, {}, { internal: true });
    state = onsiteState({ ...facts, lastError: msg });
  }
  return state;
}

async function factsFor(jobId: string, businessId: string) {
  const [{ data: b }, { data: ws }, { data: m }, { count: booked }, { gateAComplete }, { data: err }] = await Promise.all([
    admin.from("businesses").select("mitti_account_invited").eq("id", businessId).maybeSingle(),
    admin.from("workflow_settings").select("mitti_ready_check_priced_template_id").eq("id", 1).maybeSingle(),
    admin.from("ceiling_measurements").select("external_source, external_id, status").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed"),
    import("./owner-gates.server"),
    admin.from("workflow_events").select("summary, created_at").eq("job_id", jobId).eq("event_type", "mitti_access_needed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    mittiInvited: b?.mitti_account_invited === true, templateSet: !!ws?.mitti_ready_check_priced_template_id?.trim(),
    gateADone: await gateAComplete(jobId), booked: !!booked,
    auditId: m?.external_source === "mitti" ? m.external_id ?? null : null,
    lastError: (err as { summary?: string } | null)?.summary ?? null,
  };
}
