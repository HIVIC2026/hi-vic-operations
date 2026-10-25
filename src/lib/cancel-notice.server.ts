// Decision 291 (Jo, 25 Oct 2026): the Cancel dialog's ticks send O69 (owner) and I70 (installer) by EMAIL — never text.
// Called only from cancelJobFully (office-actions.server) after the job is closed and released; the installer recipient
// is captured there BEFORE the assignment is ended. Guards, unchanged: TEST jobs / TEST partners → test-send only;
// a real owner → sendGuardedOwnerEmail (customer_comms_enabled + consent via assertCustomerDeliveryAllowed, opt-out,
// suppression, one ledger row per key); a real installer → the partner office-email path (paused with the master
// switch). One `cancel_notice_sent` event per send, `cancel_notice_held` when a ticked notice could not go. A failed
// provider send is a failed customer_email_sends row, so send-failed.core shows it on Needs me like every other send.
// Best-effort: nothing here throws back into the cancel. Never reachable from the auto-advance graph.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  CANCEL_NOTICE_EMAILS_APPROVED, CANCEL_NOTICE_HELD_EVENT, CANCEL_NOTICE_PURPOSE, CANCEL_NOTICE_SENT_EVENT, type CancelNoticeWho,
  cancelNoticeKey, cancelNoticePlace, renderInstallerCancelledEmail, renderOwnerCancelledEmail,
} from "./cancel-notice.core";

/** The installer business to tell: the active assignment at cancel time (read before it is ended), else the originating business. */
export type InstallerRecipient = {
  businessId: string | null;
  contactName: string | null;
  /** Business email first (decision 291: the installer BUSINESS email), else the assigned person's. */
  email: string | null;
  isTestPartner: boolean;
};

/** The office phone number shown in O69/I70 — env only; no number on file = the "reply to this email" wording. */
export const officePhone = () => process.env["HIV_OFFICE_PHONE"]?.trim() || null;

type Outcome = { who: CancelNoticeWho; status: "sent" | "held" | "already"; detail: string; to: string | null };

export type CancelNoticeResult = { owner: Outcome | null; installer: Outcome | null };

async function alreadySent(jobId: string, cancelSeq: number, who: CancelNoticeWho): Promise<boolean> {
  const { data } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", CANCEL_NOTICE_SENT_EVENT).contains("details", { who, cancel_seq: cancelSeq }).limit(1).maybeSingle();
  return !!data;
}

async function record(jobId: string, actorId: string, o: Outcome, cancelSeq: number, key: string) {
  const label = o.who === "owner" ? "Owner job-cancelled email (O69)" : "Installer job-cancelled email (I70)";
  if (o.status === "sent") await logEvent(jobId, actorId, CANCEL_NOTICE_SENT_EVENT, `${label} sent${o.to ? ` to ${o.to}` : ""} (${o.detail})`, { who: o.who, channel: "email", cancel_seq: cancelSeq, key, status: "sent", detail: o.detail, to: o.to, decision: 291 }, { internal: true });
  else if (o.status === "held") await logEvent(jobId, actorId, CANCEL_NOTICE_HELD_EVENT, `${label} held — ${o.detail}`, { who: o.who, channel: "email", cancel_seq: cancelSeq, key, status: "held", detail: o.detail, to: o.to, decision: 291 }, { internal: true });
}

/** A provider refusal on the partner path becomes a failed ledger row so Needs me's "Send failed" row shows it. */
async function recordFailedInstallerSend(jobId: string, key: string, detail: string) {
  await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: CANCEL_NOTICE_PURPOSE.installer, idempotency_key: key, status: "failed", provider: "resend", error: detail.slice(0, 480) });
}

