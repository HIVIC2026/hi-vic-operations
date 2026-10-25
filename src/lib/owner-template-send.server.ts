// One guarded path for the approved owner emails that have no live sender yet (decision 137: "nothing sent").
// Mirrors install-booked-email.server.ts: TEST jobs get the rendered email through test-send; real owners only when the
// template's own *_APPROVED flag is true AND customer messages are on, through the one guarded owner-email path
// (opt-out, suppression, idempotency key, unsubscribe). Best-effort: callers never block on the result.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export type OwnerEmailFacts = { firstName: string | null; ownerName: string | null; address: string | null; myJobUrl: string; installerName: string | null; installerPhone: string | null; test: boolean };

export async function sendOwnerTemplateEmail(p: {
  jobId: string; purpose: string; key: string; approved: boolean; label: string; notSentEvent: string;
  render: (f: OwnerEmailFacts) => { subject: string; html: string; text: string };
  /** Files sent with the email (e.g. the manufacturer warranty on the completion pack); the same on TEST and real sends. */
  attachments?: import("./email-kit.core").EmailAttachment[];
  /** Review R04: real owners only — passed to sendGuardedOwnerEmail (re-claim a DEFINITELY failed reservation, same key). */
  retryAfterDefiniteFailure?: boolean;
}): Promise<string> {
  const { data: job } = await admin.from("jobs").select("owner_id, property_id, source").eq("id", p.jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: prop }, { data: asg }, { data: link }] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    job.property_id ? admin.from("properties").select("address_line, suburb, postcode").eq("id", job.property_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("job_assignments").select("businesses(name, trading_name, phone, onboarding_notes)").eq("job_id", p.jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", p.jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
  ]);
  const { linkUsable } = await import("./estimatelink.core");
  if (!link || !linkUsable(link)) {
    await logEvent(p.jobId, null, p.notSentEvent, `${p.label} — no working owner job link, so no email was sent`, { purpose: p.purpose }, { internal: true });
    return "not sent — owner link missing";
  }
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; phone: string | null; onboarding_notes: string | null } | null;
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { fullAddress } = await import("./address");
  const { firstName } = await import("./worker-links.core");
  const test = job.source === "qa_test";
  const facts: OwnerEmailFacts = {
    firstName: firstName(owner?.full_name ?? null), ownerName: owner?.full_name ?? null,
    address: prop ? fullAddress(prop.address_line, prop.suburb, prop.postcode) || null : null, myJobUrl: `${CUSTOMER_BASE}/my-job/${link.token}`,
    installerName: (biz?.trading_name ?? biz?.name ?? null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null, installerPhone: biz?.phone ?? null, test,
  };
  if (test) {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const mail = p.render(facts);
    const r = await sendTestEmail({ jobId: p.jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `${p.purpose}:${p.key}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text, p.attachments?.length ? { attachments: p.attachments } : {});
    return `${r.status}: ${r.detail}`;
  }
  if (!p.approved) {
    await logEvent(p.jobId, null, p.notSentEvent, `${p.label} — the email is not switched on yet, so no email was sent`, { purpose: p.purpose }, { internal: true });
    return "not sent — awaiting approval";
  }
  if (!owner?.email) return "not sent — no owner email";
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  try { await assertCustomerDeliveryAllowed(p.jobId, p.label); } catch (e) { return `not sent — ${(e as Error).message}`; }
  return (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId: p.jobId, jobSource: job.source, to: owner.email, purpose: p.purpose, key: p.key, build: () => ({ ...p.render({ ...facts, test: false }), ...(p.attachments?.length ? { attachments: p.attachments } : {}) }), ...(p.retryAfterDefiniteFailure ? { retryAfterDefiniteFailure: true } : {}) });
}
