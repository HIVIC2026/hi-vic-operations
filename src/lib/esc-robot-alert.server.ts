// Emails the office (info@) once when the Registry robot could not lodge. Lock-then-send like sendMittiFailureAlert:
// the event row is written first (deterministic id) so two calls can't both send; if the switch is off or the send
// fails the row is removed so a later call can try again. TEST jobs get no email at all.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isUniqueViolation, stableUuid } from "./mitti-create-claim.core";
import { OFFICE_REPLY_TO } from "./office-email.core";
import { RESEND_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";
import { formatPropertyAddress } from "./address";
import { SET_PASSWORD_BASE } from "./set-password-link.core";
import { robotAlertContent } from "./esc-robot-alert.core";
import type { RobotTask } from "./esc-registry-robot.core";

const ALERT_TO = "info@homeinsulationvictoria.com.au";
const FROM = "Home Insulation Victoria <jobs@homeinsulationvictoria.com.au>";
export const ROBOT_ALERT_EVENT = "esc_robot_alert_sent";

export type RobotAlertOutcome = "sent" | "already_sent" | "paused" | "test_skipped";

export async function sendRobotFailureAlert(p: { jobId: string; eventKey: string; task: RobotTask; step: string }): Promise<RobotAlertOutcome> {
  const { data: job, error: jobError } = await admin.from("jobs").select("job_number, source, property_id").eq("id", p.jobId).maybeSingle();
  // Fail closed: if we can't tell whether this is a TEST job, send nothing.
  if (jobError) throw new Error(`Could not read the job: ${jobError.message}`);
  if (!job) throw new Error("Could not find the job");
  if (job.source === "qa_test") return "test_skipped";
  const { data: prop, error: propError } = job.property_id ? await admin.from("properties").select("address_line, suburb, state, postcode").eq("id", job.property_id).maybeSingle() : { data: null, error: null };
  if (propError) throw new Error(`Could not read the property: ${propError.message}`);
  const address = prop ? formatPropertyAddress(prop as never) || null : null;
  const content = robotAlertContent({ jobNumber: job.job_number, address, task: p.task, step: p.step, jobUrl: `${SET_PASSWORD_BASE}/admin/jobs/${p.jobId}` });

  const id = await stableUuid("esc-robot-alert:" + p.eventKey);
  const { error } = await admin.from("workflow_events").insert({
    id, job_id: p.jobId, event_type: ROBOT_ALERT_EVENT, summary: "Office emailed: the robot couldn't lodge",
    details: { task: p.task, event_key: p.eventKey, to: ALERT_TO } as never, internal: true,
  });
  if (error) { if (isUniqueViolation(error)) return "already_sent"; throw new Error(error.message); }
  const unlock = async () => { await admin.from("workflow_events").delete().eq("id", id); };

  try {
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
    return "sent";
  } catch (e) {
    await unlock();
    throw e;
  }
}
