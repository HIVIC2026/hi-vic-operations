// A1 manual customer communication (STEP 17, finalised STEP 32). Office-only: every caller enforces requireAdmin.
// prepareManualEmail renders ONLY through the existing approved, guarded render paths (Save my spot preview, ineligible
// render twin) and writes no send record: it never reserves customer_email_sends, calls a provider or records a
// communication, and by default it creates no link token either (missing links become placeholders, linksReady=false).
// `issueLinks` is the explicit Office "Create sending links" step: it issues ONLY the lead's missing unsubscribe/referral
// tokens through the existing helpers. recordManualCommunication writes ONE immutable job_communications row (provider
// "manual", Office-only visibility). Nothing here sends, changes approval flags or the comms lock, writes the owner's
// details or touches lead_campaign_responses ("Save my spot" stays owner-driven).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { LocationVariables } from "./activity48.core";
import { TRUSTED_ESTIMATE_TIERS, pickArea, type RetailSettings } from "./estimate.core";
import { selectCurrentEstimate, type AreaTier } from "./intelligence.core";
import { LAUNCH_CAMPAIGN } from "./launch-campaign.core";
import { communicationOrigin } from "./portal-presentation.core";
import {
  GLOBAL_LOCK_MANUAL_BLOCKED, MANUAL_ALREADY_SENT, MANUAL_OUTCOME_LABEL, MANUAL_SENDER, MANUAL_SOURCE_EVENT, MANUAL_TEMPLATE_LABEL, SYSTEM_ALREADY_SENT, SYSTEM_SENT_STATUSES, manualSendReference,
  manualOutcomeOf, manualReasonText, manualRecordBlocker, manualRecordContent, manualSuppression, manualTemplateFor, planManualRecord,
  type AssumedSizeEstimate, type ManualEmailTemplate, type ManualRecordInput, type PreparedManualEmail,
} from "./manual-communication.core";

/** customer_email_sends.purpose written by the portal sender of each template. */
const SEND_PURPOSE: Record<ManualEmailTemplate, string> = { save_my_spot: LAUNCH_CAMPAIGN, ineligible_result: "preliminary_ineligible" };
const melbourne = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const STALE_TYPICAL = "The saved estimate still uses the typical-size assumption, but a ceiling size is now known. Recalculate the estimate before preparing an email.";

/** Read-only: does the lead have a real ceiling size (accepted measure-up, trusted research estimate or owner size)?
 *  Same precedence as the Step 3 estimate (pickArea). null = could not read (fail closed). */
async function ceilingSize(jobId: string): Promise<{ unavailable: boolean; postcode: string | null } | null> {
  const [{ data: j, error: je }, { data: m, error: me }, { data: ests, error: ee }] = await Promise.all([
    admin.from("jobs").select("estimated_area_m2, estimated_area_unknown, properties(postcode)").eq("id", jobId).maybeSingle(),
    admin.from("ceiling_measurements").select("id, verified_area_m2, measured_area_m2").eq("job_id", jobId).eq("is_current", true).eq("status", "complete").maybeSingle(),
    admin.from("property_area_estimates").select("id, tier, net_m2, created_at").eq("job_id", jobId).in("tier", TRUSTED_ESTIMATE_TIERS),
  ]);
  if (je || me || ee || !j) return null;
  const best = selectCurrentEstimate((ests ?? []).map((e) => ({ id: e.id, tier: e.tier as AreaTier, net_m2: e.net_m2 == null ? null : Number(e.net_m2), created_at: e.created_at })));
  const area = pickArea({
    measurement: m ? { id: m.id, m2: Number(m.verified_area_m2 ?? m.measured_area_m2) || null } : null,
    estimate: best ? { id: best.id!, m2: best.net_m2, tier: best.tier } : null,
    owner: j.estimated_area_unknown ? null : j.estimated_area_m2 == null ? null : Number(j.estimated_area_m2),
  });
  const p = j.properties as { postcode: string | null } | { postcode: string | null }[] | null;
  return { unavailable: area.source === "typical_default", postcode: (Array.isArray(p) ? p[0]?.postcode : p?.postcode) ?? null };
}

