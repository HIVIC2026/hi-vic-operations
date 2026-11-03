// Installer "Add a job" persistence (Jo, 7 Oct 2026; basics only since decisions 34/115, 24 Oct 2026).
// Creates the installer-supplied job the same way Upload jobs does (always a new owner, stage Ready Check ready to
// schedule, no booking) unless the address already has an OPEN job (decision 282: linked + office flag, no new job),
// records the owner's contact permission, then creates the installer's Mitti Ready Check form
// straight away through the existing claim-guarded createAssignMittiAudit path (decision 115: no booking needed).
// Task 7 (installer screens): the form no longer asks for a visit time; the Ready Check is booked from the job page.
// Mitti stays hidden until the office ticks "Mitti account invited" for the business.
// Task 19: after the save the customer is texted the rental quick taps (own-customer-rental-taps.server; off until Jo approves).
// A6 (Jo 29 Oct): the save is one transaction (`add_installer_job`, add-installer-job.server) keyed by the phone's request
// key, so Try again finishes the same job; until that function is live the step-by-step save below is used.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { early } from "./early-read";
// Speed (installer screens, Task 7): namespace import (read at call time) so the memberships read starts with the job read.
import * as pilotServer from "./pilot.server";
import { ONSITE_CONSENT_SOURCE, READY_CHECK_FORM_COMING, TEST_MITTI_ASSIGNEE, onsiteProblems, onsiteState, type OnsiteInput, type OnsiteState } from "./onsite-ready-check.core";
import type { ElectricianPlan } from "./job-electrician.core";
import type { MittiCall } from "./mitti.core";

export type AddJobBooking = "none" | "confirmed" | "blocked";
export type AddJobResult = { jobId: string; jobNumber: string | null; booking: AddJobBooking; formCreation: "scheduled" | "skipped"; state: OnsiteState; /** Task 7: whether the chosen Team electrician was put on the job. */ electrician: "allocated" | "not_allocated" | "not_asked"; ownerFirstName: string | null };

