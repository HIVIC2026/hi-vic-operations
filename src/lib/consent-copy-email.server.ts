// Executed ESC consent copy to the owner (decision 123: the ESC recommends providing a copy). Best-effort: never blocks
// the AP signature. TEST jobs go through test-send; real owners get the approved wording (decision 170,
// CONSENT_COPY_EMAIL_APPROVED) only while customer messages are on, through the one guarded owner-email path. One email
// per executed consent (idempotency key on the consent id + signed hash). The executed PDF stored by consent.server
// (`owner_esc_consents.copy_path`, private job-files bucket) is attached when it can be read; otherwise the email still
// goes with the form text in the body (the wording never claims an attachment) and the result says so.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { EmailAttachment } from "./email-kit.core";

async function executedCopyAttachment(path: string | null, jobNumber: string | null): Promise<EmailAttachment | null> {
  if (!path) return null;
  const { data, error } = await admin.storage.from("job-files").download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length) return null;
  const { bytesToBase64 } = await import("./veec-emails.core");
  const { consentCopyFilename } = await import("./consent-copy-email.core");
  return { filename: consentCopyFilename(jobNumber), content: bytesToBase64(bytes), contentType: "application/pdf" };
}

export async function emailOwnerConsentCopy(p: { jobId: string; consentId: string; sha256: string; templateVersion: string; installationDays: string[]; address: string; formText: string; copyPath?: string | null }): Promise<string> {
  const { data: job } = await admin.from("jobs").select("owner_id, source, job_number").eq("id", p.jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: asg }, { data: link }, attachment] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(name, trading_name, onboarding_notes)").eq("job_id", p.jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", p.jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
    executedCopyAttachment(p.copyPath ?? null, job.job_number ?? null).catch(() => null),
  ]);
  const { linkUsable } = await import("./estimatelink.core");
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { firstName } = await import("./worker-links.core");
  const { renderConsentCopyEmail, CONSENT_COPY_EMAIL_APPROVED } = await import("./consent-copy-email.core");
  const input = {
    firstName: firstName(owner?.full_name ?? null), installationDays: p.installationDays, address: p.address, templateVersion: p.templateVersion,
    formText: p.formText, sha256: p.sha256, myJobUrl: link && linkUsable(link) ? `${CUSTOMER_BASE}/my-job/${link.token}` : null, attached: !!attachment,
  };
  const attachments = attachment ? { attachments: [attachment] } : {};
  const attachNote = attachment ? " (PDF attached)" : " (PDF not readable – form text in the body only)";
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; onboarding_notes: string | null } | null;
    const mail = renderConsentCopyEmail({ ...input, test: true });
    const r = await sendTestEmail({ jobId: p.jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `esc_consent_copy:${p.consentId}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text, attachments);
    return `${r.status}: ${r.detail}${attachNote}`;
  }
  if (!CONSENT_COPY_EMAIL_APPROVED) {
    await logEvent(p.jobId, null, "esc_consent_copy_not_sent", "Owner ESC consent executed — the copy email wording is awaiting approval, so no copy was emailed (copy stored on the job)", { consent_id: p.consentId }, { internal: true });
    return "not sent — wording awaiting approval";
  }
  if (!owner?.email) return "not sent — no owner email";
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  try { await assertCustomerDeliveryAllowed(p.jobId, "ESC consent copy email"); } catch (e) { return `not sent — ${(e as Error).message}`; }
  const r = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({
    jobId: p.jobId, jobSource: job.source, to: owner.email, purpose: "esc_consent_copy", key: `esc-consent-copy:v1:${p.consentId}:${p.sha256.slice(0, 16)}`,
    build: () => ({ ...renderConsentCopyEmail({ ...input, test: false }), ...attachments }),
  });
  return `${r}${attachNote}`;
}
