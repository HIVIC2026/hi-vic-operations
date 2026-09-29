// Referral persistence (service role). Never contacts the referred friend; stores no friend PII.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { newReferralToken, planReferralToken, referralDedupe, referralShareUrl } from "./referral.core";

async function logReferral(tokenId: string, type: "referral_link_created" | "referral_clicked" | "referral_submission", dedupeKey: string, ext: string | null = null) {
  const { error } = await admin.from("customer_referral_events").insert({ referral_token_id: tokenId, event_type: type, dedupe_key: dedupeKey, referred_external_enquiry_id: ext, metadata: {} });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  return !error;
}

async function ensure(where: { job_id: string } | { external_enquiry_id: string }) {
  const q = admin.from("customer_referral_tokens").select("id, token, status").eq("status", "active");
  const { data: cur } = "job_id" in where ? await q.eq("job_id", where.job_id).maybeSingle() : await q.eq("external_enquiry_id", where.external_enquiry_id).is("job_id", null).maybeSingle();
  if (planReferralToken(cur ?? null) === "reuse") return cur!;
  const { data, error } = await admin.from("customer_referral_tokens").insert({ ...where, token: newReferralToken() }).select("id, token, status").single();
  if (error) { // lost a race: the other writer's active token wins
    const again = "job_id" in where ? await admin.from("customer_referral_tokens").select("id, token, status").eq("status", "active").eq("job_id", where.job_id).maybeSingle() : await admin.from("customer_referral_tokens").select("id, token, status").eq("status", "active").eq("external_enquiry_id", where.external_enquiry_id).is("job_id", null).maybeSingle();
    if (!again.data) throw new Error(error.message);
    return again.data;
  }
  await logReferral(data.id, "referral_link_created", referralDedupe.created(data.id));
  return data;
}

/** Full share URL only — callers never receive the raw token separately. */
export async function referralUrlForJob(jobId: string) { return referralShareUrl((await ensure({ job_id: jobId })).token); }
/** For ineligible Base44-only enquiries (no Lovable job). */
export async function referralUrlForExternalEnquiry(externalEnquiryId: string) { return referralShareUrl((await ensure({ external_enquiry_id: externalEnquiryId })).token); }

async function activeByToken(token: string) {
  const { data } = await admin.from("customer_referral_tokens").select("id").eq("token", token).eq("status", "active").maybeSingle();
  return data;
}

export async function trackReferralClick(token: string) {
  const t = await activeByToken(token);
  if (t && (await logReferral(t.id, "referral_clicked", referralDedupe.click(t.id)))) await admin.rpc("bump_referral_counter", { _id: t.id, _field: "click" });
}

export async function recordReferralSubmission(token: string, externalEnquiryId: string) {
  const t = await activeByToken(token);
  if (t && (await logReferral(t.id, "referral_submission", referralDedupe.submission(t.id, externalEnquiryId), externalEnquiryId))) await admin.rpc("bump_referral_counter", { _id: t.id, _field: "submission" });
}

export async function adminReferral(jobId: string) {
  const { data } = await admin.from("customer_referral_tokens").select("status, click_count, referred_submission_count, created_at, last_used_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}