export async function startOnsiteReadyCheckFor(userId: string, businessId: string, input: OnsiteInput, electrician: ElectricianPlan | null = null, call?: MittiCall, opts: { now?: Date; /** Decision 289: null = the default rule (usual electrician when saved, else Home Insulation Victoria's). Legacy callers only. */ electricianChoice?: import("./electrician-choice.core").ElectricianChoice | null; /** Task 7: the Team electrician for the PIESA (required on the portal's server function; `undefined` only from pre-Task-7 callers). */ electricianWorkerId?: string | null; /** A1: how the installer got this customer; door-knock and cold call are refused. */ leadOrigin?: import("./onsite-ready-check.core").LeadOrigin | null; /** A6: the phone's key for this draft; a key already saved resumes that job. */ requestKey?: string | null } = {}): Promise<AddJobResult> {
  const { requireApprovedPartner, intakeSourceFor } = await import("./pilot.server");
  // Task 7 (Task 1 roles): the boss and Office people add jobs for their own business; nobody else.
  const c = await (await import("./trade-view.server")).pricesOrThrow(userId);
  if (c.biz.id !== businessId) throw new WorkflowError("You are not part of this business.");
  await requireApprovedPartner(businessId);
  const now = opts.now ?? new Date();
  const businessName = c.biz.name;
  const problems = onsiteProblems(input, { businessName });
  const { electricianPlanBlocker } = await import("./job-electrician.core");
  const eb = electricianPlanBlocker(electrician); if (eb) problems.push(eb);
  const lop = (await import("./onsite-ready-check.core")).leadOriginProblem(opts.leadOrigin); if (lop) problems.push(lop);
  // Task 7: the electrician for the PIESA is one of the business's verified Team electricians, checked BEFORE anything is saved.
  const { electricianProblem, addJobConsentRecord } = await import("./add-job-flow.core");
  const teamElectricians = opts.electricianWorkerId ? await (await import("./in-house-electrician.server")).teamElectricianChoices(businessId) : [];
  const ecp = opts.electricianWorkerId === undefined ? null : electricianProblem(opts.electricianWorkerId, teamElectricians); if (ecp) problems.push(ecp);
  const electricianChoice: import("./electrician-choice.core").ElectricianChoice = opts.electricianChoice ?? "hivic";
  if (problems.length) throw new WorkflowError(problems.join(" • "));

  // A6: one request key per phone draft. A key an earlier tap already saved means the signal dropped after the save:
  // finish THAT job (electrician + form steps below) instead of checking the address or saving again.
  const requestKey = opts.requestKey ?? crypto.randomUUID();
  const { findAddedJob, addInstallerJobAtomic } = await import("./add-installer-job.server");
  const earlier = await findAddedJob(requestKey, businessId);
  let job: { id: string; job_number: string | null };
  if (earlier) job = { id: earlier.jobId, job_number: earlier.jobNumber };
  else {
    const email = input.email.trim().toLowerCase();
    const source = await intakeSourceFor(userId, businessId, "installer_onsite");
    // Decision 282 (Jo 25 Oct): only the address matters. An open job at this address is told to the office and the
    // installer sees its number; nothing is created. Email/phone are never a reason to refuse.
    const { findOpenJobAtAddress, flagDuplicateAddress, businessNameFor } = await import("./duplicate-address.server");
    const open = await findOpenJobAtAddress({ address_line: input.address_line, suburb: input.suburb, postcode: input.postcode, source }, { preferNonLead: true });
    const clash = (await import("./duplicate-address.core")).addJobClashAction(open);
    // Jo 28 Oct: an open HIV lead at this address does not block the installer; the job is saved and flagged below.
    // A6 race: a Try again tap with this request key may have saved this very job since the check above. Finish that job
    // instead of refusing it (and never flag it to the office).
    const raced = open && clash === "refuse" ? await findAddedJob(requestKey, businessId) : null;
    if (raced) job = { id: raced.jobId, job_number: raced.jobNumber };
    else {
      if (open && clash === "refuse") {
        await flagDuplicateAddress(open, userId, { from: "add_a_job", business_id: businessId, business_name: await businessNameFor(businessId), full_name: input.full_name.trim(), email, phone: input.phone.trim(), address_line: input.address_line.trim(), suburb: input.suburb.trim(), postcode: input.postcode.trim() });
        throw new WorkflowError((await import("./duplicate-address.core")).duplicateAddressMessage(open.job_number));
      }
      const { DUPLICATE_ADDRESS_EVENT, hivLeadClashSummary } = await import("./duplicate-address.core");
      const flag = open && clash === "save_and_flag" ? { summary: hivLeadClashSummary(open.job_number), details: { from: "add_a_job", existing_job_id: open.id, existing_job_number: open.job_number, needs_office: true } } : null;
      // Gate A (Jo, 8 Oct): the installer confirmed the owner's consent to be contacted.
      const { gateDoc } = await import("./owner-gates.core");
      const byOwner = input.consent_by === "owner";
      // Task 7: the approved tick names Home Insulation Victoria AND the installer (VEU rule 1); it is the wording shown and
      // recorded, with Part 3's consent record (who / purpose / methods / expiry) in the snapshot. Older jobs keep theirs.
      const givenAt = now.toISOString();
      const record = addJobConsentRecord(businessName, givenAt);
      const text = byOwner ? gateDoc("contact_privacy").body : record.wording;
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const consent = { key: byOwner ? "owner_ticked" as const : "installer_confirmed" as const, by: byOwner ? "owner" as const : "installer" as const, text, sha256: hash, record: byOwner ? null : { snapshot: record.snapshot, event: record.event } };

      /** Today's step-by-step writes, unchanged: used until add_installer_job is live, and for a "mine" electrician plan. */
      const legacySequentialSave = async (): Promise<{ id: string; job_number: string | null }> => {
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
        if (flag) await logEvent(job.id, userId, DUPLICATE_ADDRESS_EVENT, flag.summary, flag.details, { internal: true });
        await logEvent(job.id, userId, "installer_job_added", "Installer added this customer (Add a job: name, address, mobile, email, contact permission); the Mitti Ready Check form is created next", { business_id: businessId, visit_requested: false, lead_origin: opts.leadOrigin });
        const nowIso = new Date().toISOString();
        const { error: ce } = await admin.from("owner_contact_consents").insert({ job_id: job.id, owner_id: owner.id, source: ONSITE_CONSENT_SOURCE, consent_key: consent.key, consent_status: "granted", contact_consent: true, consented_at: nowIso, snapshot: { by: consent.by, text, recorded_by: userId, ...(consent.record?.snapshot ?? {}) }, sha256: hash });
        if (ce) throw new WorkflowError(`Consent could not be saved: ${ce.message}`);
        await logEvent(job.id, userId, "installer_contact_permission", byOwner ? "Owner ticked contact and privacy consent on the installer's phone" : "Installer confirmed the owner gave consent", { wording: text, by: consent.by, ...(consent.record?.event ?? {}) }, { internal: true });
        return job;
      };

      // A6: owner, property, job, assignment, consent and events in ONE transaction (nothing half-saved). The SQL only
      // records Home Insulation Victoria's electrician arrangement; a "mine" plan keeps the step-by-step save.
      const mode = (electrician as { mode?: string } | null)?.mode;
      const saved = mode === "mine" || mode === "later" ? "not_deployed" as const : await addInstallerJobAtomic((await import("./add-installer-job.core")).addInstallerJobPayload({
        requestKey, businessId, userId, source, owner: { full_name: input.full_name, email, phone: input.phone },
        property: { address_line: input.address_line, suburb: input.suburb, postcode: input.postcode }, consent,
        electricianChoice: (await import("./electrician-choice.core")).electricianChoiceRecord(electricianChoice, null, "add_job"),
        leadOrigin: opts.leadOrigin as import("./onsite-ready-check.core").LeadOrigin, visitRequested: false, flagEvent: flag,
      }));
      if (saved === "not_deployed") job = await legacySequentialSave();
      else job = { id: saved.jobId, job_number: saved.jobNumber };
    }
  }

  // Task 7: no visit time is taken here any more — the Ready Check is booked from the job page's Next step box.
  const booking: AddJobBooking = "none";
  // Task 7: the chosen Team electrician is put on the job through the existing allocation path (assignment RPC + Mitti form
  // hand-over). The job is already saved; a refusal here is logged on the job and the installer can pick again on the job page.
  let electricianAllocated: "allocated" | "not_allocated" | "not_asked" = "not_asked";
  if (opts.electricianWorkerId) {
    try { await (await import("./in-house-electrician.server")).allocateElectrician(job.id, userId, opts.electricianWorkerId, call); electricianAllocated = "allocated"; }
    catch (error) {
      electricianAllocated = "not_allocated";
      await logEvent(job.id, userId, "add_job_electrician_not_allocated", "The electrician chosen on Add a job could not be put on the job; choose again on the job page", { worker_id: opts.electricianWorkerId, reason: error instanceof Error ? error.message : String(error) }, { internal: true }).catch(console.error);
    }
  }
  // Start the guarded create immediately after saving, booking or not. A booking background attempt can share
  // the atomic claim; an existing form skips. The tick remains the backup after a failure.
  const { onReadyCheckJobAdded } = await import("./mitti-create.server");
  const formCreation = await onReadyCheckJobAdded(job.id, userId, call).catch((e) => { console.error("ready check form not scheduled", (e as Error).message); return "skipped" as const; });
  // Task 19 (Jo 2 Nov 2026, answer 24): the installer's own customer is texted the rental questions (draft wording, off until
  // Jo approves it). Not on this form; a failure here never fails Add a job.
  try { await (await import("./own-customer-rental-taps.server")).textOwnRentalTaps(job.id); }
  catch (e) { console.error("rental questions text not sent", (e as Error).message); }
  const state = await onsiteFormFor(job.id, userId, call, false);
  return { jobId: job.id, jobNumber: job.job_number, booking, formCreation, state, electrician: electricianAllocated, ownerFirstName: input.full_name.trim().split(/\s+/)[0] ?? null };
}

