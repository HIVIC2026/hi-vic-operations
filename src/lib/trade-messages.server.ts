// Decision 326 (25 Oct 2026): the approved trade messages that had wording but no workflow trigger.
//  - (Retired 2 Nov 2026, Part 4 Task 14: the decision 93 (B) PIESA offer text + E1 offer email to an electrician — the
//    installer's electrician gets the job as a no-login link instead; `piesa_offer` stays in SMS_MESSAGE_TYPES as history.)
//  - I24 (decisions 92/136): the owner declined the installation quote → the existing installer email sender, once per quote.
//  - I53 (decision 136): an installer business signed its application → "We've got your application", once per application.
// Trades go through the partner office sender (`sendOfficeEmail`: paused with customer_comms_enabled, partner guards);
// TEST jobs / TEST partners / TEST applications → test-send only.
// Live triggers: the owner's decline (portal.functions) and the application signature (installer-onboarding.functions);
// `sweepTradeMessages` on the 15-minute tick catches up anything missed (48h). Nothing here changes a quote or an application.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { QUIET_HOURS_WAIT } from "./approved-texts.core";

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
  // Jo 30 Oct 2026: "Pause all trade messages" — held before the once-only event, never claimed.
  if (!a.test_mode) { const tradePaused = await (await import("./trade-pause.server")).tradeMessagesPausedNow(); if (tradePaused) return `held: ${tradePaused}`; }
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

/** 15-minute tick: catch up owner declines and signed installer applications (48h). */
export async function sweepTradeMessages(now = new Date()) {
  const out = { declined: 0, applications: 0 };
  const since48 = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const [declines, apps] = await Promise.all([
    admin.from("workflow_events").select("job_id, details").eq("event_type", "quote_declined").gte("created_at", since48).limit(200),
    admin.from("rec_onboarding_applications").select("id").eq("partner_type", "installer").neq("status", "draft").gte("signed_at", since48).limit(200),
  ]);
  for (const r of [declines, apps]) if (r.error) throw new Error(`trade messages sweep: ${r.error.message}`);
  const ok = (r: string) => !["skipped", "already handled", "already sent", "missing facts", "no installer email", QUIET_HOURS_WAIT].includes(r) && !r.startsWith("held:");
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
