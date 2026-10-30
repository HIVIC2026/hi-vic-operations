// Decision 50 (Jo 24 Oct 2026): the office-picked installer is told by text + in the app. Best-effort; never blocks the
// offer. Real partners: the ONE real sender (`sendRealSms`, type "job_offer") with the decision 76 wording (approved,
// switched on by decision 154) — still gated by customer_comms_enabled + the job_offer switch; one text per offer (idempotency key).
// TEST jobs/partners: the test sender (allowlisted TEST numbers only), once per offer.
// Decision 361: `job_offer` keeps SMS quiet hours; sweepJobOfferTexts (15-minute tick) texts held offers at 7am.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { jobOfferCatchUpDue, jobOfferSmsKey } from "./ready-check-offer-text.core";

/** Decision 361: the 15-minute tick texts pending, unexpired Ready Check offers whose text was held by quiet hours
 *  (key still unclaimed). Real partners only — TEST offers use the test sender at offer time. Never throws per offer. */
export async function sweepJobOfferTexts(now = new Date()): Promise<{ checked: number; texted: number; failed: number }> {
  const out = { checked: 0, texted: 0, failed: 0 };
  const nowIso = now.toISOString();
  const { smsQuietReason } = await import("./quote-hold.core");
  if (smsQuietReason(nowIso)) return out;
  const { data: offers, error } = await admin.from("partner_offers").select("id, job_id, kind, status, expires_at").eq("kind", "ready_check").eq("status", "pending").gt("expires_at", nowIso).limit(200);
  if (error) throw new Error(`Job offers could not be read: ${error.message}`);
  for (const o of offers ?? []) {
    out.checked++;
    try {
      const key = jobOfferSmsKey(o.id);
      const { claimKeyOf } = await import("./sms.core");
      const { data: rows, error: re } = await (admin as unknown as { from: (t: string) => any }).from("sms_messages").select("idempotency_key, status, detail").like("idempotency_key", `${key}%`);
      if (re) throw new Error(re.message);
      const mine = ((rows ?? []) as { idempotency_key: string; status: string | null; detail: string | null }[]).filter((r) => claimKeyOf(r.idempotency_key) === key);
      const claimed = mine.some((r) => r.idempotency_key === key);
      const heldReasons = mine.filter((r) => r.idempotency_key !== key).map((r) => r.detail ?? "");
      if (!jobOfferCatchUpDue({ kind: o.kind, status: o.status, expiresAt: o.expires_at, claimed, heldReasons }, nowIso)) continue;
      const r = await textInstallerAboutOffer(o.id);
      if (/^sent\b/.test(r)) out.texted++;
    } catch (e) { out.failed++; console.error("job offer text catch-up failed", o.id, (e as Error).message); }
  }
  return out;
}

export async function textInstallerAboutOffer(offerId: string): Promise<string> {
  const { data: o } = await admin.from("partner_offers").select("id, job_id, business_id, kind, status, summary, offered_at, expires_at").eq("id", offerId).maybeSingle();
  if (!o || o.kind !== "ready_check" || o.status !== "pending") return "skipped";
  const [{ data: job }, { data: b }] = await Promise.all([
    admin.from("jobs").select("source").eq("id", o.job_id).maybeSingle(),
    admin.from("businesses").select("signer_mobile, phone, onboarding_notes").eq("id", o.business_id).maybeSingle(),
  ]);
  if (!job) return "skipped";
  const sum = o.summary as { suburb?: string | null; area_m2?: number | null } | null;
  const suburb = sum?.suburb ?? null, area = typeof sum?.area_m2 === "number" ? sum.area_m2 : null;
  const { readyCheckOfferText } = await import("./ready-check-times.core");
  const to = b?.signer_mobile ?? b?.phone ?? null;
  const { isTestPartner } = await import("./test-send.core");
  if (job.source === "qa_test" || isTestPartner(b)) {
    const label = `job_offer:${offerId}`;
    const { count } = await admin.from("job_communications").select("id", { count: "exact", head: true }).eq("job_id", o.job_id).eq("source_event", `jo_tradie:${label}`);
    if (count) return "already";
    const { sendTestSms, TEST_APP_BASE } = await import("./test-send.server");
    const r = await sendTestSms({ jobId: o.job_id, jobSource: job.source, partnerIsTest: isTestPartner(b), label, actorId: null }, to ?? "", readyCheckOfferText(suburb, `${TEST_APP_BASE}/field/offer/${offerId}`, area));
    return `${r.status}: ${r.detail}`;
  }
  const { CUSTOMER_BASE } = await import("./engagement.core");
  // Decision 165: the trigger is this offer. A switch flipped on after the 24h window (or after the installer answered)
  // must not text an old offer, so the sender gets the offer time and whether it is still open.
  const stillOpen = o.status === "pending" && (!o.expires_at || Date.parse(o.expires_at) > Date.now());
  const r = await (await import("./sms.server")).sendRealSms({
    type: "job_offer", idempotencyKey: jobOfferSmsKey(offerId), to, jobId: o.job_id, businessId: o.business_id,
    body: readyCheckOfferText(suburb, `${CUSTOMER_BASE}/field/offer/${offerId}`, area),
    event: { at: o.offered_at, current: stillOpen },
  });
  return `${r.status}: ${r.detail}`;
}