/**
 * Status for "Getting your form ready…". T3: the status read (poll) is strictly read-only and never calls Mitti.
 * `request` (the explicit "Try again" action) schedules creation in the background and returns at once;
 * duplicates are prevented by the atomic claim inside createAssignMittiAudit.
 */
export async function onsiteFormFor(jobId: string, userId: string, call?: MittiCall, request = false): Promise<OnsiteState> {
  // Speed (installer screens, Task 7): two rounds. (1) The job, the caller's memberships and every status read that needs
  // only the job id; (2) the business's Mitti flag. The job refusal, then the membership refusal, are awaited first; the
  // reads started before them are read-only and dropped when refused. Nothing is written before both checks pass.
  const jP = early(admin.from("jobs").select("channel, originating_installer_business_id, source").eq("id", jobId).maybeSingle());
  const membersP = early((async () => pilotServer.myBusinesses(userId))());
  const jobReads = factsJobReads(jobId);
  const { data: j } = await jP;
  if (!j || j.channel !== "installer_sourced" || !j.originating_installer_business_id) throw new WorkflowError("This job isn't one of your customers.");
  const bizP = early(admin.from("businesses").select("mitti_account_invited").eq("id", j.originating_installer_business_id).maybeSingle());
  await pilotServer.requireMember(userId, j.originating_installer_business_id, false, membersP);
  const facts = await factsFor(jobId, j.originating_installer_business_id, { biz: bizP, ...jobReads });
  const state = onsiteState(facts);
  if (!request || (state.kind !== "preparing" && state.kind !== "retry")) return state;
  const { data: prof } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const { scheduleReadyCheckFormCreation } = await import("./mitti-create.server");
  await scheduleReadyCheckFormCreation(jobId, userId, { userId, fullName: prof?.full_name ?? null, email: j.source === "qa_test" ? TEST_MITTI_ASSIGNEE : prof?.email ?? "" }, call);
  return onsiteState({ ...facts, lastError: null });
}

