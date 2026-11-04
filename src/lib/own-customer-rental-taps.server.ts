// Task 19 (Jo 2 Nov 2026, answer 24): an installer's OWN customer (no "It's your turn" text) is texted a link to the
// rental quick taps right after the installer adds the job: "Who should we arrange access with?" and their details.
// - Off while OWN_CUSTOMER_RENTAL_TAPS_APPROVED is false (draft wording): "awaiting approval", nothing read or sent; the
//   SMS type itself is also `wordingApproved: false` with its own switch, so it can never go early.
// - Only jobs the installer brought (channel installer_sourced); Home Insulation Victoria's leads get the questions in the
//   quick taps instead. Once per job (key own-rental-taps:v1:{job}); nothing if the rental answers are already in.
// - Do not contact, held messages, no mobile, no owner link → nothing sent. TEST jobs → test-send.
// - Add a job calls this inside try/catch: a failure here never fails Add a job.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { OWN_CUSTOMER_RENTAL_SMS_TYPE, OWN_CUSTOMER_RENTAL_TAPS_APPROVED, ownCustomerRentalTapsKey, ownCustomerRentalTapsText, rentalOnlyLink } from "./rental-answers.core";
import { quickTapsLink } from "./area-batch.core";
import type { RealSmsInput, RealSmsResult } from "./sms.server";

type JobRow = { id: string; channel: string | null; source: string | null; stage: string; deleted_at: string | null; originating_installer_business_id: string | null; owners: { full_name: string | null; phone: string | null } | null };
export type OwnRentalTapsDeps = {
  approved: boolean;
  readJob: (jobId: string) => Promise<JobRow | null>;
  installerName: (businessId: string | null) => Promise<string | null>;
  answered: (jobId: string) => Promise<boolean>;
  doNotContact: (jobId: string) => Promise<boolean>;
  allowed: (jobId: string, what: string) => Promise<void>;
  ownerLink: (jobId: string) => Promise<string | null>;
  sendSms: (input: RealSmsInput) => Promise<RealSmsResult>;
  sendTestSms: (to: string, body: string, job: JobRow) => Promise<{ status: string; detail: string }>;
};
const defaults = (): OwnRentalTapsDeps => ({
  approved: OWN_CUSTOMER_RENTAL_TAPS_APPROVED,
  readJob: async (jobId) => {
    const { data, error } = await admin.from("jobs").select("id, channel, source, stage, deleted_at, originating_installer_business_id, owners(full_name, phone)").eq("id", jobId).maybeSingle();
    if (error) throw new Error(`Could not read the job: ${error.message}`);
    return (data as unknown as JobRow | null) ?? null;
  },
  installerName: async (businessId) => {
    if (!businessId) return null;
    const { data, error } = await admin.from("businesses").select("name, trading_name").eq("id", businessId).maybeSingle();
    if (error) throw new Error(`Could not read the installer: ${error.message}`);
    return ((data?.trading_name ?? "").trim() || (data?.name ?? "").trim()) || null;
  },
  answered: async (jobId) => (await (await import("./rental-answers.server")).rentalAnswersFor(jobId)) !== null,
  doNotContact: async (jobId) => (await (await import("./do-not-contact.server")).readDoNotContact(jobId)).on,
  allowed: async (jobId, what) => (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, what),
  ownerLink: async (jobId) => {
    const { ensureOwnerLink } = await import("./estimatelink.server");
    if (!(await ensureOwnerLink(jobId))) return null;
    const { LINK_PURPOSE, linkUsable } = await import("./estimatelink.core");
    const { data } = await admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle();
    if (!data?.token || !linkUsable(data)) return null;
    const { CUSTOMER_BASE } = await import("./engagement.core");
    return `${CUSTOMER_BASE}/my-job/${data.token}`;
  },
  sendSms: async (input) => (await import("./sms.server")).sendRealSms(input),
  sendTestSms: async (to, body, job) => {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestSms } = await import("./test-send.server");
    const { data: biz } = job.originating_installer_business_id ? await admin.from("businesses").select("onboarding_notes").eq("id", job.originating_installer_business_id).maybeSingle() : { data: null };
    return sendTestSms({ jobId: job.id, jobSource: job.source, partnerIsTest: isTestPartner(biz ?? null), label: `${OWN_CUSTOMER_RENTAL_SMS_TYPE}:${job.id}`, actorId: null }, to, body);
  },
});
const firstWord = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] || null;

/** Text the installer's own customer the rental questions. Returns what happened (never throws for a normal hold). */
export async function textOwnRentalTaps(jobId: string, over: Partial<OwnRentalTapsDeps> = {}): Promise<string> {
  const d = { ...defaults(), ...over };
  if (!d.approved) return "awaiting approval";
  const job = await d.readJob(jobId);
  if (!job || job.channel !== "installer_sourced" || job.stage === "cancelled" || job.deleted_at) return "not applicable";
  const phone = job.owners?.phone ?? null;
  if (!(phone ?? "").trim()) return "no mobile";
  if (await d.answered(jobId)) return "already answered";
  if (await d.doNotContact(jobId)) return "do not contact";
  try { await d.allowed(jobId, "Rental questions text"); } catch { return "messages held"; }
  const link = await d.ownerLink(jobId);
  if (!link) return "no owner link";
  const installer = (await d.installerName(job.originating_installer_business_id)) ?? "Your installer";
  const body = ownCustomerRentalTapsText({ firstName: firstWord(job.owners?.full_name), installer, link: rentalOnlyLink(quickTapsLink(link)) });
  if (job.source === "qa_test") {
    const r = await d.sendTestSms(phone!, body, job);
    return r.status === "sent" ? "sent" : `held: ${r.detail}`;
  }
  const r = await d.sendSms({ type: OWN_CUSTOMER_RENTAL_SMS_TYPE, idempotencyKey: ownCustomerRentalTapsKey(jobId), to: phone, body, jobId, businessId: job.originating_installer_business_id });
  if (r.status === "sent" || r.status === "sent_unknown") return "sent";
  if (r.status === "already") return "already handled";
  return `held: ${r.detail}`;
}
