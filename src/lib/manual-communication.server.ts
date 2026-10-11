// A1 manual customer communication (STEP 17). Office-only: every caller enforces requireAdmin.
// prepareManualEmail renders ONLY through the existing approved, guarded render paths (Save my spot preview, ineligible
// render twin) and writes no send record: it never reserves customer_email_sends, calls a provider or records a
// communication. recordManualCommunication writes ONE immutable job_communications row (provider "manual", Office-only
// visibility). Neither sends anything, changes approval flags or the comms lock, or touches lead_campaign_responses
// ("Save my spot" stays owner-driven).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { LAUNCH_CAMPAIGN } from "./launch-campaign.core";
import { communicationOrigin } from "./portal-presentation.core";
import {
  MANUAL_OUTCOME_LABEL, MANUAL_SENDER, MANUAL_SOURCE_EVENT, MANUAL_TEMPLATE_LABEL, SYSTEM_ALREADY_SENT, SYSTEM_SENT_STATUSES,
  manualOutcomeOf, manualReasonText, manualRecordBlocker, manualRecordContent, manualTemplateFor, planManualRecord,
  type ManualEmailTemplate, type ManualRecordInput, type PreparedManualEmail,
} from "./manual-communication.core";

/** customer_email_sends.purpose written by the portal sender of each template. */
const SEND_PURPOSE: Record<ManualEmailTemplate, string> = { save_my_spot: LAUNCH_CAMPAIGN, ineligible_result: "preliminary_ineligible" };
const melbourne = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The lead's approved A1 email, rendered exactly as the portal sender would, for Office to copy. Fails closed. */
export async function prepareManualEmail(jobId: string, actorId: string | null): Promise<PreparedManualEmail> {
  const { data: job, error } = await admin.from("jobs").select("id, job_number").eq("id", jobId).maybeSingle();
  if (error) return { ok: false, jobId, jobNumber: null, reason: "Could not read the lead. Nothing prepared; try again." };
  if (!job) return { ok: false, jobId, jobNumber: null, reason: "Job not found." };
  const jobNumber = job.job_number ?? null;
  const no = (reason: string): PreparedManualEmail => ({ ok: false, jobId, jobNumber, reason });

  const { selectLeadEmailRoute } = await import("./lead-email-routing.server");
  const route = await selectLeadEmailRoute(jobId);
  if (!route) return no("Job not found.");
  const { data: est, error: estError } = await admin.from("indicative_estimates").select("area_source").eq("job_id", jobId).eq("status", "current").maybeSingle();
  if (estError) return no("Could not read the current estimate. Nothing prepared; try again.");
  const pick = manualTemplateFor({ route: route.email, routeBlocker: route.blocker, typicalSizeEstimate: est?.area_source === "typical_default" });
  if ("blocked" in pick) return no(pick.blocked);

  const { data: sends, error: sendError } = await admin.from("customer_email_sends").select("id").eq("job_id", jobId).eq("purpose", SEND_PURPOSE[pick.template]).in("status", SYSTEM_SENT_STATUSES).limit(1);
  if (sendError) return no("Could not check the portal's delivery history. Nothing prepared; try again.");
  if ((sends ?? []).length > 0) return no(SYSTEM_ALREADY_SENT);

  let mail: { to: string; subject: string; html: string; plainText: string };
  if (pick.template === "save_my_spot") {
    // Existing render-only path: mode "preview" never reserves, sends or records (see sendOne in hot-leads-send.server.ts).
    const { sendSaveMySpot } = await import("./hot-leads-send.server");
    const [r] = await sendSaveMySpot([jobId], actorId, { mode: "preview" });
    if (!r?.preview) return no(r?.detail ?? "Could not prepare the email.");
    mail = r.preview;
  } else {
    const { prepareIneligibleEmailForOffice } = await import("./followups.server");
    const r = await prepareIneligibleEmailForOffice(jobId);
    if (!r.ok) return no(manualReasonText(r.reason) ?? r.reason);
    const { suppressionFor } = await import("./emailsafety.server");
    const suppressed = manualReasonText(await suppressionFor(jobId, "preliminary_ineligible", r.to));
    if (suppressed) return no(suppressed);
    mail = r;
  }

  const { data: prior } = await admin.from("job_communications").select("created_at").eq("job_id", jobId).eq("source_event", `${MANUAL_SOURCE_EVENT}:sent_manually`).order("created_at", { ascending: false }).limit(1);
  const last = prior?.[0]?.created_at;
  const notices = last ? [`Office already recorded sending this lead an email by hand on ${melbourne(last)}. Check before sending again.`] : [];
  return { ok: true, jobId, jobNumber, template: pick.template, templateLabel: MANUAL_TEMPLATE_LABEL[pick.template], to: mail.to, subject: mail.subject, plainText: mail.plainText, html: mail.html, notices };
}

