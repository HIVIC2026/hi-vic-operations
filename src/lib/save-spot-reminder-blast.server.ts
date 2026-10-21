import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { BLAST_KEY, BLAST_TYPE, blastClaimId, currentBlastPrice, offeredLink, selectBlast, type BlastRow } from "./save-spot-reminder-blast.core";
import { linkUsable } from "./estimatelink.core";
import { customerCommsEnabled } from "./comms.server";
import { sendRealSms, sendingNumber } from "./sms.server";
import { au1Configured } from "./twilio-au1.server";
import { createOneTapCredential } from "./save-spot-one-tap.core";
import { reminderSettings } from "./save-spot-reminder-settings.server";
import { campaignLink, campaignPermission } from "./launch-campaign.server";
import { joAreaBasis } from "./jo-area-basis.core";

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

async function loadPlan(jobIds?: string[], automatic = false) {
  const settings = automatic ? await reminderSettings() : null;
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
      readAll("indicative_estimates", "job_id,scenarios,area_source,area_m2", (q) => q.in("job_id", ids).eq("status", "current").order("id")),
      readAll("customer_estimate_links", "id,job_id,token,status,expires_at", (q) => q.in("job_id", ids).eq("purpose", "step3_estimate").order("created_at", { ascending: false }).order("id")),
      readAll("owner_contact_consents", "job_id,consent_status", (q) => q.in("job_id", ids).order("created_at", { ascending: false }).order("id")),
      readAll("customer_email_sends", "job_id,estimate_link_id,purpose,idempotency_key,communication_id,provider_message_id,sent_at", (q) => q.in("job_id", ids).eq("status", "sent").order("sent_at", { ascending: false }).order("id")),
      readAll("job_communications", "id,job_id,body,source_event,source_reference,provider_message_id,delivery_status,sent_at", (q) => q.in("job_id", ids).eq("direction", "outbound").eq("channel", "email").in("delivery_status", ["sent", "delivered", "recorded"]).order("sent_at", { ascending: false }).order("id")),
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
        offeredAt: send?.sent_at ?? mail?.sent_at ?? null,
        link: offeredLink(mail?.body ?? null, link?.token ?? null),
        linkProblem: !link ? "Offered link missing, expired or revoked" : "Existing offer URL not found in sent email",
        consent: consents.find((r) => r.job_id === enquiry.id)?.consent_status === "granted" });
    }
  }
  const plan = selectBlast(rows, optouts.map((r) => r.phone), handled.map((r) => r.job_id), handled.map((r) => r.to_number), { now: Date.now(), ...(automatic ? { activatedAt: settings?.activatedAt ?? null } : {}) });
  const recipients = [];
  for (const r of plan.recipients) {
    const original = rows.find(x => x.id === r.jobId);
    const url = new URL(original?.link ?? "");
    const token = url.pathname.split("/")[2] ?? "";
    const c = await campaignLink(token);
    const { data: review, error: reviewError } = await db.from("lead_campaign_responses").select("desk_check_status").eq("job_id", r.jobId).maybeSingle();
    const { data: estimate, error: estimateError } = await db.from("indicative_estimates").select("area_source,area_m2").eq("job_id",r.jobId).eq("status","current").maybeSingle();
    if (!c || reviewError || estimateError || !campaignPermission(c,review?.desk_check_status) || !joAreaBasis({ areaSource: estimate?.area_source, areaM2: estimate?.area_m2, ownerAreaM2: c.job.estimated_area_m2 }).ok) {
      plan.skipped.push({ jobId: r.jobId, jobNumber: r.jobNumber, reason: "Current Save My Spot eligibility/estimate requires office review" }); continue;
    }
    const { data: l } = await db.from("customer_estimate_links").select("expires_at").eq("token",token).maybeSingle();
    const expiry = Math.min(Date.now()+30*86400000,Date.parse(l?.expires_at ?? ""));
    if (!Number.isFinite(expiry) || expiry <= Date.now()) { plan.skipped.push({ jobId:r.jobId,jobNumber:r.jobNumber,reason:"Secure link expired" }); continue; }
    const credential = await createOneTapCredential(token,expiry,process.env["SAVE_SPOT_LINK_SECRET"] ?? "");
    const link = `https://estimate.homeinsulationvictoria.com.au/save-spot#c=${credential}`;
    const { blastMessage } = await import("./save-spot-reminder-blast.core");
    recipients.push({ ...r, body: blastMessage(r.firstName,original?.total ?? 0,original?.rebate ?? 0,link) });
  }
  return { ...plan, recipients };
}

/** Dry run has no writes, estimate refresh, link issue, provider call or SMS claim. */
export async function runSaveSpotReminderBlast(dryRun: boolean, automatic = false) {
  const settings = await reminderSettings();
  if (automatic && (!settings.enabled || !settings.activatedAt)) return { dryRun, recipientCount: 0, skipped: [], samples: [], sendBlockers: ["24-hour reminders are off"], results: [], hasMore: false };
  const plan = await loadPlan(undefined,automatic);
  const sendBlockers: string[] = [];
  if (!(await customerCommsEnabled())) sendBlockers.push("Customer communications master switch is off (unchanged)");
  if (!sendingNumber() || !au1Configured()) sendBlockers.push("Australian SMS sender/connection is not configured");
  const result = { dryRun, recipientCount: plan.recipients.length, skipped: plan.skipped, samples: plan.recipients.slice(0, 5), sendBlockers };
  if (dryRun) return { ...result, results: [], hasMore: false };
  if (sendBlockers.length) throw new Error(sendBlockers.join("; "));
  const results: Array<{ jobId: string; jobNumber: string | null; status: string; detail: string }> = [];
  // Bounded calls: the admin screen explicitly requests subsequent batches. No background worker/cron.
  for (const recipient of plan.recipients.slice(0, 10)) {
    if (automatic && !(await reminderSettings()).enabled) break;
    const fresh = await loadPlan([recipient.jobId],automatic);
    const current = fresh.recipients.find((r) => r.jobId === recipient.jobId);
    if (!current || current.phone !== recipient.phone) {
      results.push({ jobId: recipient.jobId, jobNumber: recipient.jobNumber, status: "skipped", detail: fresh.skipped[0]?.reason ?? "Enquiry/phone changed before send" });
      continue;
    }
    const response = await sendRealSms({ type: BLAST_TYPE, jobId: current.jobId, to: current.phone, body: current.body, idempotencyKey: current.idempotencyKey },
      { ...(automatic ? { scheduledSpotReminder: true as const } : { adminSpotReminderBlast: true as const }), claimId: await blastClaimId(current.phone) });
    results.push({ jobId: current.jobId, jobNumber: current.jobNumber, status: response.status, detail: response.detail });
  }
  return { ...result, results, hasMore: plan.recipients.length > 10 };
}