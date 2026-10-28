// Batch 3a: send O78 "Your quote has expired" once per expired quote (key quote-expired:v1:<quoteId>).
// Real jobs: approval flag, delivery switch + consent, then the guarded sender. TEST jobs: test-send.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { QUOTE_EXPIRED_EMAIL_APPROVED, renderQuoteExpiredEmail } from "./quote-expired-email.core";
import { quoteExpiredEmailKey, quoteExpiredPageLink } from "./quote-expiry.core";

export const QUOTE_EXPIRED_PURPOSE = "quote_expired";

/** `link` = the owner's My job link, read before the job is closed. Returns a plain status line (never throws for a refusal). */
export async function sendQuoteExpiredEmail(jobId: string, quoteId: string, link?: string | null): Promise<string> {
  const { data: job } = await admin.from("jobs").select("source, owners(full_name, email), properties(address_line, suburb)").eq("id", jobId).maybeSingle();
  if (!job) return "skipped — job not found";
  const owner = (job.owners ?? null) as { full_name: string | null; email: string | null } | null;
  const prop = (job.properties ?? null) as { address_line: string | null; suburb: string | null } | null;
  const address = [prop?.address_line, prop?.suburb].filter(Boolean).join(", ") || "your home";
  const myJob = link ?? (await (await import("./veec-copy-email.server")).ownerMyJobLink(jobId));
  if (!myJob) return "email not sent — no working owner job link";
  const { firstName } = await import("./worker-links.core");
  const build = (unsubscribeUrl: string | null, test: boolean) => renderQuoteExpiredEmail({ firstName: firstName(owner?.full_name ?? null), address, link: quoteExpiredPageLink(myJob), unsubscribeUrl, test });
  if (job.source === "qa_test") {
    const { sendTestEmail } = await import("./test-send.server");
    const { isTestPartner } = await import("./test-send.core");
    const mail = build(null, true);
    // The installer may already be ended by the close, so read the most recent installer assignment (active or not).
    const { data: asg } = await admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const biz = ((asg as { businesses?: { onboarding_notes: string | null } | null } | null)?.businesses ?? null);
    const e = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `${QUOTE_EXPIRED_PURPOSE}:${quoteId}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text);
    return `email ${e.status}: ${e.detail}`;
  }
  if (!QUOTE_EXPIRED_EMAIL_APPROVED) return "email not sent — wording awaiting approval";
  if (!owner?.email) return "email not sent — no owner email";
  try {
    await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Quote expired email");
    return `email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: QUOTE_EXPIRED_PURPOSE, key: quoteExpiredEmailKey(quoteId), build: (u) => build(u, false) })}`;
  } catch (e) { return `email not sent — ${(e as Error).message}`; }
}
