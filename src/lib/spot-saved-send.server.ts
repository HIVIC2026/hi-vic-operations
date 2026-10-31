// Jo 23 Oct 2026: real "Spot saved" confirmation — the approved email through the same email service the
// launch emails use, and the approved text through the one real SMS sender (Twilio) the reminders use.
// One email + one text per OWNER (address/number keys), switch-gated, every contact guard re-checked.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { planSpotSaved, spotSavedDeliveryChanged, SPOT_SAVED_EMAIL_PURPOSE, SPOT_SAVED_EMAIL_SWITCH, SPOT_SAVED_SMS_SWITCH, type ChannelPlan } from "./spot-saved-send.core";
import { SUPPRESSING_EVENTS } from "./emailsafety.core";
import { smsQuietReason } from './quote-hold.core';

type Msgs = { job: { source: string | null }; email: { subject: string; text: string; html?: string }; sms: string; optOutUrl: string | null; rebate: number };
const OWNER_BASE = "https://estimate.homeinsulationvictoria.com.au";

/** The approved Spot saved text + email for this job, from the owner's saved estimate figures. */
export async function buildSpotSavedMessages(jobId: string, token: string) {
  const [{ data: job }, { data: r }] = await Promise.all([
    admin.from("jobs").select("source, owners(full_name, phone, email), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("saved_estimate_id, saved_veu_discount, saved_gross_total, saved_total, saved_area_m2").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!job) return null;
  const { renderSpotSavedEmail, renderSpotSavedSms, addressBits } = await import("./spot-saved-messages.core");
  const { unsubscribeUrlForJob } = await import("./emailsafety.server");
  const { referralUrlForJob } = await import("./referral.server");
  const owner = job.owners as { full_name: string | null; phone: string | null; email: string | null } | null;
  const prop = job.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
  const bits = addressBits(prop?.address_line ?? null, prop?.suburb ?? null);
  const optOutUrl = await unsubscribeUrlForJob(jobId);
  const input = {
    firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null, rebate: Number(r?.saved_veu_discount ?? 0), suburb: bits.suburb, shortAddress: bits.short,
    myJobUrl: `${OWNER_BASE}/my-job/${token}`, optOutUrl, referralUrl: await referralUrlForJob(jobId),
    estimate: r?.saved_gross_total ? { gross: Number(r.saved_gross_total), customer: Number(r.saved_total), areaM2: Number(r.saved_area_m2), address: bits.short ? `${bits.short} VIC${prop?.postcode ? ` ${prop.postcode}` : ""}` : null, calculatorUrl: `${OWNER_BASE}/estimate/${token}/calculator` } : null,
  };
  // Jo 23 Oct: removal fact from the owner's saved estimate, same as the Save my spot email.
  let estimateQuery = admin.from("indicative_estimates").select("scenarios").eq("job_id", jobId);
  estimateQuery = r?.saved_estimate_id ? estimateQuery.eq("id", r.saved_estimate_id) : estimateQuery.eq("status", "current");
  const { data: est } = await estimateQuery.maybeSingle();
  const { removalFromScenario } = await import("./estimate-removal.core");
  const email = renderSpotSavedEmail({ ...input, removal: removalFromScenario(Array.isArray(est?.scenarios) ? est.scenarios[0] : null) }) as { subject: string; text: string; html?: string };
  return { job, owner, sms: renderSpotSavedSms(input), email, optOutUrl, rebate: input.rebate };
}

async function activeEstimateToken(jobId: string): Promise<string | null> {
  const { data } = await admin.from("customer_estimate_links").select("token, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data && (!data.expires_at || new Date(data.expires_at).getTime() > Date.now()) ? (data.token as string) : null;
}

export type SpotSavedSendResult = { jobId: string; email: { status: string; detail: string }; sms: { status: string; detail: string } };

/** Send (or, with dry, only plan) the confirmation for one job. Never throws for an individual channel. */
export async function sendSpotSavedConfirmation(jobId: string, opts: { dry?: boolean; token?: string | undefined; emailOnly?: boolean } = {}): Promise<SpotSavedSendResult> {
  const [{ data: job }, { data: resp }, { data: ws }, { data: eopt }, { count: supp }] = await Promise.all([
    admin.from("jobs").select("source, stage, deleted_at, qa_archived_at, owners(phone, email)").eq("id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at").eq("job_id", jobId).maybeSingle(),
    admin.from("workflow_settings").select("customer_comms_enabled, sms_message_switches").eq("id", 1).maybeSingle(),
    admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
    admin.from("customer_engagement_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).in("event_type", SUPPRESSING_EVENTS.filter((e) => e.startsWith("email") || e === "complaint" || e === "opted_out")),
  ]);
  const owner = (job?.owners ?? null) as { phone: string | null; email: string | null } | null;
  const token = opts.token ?? (await activeEstimateToken(jobId));
  const { toAuE164, smsStaleReason } = await import("./sms.core");
  const e164 = toAuE164(owner?.phone ?? null);
  let smsStopped = false;
  if (e164) {
    const { data: so } = await admin.from("sms_optouts").select("opted_out_at, opted_in_at").eq("phone", e164).maybeSingle();
    smsStopped = !!so?.opted_out_at && (!so.opted_in_at || Date.parse(so.opted_in_at) < Date.parse(so.opted_out_at));
  }
  const sw = ((ws?.sms_message_switches ?? {}) as Record<string, unknown>);
  const plan = planSpotSaved({
    source: job?.source ?? null, stage: job?.stage ?? null, deletedAt: job?.deleted_at ?? null, qaArchivedAt: job?.qa_archived_at ?? null,
    spotSavedAt: resp?.spot_saved_at ?? null, campaignOptedOutAt: resp?.opted_out_at ?? null,
    consent: await (await import("./comms.server")).hasCurrentOwnerContactConsent(jobId), commsEnabled: ws?.customer_comms_enabled === true,
    email: owner?.email ?? null, phone: owner?.phone ?? null, emailOptedOut: !!eopt?.opted_out_at, emailSuppressed: (supp ?? 0) > 0, smsStopped,
    emailSwitchOn: sw[SPOT_SAVED_EMAIL_SWITCH] === true, smsSwitchOn: sw[SPOT_SAVED_SMS_SWITCH] === true, hasLink: !!token,
  });
  const out: SpotSavedSendResult = { jobId, email: skipOf(plan.email), sms: skipOf(plan.sms) };
  // Jo 30 Oct: earlier sends under ANY key (old per-job or new per-owner) count; a failed check never sends.
  if (plan.email.send && job && await spotSavedEmailAlreadySent(jobId)) { out.email = { status: "already", detail: "Already sent for this job" }; (plan as { email: ChannelPlan }).email = { send: false, reason: "Already sent for this job" }; }
  if (plan.sms.send && job && await spotSavedTextAlreadySent(jobId, plan.sms.to)) { out.sms = { status: "already", detail: "Already sent to this job or phone" }; (plan as { sms: ChannelPlan }).sms = { send: false, reason: "Already sent to this job or phone" }; }
  if (opts.emailOnly) out.sms = { status: "skipped", detail: "Email-only confirmation path" };
  // These holds never dispatch or write a fresh blocked attempt on each recovery tick.
  if (plan.sms.send && !opts.emailOnly) {
    const now = new Date().toISOString();
    const stale = smsStaleReason('spot_saved', { at: resp?.spot_saved_at ?? null }, now);
    const quiet = smsQuietReason(now);
    if (stale || quiet) {
      out.sms = { status: stale ? 'blocked' : 'pending', detail: stale ?? quiet ?? '' };
      (plan as { sms: ChannelPlan }).sms = { send: false, reason: out.sms.detail };
    }
  }
  if (!job) return out;
  if (opts.dry) {
    if (plan.email.send) out.email = await alreadyCheck("email", plan.email.key) ?? { status: "would_send", detail: plan.email.to };
    if (plan.sms.send && !opts.emailOnly) out.sms = await alreadyCheck("sms", plan.sms.key) ?? { status: "would_send", detail: plan.sms.to };
    return out;
  }
  if (!plan.email.send && !plan.sms.send) return out;
  const msgs: Msgs | null = token ? await buildSpotSavedMessages(jobId, token) : null;
  if (!msgs || !(msgs.rebate > 0)) {
    if (plan.email.send) out.email = { status: "skipped", detail: "Saved estimate is not ready" };
    if (plan.sms.send && !opts.emailOnly) out.sms = { status: "skipped", detail: "No saved rebate – no approved text for this case" };
    return out;
  }
  if (plan.email.send) out.email = await sendEmail(jobId, plan.email, msgs).catch((e) => ({ status: "failed", detail: (e as Error).message }));
  if (plan.sms.send && !opts.emailOnly) {
    const { sendRealSms } = await import("./sms.server");
    // Decision 165: the trigger is the owner saving their spot (spot_saved_at); a switch flipped on later must not
    // confirm spots saved more than a day earlier (SMS_FRESHNESS), and a held attempt no longer uses up the owner's key.
    out.sms = await sendRealSms({ type: "spot_saved", idempotencyKey: plan.sms.key, to: plan.sms.to, body: msgs.sms, jobId, event: { at: resp?.spot_saved_at ?? null } })
      .then((r) => ({ status: r.status, detail: r.detail }), (e) => ({ status: "failed", detail: (e as Error).message }));
  }
  if (spotSavedDeliveryChanged(out)) await logEvent(jobId, null, "spot_saved_confirmation_sent", `Spot saved confirmation – email: ${out.email.status}; text: ${out.sms.status}`, { email: out.email, sms: out.sms }, { internal: true }).catch(() => null);
  return out;
}

/** True when any spot_saved text was sent/delivered/sending to this job or phone, under either key format. Read errors count as sent. */
export async function spotSavedTextAlreadySent(jobId: string, e164: string | null): Promise<boolean> {
  const { priorSpotSavedTextSent, SPOT_SAVED_DONE_STATUSES } = await import("./spot-saved-send.core");
  const or = e164 ? `job_id.eq.${jobId},to_number.eq.${e164}` : `job_id.eq.${jobId}`;
  const { data, error } = await admin.from("sms_messages").select("job_id, to_number, status, message_type")
    .eq("message_type", "spot_saved").in("status", [...SPOT_SAVED_DONE_STATUSES]).or(or).limit(5);
  if (error) return true;
  return priorSpotSavedTextSent(data ?? [], jobId, e164);
}
/** True when a spot saved email was already sent/sending for this job (any address). Read errors count as sent. */
export async function spotSavedEmailAlreadySent(jobId: string): Promise<boolean> {
  const { priorSpotSavedEmailSent, SPOT_SAVED_EMAIL_DONE_STATUSES } = await import("./spot-saved-send.core");
  const { data, error } = await admin.from("customer_email_sends").select("job_id, status, purpose")
    .eq("job_id", jobId).eq("purpose", SPOT_SAVED_EMAIL_PURPOSE).in("status", [...SPOT_SAVED_EMAIL_DONE_STATUSES]).limit(5);
  if (error) return true;
  return priorSpotSavedEmailSent(data ?? [], jobId);
}

const skipOf = (p: ChannelPlan) => (p.send ? { status: "pending", detail: "" } : { status: "skipped", detail: p.reason });

async function alreadyCheck(ch: "email" | "sms", key: string) {
  const { data } = ch === "email"
    ? await admin.from("customer_email_sends").select("id").eq("idempotency_key", key).maybeSingle()
    : await admin.from("sms_messages").select("id").eq("idempotency_key", key).maybeSingle();
  return data ? { status: "already", detail: "Already sent to this owner" } : null;
}

async function sendEmail(jobId: string, p: Extract<ChannelPlan, { send: true }>, msgs: Msgs) {
  // Reserve first (unique per owner address): an existing reservation means this owner already has it.
  const { data: res, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: SPOT_SAVED_EMAIL_PURPOSE, idempotency_key: p.key }).select("id").single();
  if (error || !res) return { status: "already", detail: "Already sent to this owner" };
  const finish = (status: string, provider: string, err: string | null, id: string | null = null) =>
    admin.from("customer_email_sends").update({ status, provider, error: err, sent_at: status === "sent" ? new Date().toISOString() : null, ...(id ? { provider_message_id: id } : {}) }).eq("id", res.id);
  const { testRecipientBoundary } = await import("./comms-test-recipient.core");
  const b = testRecipientBoundary(p.to, msgs.job.source);
  if (b.status === "blocked") { await finish("failed", "not_sent", b.reason); return { status: "blocked", detail: b.reason }; }
  const { resendSend } = await import("./hot-leads-send.server");
  const html = msgs.email.html ?? `<pre>${msgs.email.text.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>`;
  const d = await resendSend(p.to, msgs.email.subject, html, msgs.email.text, p.key, msgs.optOutUrl);
  if (d.outcome === "rejected" || d.outcome === "not_attempted") { await finish("failed", "resend", d.detail); return { status: "failed", detail: d.detail }; }
  if (d.outcome === "uncertain") { await finish("delivered_unrecorded", "resend", d.detail.slice(0, 300)); return { status: "uncertain", detail: d.detail }; }
  await finish("sent", "resend", null, d.id ?? null);
  const { recordCommunication } = await import("./comms.server");
  await recordCommunication({ jobId, direction: "outbound", channel: "email", recipients: [p.to], subject: msgs.email.subject, body: msgs.email.text, provider: "resend", providerMessageId: d.id ?? null, visibility: "customer", sourceEvent: "spot_saved:email", sourceReference: p.key, createdBy: null, deliveryStatus: "sent" }).catch(() => null);
  return { status: "sent", detail: "Accepted by the email service" };
}
