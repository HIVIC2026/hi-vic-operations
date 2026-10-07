// Hot leads "Save my spot" sender. Every job re-checks: sending switch, opt-out, consent, secure link,
// and a once-per-home idempotency key. TEST (qa_test) jobs go only to Jo's allowlist via the test sender.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { LAUNCH_CAMPAIGN, LAUNCH_COPY_APPROVED, launchGroup, savedPriceFromEstimate } from "./launch-campaign.core";
import { renderLaunchCampaignEmail } from "./estimate-email";
import { renderStep3SaveSpot } from "./step3-emails";
import { CUSTOMER_BASE } from "./engagement.core";
import { reservationAllowed, withUnsubscribe } from "./emailsafety.core";
import { logEvent } from "./workflow.server";

export const HOT_SEND_BATCH = 10;
/** Last TEST send detail per job (Resend id), for reporting. */
export const testSendIds = new Map<string, string>();
export type HotSendResult = { jobId: string; jobNumber: string | null; outcome: "sent" | "skipped" | "blocked" | "failed"; detail: string };

/** Real customers: only when Jo has approved the copy AND the customer sending switch is on. */
export async function realSendingOn() {
  if (!LAUNCH_COPY_APPROVED) return false;
  const { customerCommsEnabled } = await import("./comms.server");
  return customerCommsEnabled();
}

/** TEST-only overrides (qa_test jobs): link host and group. Ignored for real jobs. */
export type TestSendOptions = { linkBase?: string; group?: "likely" | "onsite"; subjectPrefix?: string };

export async function sendSaveMySpot(jobIds: string[], actorId: string, testOpts: TestSendOptions = {}): Promise<HotSendResult[]> {
  if (jobIds.length > HOT_SEND_BATCH) throw new Error(`Send at most ${HOT_SEND_BATCH} at a time.`);
  const realOn = await realSendingOn();
  const out: HotSendResult[] = [];
  for (const jobId of jobIds) out.push(await sendOne(jobId, actorId, realOn, testOpts).catch((e) => ({ jobId, jobNumber: null, outcome: "failed" as const, detail: (e as Error).message })));
  return out;
}

