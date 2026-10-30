import { inHouseDispatchSkip } from "./in-house-suppression.server";
// Decision 376 (approved by Jo, decision 384): the installer planning notice after a CONFIRMED safety check booking (email I71 + text). Called only
// from booking.server `confirmBooking` (kind assessment), after the `installer_planning_notice` job-history point. Recorded
// ONCE per installer assignment + PIESA start as `installer_planning_notified` BEFORE anything is sent. TEST jobs / TEST
// partners → test-send; real installers → sendOfficeEmail (partner; paused with customer_comms_enabled) + the one real SMS
// sender (the `installer_planning_notice` text switch still gates the text). Best-effort: never throws to the booking, never changes a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  INSTALLER_PLANNING_NOTICE_APPROVED, INSTALLER_PLANNING_NOTICE_SMS_TYPE, INSTALLER_PLANNING_NOTIFIED_EVENT, installerPlanningKeys, installerPlanningText, renderInstallerPlanningEmail,
} from "./installer-planning-notice.core";

type Asg = { id: string; active: boolean; business_id: string | null; profiles: { full_name: string | null; email: string | null; phone: string | null } | null; businesses: { name: string | null; email: string | null; phone: string | null; signer_mobile: string | null; onboarding_notes: string | null } | null };

export async function notifyInstallerPlanning(i: { jobId: string; assignmentId: string; piesaStartIso: string }): Promise<string> {
  const skipped = await inHouseDispatchSkip(i.jobId);
  if (skipped) return skipped;
  try {
    const keys = installerPlanningKeys(i.assignmentId, i.piesaStartIso);
    const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", i.jobId).eq("event_type", INSTALLER_PLANNING_NOTIFIED_EVENT).contains("details", { key: keys.base }).limit(1).maybeSingle();
    if (prior) return "already handled";
    const [{ data: job }, { data: asgRaw }] = await Promise.all([
      admin.from("jobs").select("job_number, source, deleted_at, owners(full_name), properties(address_line, suburb)").eq("id", i.jobId).maybeSingle(),
      admin.from("job_assignments").select("id, active, business_id, profiles:user_id(full_name, email, phone), businesses(name, email, phone, signer_mobile, onboarding_notes)").eq("id", i.assignmentId).maybeSingle(),
    ]);
    const asg = asgRaw as unknown as Asg | null;
    if (!job || job.deleted_at || !asg?.active) return "skipped";
    // Jo 30 Oct 2026: "Pause all trade messages" — held before the once-only event (TEST unchanged).
    if (job.source !== "qa_test" && !(await import("./test-send.core")).isTestPartner((asg.businesses ?? {}) as never)) {
      const tradePaused = await (await import("./trade-pause.server")).tradeMessagesPausedNow();
      if (tradePaused) return `held: ${tradePaused}`;
    }
    const notifiedAt = new Date().toISOString();
    await logEvent(i.jobId, null, INSTALLER_PLANNING_NOTIFIED_EVENT, "Installer told the safety check date for planning (email I71 + text prepared) — not an install booking", { assignment_id: i.assignmentId, piesa_start: i.piesaStartIso, key: keys.base }, { internal: true });
    const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
    const { installerTextAddress } = await import("./installer-texts.core");
    const { isTestPartner } = await import("./test-send.core");
    const { firstName } = await import("./worker-links.core");
    const partnerIsTest = isTestPartner(asg.businesses ?? {});
    const test = job.source === "qa_test" || partnerIsTest;
    const { TEST_APP_BASE } = await import("./test-send.server");
    const p = (job.properties ?? null) as { address_line: string | null; suburb: string | null } | null;
    const owner = (job.owners ?? null) as { full_name: string | null } | null;
    const facts = { jobNumber: job.job_number ?? "Your job", address: installerTextAddress(p?.address_line, p?.suburb), piesaStartIso: i.piesaStartIso, link: `${test ? TEST_APP_BASE : SET_PASSWORD_BASE}/field/${i.jobId}` };
    const mail = renderInstallerPlanningEmail({ ...facts, ownerFirstName: firstName(owner?.full_name ?? null), test });
    const body = installerPlanningText(facts);
    const emailTo = asg.profiles?.email ?? asg.businesses?.email ?? null;
    const phone = asg.profiles?.phone ?? asg.businesses?.signer_mobile ?? asg.businesses?.phone ?? null;
    if (test) {
      const { sendTestEmail, sendTestSms } = await import("./test-send.server");
      const ctx = { jobId: i.jobId, jobSource: job.source, partnerIsTest, label: `installer_planning_notice:${keys.base}`, actorId: null };
      const e = await sendTestEmail(ctx, emailTo ?? "", mail.subject, mail.html, mail.text);
      const s = await sendTestSms(ctx, phone ?? "", body);
      return [`installer email ${e.status}: ${e.detail}`, `installer sms ${s.status}: ${s.detail}`].join("; ");
    }
    const out: string[] = [];
    if (!INSTALLER_PLANNING_NOTICE_APPROVED) out.push("installer email not sent — wording awaiting approval");
    else if (!emailTo) out.push("installer email not sent — no installer email");
    else {
      try {
        const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null as unknown as string, recipient: "partner", to: emailTo, contactName: asg.profiles?.full_name ?? null, subject: mail.subject, message: mail.text, label: "installer_planning_notice", record: { businessId: asg.business_id }, html: mail.html, text: mail.text });
        out.push(`installer email ${r.status}: ${r.detail}`);
      } catch (e) { out.push(`installer email not sent — ${(e as Error).message}`); }
    }
    const { data: still } = await admin.from("bookings").select("scheduled_start").eq("job_id", i.jobId).eq("kind", "assessment").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const current = !!still?.scheduled_start && Date.parse(still.scheduled_start) === Date.parse(i.piesaStartIso);
    const s = await (await import("./sms.server")).sendRealSms({ type: INSTALLER_PLANNING_NOTICE_SMS_TYPE, idempotencyKey: keys.sms, to: phone, body, jobId: i.jobId, businessId: asg.business_id, event: { at: notifiedAt, current } });
    out.push(`installer sms ${s.status}: ${s.detail}`);
    return out.join("; ");
  } catch (e) {
    console.error("installer planning notice skipped", i.jobId, (e as Error).message);
    return `not sent — ${(e as Error).message}`;
  }
}
