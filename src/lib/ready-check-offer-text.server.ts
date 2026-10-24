// Decision 50 (Jo 24 Oct 2026): the office-picked installer is told by text + in the app. Best-effort; never blocks the
// offer. Real partners: the ONE real sender (`sendRealSms`, type "job_offer") — wording NOT approved yet, so it is
// recorded as blocked until Jo approves it and the switches are on; one text per offer (idempotency key).
// TEST jobs/partners: the test sender (allowlisted TEST numbers only), once per offer.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

export async function textInstallerAboutOffer(offerId: string): Promise<string> {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, kind, status, summary").eq("id", offerId).maybeSingle();
  if (!o || o.kind !== "ready_check" || o.status !== "pending") return "skipped";
  const [{ data: job }, { data: b }] = await Promise.all([
    admin.from("jobs").select("source").eq("id", o.job_id).maybeSingle(),
    admin.from("businesses").select("signer_mobile, phone, onboarding_notes").eq("id", o.business_id).maybeSingle(),
  ]);
  if (!job) return "skipped";
  const suburb = (o.summary as { suburb?: string | null } | null)?.suburb ?? null;
  const { readyCheckOfferText } = await import("./ready-check-times.core");
  const to = b?.signer_mobile ?? b?.phone ?? null;
  const { isTestPartner } = await import("./test-send.core");
  if (job.source === "qa_test" || isTestPartner(b)) {
    const label = `job_offer:${offerId}`;
    const { count } = await admin.from("job_communications").select("id", { count: "exact", head: true }).eq("job_id", o.job_id).eq("source_event", `jo_tradie:${label}`);
    if (count) return "already";
    const { sendTestSms, TEST_APP_BASE } = await import("./test-send.server");
    const r = await sendTestSms({ jobId: o.job_id, jobSource: job.source, partnerIsTest: isTestPartner(b), label, actorId: null }, to ?? "", readyCheckOfferText(suburb, `${TEST_APP_BASE}/field/offer/${offerId}`));
    return `${r.status}: ${r.detail}`;
  }
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const r = await (await import("./sms.server")).sendRealSms({
    type: "job_offer", idempotencyKey: `job-offer:v1:${offerId}`, to, jobId: o.job_id, businessId: o.business_id,
    body: readyCheckOfferText(suburb, `${CUSTOMER_BASE}/field/offer/${offerId}`),
  });
  return `${r.status}: ${r.detail}`;
}
