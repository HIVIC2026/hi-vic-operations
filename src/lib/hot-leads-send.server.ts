// Hot leads "Save my spot" sender. Every job re-checks: sending switch, opt-out, consent, secure link,
// and a once-per-home idempotency key. TEST (qa_test) jobs go only to Jo's allowlist via the test sender.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { LAUNCH_CAMPAIGN, LAUNCH_COPY_APPROVED, launchGroup, savedPriceFromEstimate } from "./launch-campaign.core";
import { renderLaunchCampaignEmail } from "./estimate-email";
import { renderStep3Likely, renderStep3SaveSpot, renderStep3SaveSpotNoSize } from "./step3-emails";
import { noSizeEstimateBlocker } from "./no-size-estimate.core";
import { CUSTOMER_BASE } from "./engagement.core";
import { reservationAllowed, withUnsubscribe } from "./emailsafety.core";
import { groupBMediaForJob } from "./group-b-media.server";
import { groupBInvitationBlocker } from "./group-b-media.core";
import { logEvent } from "./workflow.server";
import { removalFromScenario } from "./estimate-removal.core";

export const HOT_SEND_BATCH = 10;
/** Last TEST send detail per job (Resend id), for reporting. */
export const testSendIds = new Map<string, string>();
export type HotSendResult = { jobId: string; jobNumber: string | null; outcome: "sent" | "skipped" | "blocked" | "failed"; detail: string; preview?: { to: string; subject: string; html: string } };

/** Real customers: ONLY this Save my spot campaign, approved by Jo (8 Oct 2026). The global customer
 *  comms switch stays off, so every other customer email remains blocked. Contact consent is still checked per lead. */
export async function realSendingOn() {
  const { SAVE_SPOT_REAL_SEND_APPROVED } = await import("./hot-leads.core");
  return SAVE_SPOT_REAL_SEND_APPROVED;
}
void LAUNCH_COPY_APPROVED;

/** TEST-only overrides (qa_test jobs): link host and group. Ignored for real jobs.
 *  mode "preview" renders without sending; "test_to_jo" sends a real lead's email to Jo's inbox only, with TEST-job links. */
export type TestSendOptions = { linkBase?: string; group?: "likely" | "onsite"; subjectPrefix?: string; /** TEST only: send the Step 3 likely-eligible email instead, same facts. */ variant?: "likely_estimate"; mode?: "send" | "preview" | "test_to_jo"; automaticInsulation?: boolean };
/** Jo's own inbox for "send me a test of this lead". */
export const JO_TEST_INBOX = "jolowexo@hotmail.com";
/** TEST job whose links go into Jo's test copies, so pressing them never touches the real lead. */
export const JO_TEST_LINK_JOB = "HV-1609";

export async function sendSaveMySpot(jobIds: string[], actorId: string | null, testOpts: TestSendOptions = {}): Promise<HotSendResult[]> {
  if (jobIds.length > HOT_SEND_BATCH) throw new Error(`Send at most ${HOT_SEND_BATCH} at a time.`);
  const realOn = await realSendingOn();
  const out: HotSendResult[] = [];
  for (const jobId of jobIds) out.push(await sendOne(jobId, actorId, realOn, testOpts).catch((e) => ({ jobId, jobNumber: null, outcome: "failed" as const, detail: (e as Error).message })));
  return out;
}

/** One office-triggered follow-up; never available to initial campaigns or automation. */
export async function sendExistingInsulationSaveSpot(jobId: string, actorId: string, preview = false): Promise<HotSendResult> {
  return sendOne(jobId, actorId, false, { mode: preview ? "preview" : "send" }, true);
}

async function followupAllowed(token: string) {
  const { campaignLink, campaignPermission } = await import("./launch-campaign.server");
  const c = await campaignLink(token);
  if (!c || c.group !== "onsite" || !c.criteriaPassed || (!c.ownerQualified && c.mediaReview !== "below_r2")) return false;
  const { data: response, error } = await admin.from("lead_campaign_responses").select("desk_check_status").eq("job_id", c.job.id).maybeSingle();
  return !error && campaignPermission(c, response?.desk_check_status);
}

