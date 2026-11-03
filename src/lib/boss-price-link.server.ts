// Decision 288 (Jo 25 Oct 2026): A1 Ready Check marked Complete + no price yet → text the business owner ONE link to the
// "Your price" card. Same shape as the decision-193 installer texts (`installer-texts.server.ts`): the `boss_price_link_sent`
// workflow event is recorded BEFORE anything is sent (once per job); TEST jobs / TEST partners → test-send only; real
// partners → the ONE real sender (`sendRealSms`, type `boss_price_link`: customer_comms_enabled + the type's own switch,
// quiet hours, STOP, approved-partner consent; no fallback connection, no retry; a held attempt never claims the key).
// Part 10 Task 3 (Jo 3 Nov 2026 22:58): the boss ALSO gets the "Enter your price" email (`enter-price-email.core`) — the
// same one claim covers the pair; the email is its own channel under it (`enterPriceEmailKey`, one `customer_email_sends`
// attempt per job): held (flag off / no office email / paused) → `enter_price_email_held` recorded once, retried on a later
// sync while the completion is fresh, never resending the text. Real partner + ENTER_PRICE_EMAIL_APPROVED=false → held.
// Called from `finishMittiReadyCheck` (mitti-complete.server) on the sync that sees Complete and on the 15-minute sweep.
// Never throws to its caller; never changes a stage, a quote or the form.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { BOSS_PRICE_LINK_EVENT, bossPriceLink, bossPriceLinkBlocker, bossPriceLinkKey, bossPriceLinkText } from "./boss-price-link.core";
import { ENTER_PRICE_EMAIL_APPROVED, ENTER_PRICE_EMAIL_HELD_EVENT, ENTER_PRICE_EMAIL_PURPOSE, enterPriceEmailKey, enterPriceEmailPlan, enterPriceFacts, enterPriceFresh, renderEnterPriceEmail } from "./enter-price-email.core";

type JobRow = { id: string; job_number: string; source: string | null; channel: string | null; deleted_at: string | null; originating_installer_business_id: string | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null; owners: { full_name: string | null } | null };
type BizRow = { id: string; name: string | null; signer_name: string | null; signer_mobile: string | null; phone: string | null; email: string | null; onboarding_notes: string | null };
type Entry = { label: string; value: unknown };

