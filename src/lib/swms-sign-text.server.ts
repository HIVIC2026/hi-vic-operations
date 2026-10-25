// Decision 377 (Jo 25 Oct 2026): each crew member is texted their OWN safety plan (SWMS) sign link (/sp/<token>,
// decision 364) on the mobile the business owner saved for them on My business. Pure rules: swms-sign-text.core.ts.
// Same shape as installer-texts.server: ONE `swms_sign_link_texted` workflow event per key is recorded BEFORE anything is
// sent; TEST job / TEST partner → test-send only; real → the ONE real SMS sender (`sendRealSms`: explicitly selected
// connection, no fallback, no retry; switch + wording approval + quiet hours + STOP + partner consent live there).
// A real text is not even prepared while the wording is unapproved or in quiet hours, so nothing comes out stale later.
// Never changes a booking, the plan, a signature or a stage. Run from the 15-minute tick via `sweepInstallerTexts`.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { SWMS_SIGN_LINK_EVENT, SWMS_SIGN_LINK_SMS_TYPE, swmsSignLinkText, swmsSignTextsDue, swmsTextedSignerKeys, workerIdOfSignerKey } from "./swms-sign-text.core";

/** Stored mobiles of the installing business's live workers among these signer keys (partner_workers.id → mobile). */
async function crewMobiles(businessId: string, signerKeys: readonly string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(signerKeys.map(workerIdOfSignerKey).filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const { data } = await admin.from("partner_workers").select("id, mobile").eq("business_id", businessId).is("removed_at", null).in("id", ids);
  return new Map((data ?? []).map((w) => [w.id, w.mobile ?? null]));
}

async function recordedEvents(jobId: string): Promise<{ key?: unknown; signer_key?: unknown; route?: unknown }[]> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", SWMS_SIGN_LINK_EVENT);
  return (data ?? []).map((r) => (r.details ?? {}) as { key?: unknown; signer_key?: unknown; route?: unknown });
}

/** Signer keys whose own link actually went (decision 377 (c): the lead's text then lists them by name only). */
export async function swmsOwnLinkTextedKeys(jobId: string): Promise<Set<string>> {
  try {
    const events = await recordedEvents(jobId);
    if (!events.length) return new Set();
    const { data } = await admin.from("sms_messages").select("idempotency_key, status").eq("job_id", jobId).eq("message_type", SWMS_SIGN_LINK_SMS_TYPE);
    return swmsTextedSignerKeys(events, (data ?? []) as { idempotency_key: string; status: string }[]);
  } catch { return new Set(); }
}

/** Text each unsigned crew member with their own mobile their own sign link, if a step is due. Never throws on send problems. */
export async function textSwmsSignLinks(jobId: string, booking: { id: string; scheduled_start: string }, now = new Date()): Promise<string[]> {
  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("id, job_number, source, deleted_at, installation_completed_at, properties(address_line, suburb)").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]);
  if (!job || job.deleted_at || job.installation_completed_at || !asg?.business_id) return [];
  const { data: biz } = await admin.from("businesses").select("id, onboarding_notes").eq("id", asg.business_id).maybeSingle();
  const { isTestPartner } = await import("./test-send.core");
  const partnerIsTest = isTestPartner(biz ?? {});
  const test = job.source === "qa_test" || partnerIsTest;
  if (!test) {
    // Real crew: not prepared at all until Jo approves the wording, nor in quiet hours (the next tick after 7am sends).
    const { SMS_MESSAGE_TYPES } = await import("./sms.core");
    if (!SMS_MESSAGE_TYPES[SWMS_SIGN_LINK_SMS_TYPE].wordingApproved) return ["held: wording not approved"];
    const { smsQuietReason } = await import("./quote-hold.core");
    const q = smsQuietReason(now.toISOString());
    if (q) return [`held: ${q}`];
  }
  const { loadSwms } = await import("./swms.server");
  const { swmsUnsignedSigners } = await import("./swms.core");
  const { plan, signatures, status } = await loadSwms(jobId);
  if (status.complete) return [];
  const unsigned = swmsUnsignedSigners(plan, signatures);
  if (!unsigned.length) return [];
  const [mobiles, events] = await Promise.all([crewMobiles(asg.business_id, unsigned.map((s) => s.key)), recordedEvents(jobId)]);
  const recorded = new Set(events.map((e) => (typeof e.key === "string" ? e.key : "")).filter(Boolean));
  const due = swmsSignTextsDue({ jobId, startIso: booking.scheduled_start, now, unsigned, mobiles, recorded });
  if (!due.length) return [];
  const { installerTextAddress } = await import("./installer-texts.core");
  const { swmsSignLink } = await import("./swms-link.server");
  const props = job.properties as { address_line: string | null; suburb: string | null } | null;
  const address = installerTextAddress(props?.address_line, props?.suburb);
  const out: string[] = [];
  for (const d of due) {
    try {
      const body = swmsSignLinkText({ address, startIso: booking.scheduled_start, link: await swmsSignLink(jobId, d.signerKey, now.getTime()) });
      await logEvent(jobId, null, SWMS_SIGN_LINK_EVENT, `Safety plan: ${d.name} texted their own sign link (${d.step === "reminder" ? "day before" : "install booked"}, decision 377) — text prepared`,
        { key: d.key, signer_key: d.signerKey, name: d.name, step: d.step, booking_id: booking.id, starts_at: booking.scheduled_start, business_id: asg.business_id, route: test ? "test" : "real" }, { internal: true });
      if (test) {
        const { sendTestSms } = await import("./test-send.server");
        const r = await sendTestSms({ jobId, jobSource: job.source, partnerIsTest, label: `swms_sign_link:${d.key}`, actorId: null }, d.to, body);
        out.push(`${d.name}: test ${r.status}`);
      } else {
        const { sendRealSms } = await import("./sms.server");
        const r = await sendRealSms({ type: SWMS_SIGN_LINK_SMS_TYPE, idempotencyKey: d.key, to: d.to, body, jobId, businessId: asg.business_id });
        out.push(`${d.name}: ${r.status}`);
      }
    } catch (e) { out.push(`${d.name}: not sent — ${(e as Error).message}`); }
  }
  return out;
}

/** 15-minute tick (called from sweepInstallerTexts): confirmed installs starting within the next 14 days. Bounded. */
export const SWMS_SIGN_SWEEP_DAYS = 14;
export async function sweepSwmsSignLinks(now = new Date()): Promise<number> {
  const { data } = await admin.from("bookings").select("id, job_id, scheduled_start").eq("kind", "installation").eq("status", "confirmed")
    .gt("scheduled_start", now.toISOString()).lt("scheduled_start", new Date(now.getTime() + SWMS_SIGN_SWEEP_DAYS * 86_400_000).toISOString())
    .order("scheduled_start").limit(100);
  let n = 0;
  const seen = new Set<string>();
  for (const b of data ?? []) {
    if (!b.job_id || seen.has(b.job_id)) continue;
    seen.add(b.job_id);
    try { if ((await textSwmsSignLinks(b.job_id, b, now)).some((r) => !r.startsWith("held:"))) n++; } catch (e) { console.error("safety plan sign link texts failed", b.job_id, (e as Error).message); }
  }
  return n;
}