async function sendOne(jobId: string, actorId: string | null, realOn: boolean, testOpts: TestSendOptions, followup = false): Promise<HotSendResult> {
  const mode = testOpts.mode ?? "send";
  const { data: job } = await admin.from("jobs").select("id, job_number, source, stage, eligibility_outcome, estimated_area_m2, estimated_area_unknown, owners(full_name, email), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
  if (!job) return { jobId, jobNumber: null, outcome: "failed", detail: "Job not found" };
  const r = (outcome: HotSendResult["outcome"], detail: string): HotSendResult => ({ jobId, jobNumber: job.job_number, outcome, detail });
  const isTest = job.source === "qa_test";
  if (mode === "send" && !isTest && !followup && !realOn) return r("blocked", "Sending is switched off.");
  if (followup && !["base44", "qa_test"].includes(job.source)) return r("blocked", "Follow-up is only for website homeowner enquiries.");
  if (followup && mode === "send" && !(await (await import("./comms.server")).customerCommsEnabled())) return r("blocked", "Customer emails are switched off — nothing sent.");
  if (["cancelled", "complete"].includes(job.stage)) return r("skipped", "Job is closed.");
  const owner = job.owners as { full_name: string | null; email: string | null } | null;
  const to = owner?.email?.trim().toLowerCase();
  if (!to) return r("skipped", "No owner email.");
  const [{ data: opt, error: optError }, { data: resp, error: responseError }, { data: link, error: linkError }, { data: est, error: estimateError }] = await Promise.all([
    admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", jobId).maybeSingle(),
    admin.from("customer_estimate_links").select("id, token").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
    admin.from("indicative_estimates").select("id, area_m2, area_source, insulation_declared, scenarios, snapshot").eq("job_id", jobId).eq("status", "current").maybeSingle(),
  ]);
  if (followup && (optError || responseError || linkError || estimateError)) return r("blocked", "Could not verify the current follow-up records. Try again; nothing sent.");
  if (opt?.opted_out_at || resp?.opted_out_at) return r("skipped", "Owner opted out.");
  if (resp?.spot_saved_at && !(isTest && testOpts.subjectPrefix)) return r("skipped", "Spot already saved.");
  if (!link?.token) return r("skipped", "No secure estimate link yet.");
  const price = savedPriceFromEstimate(est ?? null);
  if (!price || !price.areaM2) return r("skipped", "No current preliminary price.");
  const assumed = est?.area_source === "typical_default";
  if (assumed) { const b = noSizeEstimateBlocker({ areaSource: est?.area_source ?? null, areaM2: price.areaM2, ownerArea: job.estimated_area_unknown ? null : Number(job.estimated_area_m2) || null, insulation: price.insulation, followup }); if (b) return r("skipped", b); }
  if (followup && (price.insulation !== "present" || !(await followupAllowed(link.token)))) return r("blocked", "A qualifying declaration or approved below-R2 review and current existing-insulation estimate are required.");
  const { discountIsWholeVeecs } = await import("./estimate.core");
  const { data: cfg } = await admin.from("retail_estimator_settings").select("indicative_veec_value").eq("is_current", true).maybeSingle();
  if (!discountIsWholeVeecs(price.discount, price.total, Number(cfg?.indicative_veec_value))) return r("blocked", "Discount is not a whole number of VEECs. Recalculate the estimate first.");
  if (!isTest) {
    const { hasCurrentOwnerContactConsent } = await import("./comms.server");
    if (!(await hasCurrentOwnerContactConsent(jobId))) return r("skipped", "No current contact consent.");
  }
  const group = launchGroup(job.eligibility_outcome, price.insulation) ?? "likely";
  if (group !== "likely" && !isTest && !testOpts.automaticInsulation && !followup) return r("blocked", "Only the approved Group A email can be sent from this list.");

  // Once per home, ever: the idempotency key is the job, not the batch.
  const sendGroup = followup ? "likely" : isTest || testOpts.automaticInsulation ? (testOpts.group ?? group) : "likely";
  if (sendGroup === "onsite" && !followup) {
    const blocker = groupBInvitationBlocker(await groupBMediaForJob(jobId));
    if (blocker) return r("blocked", blocker);
    const { INSULATION_DETAILS_REAL_SEND_APPROVED } = await import("./hot-leads.core");
    if (!isTest && mode === "send" && !INSULATION_DETAILS_REAL_SEND_APPROVED) return r("blocked", "Insulation email awaits final visual approval");
  }
  const key = `${LAUNCH_CAMPAIGN}:${followup ? "existing_insulation_save_spot" : sendGroup === "onsite" ? "insulation_details" : "save_my_spot"}:${jobId}${isTest && testOpts.subjectPrefix ? `:preview-test:${testOpts.variant ?? "savespot"}:${Date.now()}` : ""}`;
  const { data: ex, error: existingSendError } = await admin.from("customer_email_sends").select("id, status").eq("idempotency_key", key).maybeSingle();
  if (followup && existingSendError) return r("blocked", "Could not check previous delivery. Nothing sent; try again.");
  if (followup && mode === "send" && ex) return r("skipped", "A follow-up attempt already exists. Check its delivery record before any further action.");
  if (mode === "send" && ex && !reservationAllowed(ex)) return r("skipped", "Already sent to this home.");
  let sendId = ex?.id ?? null;
  if (mode === "send") {
    if (ex) await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: new Date().toISOString() }).eq("id", ex.id);
    else {
      const { data, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, estimate_link_id: link.id, purpose: LAUNCH_CAMPAIGN, idempotency_key: key }).select("id").single();
      if (error || !data) return r("skipped", "Already being sent.");
      sendId = data.id;
    }
  }

  // Jo's test copy of a real lead: real wording/facts, but every link points at a TEST job.
  let linkJobId = jobId, linkToken = link.token;
  if (mode === "test_to_jo") {
    const { data: tj } = await admin.from("jobs").select("id, source").eq("job_number", JO_TEST_LINK_JOB).maybeSingle();
    const { data: tl } = tj?.source === "qa_test" ? await admin.from("customer_estimate_links").select("token").eq("job_id", tj.id).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle() : { data: null };
    if (!tj || !tl?.token) return r("failed", "TEST job links unavailable for the test copy.");
    linkJobId = tj.id; linkToken = tl.token;
  }
  const { unsubscribeUrlForJob } = await import("./emailsafety.server");
  const base = CUSTOMER_BASE; // one setting: customer links always use the live domain, never the login-walled preview
  // Creates the lead's unsubscribe token if it doesn't have one yet.
  const unsubscribeUrl = (await unsubscribeUrlForJob(linkJobId)).replace(CUSTOMER_BASE, base);
  const prop = job.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
  const snapshot = est?.snapshot as { settings?: { piesa_assessment_inc_gst?: number; ap_management_inc_gst?: number }; scenarios?: { by_access?: { standard?: { installation?: number } } }[] } | null;
  const installation = snapshot?.scenarios?.[0]?.by_access?.standard?.installation;
  const assessmentFee = snapshot?.settings?.piesa_assessment_inc_gst;
  const apFee = snapshot?.settings?.ap_management_inc_gst;
  const campaignUrl = `${base}/estimate/${linkToken}/campaign`;
  const fullAddress = (await import("./address")).fullAddress(prop?.address_line, prop?.suburb, prop?.postcode);
  const firstName = owner?.full_name?.trim().split(/\s+/)[0] ?? null;
  // Likely-eligible owners get the Jo-APPROVED "Save your spot (likely eligible)" email (7 Oct 2026, FINAL).
  const referralUrl = sendGroup === "likely" ? await (await import("./referral.server")).referralUrlForJob(linkJobId).catch(() => null) : null;
  const mail = sendGroup === "likely"
    ? (() => { const m = (isTest && testOpts.variant === "likely_estimate" ? renderStep3Likely : assumed ? renderStep3SaveSpot : renderStep3SaveSpot)({
        estimateUrl: `${base}/estimate/${linkToken}`, campaignUrl, unsubscribeUrl, referralUrl,
        estimatedTotal: price.total, veuDiscount: price.discount, grossTotal: price.gross, areaM2: price.areaM2,
        firstName, address: fullAddress, reference: job.job_number, existingInsulationPresent: (price.insulation ?? est?.insulation_declared) === "present",
        ...(followup ? { removal: removalFromScenario(Array.isArray(est?.scenarios) ? est.scenarios[0] : null) } : {}),
        ...(installation === undefined ? {} : { installation }),
        ...(assessmentFee === undefined ? {} : { assessmentFee }),
        ...(apFee === undefined ? {} : { apFee }),
      }); return { ...m, subject: isTest && testOpts.subjectPrefix ? `${testOpts.subjectPrefix} ${m.subject}` : m.subject }; })()
    : withUnsubscribe(renderLaunchCampaignEmail({
    group: sendGroup, campaignUrl, unsubscribeUrl, myJobUrl: `${base}/my-job/${linkToken}`, insulation: price.insulation ?? est?.insulation_declared ?? null,
    firstName, estimatedTotal: price.total, veuDiscount: price.discount, grossTotal: price.gross, areaM2: price.areaM2,
    address: fullAddress, reference: job.job_number,
    ...(installation === undefined ? {} : { installation }),
    ...(assessmentFee === undefined ? {} : { assessmentFee }),
    ...(apFee === undefined ? {} : { apFee }),
  }), unsubscribeUrl);
  if (mode === "preview") return { ...r("sent", "Preview only — not sent"), preview: { to, subject: mail.subject, html: mail.html } };
  if (mode === "test_to_jo") {
    const subject = `[TEST of ${job.job_number}] ${mail.subject}`;
    const t = await resendSend(JO_TEST_INBOX, subject, mail.html, mail.plainText, `save-spot-test:${jobId}:${Date.now()}`, null);
    await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: "save_my_spot_test_to_jo", summary: `Test of ${job.job_number} Save my spot email to ${JO_TEST_INBOX}: ${t.ok ? "sent" : "failed"}`, details: { job_id: jobId, detail: t.detail } as never });
    return r(t.ok ? "sent" : "failed", t.ok ? `Test sent to ${JO_TEST_INBOX}` : t.detail);
  }
  const finish = async (status: string, provider: string, error: string | null) => {
    if (!sendId) throw new Error("Email reservation is missing — nothing sent.");
    const { error: writeError } = await admin.from("customer_email_sends").update({ status, provider, error, sent_at: status === "sent" ? new Date().toISOString() : null }).eq("id", sendId);
    if (writeError) throw new Error("Could not record email outcome; check delivery history before retrying.");
  };
  if (followup && (!(await followupAllowed(link.token)) || !(await (await import("./comms.server")).customerCommsEnabled()) || !(await (await import("./comms.server")).hasCurrentOwnerContactConsent(jobId)))) {
    await finish("failed", "not_sent", "Follow-up permission changed; nothing sent.");
    return r("blocked", "Follow-up permission changed; nothing sent.");
  }
  if (followup) {
    const [{ data: optout, error: oe }, { data: response, error: re }] = await Promise.all([
      admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
      admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", jobId).maybeSingle(),
    ]);
    if (oe || re || optout?.opted_out_at || response?.opted_out_at || response?.spot_saved_at) {
      await finish("failed", "not_sent", "Owner response or opt-out changed; nothing sent.");
      return r("blocked", "Owner response or opt-out changed; nothing sent.");
    }
  }
  if (sendGroup === "onsite") {
    const blocker = groupBInvitationBlocker(await groupBMediaForJob(jobId));
    if (blocker) { await finish("failed", "not_sent", blocker); return r("blocked", blocker); }
  }
  try {
    if (isTest) {
      const { sendTestEmail } = await import("./test-send.server");
      const t = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: true, label: "hot_leads_save_my_spot", actorId }, to, mail.subject, mail.html, mail.plainText);
      if (t.status !== "sent") { await finish("failed", "resend_test", t.detail); return r(t.status === "blocked" ? "blocked" : "failed", t.detail); }
      await finish("sent", "resend_test", null);
      if (t.detail) testSendIds.set(jobId, t.detail);
    } else {
      // This one approved campaign sends through the email service directly (the Base44 bridge stays off).
      const d = await resendSend(to, mail.subject, mail.html, mail.plainText, key, unsubscribeUrl);
      if (!d.ok) { await finish("failed", "resend", d.detail); return r("failed", d.detail); }
      await finish("sent", "resend", null);
      const { recordCommunication } = await import("./comms.server");
      await recordCommunication({ jobId, direction: "outbound", channel: "email", recipients: [to], subject: mail.subject, body: mail.plainText, provider: "resend", providerMessageId: d.id, visibility: "customer", sourceEvent: LAUNCH_CAMPAIGN, sourceReference: key, createdBy: actorId } as never).catch(() => null);
    }
  } catch (e) {
    await finish(followup ? "delivered_unrecorded" : "failed", isTest ? "resend_test" : "resend", (e as Error).message.slice(0, 300));
    return r("failed", (e as Error).message);
  }
  await logEvent(jobId, actorId, "save_my_spot_email_sent", `Save my spot email sent${followup ? " after preliminary existing-insulation qualification" : " from Hot leads"}${isTest ? " (TEST, allowlist only)" : ""}`, { campaign: LAUNCH_CAMPAIGN, to_test: isTest, existing_insulation_followup: followup }, { internal: true }).catch(() => null);
  return r("sent", isTest ? "Sent to Jo's test inbox" : "Sent");
}

