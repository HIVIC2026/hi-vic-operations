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

/** Decision 106 (Jo 24 Oct 2026): the offer email alongside the text — same wording plus the offer link. Best-effort,
 *  one per offer. TEST jobs/partners: the test sender. Real partners: held behind READY_CHECK_OFFER_EMAIL_APPROVED (false)
 *  with one "not sent" event; once approved, the office partner sender (master switch + partner guards). */
export async function emailInstallerAboutOffer(offerId: string): Promise<string> {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, kind, status, summary").eq("id", offerId).maybeSingle();
  if (!o || o.kind !== "ready_check" || o.status !== "pending") return "skipped";
  const { READY_CHECK_OFFER_EMAIL_APPROVED, READY_CHECK_OFFER_EMAIL_EVENT, READY_CHECK_OFFER_EMAIL_NOT_SENT_EVENT, READY_CHECK_OFFER_EMAIL_VERSION, renderReadyCheckOfferEmail } = await import("./ready-check-offer-email.core");
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", o.job_id).in("event_type", [READY_CHECK_OFFER_EMAIL_EVENT, READY_CHECK_OFFER_EMAIL_NOT_SENT_EVENT]).contains("details", { offer_id: o.id });
  if (count) return "already";
  const [{ data: job }, { data: b }] = await Promise.all([
    admin.from("jobs").select("source, channel").eq("id", o.job_id).maybeSingle(),
    admin.from("businesses").select("name, email, signer_email, signer_name, onboarding_notes").eq("id", o.business_id).maybeSingle(),
  ]);
  if (!job || job.channel === "installer_sourced") return "skipped"; // our leads only
  const to = b?.email?.trim() || b?.signer_email?.trim() || null;
  if (!to) return "no business email";
  const suburb = (o.summary as { suburb?: string | null } | null)?.suburb ?? null;
  const first = b?.signer_name?.trim().split(/\s+/)[0] ?? null;
  const { logEvent } = await import("./workflow.server");
  const { isTestPartner } = await import("./test-send.core");
  let status: string, detail: string;
  if (job.source === "qa_test" || isTestPartner(b)) {
    const { sendTestEmail, TEST_APP_BASE } = await import("./test-send.server");
    const mail = renderReadyCheckOfferEmail({ installerFirstName: first, suburb, offerUrl: `${TEST_APP_BASE}/field/offer/${offerId}`, test: true });
    const r = await sendTestEmail({ jobId: o.job_id, jobSource: job.source, partnerIsTest: isTestPartner(b), label: `job_offer_email:${offerId}`, actorId: null }, to, mail.subject, mail.html, mail.text);
    status = r.status; detail = r.detail;
  } else if (!READY_CHECK_OFFER_EMAIL_APPROVED) {
    await logEvent(o.job_id, null, READY_CHECK_OFFER_EMAIL_NOT_SENT_EVENT, `Job offer email to ${b?.name ?? "installer"} not sent: wording waiting for Jo's approval (${READY_CHECK_OFFER_EMAIL_VERSION})`, { offer_id: o.id, business_id: o.business_id, version: READY_CHECK_OFFER_EMAIL_VERSION }, { internal: true });
    return "held: wording waiting for Jo's approval";
  } else {
    const { CUSTOMER_BASE } = await import("./engagement.core");
    const mail = renderReadyCheckOfferEmail({ installerFirstName: first, suburb, offerUrl: `${CUSTOMER_BASE}/field/offer/${offerId}` });
    const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null as unknown as string, recipient: "partner", to, contactName: b?.signer_name ?? null, subject: mail.subject, message: mail.text, label: "job_offer_email", record: { businessId: o.business_id }, html: mail.html, text: mail.text });
    status = r.status; detail = r.detail;
  }
  await logEvent(o.job_id, null, READY_CHECK_OFFER_EMAIL_EVENT, `Job offer email to ${b?.name ?? "installer"} (${status}: ${detail})`, { offer_id: o.id, business_id: o.business_id, status, to, version: READY_CHECK_OFFER_EMAIL_VERSION }, { internal: true });
  return `${status}: ${detail}`;
}
