// Executed ESC consent copy to the owner (decision 123: the ESC recommends providing a copy). Best-effort: never blocks
// the AP signature. TEST jobs get the draft through test-send; real owners only once Jo approves the wording
// (CONSENT_COPY_EMAIL_APPROVED) AND customer messages are on, through the one guarded owner-email path. One email per
// executed consent (idempotency key on the consent id + signed hash).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export async function emailOwnerConsentCopy(p: { jobId: string; consentId: string; sha256: string; templateVersion: string; installationDays: string[]; address: string; formText: string }): Promise<string> {
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", p.jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: asg }, { data: link }] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(name, trading_name, onboarding_notes)").eq("job_id", p.jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", p.jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
  ]);
  const { linkUsable } = await import("./estimatelink.core");
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { firstName } = await import("./worker-links.core");
  const { renderConsentCopyEmail, CONSENT_COPY_EMAIL_APPROVED } = await import("./consent-copy-email.core");
  const input = {
    firstName: firstName(owner?.full_name ?? null), installationDays: p.installationDays, address: p.address, templateVersion: p.templateVersion,
    formText: p.formText, sha256: p.sha256, myJobUrl: link && linkUsable(link) ? `${CUSTOMER_BASE}/my-job/${link.token}` : null,
  };
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; onboarding_notes: string | null } | null;
    const mail = renderConsentCopyEmail({ ...input, test: true });
    const r = await sendTestEmail({ jobId: p.jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `esc_consent_copy:${p.consentId}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text);
    return `${r.status}: ${r.detail}`;
  }
  if (!CONSENT_COPY_EMAIL_APPROVED) {
    await logEvent(p.jobId, null, "esc_consent_copy_not_sent", "Owner ESC consent executed — the copy email wording is awaiting approval, so no copy was emailed (copy stored on the job)", { consent_id: p.consentId }, { internal: true });
    return "not sent — wording awaiting approval";
  }
  if (!owner?.email) return "not sent — no owner email";
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  try { await assertCustomerDeliveryAllowed(p.jobId, "ESC consent copy email"); } catch (e) { return `not sent — ${(e as Error).message}`; }
  return (await import("./owner-email-send.server")).sendGuardedOwnerEmail({
    jobId: p.jobId, jobSource: job.source, to: owner.email, purpose: "esc_consent_copy", key: `esc-consent-copy:v1:${p.consentId}:${p.sha256.slice(0, 16)}`,
    build: () => renderConsentCopyEmail({ ...input, test: false }),
  });
}
