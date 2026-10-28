// Installer "Add a job" persistence (Jo, 7 Oct 2026; basics only since decisions 34/115, 24 Oct 2026).
// Creates the installer-supplied job the same way Upload jobs does (always a new owner, stage Ready Check ready to
// schedule, no booking) unless the address already has an OPEN job (decision 282: linked + office flag, no new job),
// records the owner's contact permission, then creates the installer's Mitti Ready Check form
// straight away through the existing claim-guarded createAssignMittiAudit path (decision 115: no booking needed).
// Decision 116: an optional visit day + time is saved through the same path as the job page (tradeSetReadyCheckTime).
// Mitti stays hidden until the office ticks "Mitti account invited" for the business.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { ONSITE_CONSENT_SOURCE, READY_CHECK_FORM_COMING, TEST_MITTI_ASSIGNEE, onsiteProblems, onsiteState, type OnsiteInput, type OnsiteState } from "./onsite-ready-check.core";
import type { ElectricianPlan } from "./job-electrician.core";
import type { MittiCall } from "./mitti.core";
import type { ReadyCheckPick } from "./ready-check-times.core";

export type AddJobBooking = "none" | "confirmed" | "blocked";
export type AddJobResult = { jobId: string; jobNumber: string | null; booking: AddJobBooking; formCreation: "scheduled" | "skipped"; state: OnsiteState };

