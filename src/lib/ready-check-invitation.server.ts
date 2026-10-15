// P1-R3-S92 — GAP-2: Template 8 Ready Check invitation, OFFICE MANUAL TRIGGER ONLY (owner Option A).
//
// There is NO automatic trigger here and none may be added: nothing in this module reacts to installer
// availability, area, a schedule, customer activity or Save-my-spot completion. An invitation exists only
// because an authorised Office user asked for one specific saved-spot job.
//
// Prepare and send are separate Office actions. Prepare renders only. Send re-checks every existing
// COM-04 safeguard (both runtime switches, consent, suppression, once-per-home idempotency) and writes
// an auditable workflow event. Nothing here creates a new sender or bypasses an existing control.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { hasCurrentOwnerContactConsent, recordCommunication } from "./comms.server";
import { template8SnapshotForJob } from "./personal-estimate.server";
import { renderJoReadyCheckInvitationEmail } from "./jo-outcome-email.core";
import { joRecipientFacts } from "./followups.server";
import { withUnsubscribe, reservationAllowed } from "./emailsafety.core";
import { suppressionFor as suppressionForEmail, unsubscribeUrlForJob } from "./emailsafety.server";
import { logEvent } from "./workflow.server";
import { configuredDeliveryAdapter } from "./delivery.server";
import {
  ALREADY_INVITED_MESSAGE,
  READY_CHECK_INVITATION_EVENT,
  READY_CHECK_INVITATION_PURPOSE,
  readyCheckInvitationBlocker,
  readyCheckInvitationKey,
  readyCheckSendingAllowed,
  type OfficeActor,
} from "./ready-check-invitation.core";
import type { DeliveryAdapter } from "./delivery.core";

export type PreparedReadyCheckInvitation =
  | { ok: true; jobId: string; jobNumber: string | null; to: string; subject: string; html: string; plainText: string; savedAt: string | null; snapshot: { customerTotal: number; veuRebate: number; totalBeforeRebate: number; ceilingAreaM2: number; personalEstimateUrl: string; readyCheckBookingUrl: string | null } }
  | { ok: false; jobId: string; jobNumber: string | null; reason: string };

export type SentReadyCheckInvitation = { sent: true; jobId: string; jobNumber: string | null; communicationId: string | number } | { sent: false; jobId: string; jobNumber: string | null; reason: string };

const CLOSED_STAGES = ["cancelled", "complete"];

/** One job's facts for the guard. Every read failure becomes a blocking fact (fail closed). */
async function factsFor(jobId: string) {
  const [{ data: job, error: jobError }, { data: response, error: responseError }] = await Promise.all([
    admin.from("jobs").select("id, job_number, stage, deleted_at, eligibility_outcome, eligibility_decision_source, eligibility_review_required").eq("id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at").eq("job_id", jobId).maybeSingle(),
  ]);
  if (jobError || responseError) return { job: null, savedSpot: false, unreadable: true };
  const snapshot = await template8SnapshotForJob(jobId);
  return {
    job: (job as { id: string; job_number: string | null; stage: string | null; deleted_at: string | null; eligibility_outcome: string | null; eligibility_review_required: boolean | null } | null) ?? null,
    savedSpot: !!response?.spot_saved_at && !response?.opted_out_at,
    snapshot: snapshot ?? null,
    unreadable: false,
  };
}

function jobIsEligible(job: { eligibility_outcome: string | null; eligibility_review_required: boolean | null } | null): boolean {
  if (!job) return false;
  if (job.eligibility_review_required) return false;
  return job.eligibility_outcome === "likely_eligible" || job.eligibility_outcome === "needs_onsite_confirmation";
}

/** The customer's email, read through the owner FK without an embedded relation. */
async function ownerEmailFor(jobId: string) {
  const { data: job } = await admin.from("jobs").select("external_enquiry_id, owner_id").eq("id", jobId).maybeSingle();
  const ownerId = (job as { owner_id?: string | null } | null)?.owner_id ?? null;
  const { data: owner } = ownerId
    ? await admin.from("owners").select("email").eq("id", ownerId).maybeSingle()
    : { data: null };
  return {
    email: ((owner as { email?: string | null } | null)?.email ?? "").trim().toLowerCase() || null,
    reference: (job as { external_enquiry_id?: string | null } | null)?.external_enquiry_id ?? null,
  };
}