export async function textBossPriceLink(jobId: string, i: { auditId: string; completedAt: string | null; entries?: Entry[] | undefined }, opts: { emailApproved?: boolean } = {}): Promise<string> {
  try {
    const { data: job } = await admin.from("jobs").select("id, job_number, source, channel, deleted_at, originating_installer_business_id, properties(address_line, suburb, postcode), owners(full_name)").eq("id", jobId).maybeSingle();
    const j = job as unknown as JobRow | null;
    if (!j) return "skipped: job not found";
    const emailKey = enterPriceEmailKey(jobId);
    const [{ count: claimed }, { data: emailAttempt }, stored] = await Promise.all([
      admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", BOSS_PRICE_LINK_EVENT),
      admin.from("customer_email_sends").select("id").eq("job_id", jobId).eq("idempotency_key", emailKey).maybeSingle(),
      (await import("./installer-price.server")).readInstallerPrice(jobId).catch(() => null),
    ]);
    const { installerPriceState } = await import("./installer-price.core");
    // Batch 3a: after a new-quote request an old form's own price no longer counts.
    const formEntries = await (await import("./installer-price.server")).entriesWithInstallerPrice(jobId, i.entries ?? []);
    const price = installerPriceState({ channel: j.channel, record: stored?.record ?? null, entries: formEntries });
    const completedAt = i.completedAt ?? new Date().toISOString();
    // The email channel is still open while the one claim exists but no email attempt was recorded and the completion is fresh.
    const emailOpen = !emailAttempt && enterPriceFresh(completedAt, new Date().toISOString());
    const blocker = bossPriceLinkBlocker({ channel: j.channel, deleted: !!j.deleted_at, formCompleted: true, pricePresent: price.present && price.required, alreadySent: !!claimed && !emailOpen });
    if (blocker) return `skipped: ${blocker}`;
    if (!j.originating_installer_business_id) return "skipped: no installer business on the job";
    const { data: biz } = await admin.from("businesses").select("id, name, signer_name, signer_mobile, phone, email, onboarding_notes").eq("id", j.originating_installer_business_id).maybeSingle();
    const b = (biz ?? null) as BizRow | null;
    const { isTestPartner } = await import("./test-send.core");
    const test = j.source === "qa_test" || isTestPartner(b ?? {});
    // Jo 30 Oct 2026: "Pause all trade messages" — held BEFORE the claim (TEST unchanged), so a later sync can still send it.
    const tradePaused = test ? null : await (await import("./trade-pause.server")).tradeMessagesPausedNow({ businessId: b?.id ?? j.originating_installer_business_id });
    if (!claimed && tradePaused) return `held: ${tradePaused}`;
    const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
    const { TEST_APP_BASE, sendTestSms, sendTestEmail } = await import("./test-send.server");
    const base = test ? TEST_APP_BASE : SET_PASSWORD_BASE;
    const link = bossPriceLink(base, jobId);
    const key = bossPriceLinkKey(jobId);
    const results: string[] = [];

    // ---- Text (decision 288): once per job, at the claim; never retried.
    if (!claimed) {
      // The business owner's mobile: the signing owner's mobile, else the business phone (the same rule as every other
      // business-owner text, e.g. install tomorrow / Ready Check booked).
      const to = b?.signer_mobile ?? b?.phone ?? null;
      // Claimed once, before any send: a second sync or the sweep finds this event and stops the text for good.
      await logEvent(jobId, null, BOSS_PRICE_LINK_EVENT, `Business owner texted the link to enter the price (decision 288) — text prepared${to ? "" : " (no business mobile on file)"}; the "Enter your price" email is its own channel under this claim`, { key, email_key: emailKey, audit_id: i.auditId, completed_at: completedAt, business_id: b?.id ?? j.originating_installer_business_id, to }, { internal: true });
      if (!to) results.push("not sent: no business mobile");
      else {
        const { installerTextAddress } = await import("./installer-texts.core");
        const body = bossPriceLinkText({ jobNumber: j.job_number, street: installerTextAddress(j.properties?.address_line, j.properties?.suburb), link });
        if (test) {
          const r = await sendTestSms({ jobId, jobSource: j.source, partnerIsTest: isTestPartner(b ?? {}), label: `boss_price_link:${jobId}`, actorId: null }, to, body);
          results.push(`boss sms (test) ${r.status}: ${r.detail}`);
        } else {
          const { sendRealSms } = await import("./sms.server");
          const r = await sendRealSms({ type: "boss_price_link", idempotencyKey: key, to, body, jobId, businessId: j.originating_installer_business_id, event: { at: completedAt, current: true } });
          results.push(`boss sms ${r.status}: ${r.detail}`);
        }
      }
    }

    // ---- Email (Part 10 Task 3): one attempt per job under the same claim; held reasons retried while fresh.
    const plan = enterPriceEmailPlan({ approved: opts.emailApproved ?? ENTER_PRICE_EMAIL_APPROVED, test, officeEmail: b?.email, paused: tradePaused, alreadyAttempted: !!emailAttempt, fresh: enterPriceFresh(completedAt, new Date().toISOString()) });
    if (plan.action === "held") {
      const { count: heldBefore } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", ENTER_PRICE_EMAIL_HELD_EVENT);
      if (!heldBefore) await logEvent(jobId, null, ENTER_PRICE_EMAIL_HELD_EVENT, `"Enter your price" email not sent — ${plan.reason}. The business owner still has the text.`, { key: emailKey, audit_id: i.auditId, completed_at: completedAt, business_id: b?.id ?? j.originating_installer_business_id, reason: plan.reason }, { internal: true });
      results.push(`email held: ${plan.reason}`);
      return results.join("; ");
    }
    if (plan.action === "done") { results.push("email already attempted"); return results.join("; "); }
    // Claim the email attempt (one per job) BEFORE sending; a lost race means another sync already has it.
    const claim = await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: ENTER_PRICE_EMAIL_PURPOSE, idempotency_key: emailKey }).select("id").maybeSingle();
    if (claim.error || !claim.data) { results.push("email already attempted"); return results.join("; "); }
    const facts = await enterPriceFactsForJob(jobId, j, b, formEntries as { label: string; value: string | null }[], completedAt, link, base);
    const m = renderEnterPriceEmail({ ...facts, test });
    const r = test
      ? await sendTestEmail({ jobId, jobSource: j.source, partnerIsTest: isTestPartner(b ?? {}), label: emailKey, actorId: null }, plan.to, m.subject, m.html, m.text)
      : await (await import("./office-email.server")).sendOfficeEmail({ actorId: null, recipient: "partner", to: plan.to, contactName: b?.name ?? null, subject: m.subject, message: m.text, label: ENTER_PRICE_EMAIL_PURPOSE, record: { businessId: b?.id ?? j.originating_installer_business_id }, html: m.html, text: m.text, idempotencyKey: emailKey });
    // The claim row stays either way (one attempt per job); only its status records the outcome.
    await admin.from("customer_email_sends").update({ status: r.status === "sent" ? "sent" : "failed", sent_at: r.status === "sent" ? new Date().toISOString() : null, error: r.status === "sent" ? null : r.detail ?? null }).eq("id", claim.data.id);
    results.push(`email${test ? " (test)" : ""} ${r.status}: ${r.detail}`);
    return results.join("; ");
  } catch (e) { return `boss price link not sent — ${(e as Error).message}`; }
}