/** Automatic send after an official Gate 1 decision + Step 3 prep (Jo, 8 Oct 2026): real jobs only —
 *  sendOne re-checks likely-eligible + no insulation + size entered, consent, opt-out and once-per-home.
 *  TEST (qa_test) jobs never auto-email. Best-effort: never throws, never blocks intake. */
export async function maybeAutoSendSaveSpot(jobId: string): Promise<void> {
  try {
    const { data: job } = await admin.from("jobs").select("source").eq("id", jobId).maybeSingle();
    if (!job || job.source === "qa_test") return;
    await sendSaveMySpot([jobId], null);
  } catch (e) {
    console.warn("auto save-my-spot send failed (ignored)", (e as Error).message.slice(0, 200));
  }
}

export async function sendAutomaticInsulationDetails(jobId: string): Promise<HotSendResult> {
  const blocker = groupBInvitationBlocker(await groupBMediaForJob(jobId));
  if (blocker) return { jobId, jobNumber: null, outcome: "blocked", detail: blocker };
  const { INSULATION_DETAILS_REAL_SEND_APPROVED } = await import("./hot-leads.core");
  if (!INSULATION_DETAILS_REAL_SEND_APPROVED) return { jobId, jobNumber: null, outcome: "blocked", detail: "Insulation email awaits final visual approval" };
  return sendOne(jobId, null, true, { group: "onsite", automaticInsulation: true });
}

const CAMPAIGN_FROM = "Home Insulation Victoria <jobs@homeinsulationvictoria.com.au>";
async function resendSend(to: string, subject: string, html: string, text: string, idem: string, unsubscribeUrl: string | null): Promise<{ ok: boolean; id: string | null; detail: string }> {
  const key = process.env["RESEND_API_KEY"], gw = process.env["LOVABLE_API_KEY"];
  if (!key || !gw) return { ok: false, id: null, detail: "Email is not connected" };
  const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${gw}`, "X-Connection-Api-Key": key, "Content-Type": "application/json", "Idempotency-Key": idem.slice(0, 250) },
    body: JSON.stringify({ from: CAMPAIGN_FROM, to: [to], reply_to: "info@homeinsulationvictoria.com.au", subject, html, text, ...(unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` } } : {}) }),
  });
  const t = await res.text();
  if (!res.ok) return { ok: false, id: null, detail: `Email service error ${res.status}: ${t.slice(0, 200)}` };
  let id: string | null = null; try { id = (JSON.parse(t) as { id?: string }).id ?? null; } catch { /* ignore */ }
  return { ok: true, id, detail: "Accepted" };
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
