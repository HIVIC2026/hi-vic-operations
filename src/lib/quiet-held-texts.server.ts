import { inHouseDispatchSkip } from "./in-house-suppression.server";
// Batch 2, item 1 (Jo 29 Oct 2026): texts held by the 8pm–7am quiet hours go at 7am — skipped if no longer true.
// The 15-minute tick (allocation-tick, next to sweepJobOfferTexts) reads last-24h quiet-hours holds whose real key is
// unclaimed (`quietResendDue`), re-checks each type's own "still true" fact (`STILL_TRUE`, reusing the senders' existing
// predicates), and re-sends the stored body through the ONE real sender with the REAL key and `event.at` = the hold time,
// so every guard (switches, consent, STOP, freshness limit, deleted job) still applies and the key is claimed once.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { QUIET_RESEND_TYPES, QUIET_RESEND_WINDOW_HOURS, quietResendDue, type HeldRow, type QuietResendType, type StillTrue } from "./quiet-held-texts.core";

const db = admin as unknown as { from: (t: string) => any };
type JobState = NonNullable<HeldRow["job"]>;

async function jobState(jobId: string | null): Promise<(JobState & { channel: string | null }) | null> {
  if (!jobId) return null;
  const { data, error } = await db.from("jobs").select("source, stage, deleted_at, qa_archived_at, channel").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Job could not be read: ${error.message}`);
  return data ?? null;
}
const claimKey = async (row: HeldRow) => (await import("./sms.core")).claimKeyOf(row.idempotency_key);
/** What follows `prefix` in the real key (the booking / quote id the sender put there), or null. */
const after = (key: string, prefix: string) => (key.startsWith(prefix) ? key.slice(prefix.length) : null);

/** The job is live and not a TEST job. */
export const stillTrueJobLive: StillTrue = async (row) => {
  const j = await jobState(row.job_id);
  if (!j || j.source === "qa_test") return false;
  return !(await import("./mitti.core")).isClosedOrArchivedJob(j);
};

/** deposit_release / install_no_access: the job is live and no OTHER install day has been booked since (the booking in
 *  the key — released, or the one nobody could get into — does not count). Fails closed on a read error. */
const stillTrueNoNewInstall = (prefix: string): StillTrue => async (row) => {
  const bookingId = after(await claimKey(row), prefix)?.replace(/:sms$/, "");
  if (!bookingId || !(await stillTrueJobLive(row))) return false;
  const { data, error } = await db.from("bookings").select("id").eq("job_id", row.job_id).eq("kind", "installation").eq("status", "confirmed").neq("id", bookingId).limit(1);
  if (error) return false;
  return !(data ?? []).length;
};
export const stillTrueDepositRelease = stillTrueNoNewInstall("deposit-release:v1:");
export const stillTrueInstallNoAccess = stillTrueNoNewInstall("install-no-access:v1:");

/** spot_saved: the job-level rules of the confirmation itself (spot still saved, owner not opted out, job live). Consent
 *  and the comms switch are re-checked by sendRealSms. */
export const stillTrueSpotSaved: StillTrue = async (row) => {
  const j = await jobState(row.job_id);
  const { data: resp } = await db.from("lead_campaign_responses").select("spot_saved_at, opted_out_at").eq("job_id", row.job_id).maybeSingle();
  const { spotSavedJobBlocker } = await import("./spot-saved-send.core");
  return !!j && spotSavedJobBlocker({
    source: j.source, stage: j.stage, deletedAt: j.deleted_at, qaArchivedAt: j.qa_archived_at, spotSavedAt: resp?.spot_saved_at ?? null,
    campaignOptedOutAt: resp?.opted_out_at ?? null, consent: true, commsEnabled: true,
  } as Parameters<typeof spotSavedJobBlocker>[0]) === null;
};

/** quote_ready: the quote is still issued and released (quote-ready-notify.server). */
export const stillTrueQuoteReady: StillTrue = async (row) => {
  const rest = after(await claimKey(row), "quote-ready:v1:");
  const quoteId = rest?.split(":")[0];
  if (!rest || !quoteId || !row.job_id) return false;
  // Only the text for the CURRENT send goes: a held original after a reopen, or an older :rN after another reopen, is stale.
  const { currentQuoteReadyKeySuffix, quoteStillReleased } = await import("./quote-ready-notify.server");
  try { if (rest !== `${quoteId}${await currentQuoteReadyKeySuffix(row.job_id, quoteId)}`) return false; } catch { return false; }
  const { data: q } = await db.from("quotes").select("status, release_state").eq("id", quoteId).eq("job_id", row.job_id).maybeSingle();
  return quoteStillReleased(q);
};

/** piesa_owner_confirm: the PIESA texted about is still the latest and the owner has not confirmed it. */
export const stillTruePiesaOwnerConfirm: StillTrue = async (row) => {
  const f = await (await import("./piesa-owner-confirm.server")).ownerPiesaConfirmFacts(row.job_id!);
  return !!f && !f.confirmation && (await claimKey(row)).startsWith(`piesa-owner-confirm:v1:${row.job_id}:${f.piesaRecordId}:`);
};

/** piesa_owner_fixes_confirm: the fixes record texted about is still the latest and the owner has not confirmed it. */
export const stillTruePiesaFixesConfirm: StillTrue = async (row) => {
  const f = await (await import("./piesa-fixes-confirm.server")).ownerFixesConfirmFacts(row.job_id!);
  return !!f && !f.confirmation && (await claimKey(row)).startsWith(`piesa-owner-fixes-confirm:v1:${row.job_id}:${f.recordId}:`);
};

/** veec_sign_request / veec_sign_reminder: the owner has still not signed the final VEEC assignment (veec-reminders sweep). */
export const stillTrueVeecUnsigned: StillTrue = async (row) => {
  const { data: a, error } = await db.from("customer_assignments").select("consumer_signed_at").eq("job_id", row.job_id).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").maybeSingle();
  if (error) return false; // fail closed: never send when we can't tell
  return !a?.consumer_signed_at;
};

/** visit_new_times: the cancelled visit has not been rebooked (visit-new-times.server). */
export const stillTrueVisitNewTimes: StillTrue = async (row) => {
  const bookingId = after(await claimKey(row), `visit-new-times:v1:${row.job_id}:`)?.replace(/:sms$/, "");
  if (!bookingId) return false;
  const { VISIT_NEW_TIMES_EVENT } = await import("./visit-new-times.core");
  const { data: ev } = await db.from("workflow_events").select("details").eq("job_id", row.job_id).eq("event_type", VISIT_NEW_TIMES_EVENT).contains("details", { booking_id: bookingId }).limit(1).maybeSingle();
  const kind = (ev?.details as { kind?: string } | null)?.kind;
  if (!kind) return false;
  return !(await (await import("./visit-events.server")).currentBooking(row.job_id!, kind as import("./visit-events.core").VisitKind));
};

/** install_clearance: still cleared for the same timing date and nothing booked (install-clearance.server). */
export const stillTrueInstallClearance: StillTrue = async (row) => {
  const c = await (await import("./install-days.server")).installDayContext(row.job_id!);
  if (!c.clearance.cleared || !c.clearance.timingDate || c.booked) return false;
  return (await claimKey(row)).startsWith(`install-clearance:v1:${row.job_id}:${c.clearance.timingDate.slice(0, 10)}:`);
};

/** boss_price_link: still an installer-supplied job with no price entered (boss-price-link.core blocker). */
export const stillTrueBossPriceLink: StillTrue = async (row) => {
  const j = await jobState(row.job_id);
  if (!j) return false;
  const ip = await import("./installer-price.server");
  const stored = await ip.readInstallerPrice(row.job_id!);
  // The sender passes the completed Ready Check form's entries; the stored copy is the current measurement's raw_snapshot.
  const { data: m, error } = await db.from("ceiling_measurements").select("raw_snapshot").eq("job_id", row.job_id).eq("is_current", true).maybeSingle();
  if (error) return false;
  const entries = Array.isArray(m?.raw_snapshot) ? (m.raw_snapshot as { label: string; value: unknown }[]) : [];
  const { installerPriceState } = await import("./installer-price.core");
  const price = installerPriceState({ channel: j.channel, record: stored?.record ?? null, entries: await ip.entriesWithInstallerPrice(row.job_id!, entries) });
  const { bossPriceLinkBlocker } = await import("./boss-price-link.core");
  return bossPriceLinkBlocker({ channel: j.channel, deleted: !!j.deleted_at, formCompleted: true, pricePresent: price.present && price.required, alreadySent: false }) === null;
};

/** fixes_times_link: the PIESA audit in the key is still the job's current one and no fixes times given yet (fixes-times-link.server). */
export const stillTrueFixesTimesLink: StillTrue = async (row) => {
  const auditId = after(await claimKey(row), `fixes-times-link:v1:${row.job_id}:`);
  const { fixesTimesFacts, rectificationWindowsExist } = await import("./rectification.server");
  if (!auditId || (await fixesTimesFacts(row.job_id!)).auditId !== auditId) return false;
  return !(await rectificationWindowsExist(row.job_id!));
};

/** ready_check_days_suggested: still the installer's move (installer-texts.core daysSuggestedStillCurrent). */
export const stillTrueDaysSuggested: StillTrue = async (row) => {
  // The suggestion in the key must still be the owner's latest one (ready-check-times.server keys the text on that event).
  const triggerId = after(await claimKey(row), `rc-days-suggested:v1:${row.job_id}:`);
  const { data: latest, error } = await db.from("workflow_events").select("id").eq("job_id", row.job_id).eq("event_type", "ready_check_days_suggested").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !triggerId || latest?.id !== triggerId) return false;
  const turn = await (await import("./ready-check-times.server")).readyCheckTurnFor(row.job_id!);
  return (await import("./installer-texts.core")).daysSuggestedStillCurrent(turn);
};

/** ready_check_booked_installer: that start time is still the booked Ready Check (installer-texts.core bookedStillCurrent). */
export const stillTrueBookedInstaller: StillTrue = async (row) => {
  const startIso = after(await claimKey(row), `rc-booked-installer:v1:${row.job_id}:`);
  if (!startIso) return false;
  const { data: booked } = await db.from("bookings").select("scheduled_start").eq("job_id", row.job_id).eq("kind", "ready_check").eq("status", "confirmed").limit(1).maybeSingle();
  return (await import("./installer-texts.core")).bookedStillCurrent(booked?.scheduled_start ?? null, startIso);
};

/** piesa_rules_failed: the job is live and the form version in the key is still the newest A3 and still breaks the
 *  official rules (no corrected form, no signed Section C overnight) — piesa-rules-notice.server. */
export const stillTruePiesaRules: StillTrue = async (row) => {
  const version = after(await claimKey(row), `piesa-rules:v1:${row.job_id}:`);
  if (!version || !(await stillTrueJobLive(row))) return false;
  const r = await (await import("./piesa-rules-notice.server")).piesaRulesFor(row.job_id!);
  return !!r && r.formVersion === version && r.rules.length > 0;
};

export const STILL_TRUE: Record<QuietResendType, StillTrue> = {
  piesa_rules_failed: stillTruePiesaRules,
  spot_saved: stillTrueSpotSaved,
  quote_ready: stillTrueQuoteReady,
  piesa_owner_confirm: stillTruePiesaOwnerConfirm,
  piesa_owner_fixes_confirm: stillTruePiesaFixesConfirm,
  veec_sign_request: stillTrueVeecUnsigned,
  veec_sign_reminder: stillTrueVeecUnsigned,
  deposit_release: stillTrueDepositRelease,
  visit_new_times: stillTrueVisitNewTimes,
  install_no_access: stillTrueInstallNoAccess,
  install_clearance: stillTrueInstallClearance,
  boss_price_link: stillTrueBossPriceLink,
  fixes_times_link: stillTrueFixesTimesLink,
  ready_check_days_suggested: stillTrueDaysSuggested,
  ready_check_booked_installer: stillTrueBookedInstaller,
};

/** 15-minute tick, from 7am Melbourne. `sent` = Twilio accepted; `skipped` = due but no longer true, held again, failed or errored. Never throws per text. */
export async function sweepQuietHeldTexts(nowIso: string = new Date().toISOString()): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  const { SMS_QUIET_REASON, smsQuietReason } = await import("./quote-hold.core");
  if (smsQuietReason(nowIso)) return out;
  const { HELD_KEY_MARK, claimKeyOf } = await import("./sms.core");
  const since = new Date(Date.parse(nowIso) - QUIET_RESEND_WINDOW_HOURS * 3_600_000).toISOString();
  const cols = "message_type, idempotency_key, job_id, business_id, to_number, body, status, detail, created_at";
  const { data: quiet, error } = await db.from("sms_messages").select(cols).eq("status", "blocked").eq("detail", SMS_QUIET_REASON)
    .in("message_type", [...QUIET_RESEND_TYPES]).gte("created_at", since).like("idempotency_key", `%${HELD_KEY_MARK}%`).order("created_at", { ascending: true }).limit(500);
  if (error) throw new Error(`Held texts could not be read: ${error.message}`);
  const keys = [...new Set(((quiet ?? []) as HeldRow[]).map((r) => claimKeyOf(r.idempotency_key)))];
  if (!keys.length) return out;
  // Real (claiming) rows for those keys, and any other holds on them (a key with another hold is left as recorded).
  const realReads: Promise<{ data: { idempotency_key: string }[] | null; error: { message: string } | null }>[] = [];
  for (let i = 0; i < keys.length; i += 100) realReads.push(db.from("sms_messages").select("idempotency_key").in("idempotency_key", keys.slice(i, i + 100)));
  const realResults = await Promise.all(realReads);
  const re = realResults.find((r) => r.error)?.error;
  const real = realResults.flatMap((r) => r.data ?? []);
  const { data: other, error: oe } = await db.from("sms_messages").select(cols).eq("status", "blocked").neq("detail", SMS_QUIET_REASON)
    .in("message_type", [...QUIET_RESEND_TYPES]).gte("created_at", since).like("idempotency_key", `%${HELD_KEY_MARK}%`).limit(2000);
  const checkError = re ?? oe;
  if (checkError) throw new Error(`Held texts could not be checked: ${checkError.message}`);
  const rows = [...(quiet ?? []), ...((other ?? []) as HeldRow[]).filter((r) => keys.includes(claimKeyOf(r.idempotency_key)))] as Omit<HeldRow, "job">[];
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter((x): x is string => !!x))];
  const { data: jobs, error: je } = jobIds.length ? await db.from("jobs").select("id, source, stage, deleted_at, qa_archived_at").in("id", jobIds) : { data: [], error: null };
  if (je) throw new Error(`Jobs could not be read: ${je.message}`);
  const jobById = new Map(((jobs ?? []) as (JobState & { id: string })[]).map((j) => [j.id, j]));
  const claimed = new Set(real.map((r) => r.idempotency_key));
  const due = quietResendDue(rows.map((r) => ({ ...r, job: (r.job_id && jobById.get(r.job_id)) || null })), claimed, nowIso);
  const { sendRealSms } = await import("./sms.server");
  for (const row of due) {
    try {
      if (row.job_id && ["deposit_release", "visit_new_times", "install_no_access", "install_clearance", "fixes_times_link", "ready_check_days_suggested"].includes(row.message_type) && await inHouseDispatchSkip(row.job_id)) { out.skipped++; continue; }
      if (!(await STILL_TRUE[row.message_type as QuietResendType](row))) { out.skipped++; continue; }
      // Stored body is already branded; brandSmsBody does not add the prefix twice.
      const r = await sendRealSms({
        type: row.message_type as QuietResendType, idempotencyKey: claimKeyOf(row.idempotency_key), to: row.to_number, body: row.body,
        jobId: row.job_id, businessId: row.business_id, event: { at: row.created_at, current: true },
      });
      if (r.status === "sent") out.sent++; else out.skipped++;
    } catch (e) { out.skipped++; console.error("quiet-hours held text not sent", row.message_type, row.job_id, (e as Error).message); }
  }
  return out;
}
