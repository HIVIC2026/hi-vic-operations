// Decision 376 (approved by Jo, decision 384): the 24-hour coordination reminder to the ELECTRICIAN who accepted a safety check job and has not
// offered the owner times (email E14 + text). Called only from allocation.server `sweepCoordination`, right after it has
// recorded the `coordination_reminder` workflow event (the once-per-assignment claim, written before any send). TEST jobs /
// TEST partners → test-send; real electricians → sendOfficeEmail (partner) + the one real SMS sender (customer_comms_enabled
// + the `piesa_times_reminder` text switch still gate delivery). Best-effort: never throws to the sweep, never changes a stage or a booking.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { inHouseDispatchSkip, type InHouseDispatchState } from "./in-house-suppression.server";
import {
  PIESA_TIMES_REMINDER_APPROVED, PIESA_TIMES_REMINDER_SMS_TYPE, coordinationReminderSends, piesaTimesReminderKeys, piesaTimesReminderText, renderPiesaTimesReminderEmail,
} from "./piesa-times-reminder.core";

type Asg = { id: string; active: boolean; booking_confirmed_at: string | null; business_id: string | null; profiles: { full_name: string | null; email: string | null; phone: string | null } | null; businesses: { name: string | null; email: string | null; phone: string | null; signer_mobile: string | null; onboarding_notes: string | null } | null };

export async function remindTradeToOfferTimes(i: { jobId: string; assignmentId: string; visitKind: string; remindedAt: string }, inHouseState?: InHouseDispatchState): Promise<string> {
  try {
    if (!coordinationReminderSends(i.visitKind)) return "record only";
    const skipped = await inHouseDispatchSkip(i.jobId, inHouseState);
    if (skipped) return skipped;
    const [{ data: job }, { data: asgRaw }] = await Promise.all([
      admin.from("jobs").select("job_number, source, stage, deleted_at, properties(address_line, suburb)").eq("id", i.jobId).maybeSingle(),
      admin.from("job_assignments").select("id, active, booking_confirmed_at, business_id, profiles:user_id(full_name, email, phone), businesses(name, email, phone, signer_mobile, onboarding_notes)").eq("id", i.assignmentId).maybeSingle(),
    ]);
    const asg = asgRaw as unknown as Asg | null;
    if (!job || job.deleted_at || !asg?.active || asg.booking_confirmed_at) return "skipped";
    if (job.stage !== "piesa_and_install_window_pending") return "skipped — not the electrician's move";
    const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
    const { installerTextAddress } = await import("./installer-texts.core");
    const { isTestPartner } = await import("./test-send.core");
    const { firstName } = await import("./worker-links.core");
    const partnerIsTest = isTestPartner(asg.businesses ?? {});
    const test = job.source === "qa_test" || partnerIsTest;
    const { TEST_APP_BASE } = await import("./test-send.server");
    const p = (job.properties ?? null) as { address_line: string | null; suburb: string | null } | null;
    const facts = { jobNumber: job.job_number ?? "Your job", address: installerTextAddress(p?.address_line, p?.suburb), link: `${test ? TEST_APP_BASE : SET_PASSWORD_BASE}/field/${i.jobId}` };
    const mail = renderPiesaTimesReminderEmail({ ...facts, firstName: firstName(asg.profiles?.full_name ?? null), test });
    const body = piesaTimesReminderText(facts);
    const emailTo = asg.profiles?.email ?? asg.businesses?.email ?? null;
    const phone = asg.profiles?.phone ?? asg.businesses?.signer_mobile ?? asg.businesses?.phone ?? null;
    const keys = piesaTimesReminderKeys(i.assignmentId);
    const out: string[] = [];
    if (test) {
      const { sendTestEmail, sendTestSms } = await import("./test-send.server");
      const ctx = { jobId: i.jobId, jobSource: job.source, partnerIsTest, label: `piesa_times_reminder:${i.assignmentId}`, actorId: null };
      const e = await sendTestEmail(ctx, emailTo ?? "", mail.subject, mail.html, mail.text);
      const s = await sendTestSms(ctx, phone ?? "", body);
      return [`electrician email ${e.status}: ${e.detail}`, `electrician sms ${s.status}: ${s.detail}`].join("; ");
    }
    if (!PIESA_TIMES_REMINDER_APPROVED) out.push("electrician email not sent — wording awaiting approval");
    else if (!emailTo) out.push("electrician email not sent — no electrician email");
    else {
      try {
        // sendOfficeEmail pauses partner email with customer_comms_enabled (Jo 24 Oct).
        const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null as unknown as string, recipient: "partner", to: emailTo, contactName: asg.profiles?.full_name ?? null, subject: mail.subject, message: mail.text, label: "piesa_times_reminder", record: { businessId: asg.business_id }, html: mail.html, text: mail.text });
        out.push(`electrician email ${r.status}: ${r.detail}`);
      } catch (e) { out.push(`electrician email not sent — ${(e as Error).message}`); }
    }
    const { count: proposals } = await admin.from("appointment_proposals").select("id", { count: "exact", head: true }).eq("job_id", i.jobId).eq("kind", "assessment");
    const s = await (await import("./sms.server")).sendRealSms({ type: PIESA_TIMES_REMINDER_SMS_TYPE, idempotencyKey: keys.sms, to: phone, body, jobId: i.jobId, businessId: asg.business_id, event: { at: i.remindedAt, current: !proposals } });
    out.push(`electrician sms ${s.status}: ${s.detail}`);
    return out.join("; ");
  } catch (e) {
    console.error("PIESA times reminder skipped", i.jobId, (e as Error).message);
    return `not sent — ${(e as Error).message}`;
  }
}