/** COM-04 dual switch, read fresh from workflow_settings. Missing setting => blocked. */
async function readSwitches() {
  const { data, error } = await admin.from("workflow_settings").select("customer_comms_enabled, save_my_spot_real_send_enabled").limit(1).maybeSingle();
  if (error || !data) return null;
  const row = data as { customer_comms_enabled: boolean | null; save_my_spot_real_send_enabled: boolean | null };
  return { customerCommsEnabled: row.customer_comms_enabled, saveMySpotRealSendEnabled: row.save_my_spot_real_send_enabled };
}

/** Render-only. Office reviews the exact invitation before anything is sent. Writes one audit event. */
export async function prepareReadyCheckInvitation(jobId: string, actor: OfficeActor): Promise<PreparedReadyCheckInvitation> {
  const f = await factsFor(jobId);
  const jobNumber = f.job?.job_number ?? null;
  const blocker = f.unreadable
    ? "This job's saved quote could not be read. Nothing was prepared."
    : readyCheckInvitationBlocker(
      {
        jobExists: !!f.job,
        deleted: !!f.job?.deleted_at,
        closed: !!f.job && CLOSED_STAGES.includes(f.job.stage ?? ""),
        officialEligible: jobIsEligible(f.job),
        savedSpot: f.savedSpot,
        snapshot: f.snapshot ?? null,
      },
      actor,
    );
  if (blocker) return { ok: false, jobId, jobNumber, reason: blocker };

  const snapshot = f.snapshot!;
  const owner = await ownerEmailFor(jobId);
  if (!owner.email) return { ok: false, jobId, jobNumber, reason: "This customer has no email address. Nothing was prepared." };
  const who = await joRecipientFacts(jobId, owner.reference);
  const mail = renderJoReadyCheckInvitationEmail({
    firstName: who.firstName ?? "there",
    propertyAddress: who.address ?? "your property",
    enquiryReference: who.reference ?? "",
  }, snapshot);

  await logEvent(jobId, actor.userId, `${READY_CHECK_INVITATION_EVENT}:prepared`, `Office prepared a Ready Check invitation for ${jobNumber ?? "this job"} (nothing sent)`, { job_id: jobId, template: READY_CHECK_INVITATION_PURPOSE, saved_at: snapshot.savedAt, prepared_by: actor.userId, sent: false });
  return {
    ok: true, jobId, jobNumber, to: owner.email,
    subject: mail.subject, html: mail.html, plainText: mail.plainText, savedAt: snapshot.savedAt,
    snapshot: {
      customerTotal: snapshot.customerTotal, veuRebate: snapshot.veuRebate, totalBeforeRebate: snapshot.totalBeforeRebate,
      ceilingAreaM2: snapshot.ceilingAreaM2, personalEstimateUrl: snapshot.personalEstimateUrl, readyCheckBookingUrl: snapshot.readyCheckBookingUrl ?? null,
    },
  };
}

/**
 * The Office send action. Every existing safeguard runs before the provider is called:
 * authorisation, saved snapshot, BOTH COM-04 switches, contact consent, suppression/unsubscribe,
 * and once-per-home idempotency. Anything unresolved blocks with nothing sent.
 */