/** Office-only estimate on the assumed 150 m² with the current prices. Reads only; null when prices or VEU data are missing. */
async function internalAssumedEstimate(postcode: string | null): Promise<AssumedSizeEstimate | null> {
  const pc = (postcode ?? "").trim();
  if (!pc) return null;
  const [{ data: s }, { data: loc }] = await Promise.all([
    admin.from("retail_estimator_settings").select("*").eq("is_current", true).maybeSingle(),
    admin.from("veu_location_variables").select("*").eq("postcode", pc).maybeSingle(),
  ]);
  if (!s || !loc) return null;
  return assumedSizeEstimate(loc as unknown as LocationVariables, s as unknown as RetailSettings);
}

/** The lead's approved A1 email, rendered exactly as the portal sender would, for Office to copy. Fails closed. */
export async function prepareManualEmail(jobId: string, actorId: string | null, opts: { issueLinks?: boolean } = {}): Promise<PreparedManualEmail> {
  const { data: job, error } = await admin.from("jobs").select("id, job_number").eq("id", jobId).maybeSingle();
  if (error) return { ok: false, jobId, jobNumber: null, reason: "Could not read the lead. Nothing prepared; try again.", internalEstimate: null };
  if (!job) return { ok: false, jobId, jobNumber: null, reason: "Job not found.", internalEstimate: null };
  const jobNumber = job.job_number ?? null;
  const no = (reason: string, internalEstimate: AssumedSizeEstimate | null = null): PreparedManualEmail => ({ ok: false, jobId, jobNumber, reason, internalEstimate });

  const { selectLeadEmailRoute } = await import("./lead-email-routing.server");
  const route = await selectLeadEmailRoute(jobId);
  if (!route) return no("Job not found.");
  // Reviewed-under-R2 (variant 3) only from the office's recorded media review – never from uploaded media alone.
  let review: { mediaReview: string | null; criteriaPassed: boolean } = { mediaReview: null, criteriaPassed: false };
  if (route.email === "request_insulation") {
    const { data: link, error: le } = await admin.from("customer_estimate_links").select("token").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle();
    if (le) return no("Could not read the secure link. Nothing prepared; try again.");
    if (link?.token) {
      const { campaignLink } = await import("./launch-campaign.server");
      const c = await campaignLink(link.token).catch(() => null);
      if (c) review = { mediaReview: c.mediaReview, criteriaPassed: c.criteriaPassed };
    }
  }
  const pick = manualTemplateFor({ route: route.email, routeBlocker: route.blocker, reviewedUnderR2: review.mediaReview === "below_r2" && review.criteriaPassed });
  if ("blocked" in pick) return no(pick.blocked);

  // The ineligible copy never bypasses the global communications lock (STEP 32). The Save my spot campaign keeps its
  // own existing approval, which already applies while the global lock is on.
  if (pick.template === "ineligible_result") {
    const { customerCommsEnabled } = await import("./comms.server");
    if (!(await customerCommsEnabled())) return no(GLOBAL_LOCK_MANUAL_BLOCKED);
  }

  const { data: sends, error: sendError } = await admin.from("customer_email_sends").select("id").eq("job_id", jobId).eq("purpose", SEND_PURPOSE[pick.template]).in("status", SYSTEM_SENT_STATUSES).limit(1);
  if (sendError) return no("Could not check the portal's delivery history. Nothing prepared; try again.");
  if ((sends ?? []).length > 0) return no(SYSTEM_ALREADY_SENT);
  const { data: manualSent, error: manualError } = await admin.from("job_communications").select("id").eq("job_id", jobId).eq("source_event", `${MANUAL_SOURCE_EVENT}:sent_manually`).eq("source_reference", manualSendReference(pick.template)).limit(1);
  if (manualError) return no("Could not check the office's manual email records. Nothing prepared; try again.");
  if ((manualSent ?? []).length > 0) return no(MANUAL_ALREADY_SENT);

  let variantLabel: string | null = null;
  let variant: import("./save-spot-offer.core").SaveSpotVariant | null = null;
  if (pick.template === "save_my_spot") {
    const size = await ceilingSize(jobId);
    if (!size) return no("Could not read the ceiling size records. Nothing prepared; try again.");
    const { data: est, error: estError } = await admin.from("indicative_estimates").select("area_source, insulation_declared").eq("job_id", jobId).eq("status", "current").maybeSingle();
    if (estError) return no("Could not read the current estimate. Nothing prepared; try again.");
    if (!est) return no("No current preliminary estimate. Nothing prepared.");
    const assumed = est.area_source === "typical_default";
    if (assumed && !size.unavailable) return no(STALE_TYPICAL);
    if (!assumed && size.unavailable) return no("The estimate has a ceiling size but none is on record. Recalculate the estimate before preparing an email.");
    const { pickSaveSpotVariant, SAVE_SPOT_VARIANT_LABEL } = await import("./save-spot-offer.core");
    const v = pickSaveSpotVariant({ route: route.email, insulation: est.insulation_declared, mediaReview: review.mediaReview, criteriaPassed: review.criteriaPassed, areaAssumed: assumed });
    if ("blocked" in v) return no(v.blocked);
    variant = v.variant; variantLabel = SAVE_SPOT_VARIANT_LABEL[v.variant];
  }

  const notices: string[] = [];
  let mail: { to: string; subject: string; html: string; plainText: string; linksReady: boolean };
  if (pick.template === "save_my_spot" && variant) {
    // Render only: "preview" creates nothing; "manual_copy" only issues missing links, after every opt-out/consent/
    // saved-spot/price guard of the sender has passed. Neither reserves, sends or records.
    const { prepareOfficeSaveSpot } = await import("./hot-leads-send.server");
    const r = await prepareOfficeSaveSpot(jobId, actorId, variant, !!opts.issueLinks);
    if (!r?.preview) return no(r?.detail ?? "Could not prepare the email.");
    mail = r.preview;
  } else {
    // Read-only first: every eligibility, consent and contact rule is checked BEFORE any link token is issued.
    const { suppressionFor } = await import("./emailsafety.server");
    const { prepareIneligibleEmailForOffice } = await import("./followups.server");
    const r = await prepareIneligibleEmailForOffice(jobId, { issueLinks: false });
    if (!r.ok) return no(manualReasonText(r.reason) ?? r.reason);
    const suppressed = manualSuppression(await suppressionFor(jobId, "preliminary_ineligible", r.to));
    if (suppressed.block) return no(suppressed.block);
    if (suppressed.notice) notices.push(suppressed.notice);
    if (opts.issueLinks && !r.linksReady) {
      const issued = await prepareIneligibleEmailForOffice(jobId, { issueLinks: true });
      if (!issued.ok) return no(manualReasonText(issued.reason) ?? issued.reason);
      mail = issued;
    } else mail = r;
  }

  const { data: prior } = await admin.from("job_communications").select("created_at").eq("job_id", jobId).eq("source_event", `${MANUAL_SOURCE_EVENT}:sent_manually`).order("created_at", { ascending: false }).limit(1);
  const last = prior?.[0]?.created_at;
  if (last) notices.push(`Office already recorded sending this lead an email by hand on ${melbourne(last)}. Check before sending again.`);
  return { ok: true, jobId, jobNumber, template: pick.template, templateLabel: variantLabel ?? MANUAL_TEMPLATE_LABEL[pick.template], to: mail.to, subject: mail.subject, plainText: mail.plainText, html: mail.html, notices, linksReady: mail.linksReady };
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