export type ManualRecordRequest = ManualRecordInput & { jobId: string };

/** Records what Office did outside the portal. One immutable job_communications row; never sends anything. */
export async function recordManualCommunication(input: ManualRecordRequest, actorId: string | null) {
  const blocker = manualRecordBlocker(input);
  if (blocker) throw new Error(blocker);
  const { data: job, error } = await admin.from("jobs").select("id, job_number, owners(email)").eq("id", input.jobId).maybeSingle();
  if (error) throw new Error("Could not read the job. Nothing was recorded; try again.");
  if (!job) throw new Error("Job not found. Nothing was recorded.");
  const plan = planManualRecord(input.outcome);
  const content = manualRecordContent(input);
  const owner = job.owners as { email: string | null } | { email: string | null }[] | null;
  const email = (Array.isArray(owner) ? owner[0]?.email : owner?.email)?.trim().toLowerCase() || null;
  const at = new Date().toISOString();
  const { recordCommunication } = await import("./comms.server");
  const id = await recordCommunication({
    jobId: input.jobId, direction: plan.direction, channel: plan.channel, senderText: MANUAL_SENDER, senderUserId: actorId,
    recipients: plan.channel === "email" && email ? [email] : [], subject: content.subject, body: content.body,
    provider: plan.provider, deliveryStatus: plan.deliveryStatus, visibility: plan.visibility, at,
    sourceEvent: plan.sourceEvent, sourceReference: content.sourceReference, createdBy: actorId,
  });
  return {
    id: String(id), jobId: input.jobId, jobNumber: job.job_number ?? null, outcome: input.outcome, label: MANUAL_OUTCOME_LABEL[input.outcome],
    recordedAt: at, delivered: false as const, countsAsOwnerContact: plan.countsAsOwnerContact,
  };
}

/** The job's communication records, newest first, each labelled manual (Office) or system (portal sender). */
export async function manualCommunicationHistory(jobId: string) {
  const { data, error } = await admin.from("job_communications").select("id, created_at, sent_at, received_at, direction, channel, subject, body, provider, delivery_status, source_event, created_by").eq("job_id", jobId).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error("Could not load the communication history. Try again.");
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x))];
  let people: { id: string; full_name: string | null; email: string | null }[] = [];
  if (ids.length) {
    const { data: p } = await admin.from("profiles").select("id, full_name, email").in("id", ids);
    people = p ?? [];
  }
  const who = new Map(people.map((p) => [p.id, p.full_name || p.email || "Office user"]));
  return rows.map((r) => {
    const origin = communicationOrigin(r);
    const outcome = manualOutcomeOf(r.source_event);
    return {
      id: r.id, at: r.sent_at ?? r.received_at ?? r.created_at, recordedAt: r.created_at, direction: r.direction, channel: r.channel, subject: r.subject,
      /** Office notes (phone / not sent / follow-up) are shown in full; email bodies stay in the Job File. */
      note: r.channel === "email" ? null : r.body, manual: origin.manual, originLabel: origin.label, outcomeLabel: outcome ? MANUAL_OUTCOME_LABEL[outcome] : null,
      by: r.created_by ? (who.get(r.created_by) ?? "Office user") : null,
    };
  });
}