export async function sendReadyCheckInvitation(jobId: string, actor: OfficeActor, adapterIn?: DeliveryAdapter | null): Promise<SentReadyCheckInvitation> {
  const f = await factsFor(jobId);
  const jobNumber = f.job?.job_number ?? null;
  const blocker = f.unreadable
    ? "This job's saved quote could not be read. Nothing was sent."
    : readyCheckInvitationBlocker(
      {
        jobExists: !!f.job,
        deleted: !!f.job?.deleted_at,
        closed: !!f.job && CLOSED_STAGES.includes(f.job.stage ?? ""),
        officialEligible: jobIsEligible(f.job),
        savedSpot: f.savedSpot,
        snapshot: f.snapshot ?? null,
      },
      actor,
    );
  if (blocker) return { sent: false, jobId, jobNumber, reason: blocker };

  // COM-04 owner Option A: BOTH runtime switches. Missing settings never count as on.
  const switches = await readSwitches();
  if (!switches || !readyCheckSendingAllowed(switches)) return { sent: false, jobId, jobNumber, reason: "Sending is switched off. Nothing was sent." };
  if (!(await hasCurrentOwnerContactConsent(jobId))) return { sent: false, jobId, jobNumber, reason: "This customer has no current contact consent. Nothing was sent." };
  const adapter = adapterIn === undefined ? await configuredDeliveryAdapter() : adapterIn;
  if (!adapter) return { sent: false, jobId, jobNumber, reason: "The email service isn't configured. Nothing was sent." };

  const owner = await ownerEmailFor(jobId);
  const to = owner.email;
  if (!to) return { sent: false, jobId, jobNumber, reason: "This customer has no email address. Nothing was sent." };
  const suppressed = await suppressionForEmail(jobId, READY_CHECK_INVITATION_PURPOSE, to);
  if (suppressed) return { sent: false, jobId, jobNumber, reason: suppressed };

  // Once per home, ever: the idempotency key is the job, not the batch.
  const key = readyCheckInvitationKey(jobId);
  const { data: ex } = await admin.from("customer_email_sends").select("id, status").eq("idempotency_key", key).maybeSingle();
  if (ex && (ex.status === "sent" || !reservationAllowed(ex))) return { sent: false, jobId, jobNumber, reason: ALREADY_INVITED_MESSAGE };
  let sendId = ex?.id ?? null;
  let reservedAt: string | null = null;
  if (ex) {
    const at = new Date().toISOString();
    const { data: again, error: againError } = await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: at }).eq("id", ex.id).eq("status", "failed").select("id");
    if (againError || !again?.length) return { sent: false, jobId, jobNumber, reason: ALREADY_INVITED_MESSAGE };
    reservedAt = at;
  } else {
    const { data, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: READY_CHECK_INVITATION_PURPOSE, idempotency_key: key, status: "sending" }).select("id, created_at").single();
    if (error || !data) return { sent: false, jobId, jobNumber, reason: ALREADY_INVITED_MESSAGE };
    sendId = data.id;
    reservedAt = (data as { created_at?: string | null }).created_at ?? null;
  }

  const snapshot = f.snapshot!;
  const who = await joRecipientFacts(jobId, owner.reference);
  const rendered = renderJoReadyCheckInvitationEmail({
    firstName: who.firstName ?? "there",
    propertyAddress: who.address ?? "your property",
    enquiryReference: who.reference ?? "",
  }, snapshot);
  const mail = withUnsubscribe(rendered, await unsubscribeUrlForJob(jobId));

  let delivered = false;
  try {
    const r = await adapter.deliver({ to, subject: mail.subject, html: mail.html, text: mail.plainText, idempotencyKey: key, purpose: READY_CHECK_INVITATION_PURPOSE });
    delivered = true;
    const communicationId = await recordCommunication({
      jobId, direction: "outbound", channel: "email", recipients: [to], subject: mail.subject, body: mail.plainText,
      provider: adapter.provider, providerMessageId: r.providerMessageId, visibility: "customer",
      sourceEvent: READY_CHECK_INVITATION_PURPOSE, sourceReference: key, createdBy: actor.userId, deliveryStatus: "sent",
    });
    // Only THIS attempt's reservation may receive the result: if the Office has since re-resolved the
    // row it is no longer "sending", so a late provider result cannot overwrite the newer attempt.
    await admin.from("customer_email_sends").update({ status: "sent", sent_at: new Date().toISOString(), provider: adapter.provider, provider_message_id: r.providerMessageId, communication_id: communicationId }).eq("id", sendId!).eq("status", "sending");
    await logEvent(jobId, actor.userId, `${READY_CHECK_INVITATION_EVENT}:sent`, `Office sent the Ready Check invitation for ${jobNumber ?? "this job"}`, { job_id: jobId, template: READY_CHECK_INVITATION_PURPOSE, saved_at: snapshot.savedAt, sent_by: actor.userId, sent: true });
    return { sent: true, jobId, jobNumber, communicationId };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 280);
    if (delivered) {
      await admin.from("customer_email_sends").update({ status: "delivered_unrecorded", sent_at: new Date().toISOString(), provider: adapter.provider, error: `record_failed: ${msg}` }).eq("id", sendId!);
      return { sent: false, jobId, jobNumber, reason: "The provider accepted it but the result could not be recorded. Check delivery history before retrying." };
    }
    await admin.from("customer_email_sends").update({ status: "failed", error: msg }).eq("id", sendId!);
    return { sent: false, jobId, jobNumber, reason: "The email service refused it. Nothing was sent." };
  }
}