/** Decision 106 (Jo 24 Oct 2026): the offer email alongside the text — same wording plus the offer link. Best-effort,
 *  one per offer. TEST jobs/partners: the test sender. Real partners: READY_CHECK_OFFER_EMAIL_APPROVED (on since decision 154)
 *  → the office partner sender (master switch + partner guards); off would record one "not sent" event instead. */
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
  const sum = o.summary as { suburb?: string | null; area_m2?: number | null } | null;
  const suburb = sum?.suburb ?? null, areaM2 = typeof sum?.area_m2 === "number" ? sum.area_m2 : null;
  const first = b?.signer_name?.trim().split(/\s+/)[0] ?? null;
  const { logEvent } = await import("./workflow.server");
  const { isTestPartner } = await import("./test-send.core");
  let status: string, detail: string;
  if (job.source === "qa_test" || isTestPartner(b)) {
    const { sendTestEmail, TEST_APP_BASE } = await import("./test-send.server");
    const mail = renderReadyCheckOfferEmail({ installerFirstName: first, suburb, areaM2, offerUrl: `${TEST_APP_BASE}/field/offer/${offerId}`, test: true });
    const r = await sendTestEmail({ jobId: o.job_id, jobSource: job.source, partnerIsTest: isTestPartner(b), label: `job_offer_email:${offerId}`, actorId: null }, to, mail.subject, mail.html, mail.text);
    status = r.status; detail = r.detail;
  } else if (!READY_CHECK_OFFER_EMAIL_APPROVED) {
    await logEvent(o.job_id, null, READY_CHECK_OFFER_EMAIL_NOT_SENT_EVENT, `Job offer email to ${b?.name ?? "installer"} not sent: wording waiting for Jo's approval (${READY_CHECK_OFFER_EMAIL_VERSION})`, { offer_id: o.id, business_id: o.business_id, version: READY_CHECK_OFFER_EMAIL_VERSION }, { internal: true });
    return "held: wording waiting for Jo's approval";
  } else {
    const { CUSTOMER_BASE } = await import("./engagement.core");
    const mail = renderReadyCheckOfferEmail({ installerFirstName: first, suburb, areaM2, offerUrl: `${CUSTOMER_BASE}/field/offer/${offerId}` });
    const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null as unknown as string, recipient: "partner", to, contactName: b?.signer_name ?? null, subject: mail.subject, message: mail.text, label: "job_offer_email", record: { businessId: o.business_id }, html: mail.html, text: mail.text });
    // Jo 30 Oct 2026: a "Pause all trade messages" hold is recorded by the sender but never claims this offer's email.
    if (r.status === "blocked" && (await import("./trade-pause.core")).isTradePauseHold(r.detail)) return `held: ${r.detail}`;
    status = r.status; detail = r.detail;
  }
  await logEvent(o.job_id, null, READY_CHECK_OFFER_EMAIL_EVENT, `Job offer email to ${b?.name ?? "installer"} (${status}: ${detail})`, { offer_id: o.id, business_id: o.business_id, status, to, version: READY_CHECK_OFFER_EMAIL_VERSION }, { internal: true });
  return `${status}: ${detail}`;
}
