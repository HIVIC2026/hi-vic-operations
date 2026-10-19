import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { hasCurrentOwnerContactConsent, customerCommsEnabled, recordCommunication } from "./comms.server";
import { configuredDeliveryAdapter } from "./delivery.server";
import { ownerCodeDeliveryKey, ownerCodeEmail, ownerCodeSmsBody, OWNER_CODE_PURPOSE } from "./owner-code-delivery.core";
import { WorkflowError, logEvent } from "./workflow.server";

type OwnerForCode = { email: string | null; phone: string | null };

export async function deliverOwnerCode(p: { jobId: string; codeId: string; channel: "sms" | "email"; code: string; owner: OwnerForCode }) {
  if (!(await customerCommsEnabled())) throw new WorkflowError("Customer communications are switched off, so the code was not sent.");
  if (!(await hasCurrentOwnerContactConsent(p.jobId))) throw new WorkflowError("No current owner contact consent, so the code was not sent.");
  const key = ownerCodeDeliveryKey(p.codeId);
  if (p.channel === "sms") {
    const { sendRealSms } = await import("./sms.server");
    const r = await sendRealSms({ type: "owner_code", idempotencyKey: key, to: p.owner.phone, body: ownerCodeSmsBody(p.code), jobId: p.jobId });
    await logEvent(p.jobId, null, "owner_code_delivery_attempted", `Owner signing code text: ${r.status}`, { code_id: p.codeId, status: r.status, detail: r.detail }, { internal: true });
    if (r.status === "sent" || r.status === "sent_unknown" || r.status === "already") return { status: r.status, detail: r.detail };
    throw new WorkflowError(`The text code was not sent: ${r.detail}`);
  }

  if (!p.owner.email) throw new WorkflowError("We don't have an email for you. Try text instead.");
  const adapter = await configuredDeliveryAdapter();
  if (!adapter) throw new WorkflowError("Email delivery is not configured, so the code was not sent.");
  const mail = ownerCodeEmail(p.code);
  try {
    const r = await adapter.deliver({ to: p.owner.email, subject: mail.text.split("\n")[0] ?? "Your signing code", html: mail.html, text: mail.text, idempotencyKey: key, purpose: OWNER_CODE_PURPOSE });
    await recordCommunication({ jobId: p.jobId, direction: "outbound", channel: "email", recipients: [p.owner.email], subject: "Your signing code", body: mail.text, provider: adapter.provider, providerMessageId: r.providerMessageId, visibility: "customer", sourceEvent: OWNER_CODE_PURPOSE, sourceReference: key, createdBy: null, deliveryStatus: "sent" });
    await logEvent(p.jobId, null, "owner_code_delivery_attempted", "Owner signing code email accepted by delivery provider", { code_id: p.codeId, provider: adapter.provider, provider_message_id: r.providerMessageId }, { internal: true });
    return { status: "sent" as const, detail: "Email accepted by delivery provider" };
  } catch (e) {
    await admin.from("job_communications").insert({
      job_id: p.jobId, direction: "outbound", channel: "email", recipients: [p.owner.email], subject: "Your signing code", body: mail.text,
      provider: adapter.provider, delivery_status: "failed", visibility: "customer", source_event: OWNER_CODE_PURPOSE, source_reference: key,
    }).then(() => null, () => null);
    const msg = e instanceof Error ? e.message : "unknown";
    await logEvent(p.jobId, null, "owner_code_delivery_failed", `Owner signing code email was not confirmed: ${msg.slice(0, 200)}`, { code_id: p.codeId }, { internal: true });
    throw new WorkflowError("The email code was not confirmed as sent. Please request a new code instead of retrying this one.");
  }
}
