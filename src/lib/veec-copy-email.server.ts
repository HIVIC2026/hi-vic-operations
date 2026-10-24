// Copy of the executed VEEC assignment form to the consumer (ESC template: within 10 business days of electronic signing).
// Decision 169: the approved O62 email (veec-emails.core.ts) with the executed PDF already stored in the job file
// (`customer_assignments.final_copy_path`, written by assignment.server.ts `evaluateAndApply`) ATTACHED, plus the job page.
// TEST jobs go through test-send; real owners through the one guarded owner-email path (customer_comms_enabled + consent).
// If the stored PDF cannot be read the email is not sent (the wording says "attached"); the tick retries while copy_sent_at is null.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { veecCopyDueAt } from "./veec-assignment-form.core";
import { VEEC_COPY_EMAIL_APPROVED, bytesToBase64, renderVeecCopyEmail, veecCopyFilename, type VeecCopyEmailInput } from "./veec-emails.core";
import type { EmailAttachment } from "./email-kit.core";

export async function ownerMyJobLink(jobId: string): Promise<string | null> {
  const { data: link } = await admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle();
  const { linkUsable } = await import("./estimatelink.core");
  if (!link || !linkUsable(link)) return null;
  const { CUSTOMER_BASE } = await import("./engagement.core");
  return `${CUSTOMER_BASE}/my-job/${link.token}`;
}

/** The executed copy from the private job-files bucket as an email attachment, or null when it cannot be read. */
async function executedCopyAttachment(path: string | null, jobNumber: string): Promise<EmailAttachment | null> {
  if (!path) return null;
  const { data, error } = await admin.storage.from("job-files").download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length) return null;
  return { filename: veecCopyFilename(jobNumber), content: bytesToBase64(bytes), contentType: "application/pdf" };
}

export async function sendVeecCopyEmail(jobId: string): Promise<string> {
  const { data: a } = await admin.from("customer_assignments").select("id, status, consumer_signed_at, copy_sent_at, final_copy_path").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").eq("status", "effective_complete").maybeSingle();
  if (!a?.consumer_signed_at) return "skipped — not effective";
  if (a.copy_sent_at) return "already sent";
  const { data: job } = await admin.from("jobs").select("job_number, owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "skipped";
  const jobNumber = job.job_number ?? "";
  const [{ data: owner }, link, { data: asg }, attachment] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    ownerMyJobLink(jobId),
    admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    executedCopyAttachment(a.final_copy_path ?? null, jobNumber),
  ]);
  const dueAt = veecCopyDueAt(a.consumer_signed_at);
  if (!link) { await logEvent(jobId, null, "veec_copy_email_not_sent", `Signed VEEC assignment copy not emailed — no working owner job link (due by ${dueAt})`, { due_at: dueAt }, { internal: true }); return "not sent — owner link missing"; }
  if (!attachment) { await logEvent(jobId, null, "veec_copy_email_not_sent", `Signed VEEC assignment copy not emailed — the stored signed PDF could not be read (due by ${dueAt})`, { due_at: dueAt, final_copy_path: a.final_copy_path ?? null }, { internal: true }); return "not sent — signed copy file unavailable"; }
  const { firstName } = await import("./worker-links.core");
  const input: Omit<VeecCopyEmailInput, "unsubscribeUrl" | "test"> = { firstName: firstName(owner?.full_name ?? null), jobNumber, signedAt: a.consumer_signed_at, myJobUrl: `${link}?screen=done` };
  const markSent = async (how: string) => { await admin.from("customer_assignments").update({ copy_sent_at: new Date().toISOString() }).eq("id", a.id); await logEvent(jobId, null, "veec_copy_email_sent", `Signed VEEC assignment copy emailed to the owner (${how}, PDF attached)`, { due_at: dueAt, attachment: attachment.filename }); };
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const mail = renderVeecCopyEmail({ ...input, unsubscribeUrl: null, test: true });
    const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `veec_copy:${a.id}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text, { attachments: [attachment] });
    if (r.status === "sent") await markSent("TEST");
    return `${r.status}: ${r.detail}`;
  }
  if (!VEEC_COPY_EMAIL_APPROVED) { await logEvent(jobId, null, "veec_copy_email_not_sent", `Signed VEEC assignment copy prepared — wording awaiting Jo's approval, so no email was sent (due to the owner by ${dueAt})`, { due_at: dueAt }, { internal: true }); return "not sent — wording awaiting approval"; }
  if (!owner?.email) return "not sent — no owner email";
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  try { await assertCustomerDeliveryAllowed(jobId, "VEEC assignment copy email"); } catch (e) { return `not sent — ${(e as Error).message}`; }
  const r = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: "veec_assignment_copy", key: `veec-copy:v1:${a.id}`, build: (unsubscribeUrl) => ({ ...renderVeecCopyEmail({ ...input, unsubscribeUrl, test: false }), attachments: [attachment] }) });
  if (r === "sent") await markSent("email");
  return r;
}
