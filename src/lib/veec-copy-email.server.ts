// Copy of the executed VEEC assignment form to the consumer (ESC template: within 10 business days of electronic signing).
// Prepared when the form becomes effective. TEST jobs get the draft through test-send; real owners only once Jo approves
// the wording (VEEC_COPY_EMAIL_APPROVED) AND customer messages are on, through the one guarded owner-email path.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { VEEC_COPY_EMAIL_APPROVED, veecCopyDueAt, veecCopyEmail } from "./veec-assignment-form.core";

export async function ownerMyJobLink(jobId: string): Promise<string | null> {
  const { data: link } = await admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle();
  const { linkUsable } = await import("./estimatelink.core");
  if (!link || !linkUsable(link)) return null;
  const { CUSTOMER_BASE } = await import("./engagement.core");
  return `${CUSTOMER_BASE}/my-job/${link.token}`;
}

export async function sendVeecCopyEmail(jobId: string): Promise<string> {
  const { data: a } = await admin.from("customer_assignments").select("id, status, consumer_signed_at, copy_sent_at").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").eq("status", "effective_complete").maybeSingle();
  if (!a?.consumer_signed_at) return "skipped — not effective";
  if (a.copy_sent_at) return "already sent";
  const { data: job } = await admin.from("jobs").select("job_number, owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, link, { data: asg }] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    ownerMyJobLink(jobId),
    admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
  ]);
  const dueAt = veecCopyDueAt(a.consumer_signed_at);
  if (!link) { await logEvent(jobId, null, "veec_copy_email_not_sent", `Signed VEEC assignment copy not emailed — no working owner job link (due by ${dueAt})`, { due_at: dueAt }, { internal: true }); return "not sent — owner link missing"; }
  const { firstName } = await import("./worker-links.core");
  const input = { firstName: firstName(owner?.full_name ?? null), jobNumber: job.job_number ?? "", signedAt: a.consumer_signed_at, link: `${link}?screen=done` };
  const markSent = async (how: string) => { await admin.from("customer_assignments").update({ copy_sent_at: new Date().toISOString() }).eq("id", a.id); await logEvent(jobId, null, "veec_copy_email_sent", `Signed VEEC assignment copy emailed to the owner (${how})`, { due_at: dueAt }); };
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const mail = veecCopyEmail({ ...input, test: true });
    const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `veec_copy:${a.id}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text);
    if (r.status === "sent") await markSent("TEST");
    return `${r.status}: ${r.detail}`;
  }
  if (!VEEC_COPY_EMAIL_APPROVED) { await logEvent(jobId, null, "veec_copy_email_not_sent", `Signed VEEC assignment copy prepared — wording awaiting Jo's approval, so no email was sent (due to the owner by ${dueAt})`, { due_at: dueAt }, { internal: true }); return "not sent — wording awaiting approval"; }
  if (!owner?.email) return "not sent — no owner email";
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  try { await assertCustomerDeliveryAllowed(jobId, "VEEC assignment copy email"); } catch (e) { return `not sent — ${(e as Error).message}`; }
  const r = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: "veec_assignment_copy", key: `veec-copy:v1:${a.id}`, build: () => veecCopyEmail({ ...input, test: false }) });
  if (r === "sent") await markSent("email");
  return r;
}