/** The status reads that need only the job id (started early by onsiteFormFor). */
function factsJobReads(jobId: string) {
  return {
    ws: early(admin.from("workflow_settings").select("mitti_ready_check_priced_template_id, auto_send_mitti").eq("id", 1).maybeSingle()),
    m: early(admin.from("ceiling_measurements").select("external_source, external_id, status").eq("job_id", jobId).eq("is_current", true).maybeSingle()),
    booked: early(admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed")),
    err: early(admin.from("workflow_events").select("summary, created_at").eq("job_id", jobId).eq("event_type", "mitti_access_needed").order("created_at", { ascending: false }).limit(1).maybeSingle()),
  };
}

async function factsFor(jobId: string, businessId: string, pre?: ReturnType<typeof factsJobReads> & { biz: PromiseLike<{ data: { mitti_account_invited: boolean | null } | null }> }) {
  const r = pre ?? { biz: admin.from("businesses").select("mitti_account_invited").eq("id", businessId).maybeSingle(), ...factsJobReads(jobId) };
  const [{ data: b }, { data: ws }, { data: m }, { count: booked }, { data: err }] = await Promise.all([r.biz, r.ws, r.m, r.booked, r.err]);
  return {
    mittiInvited: b?.mitti_account_invited === true, templateSet: !!ws?.mitti_ready_check_priced_template_id?.trim(), autoSend: ws?.auto_send_mitti === true,
    gateADone: true, booked: !!booked,
    auditId: m?.external_source === "mitti" ? m.external_id ?? null : null,
    lastError: (err as { summary?: string } | null)?.summary ?? null,
  };
}
