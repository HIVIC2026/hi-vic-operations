// Task 9 (Jo 28 Oct 2026, spec rule 3): the A3 PIESA sync saw the safety check completed with repair work and no price →
// text the electrician BUSINESS OWNER (the business on the job, never the staff member who did the check) ONE link to the
// "Your price" card on the job page. Same shape as the decision-288 boss price link and the decision-315 fixes times link:
// the `repair_price_link_sent` workflow event is recorded BEFORE anything is sent (once per job + A3 form); TEST jobs /
// TEST partners → test-send only; real partners → the ONE real sender (`sendRealSms`, type `repair_price_link`:
// customer_comms_enabled + the type's own switch (absent = OFF), quiet hours, STOP, approved-partner consent; no fallback
// connection, no retry; a held attempt never claims the key). Called from `syncMittiAssessment` (mitti.server) only.
// Never throws to its caller; never changes a stage, a quote or the form. Not on the autoAdvance graph.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { REPAIR_PRICE_LINK_EVENT, REPAIR_PRICE_SMS_TYPE, repairPriceLink, repairPriceLinkBlocker, repairPriceLinkKey, repairPriceLinkText, repairPriceNeeded } from "./electrician-repair-price.core";

type JobRow = { id: string; source: string | null; deleted_at: string | null; properties: { address_line: string | null; suburb: string | null } | null };
type BizRow = { id: string; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null };

export async function textRepairPriceLink(jobId: string, i: { auditId: string; completedAt: string | null; short: Record<string, string | null | undefined> }): Promise<string> {
  try {
    const { data: job } = await admin.from("jobs").select("id, source, deleted_at, properties(address_line, suburb)").eq("id", jobId).maybeSingle();
    const j = job as unknown as JobRow | null;
    if (!j) return "skipped: job not found";
    const key = repairPriceLinkKey(jobId, i.auditId);
    const [{ count: sent }, stored, { data: asg }] = await Promise.all([
      admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", REPAIR_PRICE_LINK_EVENT).contains("details", { key }),
      (await import("./electrician-repair-price.server")).readRepairPrice(jobId, i.auditId),
      admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).limit(1).maybeSingle(),
    ]);
    const { parseFixesPrice } = await import("./fixes-price.core");
    const pricePresent = !!stored || parseFixesPrice(i.short["fixesPriceIncGst"]) != null;
    const blocker = repairPriceLinkBlocker({ deleted: !!j.deleted_at, piesaCompleted: true, priceNeeded: repairPriceNeeded(i.short), pricePresent, alreadySent: !!sent, electricianAssigned: !!asg?.business_id });
    if (blocker) return `skipped: ${blocker}`;
    const businessId = asg!.business_id as string;
    const { data: biz } = await admin.from("businesses").select("id, signer_mobile, phone, onboarding_notes").eq("id", businessId).maybeSingle();
    const b = (biz ?? null) as BizRow | null;
    // The business owner's mobile: the signing owner's mobile, else the business phone (the same rule as the installer
    // boss price link). Never the staff member's own phone: staff never see a price.
    const to = b?.signer_mobile ?? b?.phone ?? null;
    const completedAt = i.completedAt ?? new Date().toISOString();
    // Claimed once, before any send: a later sync, the tick or a re-sync finds this event and stops.
    await logEvent(jobId, null, REPAIR_PRICE_LINK_EVENT, `Electrician business owner texted the link to enter the repair price — text prepared${to ? "" : " (no business mobile on file)"}`, { key, audit_id: i.auditId, completed_at: completedAt, business_id: businessId, to }, { internal: true });
    if (!to) return "not sent: no business mobile";
    const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
    const { installerTextAddress } = await import("./installer-texts.core");
    const { isTestPartner } = await import("./test-send.core");
    const partnerIsTest = isTestPartner(b ?? {});
    const test = j.source === "qa_test" || partnerIsTest;
    const { TEST_APP_BASE, sendTestSms } = await import("./test-send.server");
    const body = repairPriceLinkText({ address: installerTextAddress(j.properties?.address_line, j.properties?.suburb), link: repairPriceLink(test ? TEST_APP_BASE : SET_PASSWORD_BASE, jobId) });
    if (test) {
      const r = await sendTestSms({ jobId, jobSource: j.source, partnerIsTest, label: `repair_price_link:${jobId}`, actorId: null }, to, body);
      return `repair price sms (test) ${r.status}: ${r.detail}`;
    }
    const { sendRealSms } = await import("./sms.server");
    const r = await sendRealSms({ type: REPAIR_PRICE_SMS_TYPE, idempotencyKey: key, to, body, jobId, businessId, event: { at: completedAt, current: true } });
    return `repair price sms ${r.status}: ${r.detail}`;
  } catch (e) { return `repair price sms not sent — ${(e as Error).message}`; }
}
