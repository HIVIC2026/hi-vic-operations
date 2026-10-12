// Sends Jo's own one-off office email to an applicant or partner, and records it on that record.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { OFFICE_REPLY_TO, officeEmailBlocker, officeEmailCopy, type OfficeRecipient } from "./office-email.core";
import { simpleEmail } from "./simple-email.core";
import type { SendResult } from "./test-send.server";
import { RESEND_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

const FROM = "Home Insulation Victoria <jobs@homeinsulationvictoria.com.au>";
export type OfficeEmailRecord = { applicationId?: string | null; enquiryId?: string | null; businessId?: string | null };

export async function sendOfficeEmail(p: { actorId: string; recipient: OfficeRecipient; to: string; contactName: string | null; subject: string; message: string; label: string; record: OfficeEmailRecord; html?: string; text?: string }): Promise<SendResult> {
  const blocked = officeEmailBlocker({ origin: "office_manual", recipient: p.recipient, to: p.to, message: p.message });
  const to = p.to.trim().toLowerCase();
  let mail = p.html && p.text ? { html: p.html, text: p.text } : null;
  const c = officeEmailCopy({ contactName: p.contactName, subject: p.subject, message: p.message });
  if (!mail) mail = simpleEmail(c.heading, c.lines, undefined, { testLabel: false });
  let r: SendResult;
  if (blocked) r = { channel: "email", to, status: "blocked", detail: blocked };
  else {
    try {
      const key = process.env["RESEND_API_KEY"], gw = process.env["LOVABLE_API_KEY"];
      if (!key || !gw) throw new Error("Email is not connected");
      const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${gw}`, "X-Connection-Api-Key": key, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ from: FROM, to: [to], reply_to: OFFICE_REPLY_TO, subject: c.subject, html: mail.html, text: mail.text }),
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
