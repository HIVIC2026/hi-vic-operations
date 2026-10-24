// Decision 172 (Jo, 24 Oct 2026): the one-off "3 questions" reminder. Office page only; no cron, no retry.
// Each pre-23-Oct enquiry that has not answered the three insulation questions gets, ONCE, the approved questions
// email (renderJoOutcomeEmail T5/T6 with insulationQuestions) through the guarded owner email path and one text
// (type three_questions_reminder) through the one real SMS sender. TEST (qa_test) jobs go through test-send only.
// Delivery sits behind customer_comms_enabled; a dry run reads only and never issues a link, claims a key or sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { linkUsable } from "./estimatelink.core";
import { CUSTOMER_BASE } from "./engagement.core";
import { declaredExtras } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { savedInsulationTap } from "./insulation-details.core";
import { savedPriceFromEstimate } from "./launch-campaign.core";
import { joAreaBasis } from "./jo-area-basis.core";
import { removalUpTo } from "./estimate-removal-upto.core";
import { fullAddress } from "./address";
import { renderJoOutcomeEmail, type JoWiredEmail } from "./jo-outcome-email.core";
import { withUnsubscribe } from "./emailsafety.core";
import { customerCommsEnabled } from "./comms.server";
import {
  THREE_QUESTIONS_CUTOFF_ISO, THREE_QUESTIONS_EMAIL_PURPOSE, THREE_QUESTIONS_SMS_TYPE, selectThreeQuestionsReminder, threeQuestionsClaimId,
  type ReminderRecipient, type ReminderRow, type ReminderSkip,
} from "./three-questions-reminder.core";

const db = admin as any;
const MAX_INDEX_ROWS = 5000;
const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type Plan = { recipients: ReminderRecipient[]; skipped: ReminderSkip[]; mails: Map<string, JoWiredEmail>; sources: Map<string, string | null>; truncated: boolean };

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`Could not read ${what}; nothing sent`);
  return (data ?? ([] as unknown)) as T;
}

