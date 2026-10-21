import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { BLAST_KEY, BLAST_TYPE, blastClaimId, currentBlastPrice, offeredLink, selectBlast, type BlastRow } from "./save-spot-reminder-blast.core";
import { linkUsable } from "./estimatelink.core";
import { customerCommsEnabled } from "./comms.server";
import { sendRealSms, sendingNumber } from "./sms.server";
import { au1Configured } from "./twilio-au1.server";

const db = admin as any;
async function readAll(table: string, columns: string, configure: (q: any) => any) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await configure(db.from(table).select(columns)).range(offset, offset + 499);
    if (error) throw new Error(`Could not verify reminder ${table} records; nothing further sent`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 500) return rows;
  }
}

async function loadPlan(jobIds?: string[]) {
  const enquiries = await readAll("office_enquiry_index", "id,job_number,created_at,source,owner_name,owner_phone,spot_offered,spot_saved,deleted_at,removed,stage", (q) => {
    q = q.eq("spot_offered", true).order("created_at", { ascending: false }).order("id");
    return jobIds ? q.in("id", jobIds) : q;
  });
  const [optouts, handled] = await Promise.all([
    readAll("sms_optouts", "phone", (q) => q.not("opted_out_at", "is", null).order("phone")),
    readAll("sms_messages", "job_id,to_number", (q) => q.eq("message_type", BLAST_TYPE).like("idempotency_key", BLAST_KEY + "%").order("id")),
  ]);
  const rows: BlastRow[] = [];
  for (let offset = 0; offset < enquiries.length; offset += 100) {
    const slice = enquiries.slice(offset, offset + 100), ids = slice.map((r) => r.id);
    const [estimates, links, consents, sends, communications] = await Promise.all([
      readAll("indicative_estimates", "job_id,scenarios", (q) => q.in("job_id", ids).eq("status", "current").order("id")),
      readAll("customer_estimate_links", "id,job_id,token,status,expires_at", (q) => q.in("job_id", ids).eq("purpose", "step3_estimate").order("created_at", { ascending: false }).order("id")),
      readAll("owner_contact_consents", "job_id,consent_status", (q) => q.in("job_id", ids).order("created_at", { ascending: false }).order("id")),
      readAll("customer_email_sends", "job_id,estimate_link_id,purpose,idempotency_key,communication_id,provider_message_id", (q) => q.in("job_id", ids).eq("status", "sent").order("sent_at", { ascending: false }).order("id")),
      readAll("job_communications", "id,job_id,body,source_event,source_reference,provider_message_id,delivery_status", (q) => q.in("job_id", ids).eq("direction", "outbound").eq("channel", "email").in("delivery_status", ["sent", "delivered", "recorded"]).order("sent_at", { ascending: false }).order("id")),
    ]);
    for (const enquiry of slice) {
      const estimate = estimates.find((r) => r.job_id === enquiry.id);
      const send = sends.find((r) => r.job_id === enquiry.id && (r.purpose === "step3_estimate" ||
        (r.purpose === "existing_leads_launch_v1" && !String(r.idempotency_key).includes(":insulation_details:") && !/:b(:|$)/.test(r.idempotency_key ?? ""))));
      const jobLinks = links.filter((r) => r.job_id === enquiry.id && linkUsable(r));
      const link = send ? jobLinks.find((r) => r.id === send.estimate_link_id) : jobLinks[0];
      const mails = communications.filter((r) => r.job_id === enquiry.id);
      // Prefer the precise sent-offer communication; a missing body is a skip, never a generated URL.
      const mail = send?.communication_id ? mails.find((r) => r.id === send.communication_id) :
        send?.provider_message_id ? mails.find((r) => r.provider_message_id === send.provider_message_id && r.source_reference === send.idempotency_key) :
        mails.find((r) => ["sent", "delivered"].includes(r.delivery_status) && ["existing_leads_launch_v1", "step3_estimate", "jo_tradie:hot_leads_save_my_spot", "office_manual_email"].includes(r.source_event) && offeredLink(r.body, link?.token ?? null));
      rows.push({ ...enquiry, ...currentBlastPrice(estimate?.scenarios),
        link: offeredLink(mail?.body ?? null, link?.token ?? null),
        linkProblem: !link ? "Offered link missing, expired or revoked" : "Existing offer URL not found in sent email",
        consent: consents.find((r) => r.job_id === enquiry.id)?.consent_status === "granted" });
    }
  }
  return selectBlast(rows, optouts.map((r) => r.phone), handled.map((r) => r.job_id), handled.map((r) => r.to_number));
}

/** Dry run has no writes, estimate refresh, link issue, provider call or SMS claim. */
export async function runSaveSpotReminderBlast(dryRun: boolean) {
  const plan = await loadPlan();
  const sendBlockers: string[] = [];
  if (!(await customerCommsEnabled())) sendBlockers.push("Customer communications master switch is off (unchanged)");
  if (!sendingNumber() || !au1Configured()) sendBlockers.push("Australian SMS sender/connection is not configured");
  const result = { dryRun, recipientCount: plan.recipients.length, skipped: plan.skipped, samples: plan.recipients.slice(0, 5), sendBlockers };
  if (dryRun) return { ...result, results: [], hasMore: false };
  if (sendBlockers.length) throw new Error(sendBlockers.join("; "));
  const results: Array<{ jobId: string; jobNumber: string | null; status: string; detail: string }> = [];
  // Bounded calls: the admin screen explicitly requests subsequent batches. No background worker/cron.
  for (const recipient of plan.recipients.slice(0, 10)) {
    const fresh = await loadPlan([recipient.jobId]);
    const current = fresh.recipients.find((r) => r.jobId === recipient.jobId);
    if (!current || current.phone !== recipient.phone) {
      results.push({ jobId: recipient.jobId, jobNumber: recipient.jobNumber, status: "skipped", detail: fresh.skipped[0]?.reason ?? "Enquiry/phone changed before send" });
      continue;
    }
    const response = await sendRealSms({ type: BLAST_TYPE, jobId: current.jobId, to: current.phone, body: current.body, idempotencyKey: current.idempotencyKey },
      { adminSpotReminderBlast: true, claimId: await blastClaimId(current.phone) });
    results.push({ jobId: current.jobId, jobNumber: current.jobNumber, status: response.status, detail: response.detail });
  }
  return { ...result, results, hasMore: plan.recipients.length > 10 };
}