async function sendOne(jobId: string, actorId: string, realOn: boolean, testOpts: TestSendOptions): Promise<HotSendResult> {
  const { data: job } = await admin.from("jobs").select("id, job_number, source, stage, eligibility_outcome, owners(full_name, email), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
  if (!job) return { jobId, jobNumber: null, outcome: "failed", detail: "Job not found" };
  const r = (outcome: HotSendResult["outcome"], detail: string): HotSendResult => ({ jobId, jobNumber: job.job_number, outcome, detail });
  const isTest = job.source === "qa_test";
  if (!isTest && !realOn) return r("blocked", "Sending is switched off.");
  if (["cancelled", "complete"].includes(job.stage)) return r("skipped", "Job is closed.");
  const owner = job.owners as { full_name: string | null; email: string | null } | null;
  const to = owner?.email?.trim().toLowerCase();
  if (!to) return r("skipped", "No owner email.");
  const [{ data: opt }, { data: resp }, { data: link }, { data: est }] = await Promise.all([
    admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", jobId).maybeSingle(),
    admin.from("customer_estimate_links").select("id, token").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
    admin.from("indicative_estimates").select("id, area_m2, insulation_declared, scenarios, snapshot").eq("job_id", jobId).eq("status", "current").maybeSingle(),
  ]);
  if (opt?.opted_out_at || resp?.opted_out_at) return r("skipped", "Owner opted out.");
  if (resp?.spot_saved_at && !(isTest && testOpts.subjectPrefix)) return r("skipped", "Spot already saved.");
  if (!link?.token) return r("skipped", "No secure estimate link yet.");
  const price = savedPriceFromEstimate(est ?? null);
  if (!price || !price.areaM2) return r("skipped", "No current preliminary price.");
  const { discountIsWholeVeecs } = await import("./estimate.core");
  const { data: cfg } = await admin.from("retail_estimator_settings").select("indicative_veec_value").eq("is_current", true).maybeSingle();
  if (!discountIsWholeVeecs(price.discount, price.total, Number(cfg?.indicative_veec_value))) return r("blocked", "Discount is not a whole number of VEECs. Recalculate the estimate first.");
  if (!isTest) {
    const { hasCurrentOwnerContactConsent } = await import("./comms.server");
    if (!(await hasCurrentOwnerContactConsent(jobId))) return r("skipped", "No current contact consent.");
  }
  const group = launchGroup(job.eligibility_outcome, price.insulation) ?? "likely";
  if (group !== "likely" && !isTest) return r("blocked", "Only the approved Group A email can be sent from this list.");

  // Once per home, ever: the idempotency key is the job, not the batch.
  const sendGroup = isTest ? (testOpts.group ?? group) : "likely";
  const key = `${LAUNCH_CAMPAIGN}:save_my_spot:${jobId}${isTest && sendGroup === "onsite" ? ":b" : ""}${isTest && testOpts.subjectPrefix ? `:preview-test:${Date.now()}` : ""}`;
  const { data: ex } = await admin.from("customer_email_sends").select("id, status").eq("idempotency_key", key).maybeSingle();
  if (ex && !reservationAllowed(ex)) return r("skipped", "Already sent to this home.");
  let sendId = ex?.id ?? null;
  if (ex) await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: new Date().toISOString() }).eq("id", ex.id);
  else {
    const { data, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, estimate_link_id: link.id, purpose: LAUNCH_CAMPAIGN, idempotency_key: key }).select("id").single();
    if (error || !data) return r("skipped", "Already being sent.");
    sendId = data.id;
  }

  const { unsubscribeUrlForJob } = await import("./emailsafety.server");
  const base = CUSTOMER_BASE; // one setting: customer links always use the live domain, never the login-walled preview
  const unsubscribeUrl = (await unsubscribeUrlForJob(jobId)).replace(CUSTOMER_BASE, base);
  const prop = job.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
  const snapshot = est?.snapshot as { settings?: { piesa_assessment_inc_gst?: number; ap_management_inc_gst?: number }; scenarios?: { by_access?: { standard?: { installation?: number } } }[] } | null;
  const installation = snapshot?.scenarios?.[0]?.by_access?.standard?.installation;
  const assessmentFee = snapshot?.settings?.piesa_assessment_inc_gst;
  const apFee = snapshot?.settings?.ap_management_inc_gst;
  const campaignUrl = `${base}/estimate/${link.token}/campaign`;
  const fullAddress = (await import("./address")).fullAddress(prop?.address_line, prop?.suburb, prop?.postcode);
  const firstName = owner?.full_name?.trim().split(/\s+/)[0] ?? null;
  // Likely-eligible owners get the Jo-APPROVED "Save your spot (likely eligible)" email (7 Oct 2026, FINAL).
  const referralUrl = sendGroup === "likely" ? await (await import("./referral.server")).referralUrlForJob(jobId).catch(() => null) : null;
  const mail = sendGroup === "likely"
    ? (() => { const m = renderStep3SaveSpot({
        estimateUrl: `${base}/estimate/${link.token}`, campaignUrl, unsubscribeUrl, referralUrl,
        estimatedTotal: price.total, veuDiscount: price.discount, grossTotal: price.gross, areaM2: price.areaM2,
        firstName, address: fullAddress, reference: job.job_number, existingInsulationPresent: (price.insulation ?? est?.insulation_declared) === "present",
        ...(installation === undefined ? {} : { installation }),
        ...(assessmentFee === undefined ? {} : { assessmentFee }),
        ...(apFee === undefined ? {} : { apFee }),
      }); return { ...m, subject: isTest && testOpts.subjectPrefix ? `${testOpts.subjectPrefix} ${m.subject}` : m.subject }; })()
    : withUnsubscribe(renderLaunchCampaignEmail({
    group: sendGroup, campaignUrl, unsubscribeUrl, myJobUrl: `${base}/my-job/${link.token}`, insulation: price.insulation ?? est?.insulation_declared ?? null,
    firstName, estimatedTotal: price.total, veuDiscount: price.discount, grossTotal: price.gross, areaM2: price.areaM2,
    address: fullAddress, reference: job.job_number,
    ...(installation === undefined ? {} : { installation }),
    ...(assessmentFee === undefined ? {} : { assessmentFee }),
    ...(apFee === undefined ? {} : { apFee }),
  }), unsubscribeUrl);
  const finish = async (status: string, provider: string, error: string | null) => {
    await admin.from("customer_email_sends").update({ status, provider, error, sent_at: status === "sent" ? new Date().toISOString() : null }).eq("id", sendId!);
  };
  try {
    if (isTest) {
      const { sendTestEmail } = await import("./test-send.server");
      const t = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: true, label: "hot_leads_save_my_spot", actorId }, to, mail.subject, mail.html, mail.plainText);
      if (t.status !== "sent") { await finish("failed", "resend_test", t.detail); return r(t.status === "blocked" ? "blocked" : "failed", t.detail); }
      await finish("sent", "resend_test", null);
      if (t.detail) testSendIds.set(jobId, t.detail);
    } else {
      const { configuredDeliveryAdapter } = await import("./delivery.server");
      const adapter = await configuredDeliveryAdapter();
      if (!adapter) { await finish("failed", "none", "Email delivery not configured"); return r("blocked", "Email delivery is not set up."); }
      const d = await adapter.deliver({ to, subject: mail.subject, html: mail.html, text: mail.plainText, idempotencyKey: key, purpose: LAUNCH_CAMPAIGN });
      await finish("sent", adapter.provider, null);
      const { recordCommunication } = await import("./comms.server");
      await recordCommunication({ jobId, direction: "outbound", channel: "email", recipients: [to], subject: mail.subject, body: mail.plainText, provider: adapter.provider, providerMessageId: d.providerMessageId, visibility: "customer", sourceEvent: LAUNCH_CAMPAIGN, sourceReference: key, createdBy: actorId } as never);
    }
  } catch (e) {
    const { statusAfterDeliveryError } = await import("./delivery.core");
    await finish(isTest ? "failed" : statusAfterDeliveryError(e), isTest ? "resend_test" : "bridge", (e as Error).message.slice(0, 300));
    return r("failed", (e as Error).message);
  }
  await logEvent(jobId, actorId, "save_my_spot_email_sent", `Save my spot email sent from Hot leads${isTest ? " (TEST, allowlist only)" : ""}`, { campaign: LAUNCH_CAMPAIGN, to_test: isTest }, { internal: true }).catch(() => null);
  return r("sent", isTest ? "Sent to Jo's test inbox" : "Sent");
}

/** Office edits an owner email (Jo-approved fixes only). Audited with a reason. */
export async function updateHotLeadEmail(jobId: string, email: string, reason: string, actorId: string) {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(clean)) throw new Error("Enter a valid email address.");
  if (reason.trim().length < 5) throw new Error("Say why the email is changing (for example, Jo confirmed with the owner).");
  const { data: job } = await admin.from("jobs").select("owner_id, owners(email)").eq("id", jobId).maybeSingle();
  if (!job?.owner_id) throw new Error("Owner not found.");
  const before = (job.owners as { email: string | null } | null)?.email ?? null;
  const { error } = await admin.from("owners").update({ email: clean }).eq("id", job.owner_id);
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "owner_email_corrected", `Owner email changed from ${before ?? "blank"} to ${clean}: ${reason.trim()}`, { before, after: clean, reason: reason.trim() }, { internal: true });
  return { ok: true as const };
}