/** Every fact the pure selector needs, plus the rendered email per candidate. Read-only. */
async function loadPlan(opts: { jobIds?: string[]; allowTest?: boolean } = {}): Promise<Plan> {
  const cols = "id,job_number,created_at,source,stage,eligibility_outcome,removed,deleted_at,owner_name,owner_email,owner_phone,spot_saved,contact_rank";
  let q = db.from("office_enquiry_index").select(cols);
  q = opts.jobIds ? q.in("id", opts.jobIds) : q.lt("created_at", THREE_QUESTIONS_CUTOFF_ISO);
  const index: any[] = await must(q.order("created_at").limit(MAX_INDEX_ROWS), "enquiries");
  const ids = index.map((r) => r.id as string);
  const [optouts, smsHandled] = await Promise.all([
    must<any[]>(db.from("sms_optouts").select("phone").not("opted_out_at", "is", null), "SMS opt-outs"),
    must<any[]>(db.from("sms_messages").select("job_id,to_number").eq("message_type", THREE_QUESTIONS_SMS_TYPE), "sent reminder texts"),
  ]);
  const rate = await db.from("retail_estimator_settings").select("removal_inc_gst_per_m2").eq("is_current", true).maybeSingle();
  const jobs = new Map<string, any>(), props = new Map<string, any>(), ests = new Map<string, any>(), links = new Map<string, any>();
  const emailOpt = new Set<string>(), emailHandled = new Set<string>();
  for (const c of chunks(ids)) {
    const [j, e, l, oa, ob, sends] = await Promise.all([
      must<any[]>(db.from("jobs").select("id,property_id,job_number,source,estimated_area_m2,estimated_area_unknown").in("id", c), "jobs"),
      must<any[]>(db.from("indicative_estimates").select("id,job_id,scenarios,area_source,area_m2,insulation_declared,snapshot").in("job_id", c).eq("status", "current"), "estimates"),
      must<any[]>(db.from("customer_estimate_links").select("job_id,token,status,expires_at,created_at").in("job_id", c).eq("purpose", "step3_estimate").eq("status", "active").order("created_at", { ascending: false }), "secure links"),
      must<any[]>(db.from("customer_email_optouts").select("job_id,opted_out_at").in("job_id", c), "email opt-outs"),
      must<any[]>(db.from("lead_campaign_responses").select("job_id,opted_out_at").in("job_id", c), "campaign opt-outs"),
      must<any[]>(db.from("customer_email_sends").select("job_id").in("job_id", c).eq("purpose", THREE_QUESTIONS_EMAIL_PURPOSE), "sent reminder emails"),
    ]);
    for (const r of j) jobs.set(r.id, r);
    for (const r of e) if (!ests.has(r.job_id)) ests.set(r.job_id, r);
    for (const r of l) if (!links.has(r.job_id) && linkUsable(r)) links.set(r.job_id, r);
    for (const r of [...oa, ...ob]) if (r.opted_out_at) emailOpt.add(r.job_id);
    for (const r of sends) emailHandled.add(r.job_id);
    const propIds = [...new Set(j.map((r) => r.property_id).filter(Boolean))] as string[];
    if (propIds.length) for (const r of await must<any[]>(db.from("properties").select("id,address_line,suburb,postcode,enrichment").in("id", propIds), "properties")) props.set(r.id, r);
  }
  const rows: ReminderRow[] = [], mails = new Map<string, JoWiredEmail>(), sources = new Map<string, string | null>();
  for (const r of index) {
    const job = jobs.get(r.id), prop = job ? props.get(job.property_id) : null, est = ests.get(r.id), link = links.get(r.id);
    const enrichment = (prop?.enrichment ?? null) as Record<string, unknown> | null;
    const answers = ((enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } }).raw?.answers ?? null;
    const declared = normaliseInsulation(declaredExtras(answers).existing_insulation) ?? normaliseInsulation(est?.insulation_declared ?? null);
    const price = savedPriceFromEstimate(est ?? null);
    const token = link?.token as string | undefined;
    const row: ReminderRow = {
      id: r.id, job_number: r.job_number, created_at: r.created_at, source: r.source, stage: r.stage, eligibility_outcome: r.eligibility_outcome,
      removed: r.removed, deleted_at: r.deleted_at, owner_name: r.owner_name, owner_email: r.owner_email, owner_phone: r.owner_phone,
      spot_saved: r.spot_saved, contact_rank: r.contact_rank, declared, tapAnswered: !!savedInsulationTap(enrichment),
      emailOptedOut: emailOpt.has(r.id), rebate: price?.discount ?? null, link: token ? `${CUSTOMER_BASE}/estimate/${token}/video` : null, renderProblem: null,
    };
    sources.set(r.id, job?.source ?? r.source ?? null);
    if (token && price && job && declared !== "none") {
      const snapshot = est?.snapshot as { settings?: { piesa_assessment_inc_gst?: number; ap_management_inc_gst?: number }; scenarios?: { by_access?: { standard?: { installation?: number } } }[] } | null;
      const installation = snapshot?.scenarios?.[0]?.by_access?.standard?.installation, piesaFee = snapshot?.settings?.piesa_assessment_inc_gst, apFee = snapshot?.settings?.ap_management_inc_gst;
      const basis = joAreaBasis({ areaSource: est?.area_source ?? null, areaM2: price.areaM2, ownerAreaM2: job.estimated_area_unknown ? null : Number(job.estimated_area_m2) || null });
      const outcome = r.eligibility_outcome === "likely_eligible" || r.eligibility_outcome === "needs_onsite_confirmation" ? r.eligibility_outcome : null;
      if (![installation, piesaFee, apFee].every((n) => Number.isFinite(Number(n)))) row.renderProblem = "Estimate figures missing — recalculate first";
      else if (!basis.ok) row.renderProblem = "Estimate size basis needs office review";
      else if (outcome) {
        try {
          const base = `${CUSTOMER_BASE}/estimate/${token}`;
          const mail = renderJoOutcomeEmail({
            outcome, insulation: declared === "present" ? "present" : "unknown", ceilingSizeKnown: basis.ceilingSizeKnown, deskCheckStatus: null, insulationQuestions: true,
            recipient: { firstName: r.owner_name?.trim().split(/\s+/)[0] || "there", propertyAddress: fullAddress(prop?.address_line, prop?.suburb, prop?.postcode), enquiryReference: r.job_number ?? "" },
            figures: {
              veuRebate: price.discount, customerTotal: price.total, totalBeforeRebate: price.gross, installation: Number(installation), piesaFee: Number(piesaFee), apFee: Number(apFee),
              ceilingAreaM2: basis.areaM2, areaEstimated: basis.areaEstimated,
              removalUpTo: removalUpTo({ insulation: "present", areaM2: basis.areaM2, ratePerM2: rate.data?.removal_inc_gst_per_m2 }),
            },
            links: { saveMySpotUrl: `${base}/campaign`, uploadMediaUrl: `${base}/video`, reviewResultUrl: base, calculatorUrl: `${base}/calculator` },
          });
          if (!mail || !mail.ctas.includes("upload_media")) row.renderProblem = "The questions email does not apply to this enquiry";
          else mails.set(r.id, mail);
        } catch (e) { row.renderProblem = `Could not prepare the email: ${(e as Error).message}`; }
      }
    }
    rows.push(row);
  }
  const plan = selectThreeQuestionsReminder(rows, optouts.map((o) => o.phone), [...emailHandled, ...smsHandled.map((s) => s.job_id).filter(Boolean)], smsHandled.map((s) => s.to_number), { allowTest: !!opts.allowTest, ignoreCutoff: !!opts.jobIds });
  return { ...plan, mails, sources, truncated: index.length >= MAX_INDEX_ROWS };
}

export type ReminderRunResult = {
  dryRun: boolean; recipientCount: number; skipped: ReminderSkip[]; sendBlockers: string[];
  samples: { jobId: string; jobNumber: string | null; email: string | null; phone: string | null; subject: string | null; smsBody: string }[];
  results: { jobId: string; jobNumber: string | null; email: string; sms: string }[]; hasMore: boolean;
};

