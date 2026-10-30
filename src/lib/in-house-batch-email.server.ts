// Allocation records intent only. The existing guarded sender owns all ledger claims and provider calls.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { assertCustomerDeliveryAllowed } from "./comms.server";
import { sendGuardedOwnerEmail } from "./owner-email-send.server";
import { emailShell, p as paragraph } from "./email-kit.core";

const PURPOSE = "in_house_partner_call";
const PENDING = "in_house_partner_call_email_pending";
type Pending = { job_id: string; details: { business_id?: string; batch_id?: string; partner_trading_name?: string } | null };
async function approvedTemplate() {
  const result = await admin.from("customer_communication_templates").select("id,subject,body_markdown,approved_by,approved_at")
    .eq("template_key", "in_house_partner_will_call").eq("status", "approved").not("approved_by", "is", null).not("approved_at", "is", null)
    .order("approved_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error("Could not read the approved partner call email.");
  return result.data;
}
export async function sendInHousePartnerCall(jobId: string): Promise<string> {
  const template = await approvedTemplate();
  if (!template) return "awaiting approval";
  const [job, pending, assignments, ledger] = await Promise.all([
    admin.from("jobs").select("id,source,stage,owners(email)").eq("id", jobId).is("deleted_at", null).neq("source", "qa_test").maybeSingle(),
    admin.from("workflow_events").select("job_id,details").eq("job_id", jobId).eq("event_type", PENDING).order("created_at").limit(1).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true),
    admin.from("customer_email_sends").select("id").eq("job_id", jobId).eq("purpose", PURPOSE).limit(1),
  ]);
  if (job.error || pending.error || assignments.error || ledger.error) throw new Error("Could not read partner call email safeguards.");
  const details = (pending.data as Pending | null)?.details;
  const owner = job.data?.owners as { email: string | null } | null;
  if (!job.data || ["cancelled", "complete"].includes(job.data.stage) || !owner?.email || !details?.partner_trading_name
    || !assignments.data?.some(a => a.business_id === details.business_id)) return "not applicable";
  if (ledger.data?.length) return "already attempted";
  try { await assertCustomerDeliveryAllowed(jobId, "Ready Check partner call email"); } catch { return "messages held"; }
  const replace = (text: string) => text.replaceAll("{{partner_trading_name}}", details.partner_trading_name ?? "");
  const subject = replace(template.subject), text = replace(template.body_markdown);
  // Unsupported placeholders fail closed; approved text is escaped, never executed as HTML.
  if (/\{\{[^}]+\}\}/.test(subject + text)) return "template needs review";
  return sendGuardedOwnerEmail({ jobId, jobSource: job.data.source, to: owner.email, purpose: PURPOSE,
    key: `in-house-partner-call:v1:${jobId}`,
    beforeSend: async () => {
      await assertCustomerDeliveryAllowed(jobId, "Ready Check partner call email");
      const current = await approvedTemplate();
      if (current?.id !== template.id || current.subject !== template.subject || current.body_markdown !== template.body_markdown) throw new Error("Partner call email approval changed.");
    },
    build: unsubscribeUrl => ({ subject, text, html: emailShell({ body: text.split(/\n\s*\n/).map(line => paragraph(line)).join(""), unsubscribe: unsubscribeUrl }) }),
  });
}
export async function sweepInHousePartnerCalls(): Promise<{ checked: number; sent: number }> {
  if (!(await approvedTemplate())) return { checked: 0, sent: 0 };
  // Read only current real jobs; exclude attempts BEFORE limiting so sent history cannot starve new pending jobs.
  const events = await admin.from("workflow_events").select("job_id,jobs!inner(id)").eq("event_type", PENDING)
    .is("jobs.deleted_at", null).neq("jobs.source", "qa_test").order("created_at");
  if (events.error) throw new Error("Could not read pending partner call emails.");
  const ids = [...new Set((events.data ?? []).flatMap(e => e.job_id ? [e.job_id] : []))];
  if (!ids.length) return { checked: 0, sent: 0 };
  const attempts = await admin.from("customer_email_sends").select("job_id").in("job_id", ids).eq("purpose", PURPOSE);
  if (attempts.error) throw new Error("Could not read partner call email attempts.");
  const attempted = new Set((attempts.data ?? []).map(a => a.job_id));
  const candidates = ids.filter(id => !attempted.has(id)).slice(0, 50);
  let sent = 0;
  for (const id of candidates) {
    try { if (await sendInHousePartnerCall(id) === "sent") sent++; }
    catch (error) { console.error("Partner call email sweep failed", error instanceof Error ? error.message : "unknown"); }
  }
  return { checked: candidates.length, sent };
}