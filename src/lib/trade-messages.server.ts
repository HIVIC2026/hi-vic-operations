// Decision 326 (25 Oct 2026): the approved trade messages that had wording but no workflow trigger.
//  - Decision 93 (B) + E1: a PIESA offer to an electrician → one text + one email per offer (both recorded before sending).
//  - I24 (decisions 92/136): the owner declined the installation quote → the existing installer email sender, once per quote.
//  - I53 (decision 136): an installer business signed its application → "We've got your application", once per application.
// Trades go through the partner office sender (`sendOfficeEmail`: paused with customer_comms_enabled, partner guards) and
// the ONE real SMS sender (`sendRealSms` type `piesa_offer`: comms switch + per-type switch + approved active partner +
// STOP + idempotency key + quiet hours); TEST jobs / TEST partners / TEST applications → test-send only.
// Live triggers: the owner's decline (portal.functions) and the application signature (installer-onboarding.functions).
// PIESA offers are picked up only by `sweepTradeMessages` on the 15-minute tick (allocation.server sits on the
// autoAdvanceJob import graph, which must stay free of senders); the sweep also catches up anything missed (24h for
// offers, 48h for declines and applications). Nothing here changes an offer, a quote or an application.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { APPROVED_TEXT_EVENT, APPROVED_TEXT_SWEEP_HOURS, QUIET_HOURS_WAIT, approvedTextKey, piesaOfferText } from "./approved-texts.core";

type OfferRow = { id: string; job_id: string; business_id: string | null; kind: string; status: string; summary: unknown; offered_at: string | null; expires_at: string | null };
type Biz = { id: string; name: string | null; email: string | null; signer_email: string | null; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null };

async function offerContext(offerId: string) {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, kind, status, summary, offered_at, expires_at").eq("id", offerId).maybeSingle();
  const offer = o as OfferRow | null;
  if (!offer || offer.kind !== "piesa" || offer.status !== "pending" || !offer.business_id) return null;
  const sum = (offer.summary ?? {}) as { suburb?: string | null; job_number?: string | null; approx_area_m2?: number | null; electrician_rate_inc_gst?: number | null; test_staged?: boolean };
  if (sum.test_staged) return null; // "Jo as a fake tradie" staged offers are texted/emailed by jo-tradie.server itself
  const [{ data: job }, { data: biz }, { count: ownerTimes }] = await Promise.all([
    admin.from("jobs").select("source, deleted_at").eq("id", offer.job_id).maybeSingle(),
    admin.from("businesses").select("id, name, email, signer_email, signer_mobile, phone, onboarding_notes").eq("id", offer.business_id).maybeSingle(),
    admin.from("appointment_proposals").select("id", { count: "exact", head: true }).eq("job_id", offer.job_id).not("piesa_window_round", "is", null).eq("status", "proposed").gt("starts_at", new Date().toISOString()),
  ]);
  if (!job || job.deleted_at) return null;
  const { isTestPartner } = await import("./test-send.core");
  const b = (biz ?? null) as Biz | null;
  const test = job.source === "qa_test" || isTestPartner(b);
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { TEST_APP_BASE } = await import("./test-send.server");
  return { offer, sum, job, biz: b, test, ownerTimesOpen: (ownerTimes ?? 0) > 0, link: `${test ? TEST_APP_BASE : CUSTOMER_BASE}/field/offer/${offer.id}` };
}

/** Decision 93 (B): one text per PIESA offer to the offered electrician business. */
export async function textElectricianAboutOffer(offerId: string, now = new Date()): Promise<string> {
  const c = await offerContext(offerId);
  if (!c) return "skipped";
  const key = approvedTextKey.piesaOffer(offerId);
  const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", c.offer.job_id).eq("event_type", APPROVED_TEXT_EVENT).contains("details", { key }).limit(1).maybeSingle();
  if (prior) return "already handled";
  if ((await import("./quote-hold.core")).smsQuietReason(now.toISOString())) return QUIET_HOURS_WAIT;
  const body = piesaOfferText({ suburb: c.sum.suburb ?? null, jobNumber: c.sum.job_number ?? null, pay: c.sum.electrician_rate_inc_gst ?? null, link: c.link });
  if (!body) return "missing facts";
  await logEvent(c.offer.job_id, null, APPROVED_TEXT_EVENT, `Electrician texted: new PIESA job offer (decision 93) — text prepared for ${c.biz?.name ?? "electrician"}`, { text: "piesa_offer", key, offer_id: offerId, business_id: c.offer.business_id }, { internal: true });
  const to = c.biz?.signer_mobile ?? c.biz?.phone ?? null;
  try {
    if (c.test) {
      const { sendTestSms } = await import("./test-send.server");
      const r = await sendTestSms({ jobId: c.offer.job_id, jobSource: c.job.source, partnerIsTest: (await import("./test-send.core")).isTestPartner(c.biz), label: `piesa_offer:${offerId}`, actorId: null }, to ?? "", body);
      return `electrician sms (test) ${r.status}: ${r.detail}`;
    }
    const stillOpen = c.offer.status === "pending" && (!c.offer.expires_at || Date.parse(c.offer.expires_at) > now.getTime());
    const r = await (await import("./sms.server")).sendRealSms({ type: "piesa_offer", idempotencyKey: key, to, body, jobId: c.offer.job_id, businessId: c.offer.business_id, event: { at: c.offer.offered_at ?? now.toISOString(), current: stillOpen } });
    return `electrician sms ${r.status}: ${r.detail}`;
  } catch (e) { return `electrician sms not sent — ${(e as Error).message}`; }
}