export type ReadyCheckCandidate = {
  jobId: string; jobNumber: string | null; ownerName: string | null; ownerEmail: string | null;
  address: string | null; spotSavedAt: string | null; savedTotal: number | null; savedAreaM2: number | null;
};

/** Saved-spot eligible jobs, for the Office worklist. Read-only; never triggers anything. */
export async function loadReadyCheckCandidates(): Promise<ReadyCheckCandidate[]> {
  const { data, error } = await admin
    .from("lead_campaign_responses")
    .select("job_id, spot_saved_at, opted_out_at, saved_total, saved_area_m2")
    .limit(200);
  if (error) throw new Error(error.message);
  // A saved spot with no opt-out; anything else is not invitation material.
  const saved = ((data ?? []) as unknown as Array<{ job_id: string; spot_saved_at: string | null; opted_out_at: string | null; saved_total: number | null; saved_area_m2: number | null }>)
    .filter((r) => !!r.spot_saved_at && !r.opted_out_at)
    .sort((a, b) => String(a.spot_saved_at).localeCompare(String(b.spot_saved_at)));
  const ids = saved.map((r) => r.job_id);
  if (!ids.length) return [];
  const { fullAddress } = await import("./address");
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, job_number, stage, deleted_at, source, owner_id, property_id, eligibility_outcome, eligibility_review_required")
    .in("id", ids);
  const rows = (jobs ?? []) as unknown as Array<{ id: string; job_number: string | null; stage: string | null; deleted_at: string | null; source: string | null; owner_id: string | null; property_id: string | null; eligibility_outcome: string | null; eligibility_review_required: boolean | null }>;
  const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter((x): x is string => !!x))];
  const propIds = [...new Set(rows.map((r) => r.property_id).filter((x): x is string => !!x))];
  const [owners, props] = await Promise.all([
    ownerIds.length ? admin.from("owners").select("id, full_name, email").in("id", ownerIds) : { data: [] },
    propIds.length ? admin.from("properties").select("id, address_line, suburb, postcode").in("id", propIds) : { data: [] },
  ]);
  const ownerById = new Map(((owners.data ?? []) as unknown as Array<{ id: string; full_name: string | null; email: string | null }>).map((o) => [o.id, o]));
  const propById = new Map(((props.data ?? []) as unknown as Array<{ id: string; address_line: string | null; suburb: string | null; postcode: string | null }>).map((p) => [p.id, p]));

  const out: ReadyCheckCandidate[] = [];
  for (const r of saved) {
    const job = rows.find((j) => j.id === r.job_id);
    if (!job || job.deleted_at || CLOSED_STAGES.includes(job.stage ?? "") || job.source === "qa_test") continue;
    if (!jobIsEligible(job)) continue;
    const owner = job.owner_id ? ownerById.get(job.owner_id) : undefined;
    const prop = job.property_id ? propById.get(job.property_id) : undefined;
    out.push({
      jobId: r.job_id, jobNumber: job.job_number ?? null, ownerName: owner?.full_name ?? null, ownerEmail: owner?.email ?? null,
      address: prop ? fullAddress(prop.address_line, prop.suburb, prop.postcode) : null,
      spotSavedAt: r.spot_saved_at, savedTotal: r.saved_total, savedAreaM2: r.saved_area_m2,
    });
  }
  return out;
}