async function sendOne(rec: ReminderRecipient, mail: JoWiredEmail | undefined, source: string | null, actorId: string | null) {
  const isTest = source === "qa_test";
  let email = rec.email ? "not sent" : "no email address";
  let sms = rec.phone ? "not sent" : "no mobile";
  if (!mail) email = "email not prepared";
  else if (rec.email && isTest) {
    const { sendTestEmail } = await import("./test-send.server");
    const unsubscribe = await (await import("./emailsafety.server")).unsubscribeUrlForJob(rec.jobId);
    const m = withUnsubscribe(mail, unsubscribe);
    email = (await sendTestEmail({ jobId: rec.jobId, jobSource: "qa_test", partnerIsTest: true, label: "three_questions_reminder", actorId }, rec.email, m.subject, m.html, m.plainText)).status;
  } else if (rec.email) {
    const { sendGuardedOwnerEmail } = await import("./owner-email-send.server");
    email = await sendGuardedOwnerEmail({
      jobId: rec.jobId, jobSource: source, to: rec.email, purpose: THREE_QUESTIONS_EMAIL_PURPOSE, key: rec.emailKey,
      build: (unsubscribe) => { const m = withUnsubscribe(mail, unsubscribe ?? ""); return { subject: m.subject, html: m.html, text: m.plainText }; },
    });
  }
  if (rec.phone && isTest) {
    const { sendTestSms } = await import("./test-send.server");
    sms = (await sendTestSms({ jobId: rec.jobId, jobSource: "qa_test", partnerIsTest: true, label: "three_questions_reminder", actorId }, rec.phone, rec.smsBody)).status;
  } else if (rec.phone) {
    const { sendRealSms } = await import("./sms.server");
    const r = await sendRealSms({ type: THREE_QUESTIONS_SMS_TYPE, idempotencyKey: rec.smsKey, to: rec.phone, body: rec.smsBody, jobId: rec.jobId },
      { claimId: await threeQuestionsClaimId(rec.phone), adminSpotReminderBlast: true });
    sms = `${r.status}: ${r.detail}`;
  }
  return { jobId: rec.jobId, jobNumber: rec.jobNumber, email, sms };
}

/**
 * Dry run: read-only plan. Send: at most 10 enquiries per call (the page asks for the next batch), each re-checked
 * just before sending so a home that answered, opted out or was reminded meanwhile is skipped. `testJobNumber`
 * limits the run to ONE qa_test job (cutoff ignored, TEST allowed) and routes it through test-send only.
 */
export async function runThreeQuestionsReminder(dryRun: boolean, actorId: string | null, testJobNumber?: string): Promise<ReminderRunResult> {
  let only: { jobIds: string[]; allowTest: true } | undefined;
  if (testJobNumber) {
    const { data: tj } = await db.from("jobs").select("id,source").eq("job_number", testJobNumber).maybeSingle();
    if (!tj || tj.source !== "qa_test") throw new Error("TEST sends use TEST jobs only.");
    only = { jobIds: [tj.id], allowTest: true };
  }
  const plan = await loadPlan(only);
  const sendBlockers: string[] = [];
  if (!only && !(await customerCommsEnabled())) sendBlockers.push("Customer communications master switch is off (unchanged)");
  const { sendingNumber } = await import("./sms.server");
  const { au1Configured } = await import("./twilio-au1.server");
  if (!sendingNumber() || !au1Configured()) sendBlockers.push("Australian SMS sender/connection is not configured");
  if (plan.truncated) sendBlockers.push(`More than ${MAX_INDEX_ROWS} enquiries read; narrow the audience before sending`);
  const base = {
    dryRun, recipientCount: plan.recipients.length, skipped: plan.skipped, sendBlockers,
    samples: plan.recipients.slice(0, 5).map((r) => ({ jobId: r.jobId, jobNumber: r.jobNumber, email: r.email, phone: r.phone, subject: plan.mails.get(r.jobId)?.subject ?? null, smsBody: r.smsBody })),
  };
  if (dryRun) return { ...base, results: [], hasMore: false };
  if (sendBlockers.length) throw new Error(sendBlockers.join("; "));
  await (await import("./sms.server")).settleStuckSending();
  const results: ReminderRunResult["results"] = [];
  for (const rec of plan.recipients.slice(0, 10)) {
    const fresh = only ? plan : await loadPlan({ jobIds: [rec.jobId] });
    const current = fresh.recipients.find((r) => r.jobId === rec.jobId);
    if (!current || current.email !== rec.email || current.phone !== rec.phone) {
      results.push({ jobId: rec.jobId, jobNumber: rec.jobNumber, email: "skipped", sms: fresh.skipped.find((s) => s.jobId === rec.jobId)?.reason ?? "Enquiry changed before send" });
      continue;
    }
    results.push(await sendOne(current, fresh.mails.get(rec.jobId), fresh.sources.get(rec.jobId) ?? null, actorId));
  }
  return { ...base, results, hasMore: plan.recipients.length > 10 };
}
