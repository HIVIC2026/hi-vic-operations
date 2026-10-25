// Decision 315 (Jo 25 Oct 2026): the A4 PIESA sync saw the PIESA completed, repair work is needed (not fixed on the same
// visit, not the decision-314 on-site-only answer) and no electrician fixes windows exist → text the assigned electrician
// ONE link to their job page to pick 3–5 fixes times + estimated hours. Same shape as the decision-288 boss price link:
// the `fixes_times_link_sent` workflow event is recorded BEFORE anything is sent (once per job + PIESA form); TEST jobs /
// TEST partners → test-send only; real partners → the ONE real sender (`sendRealSms`, type `fixes_times_link`:
// customer_comms_enabled + the type's own switch, quiet hours, STOP, approved-partner consent; no fallback connection, no
// retry; a held attempt never claims the key). Called from `syncMittiAssessment` (mitti.server) only. Never throws to its
// caller; never changes a stage, a quote or the form. Not on the autoAdvance graph.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { FIXES_TIMES_LINK_EVENT, FIXES_TIMES_SMS_TYPE, fixesTimesLink, fixesTimesLinkBlocker, fixesTimesLinkKey, fixesTimesLinkText, fixesTimesNeeded } from "./fixes-times.core";

type JobRow = { id: string; source: string | null; deleted_at: string | null; properties: { address_line: string | null; suburb: string | null } | null };
type AsgRow = { business_id: string | null; profiles: { full_name: string | null; phone: string | null } | null; businesses: { id: string; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null } | null };

export async function textFixesTimesLink(jobId: string, i: { auditId: string; completedAt: string | null; short: Record<string, string | null | undefined> }): Promise<string> {
  try {
    const { data: job } = await admin.from("jobs").select("id, source, deleted_at, properties(address_line, suburb)").eq("id", jobId).maybeSingle();
    const j = job as unknown as JobRow | null;
    if (!j) return "skipped: job not found";
    const key = fixesTimesLinkKey(jobId, i.auditId);
    const [{ count: sent }, windowsExist, { data: asgRaw }] = await Promise.all([
      admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", FIXES_TIMES_LINK_EVENT).contains("details", { key }),
      (await import("./rectification.server")).rectificationWindowsExist(jobId),
      admin.from("job_assignments").select("business_id, profiles:user_id(full_name, phone), businesses(id, signer_mobile, phone, onboarding_notes)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).limit(1).maybeSingle(),
    ]);
    const asg = asgRaw as unknown as AsgRow | null;
    const blocker = fixesTimesLinkBlocker({ deleted: !!j.deleted_at, piesaCompleted: true, timesNeeded: fixesTimesNeeded(i.short), windowsExist, alreadySent: !!sent, electricianAssigned: !!asg?.business_id });
    if (blocker) return `skipped: ${blocker}`;
    // The assigned electrician's own mobile, else their business's (the same rule as the other trade texts).
    const to = asg?.profiles?.phone ?? asg?.businesses?.signer_mobile ?? asg?.businesses?.phone ?? null;
    const completedAt = i.completedAt ?? new Date().toISOString();
    // Claimed once, before any send: a later sync, the tick or a re-sync finds this event and stops.
    await logEvent(jobId, null, FIXES_TIMES_LINK_EVENT, `Electrician texted the link to pick 3 to 5 electrical fixes times (decision 315) — text prepared${to ? "" : " (no electrician mobile on file)"}`, { key, audit_id: i.auditId, completed_at: completedAt, business_id: asg!.business_id, to }, { internal: true });
    if (!to) return "not sent: no electrician mobile";
    const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
    const { installerTextAddress } = await import("./installer-texts.core");
    const { isTestPartner } = await import("./test-send.core");
    const partnerIsTest = isTestPartner(asg?.businesses ?? {});
    const test = j.source === "qa_test" || partnerIsTest;
    const { TEST_APP_BASE, sendTestSms } = await import("./test-send.server");
    const body = fixesTimesLinkText({ address: installerTextAddress(j.properties?.address_line, j.properties?.suburb), link: fixesTimesLink(test ? TEST_APP_BASE : SET_PASSWORD_BASE, jobId) });
    if (test) {
      const r = await sendTestSms({ jobId, jobSource: j.source, partnerIsTest, label: `fixes_times_link:${jobId}`, actorId: null }, to, body);
      return `fixes times sms (test) ${r.status}: ${r.detail}`;
    }
    const { sendRealSms } = await import("./sms.server");
    const r = await sendRealSms({ type: FIXES_TIMES_SMS_TYPE, idempotencyKey: key, to, body, jobId, businessId: asg!.business_id, event: { at: completedAt, current: !windowsExist } });
    return `fixes times sms ${r.status}: ${r.detail}`;
  } catch (e) { return `fixes times sms not sent — ${(e as Error).message}`; }
}