/** E1: one email per PIESA offer, alongside the text. */
export async function emailElectricianAboutOffer(offerId: string): Promise<string> {
  const c = await offerContext(offerId);
  if (!c) return "skipped";
  const { ELECTRICIAN_OFFER_EMAIL_APPROVED, ELECTRICIAN_OFFER_EMAIL_EVENT, ELECTRICIAN_OFFER_EMAIL_VERSION, renderElectricianOfferEmail } = await import("./electrician-offer-email.core");
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", c.offer.job_id).eq("event_type", ELECTRICIAN_OFFER_EMAIL_EVENT).contains("details", { offer_id: offerId });
  if (count) return "already handled";
  const to = c.biz?.email?.trim() || c.biz?.signer_email?.trim() || null;
  if (!to) return "missing facts";
  const mail = renderElectricianOfferEmail({ suburb: c.sum.suburb ?? null, rate: c.sum.electrician_rate_inc_gst ?? null, areaM2: c.sum.approx_area_m2 ?? null, ownerTimesOpen: c.ownerTimesOpen, offerUrl: c.link, test: c.test });
  if (!mail) return "missing facts";
  if (!c.test && !ELECTRICIAN_OFFER_EMAIL_APPROVED) return "skipped";
  await logEvent(c.offer.job_id, null, ELECTRICIAN_OFFER_EMAIL_EVENT, `Electrician offer email (E1) prepared for ${c.biz?.name ?? "electrician"}`, { offer_id: offerId, business_id: c.offer.business_id, to, version: ELECTRICIAN_OFFER_EMAIL_VERSION }, { internal: true });
  try {
    if (c.test) {
      const { sendTestEmail } = await import("./test-send.server");
      const r = await sendTestEmail({ jobId: c.offer.job_id, jobSource: c.job.source, partnerIsTest: (await import("./test-send.core")).isTestPartner(c.biz), label: `piesa_offer_email:${offerId}`, actorId: null, emailApproved: ELECTRICIAN_OFFER_EMAIL_APPROVED }, to, mail.subject, mail.html, mail.text);
      return `electrician email (test) ${r.status}: ${r.detail}`;
    }
    const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null, recipient: "partner", to, contactName: null, subject: mail.subject, message: mail.text, label: "piesa_offer_email", record: { businessId: c.offer.business_id }, html: mail.html, text: mail.text });
    return `electrician email ${r.status}: ${r.detail}`;
  } catch (e) { return `electrician email not sent — ${(e as Error).message}`; }
}

/** I24: the owner declined an installation quote → the installer email (existing sender, once per quote by its own event). */
export async function tellInstallerOwnerDeclined(jobId: string, quoteId: string, storedReason: string | null): Promise<string> {
  const { data: q } = await admin.from("quotes").select("kind, status").eq("id", quoteId).eq("job_id", jobId).maybeSingle();
  if (!q || q.kind !== "installation" || q.status !== "declined") return "skipped";
  const { splitDeclineReason } = await import("./trade-messages.core");
  return (await import("./installer-declined-email.server")).emailInstallerQuoteDeclined(jobId, quoteId, splitDeclineReason(storedReason));
}