export async function sendCancelNotices(jobId: string, actorId: string, tell: { owner: boolean; installer: boolean }, i: { cancelSeq: number; installer: InstallerRecipient | null }): Promise<CancelNoticeResult> {
  const out: CancelNoticeResult = { owner: null, installer: null };
  if (!tell.owner && !tell.installer) return out;
  const { data: job } = await admin.from("jobs").select("job_number, source, owner_id, property_id").eq("id", jobId).maybeSingle();
  if (!job) return out;
  const [{ data: owner }, { data: prop }] = await Promise.all([
    tell.owner && job.owner_id ? admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle() : Promise.resolve({ data: null as { full_name: string | null; email: string | null } | null }),
    job.property_id ? admin.from("properties").select("address_line, suburb, postcode").eq("id", job.property_id).maybeSingle() : Promise.resolve({ data: null as { address_line: string | null; suburb: string | null; postcode: string | null } | null }),
  ]);
  const phone = officePhone();
  const testJob = job.source === "qa_test";

  if (tell.owner) {
    const who = "owner" as const, key = cancelNoticeKey(jobId, i.cancelSeq, who);
    try {
      if (await alreadySent(jobId, i.cancelSeq, who)) out.owner = { who, status: "already", detail: "already sent for this cancellation", to: null };
      else {
        const { fullAddress } = await import("./address");
        const { firstName } = await import("./worker-links.core");
        const to = owner?.email?.trim() || null;
        const render = (test: boolean) => renderOwnerCancelledEmail({ firstName: firstName(owner?.full_name), jobNumber: job.job_number, address: prop ? fullAddress(prop.address_line, prop.suburb, prop.postcode) || null : null, officePhone: phone, test });
        if (testJob) {
          const { sendTestEmail } = await import("./test-send.server");
          const m = render(true);
          const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: false, label: `${CANCEL_NOTICE_PURPOSE.owner}:${key}`, actorId }, to ?? "", m.subject, m.html, m.text);
          out.owner = { who, status: r.status === "sent" ? "sent" : "held", detail: `test-send ${r.status}: ${r.detail}`, to: r.to || to };
        } else if (!CANCEL_NOTICE_EMAILS_APPROVED) out.owner = { who, status: "held", detail: "the email is not switched on yet", to };
        else if (!to) out.owner = { who, status: "held", detail: "no owner email on file", to: null };
        else {
          const { assertCustomerDeliveryAllowed } = await import("./comms.server");
          let blocked: string | null = null;
          try { await assertCustomerDeliveryAllowed(jobId, "Owner job-cancelled email"); } catch (e) { blocked = (e as Error).message; }
          if (blocked) out.owner = { who, status: "held", detail: blocked, to };
          else {
            const r = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to, purpose: CANCEL_NOTICE_PURPOSE.owner, key, build: () => render(false) });
            out.owner = { who, status: r === "sent" || r.startsWith("delivery uncertain") ? "sent" : "held", detail: r, to };
          }
        }
      }
    } catch (e) { out.owner = { who, status: "held", detail: `could not send: ${(e as Error).message}`, to: owner?.email ?? null }; }
    await record(jobId, actorId, out.owner, i.cancelSeq, key).catch(() => undefined);
  }

  if (tell.installer) {
    const who = "installer" as const, key = cancelNoticeKey(jobId, i.cancelSeq, who);
    const inst = i.installer;
    try {
      if (await alreadySent(jobId, i.cancelSeq, who)) out.installer = { who, status: "already", detail: "already sent for this cancellation", to: null };
      else if (!inst) out.installer = { who, status: "held", detail: "no installer on this job", to: null };
      else {
        const to = inst.email?.trim() || null;
        const test = testJob || inst.isTestPartner;
        const m = renderInstallerCancelledEmail({ jobNumber: job.job_number, place: cancelNoticePlace({ addressLine: prop?.address_line ?? null, suburb: prop?.suburb ?? null }), officePhone: phone, test });
        if (test) {
          const { sendTestEmail } = await import("./test-send.server");
          const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: inst.isTestPartner, label: `${CANCEL_NOTICE_PURPOSE.installer}:${key}`, actorId }, to ?? "", m.subject, m.html, m.text);
          out.installer = { who, status: r.status === "sent" ? "sent" : "held", detail: `test-send ${r.status}: ${r.detail}`, to: r.to || to };
        } else if (!CANCEL_NOTICE_EMAILS_APPROVED) out.installer = { who, status: "held", detail: "the email is not switched on yet", to };
        else if (!to) out.installer = { who, status: "held", detail: "no installer email on file", to: null };
        else {
          const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId, recipient: "partner", to, contactName: inst.contactName, subject: m.subject, message: m.text, label: CANCEL_NOTICE_PURPOSE.installer, record: { businessId: inst.businessId }, html: m.html, text: m.text });
          if (r.status === "failed") await recordFailedInstallerSend(jobId, key, r.detail).catch(() => undefined);
          out.installer = { who, status: r.status === "sent" ? "sent" : "held", detail: r.detail, to };
        }
      }
    } catch (e) { out.installer = { who, status: "held", detail: `could not send: ${(e as Error).message}`, to: inst?.email ?? null }; }
    await record(jobId, actorId, out.installer, i.cancelSeq, key).catch(() => undefined);
  }
  return out;
}
