// Hot leads "Save my spot" sender. Every job re-checks: sending switch, opt-out, consent, secure link,
// and a once-per-home idempotency key. TEST (qa_test) jobs go only to Jo's allowlist via the test sender.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { LAUNCH_CAMPAIGN, LAUNCH_COPY_APPROVED, launchGroup, savedPriceFromEstimate } from "./launch-campaign.core";
import { renderLaunchCampaignEmail } from "./estimate-email";
import { renderStep3Likely, renderStep3SaveSpot } from "./step3-emails";
import { noSizeEstimateBlocker, initialReplyQualifies, NO_SIZE_REAL_SEND_HELD } from "./no-size-estimate.core";
import { CUSTOMER_BASE } from "./engagement.core";
import { reservationAllowed, withUnsubscribe } from "./emailsafety.core";
import { groupBMediaForJob } from "./group-b-media.server";
import { groupBInvitationBlocker } from "./group-b-media.core";
import { logEvent } from "./workflow.server";
import { removalFromScenario } from "./estimate-removal.core";
import { MANUAL_SENT_EVENT, manualSendReference } from "./manual-communication.core";
import { RESEND_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";
import { AUTO_REPLY_OFF } from "./enquiry-auto-reply.core";
import { classifyProviderStatus, SENT_UNKNOWN_PREFIX, UNCERTAIN_SEND_DETAIL, type ResendAttempt } from "./save-spot-delivery.core";

export const HOT_SEND_BATCH = 10;
/** Last TEST send detail per job (Resend id), for reporting. */
export const testSendIds = new Map<string, string>();
export type HotSendResult = { jobId: string; jobNumber: string | null; /** "uncertain" (STEP 56): the email service may have accepted it; recorded as delivered_unrecorded, never retried automatically. */ outcome: "sent" | "skipped" | "blocked" | "failed" | "uncertain"; detail: string; preview?: { to: string; subject: string; html: string; plainText: string; /** false = preview placeholders stand in for links the lead doesn't have yet. */ linksReady: boolean }; linkJobId?: string; linkToken?: string; sendGroup?: string };

/** Real customers: ONLY this Save my spot campaign, approved by Jo (8 Oct 2026). The global customer
 *  comms switch stays off, so every other customer email remains blocked. Contact consent is still checked per lead. */
/** Real customers: ONLY this Save my spot campaign, approved by Jo (8 Oct 2026). The global customer
 *  comms switch stays off, so every other customer email remains blocked. Contact consent is still checked per lead. */
export async function realSendingOn() {
  const { data, error } = await admin.from("workflow_settings").select("save_my_spot_real_send_enabled, customer_comms_enabled").limit(1).maybeSingle();
  if (error || !data) return false;
  const ws = data as { save_my_spot_real_send_enabled: boolean | null; customer_comms_enabled: boolean | null };
  return ws.save_my_spot_real_send_enabled === true && ws.customer_comms_enabled === true;
}
void LAUNCH_COPY_APPROVED;

/** TEST-only overrides (qa_test jobs): link host and group. Ignored for real jobs.
 *  mode "preview" renders without sending and without creating any link token (missing links become placeholders);
 *  "manual_copy" is the same render but issues the lead's missing unsubscribe/referral links for an Office hand-send (STEP 32);
 *  "test_to_jo" sends a real lead's email to Jo's inbox only, with TEST-job links. */
export type TestSendOptions = { linkBase?: string; group?: "likely" | "onsite"; subjectPrefix?: string; /** TEST only: send the Step 3 likely-eligible email instead, same facts. */ variant?: "likely_estimate"; mode?: "send" | "preview" | "manual_copy" | "test_to_jo" | "test_preview"; automaticInsulation?: boolean; /** Set only by the post-Gate-1 router: the owner's own first reply. */ automaticInitial?: boolean; /** S20-R01: set only by the automatic Group B invitation for a NEW enquiry while the master switch is off; the new-enquiry gate is re-checked before the provider call. */ newEnquiryAutoReply?: boolean; /** Office manual copy only (Jo, 12 Oct): render the approved three-variant email. Never sends. */ officeVariant?: import("./save-spot-offer.core").SaveSpotVariant };
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
/** Office "Prepare email to copy" (Jo, 12 Oct): the approved three-variant email, render only. All contact guards apply. */
export async function prepareOfficeSaveSpot(jobId: string, actorId: string | null, variant: import("./save-spot-offer.core").SaveSpotVariant, issueLinks: boolean): Promise<HotSendResult> {
  return sendOne(jobId, actorId, false, { mode: issueLinks ? "manual_copy" : "preview", officeVariant: variant }, variant === "reviewed_under_r2").catch((e) => ({ jobId, jobNumber: null, outcome: "blocked" as const, detail: (e as Error).message }));
}

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
  const { data: job, error: jobError } = await admin.from("jobs").select("id, job_number, source, stage, created_at, eligibility_outcome, estimated_area_m2, estimated_area_unknown, owners(full_name, email), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
  if (jobError) return { jobId, jobNumber: null, outcome: "blocked", detail: "Could not read the job. Try again; nothing sent." };
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
  // Fail closed for every send: an unreadable opt-out, response, link or estimate never counts as "none".
  if (optError || responseError || linkError || estimateError) return r("blocked", followup ? "Could not verify the current follow-up records. Try again; nothing sent." : "Could not verify opt-out, saved spot, link or estimate records. Try again; nothing sent.");
  if (opt?.opted_out_at || resp?.opted_out_at) return r("skipped", "Owner opted out.");
  if (resp?.spot_saved_at && !(isTest && testOpts.subjectPrefix)) return r("skipped", "Spot already saved.");
  if (!link?.token) return r("skipped", "No secure estimate link yet.");
  const price = savedPriceFromEstimate(est ?? null);
  if (!price || !price.areaM2) return r("skipped", "No current preliminary price.");
  const assumed = est?.area_source === "typical_default";
  const office = !!testOpts.officeVariant;
  if (office && mode !== "preview" && mode !== "manual_copy") return r("blocked", "Office copies are never sent by the portal.");
  if (office) {
    const { originalEstimateBlocker } = await import("./save-spot-offer.core");
    const b = originalEstimateBlocker({ estimate: est ? { area_m2: est.area_m2, area_source: est.area_source, insulation_declared: est.insulation_declared, hasPrice: true } : null, ownerAreaKnown: !job.estimated_area_unknown && Number(job.estimated_area_m2) > 0, reviewedUnderR2: testOpts.officeVariant === "reviewed_under_r2" });
    if (b) return r("skipped", assumed ? "The saved estimate's assumed size no longer applies. Recalculate the estimate first." : b);
  } else if (assumed) {
    // Real typical-size sends are held (no proven original-enquiry claim); previews and TEST records still render.
    const automaticInitial = isTest || mode !== "send" ? true : initialReplyQualifies({ originalInitialClaim: null });
    if (!automaticInitial && testOpts.automaticInitial === true) return r("skipped", NO_SIZE_REAL_SEND_HELD);
    const b = noSizeEstimateBlocker({ areaSource: est?.area_source ?? null, areaM2: price.areaM2, ownerArea: job.estimated_area_unknown ? null : Number(job.estimated_area_m2) || null, insulation: price.insulation, followup, automaticInitial });
    if (b) return r("skipped", b);
  }
  if (followup && (price.insulation !== "present" || !(await followupAllowed(link.token)))) return r("blocked", "A qualifying declaration or approved below-R2 review and current existing-insulation estimate are required.");
  const { discountIsWholeVeecs } = await import("./estimate.core");
  const { data: cfg, error: cfgError } = await admin.from("retail_estimator_settings").select("indicative_veec_value").eq("is_current", true).maybeSingle();
  if (cfgError || !cfg) return r("blocked", "Could not read current estimator settings. Try again; nothing sent.");
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
  if (mode === "send") {
    // STEP 17: Office already sent this email by hand (recorded "Sent manually") – the portal never sends it again.
    const { data: manual, error: manualError } = await admin.from("job_communications").select("id").eq("job_id", jobId).eq("source_event", MANUAL_SENT_EVENT).eq("source_reference", manualSendReference("save_my_spot")).limit(1).maybeSingle();
    if (manualError) return r("blocked", "Could not check the office's manual email records. Try again; nothing sent.");
    if (manual) return r("skipped", "The office already sent this email by hand (recorded manual send).");
  }
  let sendId = ex?.id ?? null;
  // STEP 56: this attempt's reservation time. Outcomes are written only while the row is still THIS attempt, so a result
  // that arrives very late can never land on a newer attempt after the Office resolved this one.
  let reservedAt: string | null = null;
  if (mode === "send") {
    if (ex) {
      // STEP 56: only a confirmed failure is re-reserved, atomically – two triggers that read the same failed row can't both send.
      const at = new Date().toISOString();
      const { data: again, error: againError } = await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: at }).eq("id", ex.id).eq("status", "failed").select("id");
      if (againError || !again?.length) return r("skipped", "Already being sent.");
      reservedAt = at;
    } else {
      const { data, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, estimate_link_id: link.id, purpose: LAUNCH_CAMPAIGN, idempotency_key: key }).select("id, created_at").single();
      if (error || !data) return r("skipped", "Already being sent.");
      sendId = data.id;
      reservedAt = (data as { created_at?: string | null }).created_at ?? null;
    }
  }

  // Jo's test copy of a real lead: real wording/facts, but every link points at a TEST job.
  let linkJobId = jobId, linkToken = link.token;
  // "test_preview" prepares exactly the same TEST links as "test_to_jo" but renders only: no provider call and (STEP 32)
  // no unsubscribe/referral token creation – missing ones are preview placeholders.
  const testCopy = mode === "test_to_jo" || mode === "test_preview";
  if (testCopy && sendGroup === "onsite") {
    // Group B test copies must open a Group B TEST homeowner who has not answered yet. HV-1609 is a likely-eligible
    // TEST job with a saved spot, so its links skipped the four insulation choices and showed "Spot saved".
    try { const f = await (await import("./group-b-test-fixture.server")).createGroupBTestLink(JO_TEST_LINK_JOB); linkJobId = f.jobId; linkToken = f.token; }
    catch { return r("failed", "TEST Group B homeowner unavailable for the test copy."); }
  } else if (testCopy) {
    const { data: tj } = await admin.from("jobs").select("id, source").eq("job_number", JO_TEST_LINK_JOB).maybeSingle();
    const { data: tl } = tj?.source === "qa_test" ? await admin.from("customer_estimate_links").select("token").eq("job_id", tj.id).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle() : { data: null };
    if (!tj || !tl?.token) return r("failed", "TEST job links unavailable for the test copy.");
    linkJobId = tj.id; linkToken = tl.token;
  }
  const base = CUSTOMER_BASE; // one setting: customer links always use the live domain, never the login-walled preview
  // Previews never create tokens (STEP 32): reuse an existing link, otherwise show a placeholder and say so.
  const readOnlyLinks = mode === "preview" || mode === "test_preview";
  const previewLinks = readOnlyLinks ? await import("./preview-links.server") : null;
  let linksReady = true;
  let unsubscribeUrl: string;
  if (previewLinks) {
    const existing = await previewLinks.existingUnsubscribeUrl(linkJobId);
    if (!existing) linksReady = false;
    unsubscribeUrl = existing ?? previewLinks.PREVIEW_UNSUBSCRIBE_URL;
  } else {
    const { unsubscribeUrlForJob } = await import("./emailsafety.server");
    // Creates the lead's unsubscribe token if it doesn't have one yet.
    unsubscribeUrl = (await unsubscribeUrlForJob(linkJobId)).replace(CUSTOMER_BASE, base);
  }
  const prop = job.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
  const snapshot = est?.snapshot as { settings?: { piesa_assessment_inc_gst?: number; ap_management_inc_gst?: number }; scenarios?: { by_access?: { standard?: { installation?: number } } }[] } | null;
  const installation = snapshot?.scenarios?.[0]?.by_access?.standard?.installation;
  const assessmentFee = snapshot?.settings?.piesa_assessment_inc_gst;
  const apFee = snapshot?.settings?.ap_management_inc_gst;
  const campaignUrl = `${base}/estimate/${linkToken}/campaign`;
  const fullAddress = (await import("./address")).fullAddress(prop?.address_line, prop?.suburb, prop?.postcode);
  const firstName = owner?.full_name?.trim().split(/\s+/)[0] ?? null;
  // Likely-eligible owners get the Jo-APPROVED "Save your spot (likely eligible)" email (7 Oct 2026, FINAL).
  let referralUrl: string | null = null;
  if ((sendGroup === "likely" || office) && previewLinks) {
    referralUrl = await previewLinks.existingReferralUrl(linkJobId).catch(() => null);
    if (!referralUrl) { linksReady = false; referralUrl = previewLinks.PREVIEW_REFERRAL_URL; }
  } else if (sendGroup === "likely" || office) referralUrl = await (await import("./referral.server")).referralUrlForJob(linkJobId).catch(() => null);
  const mail = office
    ? await (async () => {
      const o = await import("./save-spot-offer.core");
      const removal = removalFromScenario(Array.isArray(est?.scenarios) ? est.scenarios[0] : null);
      const fees = { assessment: Number(assessmentFee), ap: Number(apFee) };
      if (!Number.isFinite(fees.assessment) || !Number.isFinite(fees.ap) || installation === undefined) throw new Error("The estimate has no itemised prices. Recalculate it first.");
      const links = o.saveSpotLinks(linkToken, base);
      return o.renderSaveSpotOfferEmail({
        variant: testOpts.officeVariant!, assumedArea: assumed, address: fullAddress ?? "", areaM2: price.areaM2!, firstName, reference: job.job_number,
        installation: Number(installation), assessmentFee: fees.assessment, apFee: fees.ap, gross: price.gross, discount: price.discount, customer: price.total,
        removal: testOpts.officeVariant === "reviewed_under_r2" ? removal : removal.kind === "included" ? removal : { kind: "excluded" },
        apCount: 2, ...links, unsubscribeUrl, referralUrl,
      });
    })()
    : sendGroup === "likely"
    ? (() => { const m = (isTest && testOpts.variant === "likely_estimate" ? renderStep3Likely : renderStep3SaveSpot)({
        estimateUrl: `${base}/estimate/${linkToken}`, campaignUrl, unsubscribeUrl, referralUrl,
        estimatedTotal: price.total, veuDiscount: price.discount, grossTotal: price.gross, areaM2: price.areaM2,
        ...(assumed ? { areaIsTypical: true } : {}),
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
  if (mode === "preview" || mode === "manual_copy") return { ...r("sent", "Preview only — not sent"), preview: { to, subject: mail.subject, html: mail.html, plainText: mail.plainText, linksReady } };
  if (mode === "test_preview") return { ...r("sent", "TEST copy rendered only — not sent"), preview: { to: JO_TEST_INBOX, subject: `[TEST of ${job.job_number}] ${mail.subject}`, html: mail.html, plainText: mail.plainText, linksReady }, linkJobId, linkToken, sendGroup };
  if (mode === "test_to_jo") {
    const subject = `[TEST of ${job.job_number}] ${mail.subject}`;
    const t = await resendSend(JO_TEST_INBOX, subject, mail.html, mail.plainText, `save-spot-test:${jobId}:${Date.now()}`, null);
    const ok = t.outcome === "accepted", word = ok ? "sent" : t.outcome === "uncertain" ? "outcome unknown" : "failed";
    await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: "save_my_spot_test_to_jo", summary: `Test of ${job.job_number} Save my spot email to ${JO_TEST_INBOX}: ${word}`, details: { job_id: jobId, detail: t.detail } as never });
    return r(ok ? "sent" : t.outcome === "uncertain" ? "uncertain" : "failed", ok ? `Test sent to ${JO_TEST_INBOX}` : t.detail);
  }
  const finish = async (status: string, provider: string, error: string | null, providerMessageId: string | null = null) => {
    if (!sendId) throw new Error("Email reservation is missing — nothing sent.");
    const write = admin.from("customer_email_sends").update({ status, provider, error, sent_at: status === "sent" ? new Date().toISOString() : null, ...(providerMessageId ? { provider_message_id: providerMessageId } : {}) }).eq("id", sendId);
    const { data: written, error: writeError } = await (reservedAt ? write.eq("created_at", reservedAt) : write).select("id");
    if (writeError) throw new Error("Could not record email outcome; check delivery history before retrying.");
    // An empty result means the row is no longer this attempt (resolved by the Office and re-reserved): the late result
    // is not written over the newer attempt.
    if (reservedAt && Array.isArray(written) && written.length === 0) throw new Error("This email attempt was already resolved or replaced; its late result was not recorded.");
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
  if (!isTest && mode === "send" && sendGroup === "onsite" && !followup && !(await groupBGlobalsOn()) && !(testOpts.newEnquiryAutoReply === true && (await (await import("./enquiry-auto-reply.server")).newEnquiryAutoReplyGate(jobId)).allowed)) { await finish("failed", "not_sent", GROUP_B_GLOBALS_OFF); return r("blocked", GROUP_B_GLOBALS_OFF); }
  { const { jobDeletedBlocker } = await import("./job-live.server"); const del = await jobDeletedBlocker(jobId); if (del) { await finish("failed", "not_sent", del); return r("blocked", del); } }
  // STEP 56: true from the moment the real provider call starts until it is known to have been refused. While true, no
  // error path may record "failed" (a failed row is resendable): the outcome is recorded as delivered_unrecorded instead.
  let mayHaveSent = false;
  let acceptedId: string | null | undefined; // set once the email service has accepted the email (id may be unreadable)
  try {
    if (isTest) {
      const { sendTestEmail } = await import("./test-send.server");
      const t = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: true, label: "hot_leads_save_my_spot", actorId }, to, mail.subject, mail.html, mail.plainText);
      if (t.status !== "sent") { await finish("failed", "resend_test", t.detail); return r(t.status === "blocked" ? "blocked" : "failed", t.detail); }
      await finish("sent", "resend_test", null);
      if (t.detail) testSendIds.set(jobId, t.detail);
    } else {
      // This one approved campaign sends through the email service directly (the Base44 bridge stays off).
      mayHaveSent = true;
      const d = await resendSend(to, mail.subject, mail.html, mail.plainText, key, unsubscribeUrl);
      if (d.outcome === "rejected" || d.outcome === "not_attempted") { mayHaveSent = false; await finish("failed", "resend", d.detail); return r("failed", d.detail); }
      if (d.outcome === "uncertain") {
        await finish("delivered_unrecorded", "resend", `${SENT_UNKNOWN_PREFIX}${d.detail}`.slice(0, 300));
        await logEvent(jobId, actorId, "save_my_spot_outcome_unknown", `Save my spot email outcome unknown – not retried automatically. ${d.detail}`.slice(0, 500), { campaign: LAUNCH_CAMPAIGN, idempotency_key: key, existing_insulation_followup: followup }, { internal: true }).catch(() => null);
        return r("uncertain", UNCERTAIN_SEND_DETAIL);
      }
      acceptedId = d.id;
      await finish("sent", "resend", null, d.id);
      const { recordCommunication } = await import("./comms.server");
      await recordCommunication({ jobId, direction: "outbound", channel: "email", recipients: [to], subject: mail.subject, body: mail.plainText, provider: "resend", providerMessageId: d.id, visibility: "customer", sourceEvent: LAUNCH_CAMPAIGN, sourceReference: key, createdBy: actorId } as never).catch(() => null);
    }
  } catch (e) {
    const message = (e as Error).message;
    if (followup) {
      await finish("delivered_unrecorded", isTest ? "resend_test" : "resend", message.slice(0, 300));
      return r("uncertain", message);
    }
    if (mayHaveSent) {
      // Accepted (or possibly accepted) but the outcome couldn't be recorded: never "failed". If even this write fails the
      // row stays "sending", which also blocks any automatic resend.
      const accepted = acceptedId !== undefined ? `Accepted by the email service${acceptedId ? ` (id ${acceptedId})` : ""} but the result could not be recorded: ` : "";
      await finish("delivered_unrecorded", "resend", `${SENT_UNKNOWN_PREFIX}${accepted}${message}`.slice(0, 300), acceptedId ?? null).catch(() => null);
      await logEvent(jobId, actorId, "save_my_spot_outcome_unknown", `Save my spot email outcome unknown – not retried automatically. ${message}`.slice(0, 500), { campaign: LAUNCH_CAMPAIGN, idempotency_key: key, existing_insulation_followup: followup }, { internal: true }).catch(() => null);
      return r("uncertain", UNCERTAIN_SEND_DETAIL);
    }
    await finish("failed", isTest ? "resend_test" : "resend", message.slice(0, 300));
    return r("failed", message);
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

/** Group B real delivery requires BOTH global switches on (customer_comms_enabled + delivery enabled). Unreadable = off. */
export async function groupBGlobalsOn(): Promise<boolean> {
  const [{ data: w, error: we }, { data: d, error: de }] = await Promise.all([
    admin.from("workflow_settings").select("customer_comms_enabled").limit(1).maybeSingle(),
    admin.from("customer_delivery_settings").select("enabled").eq("id", 1).maybeSingle(),
  ]);
  if (we || de || !w || !d) return false;
  return (w as { customer_comms_enabled: boolean | null }).customer_comms_enabled === true && (d as { enabled: boolean | null }).enabled === true;
}
export const GROUP_B_GLOBALS_OFF = "Customer emails are switched off — Group B invitation not sent.";

export async function sendAutomaticInsulationDetails(jobId: string): Promise<HotSendResult> {
  // S20-R01: with the master switch off, only a NEW enquiry may get it, and only while automatic enquiry emails are on
  // (enquiry-auto-reply.core.ts). The scheduled backlog worker never sends this email.
  let newEnquiryAutoReply = false;
  if (!(await groupBGlobalsOn())) {
    const { newEnquiryAutoReplyGate } = await import("./enquiry-auto-reply.server");
    const gate = await newEnquiryAutoReplyGate(jobId);
    if (!gate.allowed) return { jobId, jobNumber: null, outcome: "blocked", detail: gate.reason === AUTO_REPLY_OFF ? GROUP_B_GLOBALS_OFF : gate.reason };
    newEnquiryAutoReply = true;
  }
  const blocker = groupBInvitationBlocker(await groupBMediaForJob(jobId));
  if (blocker) return { jobId, jobNumber: null, outcome: "blocked", detail: blocker };
  const { INSULATION_DETAILS_REAL_SEND_APPROVED } = await import("./hot-leads.core");
  if (!INSULATION_DETAILS_REAL_SEND_APPROVED) return { jobId, jobNumber: null, outcome: "blocked", detail: "Insulation email awaits final visual approval" };
  return sendOne(jobId, null, true, { group: "onsite", automaticInsulation: true, ...(newEnquiryAutoReply ? { newEnquiryAutoReply: true } : {}) });
}

/** S20-R01: the email service Save my spot already uses (Resend via the connector gateway), as a DeliveryAdapter for the
 *  automatic ineligible reply when no Base44 bridge is configured. A definite refusal is DeliveryRejectedError ("failed",
 *  retryable); any unknown outcome is a plain error, which the sender records as delivered_unrecorded (never retried). */
export function resendDeliveryAdapter(): import("./delivery.core").DeliveryAdapter {
  return {
    provider: "resend",
    async deliver(msg) {
      const { DeliveryRejectedError } = await import("./delivery.core");
      const d = await resendSend(msg.to, msg.subject, msg.html, msg.text, msg.idempotencyKey, null);
      if (d.outcome === "accepted") return { providerMessageId: d.id };
      if (d.outcome === "rejected" || d.outcome === "not_attempted") throw new DeliveryRejectedError(d.detail);
      throw new Error(d.detail); // unknown outcome: recorded delivered_unrecorded ("sent_unknown: …") and never retried
    },
  };
}

const CAMPAIGN_FROM = "Home Insulation Victoria <jobs@homeinsulationvictoria.com.au>";
/** One provider call. Never throws: a timeout or dropped connection is an UNKNOWN outcome (the request may already have
 *  been accepted), and the HTTP status is classified by classifyProviderStatus (save-spot-delivery.core.ts). */
async function resendSend(to: string, subject: string, html: string, text: string, idem: string, unsubscribeUrl: string | null): Promise<ResendAttempt> {
  const key = process.env["RESEND_API_KEY"], gw = process.env["LOVABLE_API_KEY"];
  if (!key || !gw) return { outcome: "not_attempted", detail: "Email is not connected" };
  let res: Response;
  try {
    res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${gw}`, "X-Connection-Api-Key": key, "Content-Type": "application/json", "Idempotency-Key": idem.slice(0, 250) },
      body: JSON.stringify({ from: CAMPAIGN_FROM, to: [to], reply_to: "info@homeinsulationvictoria.com.au", subject, html, text, ...(unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` } } : {}) }),
      signal: timeoutSignal(RESEND_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    return { outcome: "uncertain", detail: `No clear answer from the email service (${timedOut ? "timed out" : "connection lost"}).` };
  }
  const t = await res.text().catch(() => "");
  const kind = classifyProviderStatus(res.status);
  if (kind === "rejected") return { outcome: "rejected", status: res.status, detail: `Email service error ${res.status}: ${t.slice(0, 200)}` };
  if (kind === "uncertain") return { outcome: "uncertain", detail: `Email service answered ${res.status}; it may still have accepted the email. ${t.slice(0, 200)}`.trim() };
  let id: string | null = null; try { id = (JSON.parse(t) as { id?: string }).id ?? null; } catch { /* accepted; id unreadable */ }
  return { outcome: "accepted", id, detail: "Accepted" };
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
