// Decision 92/136 (Jo 24 Oct 2026): short "Owner declined" email to the job's installer. Same shape as the accepted
// email sender (installer-accepted-email.server.ts), but INSTALLER_DECLINED_EMAIL_APPROVED is still false, so real
// partners get nothing; TEST jobs / TEST partners go only to Jo's TEST inbox. Never blocks the decline.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export async function emailInstallerQuoteDeclined(jobId: string, quoteId: string, reason: { label: string | null; note: string | null }): Promise<string> {
  const { INSTALLER_DECLINED_EMAIL_APPROVED, renderInstallerDeclinedEmail } = await import("./installer-accepted-email.core");
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "installer_declined_email").contains("details", { quote_id: quoteId });
  if (count) return "already sent";
  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("job_number, source, owners(full_name), properties(address_line, suburb)").eq("id", jobId).single(),
    admin.from("job_assignments").select("user_id, business_id, profiles:user_id(full_name, email), businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]);
  const prof = (asg?.profiles ?? null) as { full_name: string | null; email: string | null } | null;
  if (!job || !asg || !prof?.email) return "no installer email";
  const p = job.properties as { address_line: string | null; suburb: string | null } | null;
  const address = [p?.address_line, p?.suburb].filter(Boolean).join(", ") || null;
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const { isTestPartner } = await import("./test-send.core");
  const test = job.source === "qa_test" || isTestPartner(asg.businesses as never);
  if (!test && !INSTALLER_DECLINED_EMAIL_APPROVED) {
    await logEvent(jobId, null, "installer_declined_email_not_sent", "Owner declined — the installer email is not switched on yet, so nothing was sent", { quote_id: quoteId }, { internal: true });
    return "not approved";
  }
  const mail = renderInstallerDeclinedEmail({ installerFirstName: prof.full_name?.split(/\s+/)[0] ?? null, ownerName: (job.owners as { full_name: string | null } | null)?.full_name ?? null, address, jobNumber: job.job_number, jobUrl: `${SET_PASSWORD_BASE}/field/${jobId}`, reasonLabel: reason.label, reasonNote: reason.note, test });
  let status: string, detail: string;
  if (test) {
    const r = await (await import("./test-send.server")).sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: true, label: `installer_declined:${quoteId}`, actorId: null } as never, prof.email, mail.subject, mail.html, mail.text);
    status = r.status; detail = r.detail;
  } else {
    const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null as unknown as string, recipient: "partner", to: prof.email, contactName: prof.full_name, subject: mail.subject, message: mail.text, label: "installer_quote_declined", record: { businessId: asg.business_id }, html: mail.html, text: mail.text });
    status = r.status; detail = r.detail;
  }
  await logEvent(jobId, null, "installer_declined_email", `Installer told the owner declined (${status}: ${detail})`, { quote_id: quoteId, status, to: prof.email }, { internal: true });
  return status;
}
