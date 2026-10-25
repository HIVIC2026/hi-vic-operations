// Decision 288 (Jo 25 Oct 2026): A1 Ready Check marked Complete + no price yet → text the business owner ONE link to the
// "Your price" card. Same shape as the decision-193 installer texts (`installer-texts.server.ts`): the `boss_price_link_sent`
// workflow event is recorded BEFORE anything is sent (once per job); TEST jobs / TEST partners → test-send only; real
// partners → the ONE real sender (`sendRealSms`, type `boss_price_link`: customer_comms_enabled + the type's own switch,
// quiet hours, STOP, approved-partner consent; no fallback connection, no retry; a held attempt never claims the key).
// Called from `finishMittiReadyCheck` (mitti-complete.server) on the sync that sees Complete and on the 15-minute sweep.
// Never throws to its caller; never changes a stage, a quote or the form.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { BOSS_PRICE_LINK_EVENT, bossPriceLink, bossPriceLinkBlocker, bossPriceLinkKey, bossPriceLinkText } from "./boss-price-link.core";

type JobRow = { id: string; job_number: string; source: string | null; channel: string | null; deleted_at: string | null; originating_installer_business_id: string | null; properties: { address_line: string | null; suburb: string | null } | null };
type BizRow = { id: string; name: string | null; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null };

export async function textBossPriceLink(jobId: string, i: { auditId: string; completedAt: string | null; entries?: { label: string; value: unknown }[] | undefined }): Promise<string> {
  try {
    const { data: job } = await admin.from("jobs").select("id, job_number, source, channel, deleted_at, originating_installer_business_id, properties(address_line, suburb)").eq("id", jobId).maybeSingle();
    const j = job as unknown as JobRow | null;
    if (!j) return "skipped: job not found";
    const [{ count: sent }, stored] = await Promise.all([
      admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", BOSS_PRICE_LINK_EVENT),
      (await import("./installer-price.server")).readInstallerPrice(jobId).catch(() => null),
    ]);
    const { installerPriceState } = await import("./installer-price.core");
    const price = installerPriceState({ channel: j.channel, record: stored?.record ?? null, entries: i.entries ?? [] });
    const blocker = bossPriceLinkBlocker({ channel: j.channel, deleted: !!j.deleted_at, formCompleted: true, pricePresent: price.present && price.required, alreadySent: !!sent });
    if (blocker) return `skipped: ${blocker}`;
    if (!j.originating_installer_business_id) return "skipped: no installer business on the job";
    const { data: biz } = await admin.from("businesses").select("id, name, signer_mobile, phone, onboarding_notes").eq("id", j.originating_installer_business_id).maybeSingle();
    const b = (biz ?? null) as BizRow | null;
    // The business owner's mobile: the signing owner's mobile, else the business phone (the same rule as every other
    // business-owner text, e.g. install tomorrow / Ready Check booked).
    const to = b?.signer_mobile ?? b?.phone ?? null;
    const key = bossPriceLinkKey(jobId);
    const completedAt = i.completedAt ?? new Date().toISOString();
    // Claimed once, before any send: a second sync or the sweep finds this event and stops.
    await logEvent(jobId, null, BOSS_PRICE_LINK_EVENT, `Business owner texted the link to enter the price (decision 288) — text prepared${to ? "" : " (no business mobile on file)"}`, { key, audit_id: i.auditId, completed_at: completedAt, business_id: b?.id ?? j.originating_installer_business_id, to }, { internal: true });
    if (!to) return "not sent: no business mobile";
    const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
    const { installerTextAddress } = await import("./installer-texts.core");
    const { isTestPartner } = await import("./test-send.core");
    const test = j.source === "qa_test" || isTestPartner(b ?? {});
    const { TEST_APP_BASE, sendTestSms } = await import("./test-send.server");
    const body = bossPriceLinkText({ jobNumber: j.job_number, street: installerTextAddress(j.properties?.address_line, j.properties?.suburb), link: bossPriceLink(test ? TEST_APP_BASE : SET_PASSWORD_BASE, jobId) });
    if (test) {
      const r = await sendTestSms({ jobId, jobSource: j.source, partnerIsTest: isTestPartner(b ?? {}), label: `boss_price_link:${jobId}`, actorId: null }, to, body);
      return `boss sms (test) ${r.status}: ${r.detail}`;
    }
    const { sendRealSms } = await import("./sms.server");
    const r = await sendRealSms({ type: "boss_price_link", idempotencyKey: key, to, body, jobId, businessId: j.originating_installer_business_id, event: { at: completedAt, current: true } });
    return `boss sms ${r.status}: ${r.detail}`;
  } catch (e) { return `boss sms not sent — ${(e as Error).message}`; }
}
