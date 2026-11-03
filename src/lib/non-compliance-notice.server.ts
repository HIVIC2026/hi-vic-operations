// Part 4 Task 13 (Jo 2 Nov 2026, answer 9; cl 27): the office presses "Tell the owner: something didn't comply" on the job page.
// Office only. Not called from anywhere else (no automatic trigger, no installer button). Compliance purpose `non_compliance_notice`:
// Do not contact and Unsubscribe never block it. Records ONE `non_compliance_notice_sent` per note before sending; the email key
// (per job + note) stops a repeat. The phone is the installer's OFFICE phone; missing office phone/email = held with an office note.
// TEST jobs → test-send only. Real owners → `sendGuardedOwnerEmail` behind NON_COMPLIANCE_NOTICE_APPROVED + customer_comms_enabled.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { NON_COMPLIANCE_HELD_EVENT, NON_COMPLIANCE_NOTICE_APPROVED, NON_COMPLIANCE_PURPOSE, NON_COMPLIANCE_SENT_EVENT, nonComplianceKey, nonComplianceNotice } from "./non-compliance-notice.core";

export type NonComplianceDeps = { approved: boolean };
const defaultDeps = (): NonComplianceDeps => ({ approved: NON_COMPLIANCE_NOTICE_APPROVED });

export async function sendNonComplianceNotice(jobId: string, actorId: string, i: { what: string; fix: string }, deps: NonComplianceDeps = defaultDeps()): Promise<string> {
  const { data: isAdmin, error } = await admin.rpc("has_role", { _user_id: actorId, _role: "admin" });
  if (error || isAdmin !== true) throw new Error("Only the office can send this.");
  const what = i.what.trim(), fix = i.fix.trim();
  if (!what || !fix) throw new Error("Say what we found and what the fix is.");
  const { data: job } = await admin.from("jobs").select("id, owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "not sent — job not found";
  const test = job.source === "qa_test";
  if (!test && !deps.approved) return "awaiting approval";
  const { data: owner } = job.owner_id ? await admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle() : { data: null };
  if (!owner?.email) return "not sent — no owner email";
  const { logEvent } = await import("./workflow.server");
  const contact = await (await import("./owner-contact.server")).businessContactForJob(jobId, "installer");
  const { contactLine } = await import("./owner-wording.core");
  if (!contact || !contactLine(contact)) {
    const why = !contact ? "No installer on the job" : !contact.officePhone?.trim() ? `No office phone for ${contact.tradingName || contact.name}` : `No business email for ${contact.tradingName || contact.name}`;
    await logEvent(jobId, actorId, NON_COMPLIANCE_HELD_EVENT, `Didn't-comply notice held: ${why}. Add it on the installer's business, then press the button again.`, { held: why }, { internal: true });
    return `held — ${why}`;
  }
  const { firstName } = await import("./worker-links.core");
  const facts = { firstName: firstName(owner.full_name ?? null), what, fix, contact };
  const key = nonComplianceKey(jobId, what, fix);
  const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", NON_COMPLIANCE_SENT_EVENT).contains("details", { key }).limit(1).maybeSingle();
  if (!prior) await logEvent(jobId, actorId, NON_COMPLIANCE_SENT_EVENT, "Office told the owner something didn't comply: email prepared", { key, what, fix }, { internal: true });
  if (test) {
    const { sendTestEmail } = await import("./test-send.server");
    const mail = nonComplianceNotice(facts);
    const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: false, label: `${NON_COMPLIANCE_PURPOSE}:${key}`, actorId }, owner.email, mail.subject, mail.html, mail.text);
    return `email ${r.status}: ${r.detail}`;
  }
  try {
    await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Didn't-comply notice");
    return await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: NON_COMPLIANCE_PURPOSE, key, build: () => nonComplianceNotice(facts) });
  } catch (e) { return `not sent — ${(e as Error).message}`; }
}
