// Stage 6 (Jo 22 Oct 2026): once a released installation quote exists, tell the owner — by text, and by
// email only when an approved template is on file. Nothing here invents customer wording:
//  • the text uses the `quote_ready` type, whose wording is NOT approved yet, so the real sender refuses it
//    until Jo approves it (sms.core.ts). The draft below is what she would be approving.
//  • the email goes only through an approved `customer_communication_templates` row; with none on file the
//    office is told the quote went out with no email, instead of a made-up one.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export const QUOTE_EMAIL_TEMPLATE_KEY = "quote_ready";
/** DRAFT wording (never sent until Jo approves the `quote_ready` SMS type). */
export const quoteReadySmsBody = (jobNumber: string) =>
  `Your ceiling insulation quote is ready — please open your Home Insulation Victoria job page to see it (job ${jobNumber}). Reply STOP to opt out.`;

export type QuoteNotifyResult = { sms: string; email: string };

export async function notifyOwnerQuoteReady(jobId: string, quoteId: string, kind: string): Promise<QuoteNotifyResult> {
  if (kind !== "installation") return { sms: "skipped", email: "skipped" };
  const { data: job } = await admin.from("jobs").select("owner_id, job_number").eq("id", jobId).maybeSingle();
  if (!job) return { sms: "skipped", email: "skipped" };
  const { data: owner } = await admin.from("owners").select("phone, email").eq("id", job.owner_id).maybeSingle();

  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({
    type: "quote_ready", idempotencyKey: `quote-ready:v1:${quoteId}`, to: owner?.phone ?? null, jobId,
    body: quoteReadySmsBody(String(job.job_number ?? "")),
  }).catch((e) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : "error", sid: null }));

  const { data: tpl } = await admin.from("customer_communication_templates").select("subject, body_markdown")
    .eq("template_key", QUOTE_EMAIL_TEMPLATE_KEY).eq("status", "approved").order("version", { ascending: false }).limit(1).maybeSingle();
  let email = "no approved wording — not sent";
  if (tpl && owner?.email) {
    const { resendSend } = await import("./hot-leads-send.server");
    const d = await resendSend(owner.email, tpl.subject, tpl.body_markdown, tpl.body_markdown, `quote-ready-email:v1:${quoteId}`, null).catch(() => null);
    email = d && d.outcome !== "rejected" && d.outcome !== "not_attempted" ? "sent" : `failed: ${d?.detail ?? "send error"}`;
  }
  if (!tpl) {
    await logEvent(jobId, null, "ready_check_needs_office", "Quote released to the owner — no approved quote email wording on file, so no email was sent",
      { quote_id: quoteId, needs_office: true }, { internal: true });
  }
  return { sms: `${s.status}: ${s.detail}`, email };
}