export async function startOnsiteReadyCheckFor(userId: string, businessId: string, input: OnsiteInput, electrician: ElectricianPlan | null = null, call?: MittiCall, opts: { visit?: ReadyCheckPick | null; now?: Date; /** Decision 289: null = the default rule (usual electrician when saved, else Home Insulation Victoria's). */ electricianChoice?: import("./electrician-choice.core").ElectricianChoice | null; /** A1: how the installer got this customer; door-knock and cold call are refused. */ leadOrigin?: import("./onsite-ready-check.core").LeadOrigin | null } = {}): Promise<AddJobResult> {
  const { requireMember, requireApprovedPartner, intakeSourceFor } = await import("./pilot.server");
  await requireMember(userId, businessId, true); // same rule as Add one job: business owner only
  await requireApprovedPartner(businessId);
  const now = opts.now ?? new Date();
  const problems = onsiteProblems(input);
  const { electricianPlanBlocker, OWNER_CONTACT_PERMISSION } = await import("./job-electrician.core");
  const eb = electricianPlanBlocker(electrician); if (eb) problems.push(eb);
  const lop = (await import("./onsite-ready-check.core")).leadOriginProblem(opts.leadOrigin); if (lop) problems.push(lop);
  // Decision 289: "Electrical safety check by" is chosen once here; "my usual electrician" needs one saved in My business.
  // A3: "my usual electrician" can be picked only once that electrician is onboarded (checked here as well as on the form).
  const { defaultElectricianChoice, addJobUsual, addJobElectricianProblem } = await import("./electrician-choice.core");
  const usualStatus = await (await import("./usual-electrician.server")).readUsualElectricianStatus(businessId);
  const status = usualStatus.electrician ? { name: usualStatus.electrician.name, onboarded: usualStatus.onboarded } : null;
  const electricianChoice = opts.electricianChoice ?? defaultElectricianChoice(addJobUsual(status));
  const ecp = addJobElectricianProblem(electricianChoice, status); if (ecp) problems.push(ecp);
  // Decision 116: the optional visit time follows the job page's rules (exact times, business days, 24h+ ahead) and is
  // checked BEFORE anything is saved, so a bad time never leaves a job behind.
  if (opts.visit) problems.push(...(await import("./ready-check-times.core")).a1ReadyCheckTimeBlockers(opts.visit, now));
  if (problems.length) throw new WorkflowError(problems.join(" • "));

  const email = input.email.trim().toLowerCase();
  const source = await intakeSourceFor(userId, businessId, "installer_onsite");
  // Decision 282 (Jo 25 Oct): only the address matters. An open job at this address is told to the office and the
  // installer sees its number; nothing is created. Email/phone are never a reason to refuse.
  const { findOpenJobAtAddress, flagDuplicateAddress, businessNameFor } = await import("./duplicate-address.server");
  const open = await findOpenJobAtAddress({ address_line: input.address_line, suburb: input.suburb, postcode: input.postcode, source }, { preferNonLead: true });
  const clash = (await import("./duplicate-address.core")).addJobClashAction(open);
  // Jo 28 Oct: an open HIV lead at this address does not block the installer; the job is saved and flagged below.
  if (open && clash === "refuse") {
    await flagDuplicateAddress(open, userId, { from: "add_a_job", business_id: businessId, business_name: await businessNameFor(businessId), full_name: input.full_name.trim(), email, phone: input.phone.trim(), address_line: input.address_line.trim(), suburb: input.suburb.trim(), postcode: input.postcode.trim() });
    throw new WorkflowError((await import("./duplicate-address.core")).duplicateAddressMessage(open.job_number));
  }
  const { createInstallerOwner } = await import("./installer-owner.server");
  const owner = await createInstallerOwner(admin, businessId, { full_name: input.full_name.trim(), email, phone: input.phone.trim() });
  const { data: prop, error: pe } = await admin.from("properties").insert({ owner_id: owner.id, address_line: input.address_line.trim(), suburb: input.suburb.trim(), postcode: input.postcode.trim(), state: "VIC" }).select("id").single();
  if (pe || !prop) throw new WorkflowError(pe?.message ?? "Property could not be saved.");
  // Decision 34: basics only. The visit, measurements, existing insulation, removal, product, price and electrician are
  // all answered in the Mitti Ready Check form, so nothing here claims a visit or a quote.
  const { data: job, error: je } = await admin.from("jobs").insert({
    owner_id: owner.id, property_id: prop.id, stage: "ready_check_ready_to_schedule", source, business_unit: "hivic", installer_led: true,
    channel: "installer_sourced", originating_installer_business_id: businessId, originating_installer_user_id: userId,
    external_enquiry_id: `onsite:${crypto.randomUUID()}`, customer_relationship_owner: "installer",
    installer_site_check: "no", installer_site_check_date: null, installer_quoted: "no",
    next_action: READY_CHECK_FORM_COMING,
  }).select("id, job_number").single();
  if (je || !job) throw new WorkflowError(je?.message ?? "Job could not be saved.");
  await admin.from("job_assignments").insert({ job_id: job.id, user_id: userId, role: "installer", business_id: businessId, assigned_by: userId, first_response_at: new Date().toISOString() });
  await (await import("./job-electrician.server")).recordJobElectricianChoice(job.id, businessId, electrician ?? { mode: "hivic" }, userId);
  // Decision 289: the one electrician choice for this job (append-only event; the quote pipeline reads it).
  await (await import("./electrician-choice.server")).recordElectricianChoice(job.id, businessId, userId, electricianChoice, "add_job");
  if (open && clash === "save_and_flag") {
    const { DUPLICATE_ADDRESS_EVENT, hivLeadClashSummary } = await import("./duplicate-address.core");
    await logEvent(job.id, userId, DUPLICATE_ADDRESS_EVENT, hivLeadClashSummary(open.job_number), { from: "add_a_job", existing_job_id: open.id, existing_job_number: open.job_number, needs_office: true }, { internal: true });
  }
  await logEvent(job.id, userId, "installer_job_added", "Installer added this customer (Add a job: name, address, mobile, email, contact permission); the Mitti Ready Check form is created next", { business_id: businessId, visit_requested: !!opts.visit, lead_origin: opts.leadOrigin });
  // Gate A (Jo, 8 Oct): the installer confirmed the owner's consent to be contacted.
  const { gateDoc } = await import("./owner-gates.core");
  const byOwner = input.consent_by === "owner";
  // Jo (decision 198 follow-up): the short permission sentence is the label shown and recorded for new jobs; older jobs keep the sentence they were saved with.
  const text = byOwner ? gateDoc("contact_privacy").body : OWNER_CONTACT_PERMISSION;
  const nowIso = new Date().toISOString();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const { error: ce } = await admin.from("owner_contact_consents").insert({ job_id: job.id, owner_id: owner.id, source: ONSITE_CONSENT_SOURCE, consent_key: byOwner ? "owner_ticked" : "installer_confirmed", consent_status: "granted", contact_consent: true, consented_at: nowIso, snapshot: { by: byOwner ? "owner" : "installer", text, recorded_by: userId }, sha256: hash });
  if (ce) throw new WorkflowError(`Consent could not be saved: ${ce.message}`);
  await logEvent(job.id, userId, "installer_contact_permission", byOwner ? "Owner ticked contact and privacy consent on the installer's phone" : "Installer confirmed the owner gave consent", { wording: text, by: byOwner ? "owner" : "installer" }, { internal: true });

  // Decision 116: a visit day + time entered on Add a job is the same booking the job page writes (confirmBooking,
  // then the form with the booked date). A refusal never undoes the job; the installer can enter it on the job later.
  let booking: AddJobBooking = "none";
  if (opts.visit) {
    try {
      await (await import("./trade-view.server")).tradeSetReadyCheckTime(userId, job.id, opts.visit, now, call);
      booking = "confirmed";
    } catch (error) {
      booking = "blocked";
      await logEvent(job.id, userId, "installer_visit_time_not_saved", "Visit day and time entered on Add a job could not be saved as the Ready Check booking; the job is saved and the time can be entered on the job", { reason: error instanceof Error ? error.message : "Booking checks blocked confirmation", visit: opts.visit }, { internal: true });
    }
  }
  // Start the guarded create immediately after saving, booking or not. A booking background attempt can share
  // the atomic claim; an existing form skips. The tick remains the backup after a failure.
  const { onReadyCheckJobAdded } = await import("./mitti-create.server");
  const formCreation = await onReadyCheckJobAdded(job.id, userId, call).catch((e) => { console.error("ready check form not scheduled", (e as Error).message); return "skipped" as const; });
  const state = await onsiteFormFor(job.id, userId, call, false);
  return { jobId: job.id, jobNumber: job.job_number, booking, formCreation, state };
}

/**
 * Status for "Getting your form ready…". T3: the status read (poll) is strictly read-only and never calls Mitti.
 * `request` (the explicit "Try again" action) schedules creation in the background and returns at once;
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
  const [{ data: b }, { data: ws }, { data: m }, { count: booked }, { data: err }] = await Promise.all([
    admin.from("businesses").select("mitti_account_invited").eq("id", businessId).maybeSingle(),
    admin.from("workflow_settings").select("mitti_ready_check_priced_template_id, auto_send_mitti").eq("id", 1).maybeSingle(),
    admin.from("ceiling_measurements").select("external_source, external_id, status").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed"),
    admin.from("workflow_events").select("summary, created_at").eq("job_id", jobId).eq("event_type", "mitti_access_needed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    mittiInvited: b?.mitti_account_invited === true, templateSet: !!ws?.mitti_ready_check_priced_template_id?.trim(), autoSend: ws?.auto_send_mitti === true,
    gateADone: true, booked: !!booked,
    auditId: m?.external_source === "mitti" ? m.external_id ?? null : null,
    lastError: (err as { summary?: string } | null)?.summary ?? null,
  };
}