/** I53: one "We've got your application" email per signed installer application. Recorded before sending. */
export async function emailApplicationReceived(applicationId: string): Promise<string> {
  const { data: app } = await admin.from("rec_onboarding_applications").select("id, status, partner_type, test_mode, data, signer_email, signer_name, partner_enquiry_id").eq("id", applicationId).maybeSingle();
  const a = app as { id: string; status: string; partner_type: string; test_mode: boolean | null; data: unknown; signer_email: string | null; signer_name: string | null; partner_enquiry_id: string | null } | null;
  if (!a || a.partner_type !== "installer" || a.status === "draft") return "skipped";
  const { APPLICATION_RECEIVED_EVENT, applicationReceivedFacts } = await import("./trade-messages.core");
  const { data: prior } = await admin.from("admin_config_events").select("id").eq("event_type", APPLICATION_RECEIVED_EVENT).contains("details", { application_id: a.id }).limit(1).maybeSingle();
  if (prior) return "already handled";
  const f = applicationReceivedFacts((a.data ?? {}) as Record<string, unknown>, a.signer_email, a.signer_name);
  if (!f.to || !f.businessName) return "missing facts";
  const { APPLICATION_RECEIVED_EMAIL_APPROVED, renderApplicationReceivedEmail } = await import("./application-review.core");
  if (!a.test_mode && !APPLICATION_RECEIVED_EMAIL_APPROVED) return "skipped";
  const test = !!a.test_mode;
  const mail = renderApplicationReceivedEmail({ contactName: f.contactName, businessName: f.businessName, test });
  const { TEST_ALLOWLIST } = await import("./test-send.core");
  const to = test ? TEST_ALLOWLIST.email[0]! : f.to; // TEST applications reach only Jo's allowlisted inbox
  const { error } = await admin.from("admin_config_events").insert({ actor_id: null, event_type: APPLICATION_RECEIVED_EVENT, summary: `"We've got your application" email prepared for ${f.businessName}`, details: { application_id: a.id, enquiry_id: a.partner_enquiry_id, to, test } as never });
  if (error) throw new Error(`Could not record the application email: ${error.message}`);
  try {
    if (test) {
      const r = await (await import("./test-send.server")).sendTestEmail({ jobId: null, jobSource: null, partnerIsTest: true, label: `application_received:${a.id}`, actorId: null }, to, mail.subject, mail.html, mail.text);
      return `applicant email (test) ${r.status}: ${r.detail}`;
    }
    const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null, recipient: "applicant", to, contactName: f.contactName, subject: mail.subject, message: mail.text, label: "application_received", record: { applicationId: a.id, enquiryId: a.partner_enquiry_id }, html: mail.html, text: mail.text });
    return `applicant email ${r.status}: ${r.detail}`;
  } catch (e) { return `applicant email not sent — ${(e as Error).message}`; }
}

/** 15-minute tick: catch up PIESA offers (24h), owner declines and signed installer applications (48h). */
export async function sweepTradeMessages(now = new Date()) {
  const out = { offerTexts: 0, offerEmails: 0, declined: 0, applications: 0 };
  const since24 = new Date(now.getTime() - APPROVED_TEXT_SWEEP_HOURS * 3_600_000).toISOString();
  const since48 = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const [offers, declines, apps] = await Promise.all([
    admin.from("partner_offers").select("id").eq("kind", "piesa").eq("status", "pending").gte("offered_at", since24).limit(200),
    admin.from("workflow_events").select("job_id, details").eq("event_type", "quote_declined").gte("created_at", since48).limit(200),
    admin.from("rec_onboarding_applications").select("id").eq("partner_type", "installer").neq("status", "draft").gte("signed_at", since48).limit(200),
  ]);
  for (const r of [offers, declines, apps]) if (r.error) throw new Error(`trade messages sweep: ${r.error.message}`);
  const ok = (r: string) => !["skipped", "already handled", "already sent", "missing facts", "no installer email", QUIET_HOURS_WAIT].includes(r);
  for (const o of offers.data ?? []) {
    try { if (ok(await textElectricianAboutOffer(o.id, now))) out.offerTexts++; } catch (e) { console.error("PIESA offer text failed", (e as Error).message); }
    try { if (ok(await emailElectricianAboutOffer(o.id))) out.offerEmails++; } catch (e) { console.error("PIESA offer email failed", (e as Error).message); }
  }
  for (const d of declines.data ?? []) {
    const det = (d.details ?? {}) as { quote_id?: string; reason?: string | null };
    if (!d.job_id || !det.quote_id) continue;
    try { if (ok(await tellInstallerOwnerDeclined(d.job_id, det.quote_id, det.reason ?? null))) out.declined++; } catch (e) { console.error("owner declined installer email failed", (e as Error).message); }
  }
  for (const a of apps.data ?? []) {
    try { if (ok(await emailApplicationReceived(a.id))) out.applications++; } catch (e) { console.error("application received email failed", (e as Error).message); }
  }
  return out;
}
