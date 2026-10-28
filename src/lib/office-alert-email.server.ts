// Emails the office (info@) once when a Mitti form could not be created. Its own sender module: never import it from
// auto-advance code. Lock-then-send: the alert_sent event is written first (deterministic id), so two sweeps can't
// both send; if the switch is off or the send fails the event is removed so the next sweep tries again.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isUniqueViolation, stableUuid, type MittiFormKind } from "./mitti-create-claim.core";
import { ALERT_SENT_EVENT } from "./mitti-retry.core";
import { OFFICE_REPLY_TO } from "./office-email.core";
import { RESEND_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

export const ALERT_TO = "info@homeinsulationvictoria.com.au";
const FROM = "Home Insulation Victoria <jobs@homeinsulationvictoria.com.au>";

export type AlertOutcome = "sent" | "already_sent" | "paused" | "test_routed";

export async function sendMittiFailureAlert(jobId: string, kind: MittiFormKind, alertKey: string, content: { subject: string; text: string; html: string }): Promise<AlertOutcome> {
  const { data: job } = await admin.from("jobs").select("source").eq("id", jobId).maybeSingle();
  const { data: asg } = await admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const { isTestPartner, TEST_ALLOWLIST } = await import("./test-send.core");
  const source = (job?.source ?? null) as string | null;
  const test = source === "qa_test" || isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null);
  const to = test ? TEST_ALLOWLIST.email[0] : ALERT_TO;

  const id = await stableUuid("mitti-alert:" + alertKey);
  const { error } = await admin.from("workflow_events").insert({
    id, job_id: jobId, event_type: ALERT_SENT_EVENT, summary: `Office emailed: a ${kind.replace(/_/g, " ")} form could not be created`,
    details: { kind, alert_key: alertKey, to } as never, internal: true,
  });
  if (error) { if (isUniqueViolation(error)) return "already_sent"; throw new Error(error.message); }
  const unlock = async () => { await admin.from("workflow_events").delete().eq("id", id); };

  try {
    if (test) {
      // Same rules as every other test email: the test sender only reaches the allowlist.
      const { sendTestEmail } = await import("./test-send.server");
      const r = await sendTestEmail({ jobId, jobSource: source, partnerIsTest: test && source !== "qa_test", label: `mitti_failure_alert:${kind}`, actorId: null }, to, content.subject, content.html, content.text);
      if (r.status === "failed") throw new Error(r.detail);
      return "test_routed";
    }
    const { customerCommsEnabled } = await import("./comms.server");
    if (!(await customerCommsEnabled())) { await unlock(); return "paused"; }
    const key = process.env["RESEND_API_KEY"], gw = process.env["LOVABLE_API_KEY"];
    if (!key || !gw) throw new Error("Email is not connected");
    const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${gw}`, "X-Connection-Api-Key": key, "Content-Type": "application/json", "Idempotency-Key": id },
      body: JSON.stringify({ from: FROM, to: [ALERT_TO], reply_to: OFFICE_REPLY_TO, subject: content.subject, html: content.html, text: content.text }),
      signal: timeoutSignal(RESEND_FETCH_TIMEOUT_MS),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`The email service didn't accept the alert (error ${res.status}): ${body.slice(0, 200)}`);
    try {
      const msgId = (JSON.parse(body) as { id?: string }).id;
      if (msgId) await admin.from("workflow_events").update({ details: { kind, alert_key: alertKey, to: ALERT_TO, message_id: msgId } as never }).eq("id", id);
    } catch { /* optional detail only */ }
    return "sent";
  } catch (e) {
    await unlock();
    throw e;
  }
}