/** The email's facts: the Ready Check answers the quote reads + the current measurement, who did the Ready Check
 *  (latest `visit_allocated` for the Ready Check), the owner's name and the saved Mitti Ready Check report (signed app link). */
async function enterPriceFactsForJob(jobId: string, j: JobRow, b: BizRow | null, entries: { label: string; value: string | null }[], completedAt: string, priceUrl: string, base: string) {
  const [{ data: m }, { data: allocEvents }, { data: report }] = await Promise.all([
    admin.from("ceiling_measurements").select("measured_area_m2, removal_required").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("workflow_events").select("event_type, details, created_at").eq("job_id", jobId).eq("event_type", "visit_allocated").order("created_at", { ascending: false }).limit(20),
    admin.from("documents").select("storage_path").eq("job_id", jobId).eq("kind", "mitti_report").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { currentAllocation } = await import("./visit-allocation.core");
  const checker = currentAllocation(((allocEvents ?? []) as { event_type: string; details: unknown; created_at: string }[]), "ready_check")?.worker_name ?? null;
  const { readyCheckRemovalRequired } = await import("./ready-check-answers.core");
  const measurement = m as { measured_area_m2?: number | string | null; removal_required?: boolean | null } | null;
  let readyCheckPdfUrl: string | null = null;
  const path = (report as { storage_path?: string | null } | null)?.storage_path;
  if (path) {
    const signed = await (await import("./file-links.server")).signFile("job-files", path, 7 * 24 * 3600).catch(() => null);
    readyCheckPdfUrl = signed?.data?.signedUrl ? `${base.replace(/\/+$/, "")}${signed.data.signedUrl}` : null;
  }
  const p = j.properties;
  const address = [p?.address_line?.trim(), [p?.suburb?.trim(), p?.postcode?.trim() ? `VIC ${p.postcode.trim()}` : null].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "the property";
  return enterPriceFacts(entries, {
    recipientName: b?.signer_name ?? null, checkerName: checker, ownerName: j.owners?.full_name ?? null,
    jobNumber: j.job_number, address, completedAt,
    measuredAreaM2: measurement?.measured_area_m2 == null ? null : Number(measurement.measured_area_m2),
    removalRequired: readyCheckRemovalRequired(entries, measurement),
    priceUrl, readyCheckPdfUrl,
  });
}
