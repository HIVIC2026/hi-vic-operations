// Sends Jo's own one-off office email to an applicant or partner, and records it on that record.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { OFFICE_REPLY_TO, officeEmailBlocker, officeEmailCopy, officeEmailLayout, type OfficeRecipient } from "./office-email.core";
import type { SendResult } from "./test-send.server";
import { RESEND_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

const FROM = "Home Insulation Victoria <jobs@homeinsulationvictoria.com.au>";
export const PARTNER_EMAILS_PAUSED = "Emails are paused while the templates are reviewed (master switch off). Nothing was sent.";
export type OfficeEmailRecord = { applicationId?: string | null; enquiryId?: string | null; businessId?: string | null };

export async function sendOfficeEmail(p: { actorId: string | null; recipient: OfficeRecipient; to: string; contactName: string | null; subject: string; message: string; label: string; record: OfficeEmailRecord; html?: string; text?: string; attachments?: import("./email-kit.core").EmailAttachment[]; /** Once-only key: the email service drops a repeat with the same key (24h). */ idempotencyKey?: string }): Promise<SendResult> {
  // Jo 24 Oct: partner, applicant and electrician emails pause with the master switch until every template is reviewed.
  const { customerCommsEnabled } = await import("./comms.server");
  const paused = (await customerCommsEnabled()) ? null : PARTNER_EMAILS_PAUSED;
  const blocked = paused ?? officeEmailBlocker({ origin: "office_manual", recipient: p.recipient, to: p.to, message: p.message });
  const to = p.to.trim().toLowerCase();
  let mail = p.html && p.text ? { html: p.html, text: p.text } : null;
  const c = officeEmailCopy({ contactName: p.contactName, subject: p.subject, message: p.message });
  if (!mail) mail = officeEmailLayout({ contactName: p.contactName, subject: p.subject, message: p.message, test: false });
  let r: SendResult;
  if (blocked) r = { channel: "email", to, status: "blocked", detail: blocked };
  else {
    try {
      const key = process.env["RESEND_API_KEY"], gw = process.env["LOVABLE_API_KEY"];
      if (!key || !gw) throw new Error("Email is not connected");
      const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${gw}`, "X-Connection-Api-Key": key, "Content-Type": "application/json", "Idempotency-Key": p.idempotencyKey ?? crypto.randomUUID() },
        body: JSON.stringify({ from: FROM, to: [to], reply_to: OFFICE_REPLY_TO, subject: c.subject, html: mail.html, text: mail.text, ...(p.attachments?.length ? { attachments: p.attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })) } : {}) }),
        signal: timeoutSignal(RESEND_FETCH_TIMEOUT_MS),
      });
      const t = await res.text();
      r = res.ok ? { channel: "email", to, status: "sent", detail: "Accepted by the email service" } : { channel: "email", to, status: "failed", detail: res.status === 422 || res.status === 400 ? "The email service refused this address or message." : `The email service didn't accept it (error ${res.status}). Please try again shortly.` };
      if (!res.ok) console.error("office email failed", res.status, t.slice(0, 300));
    } catch (e) { r = { channel: "email", to, status: "failed", detail: `Couldn't reach the email service, so it may not have sent: ${(e as Error).message}` }; }
  }
  await admin.from("admin_config_events").insert({ actor_id: p.actorId, event_type: "office_manual_email", summary: `Office email to ${to}: ${r.status}`, details: { ...p.record, to, subject: c.subject, message: p.message, label: p.label, status: r.status, detail: r.detail, reply_to: OFFICE_REPLY_TO } as never });
  return r;
}
