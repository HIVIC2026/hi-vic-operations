// Decision 215 (Jo, 24 Oct 2026): owner notice after an install-day "Couldn't get in?" (trade-view.server
// tradeCouldntGetIn → install-days.server changeInstallDay). Records ONE `install_no_access_owner_notice` event per
// cancelled install booking before sending, so a retry never texts or emails twice. TEST jobs → test-send only; real
// owners → the guarded owner-email path and the one real SMS sender (type `install_no_access`), both behind
// customer_comms_enabled and, until Jo approves the wording, held by INSTALL_NO_ACCESS_NOTICE_APPROVED / wordingApproved.
import { myJobScreen } from "./mail-mjml.core";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { INSTALL_NO_ACCESS_NOTICE_APPROVED, INSTALL_NO_ACCESS_NOTICE_EVENT, INSTALL_NO_ACCESS_SMS_TYPE, installNoAccessKeys, installNoAccessText, installNoAccessTextCatchUpDue, renderInstallNoAccessEmail } from "./install-no-access-notice.core";

export type InstallNoAccessNoticeInput = {
  jobId: string; bookingId: string;
  /** The cancelled install start (ISO) and the installer's reason. */
  wasStart: string; reason: string;
  /** The installer's new days when offered in the same action (ISO starts); [] = they follow by the normal O33 email. */
  newDayStarts?: string[];
  reportedAt?: string;
};

/** The owner/installer facts both the first notice and the 7am catch-up use. `missingLink` = no working Secure My job link. */
async function noticeFacts(jobId: string, wasStart: string, newDayStarts: string[]) {
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return null;
  const [{ data: owner }, { data: asg }, link, ctx] = await Promise.all([
    admin.from("owners").select("full_name, email, phone").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(name, trading_name, onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    (await import("./veec-copy-email.server")).ownerMyJobLink(jobId),
    (await import("./install-days.server")).installDayContext(jobId),
  ]);
  const { firstName } = await import("./worker-links.core");
  const { formatInstallDay } = await import("./install-days.core");
  const { splitDayTime } = await import("./ready-check-times-email.core");
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; onboarding_notes: string | null } | null;
  const installBy = ctx.deadline ? new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${ctx.deadline}T12:00:00Z`)) : null;
  const facts = {
    firstName: firstName(owner?.full_name ?? null), installerName: (biz?.trading_name ?? biz?.name ?? null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null,
    day: formatInstallDay(wasStart, false), newDays: newDayStarts.map((s) => ({ ...splitDayTime(formatInstallDay(s)), href: link ? myJobScreen(link, "book") : "" })), installBy, link: link ?? "",
  };
  return { job, owner, biz, facts, missingLink: !link };
}

export async function sendInstallNoAccessNotice(p: InstallNoAccessNoticeInput): Promise<string> {
  const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", p.jobId).eq("event_type", INSTALL_NO_ACCESS_NOTICE_EVENT).contains("details", { booking_id: p.bookingId }).limit(1).maybeSingle();
  if (prior) return "already handled";
  await logEvent(p.jobId, null, INSTALL_NO_ACCESS_NOTICE_EVENT, "Owner told we couldn't get in on the install day: text + email prepared", { booking_id: p.bookingId, was: p.wasStart, reason: p.reason }, { internal: true });
  const nf = await noticeFacts(p.jobId, p.wasStart, p.newDayStarts ?? []);
  if (!nf) return "skipped";
  if (nf.missingLink) {
    await logEvent(p.jobId, null, "install_no_access_owner_notice_not_sent", "No working owner job link, so the couldn't-get-in notice could not be sent", { booking_id: p.bookingId }, { internal: true });
    return "not sent — owner link missing";
  }
  const { job, owner, biz, facts } = nf;
  const keys = installNoAccessKeys(p.bookingId);
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const tctx = { jobId: p.jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `install_no_access:${p.bookingId}`, actorId: null };
    const mail = renderInstallNoAccessEmail({ ...facts, test: true });
    const e = await sendTestEmail(tctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
    const s = await sendTestSms(tctx, owner?.phone ?? "", installNoAccessText(facts));
    return `email ${e.status}: ${e.detail}; sms ${s.status}: ${s.detail}`;
  }
  const out: string[] = [];
  if (!INSTALL_NO_ACCESS_NOTICE_APPROVED) out.push("email not sent — wording awaiting approval");
  else if (!owner?.email) out.push("email not sent — no owner email");
  else {
    try {
      await (await import("./comms.server")).assertCustomerDeliveryAllowed(p.jobId, "Couldn't get in email");
      out.push(`email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId: p.jobId, jobSource: job.source, to: owner.email, purpose: "install_no_access", key: keys.email, build: () => renderInstallNoAccessEmail({ ...facts, test: false }) })}`);
    } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
  }
  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({ type: INSTALL_NO_ACCESS_SMS_TYPE, idempotencyKey: keys.sms, to: owner?.phone ?? null, body: installNoAccessText(facts), jobId: p.jobId, event: { at: p.reportedAt ?? new Date().toISOString() } });
  out.push(`sms ${s.status}: ${s.detail}`);
  return out.join("; ");
}

/** Decision 215 / spec D4: a couldn't-get-in text held after 8pm goes at 7am — the same key, so never twice. Text only: the
 *  email already went at once and no new event is recorded. Skips when the job is gone or closed, or the owner already has
 *  a new install day booked (the text would be out of date). */
export async function resendInstallNoAccessText(p: { jobId: string; bookingId: string; wasStart: string; reason: string; reportedAt: string }): Promise<string> {
  const { data: j } = await admin.from("jobs").select("stage, deleted_at").eq("id", p.jobId).maybeSingle();
  const { CLOSED_JOB_STAGES } = await import("./duplicate-address.core");
  if (!j || j.deleted_at || CLOSED_JOB_STAGES.has(j.stage ?? "")) return "skipped — job closed";
  const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", p.jobId).eq("kind", "installation").eq("status", "confirmed");
  if (count) return "skipped — new install day already booked";
  const nf = await noticeFacts(p.jobId, p.wasStart, []);
  if (!nf || nf.missingLink) return "skipped";
  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({ type: INSTALL_NO_ACCESS_SMS_TYPE, idempotencyKey: installNoAccessKeys(p.bookingId).sms, to: nf.owner?.phone ?? null, body: installNoAccessText(nf.facts), jobId: p.jobId, event: { at: p.reportedAt } });
  return `sms ${s.status}: ${s.detail}`;
}

/** The 15-minute tick: text held couldn't-get-in notices once quiet hours end. Real jobs only (TEST jobs use the test sender at
 *  report time), events from the last 24h. Never throws per event. */
export async function sweepInstallNoAccessTexts(now = new Date()): Promise<{ checked: number; texted: number; failed: number }> {
  const out = { checked: 0, texted: 0, failed: 0 };
  const nowIso = now.toISOString();
  const { smsQuietReason } = await import("./quote-hold.core");
  if (smsQuietReason(nowIso)) return out;
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const { data: all, error } = await admin.from("workflow_events").select("job_id, details, created_at").eq("event_type", INSTALL_NO_ACCESS_NOTICE_EVENT).gte("created_at", since).limit(200);
  if (error) throw new Error(`Couldn't-get-in notices could not be read: ${error.message}`);
  const ids = [...new Set((all ?? []).map((e) => e.job_id).filter((x): x is string => !!x))];
  const { data: realJobs, error: je } = ids.length ? await admin.from("jobs").select("id").in("id", ids).neq("source", "qa_test").is("deleted_at", null) : { data: [], error: null };
  if (je) throw new Error(`Couldn't-get-in jobs could not be read: ${je.message}`);
  const real = new Set((realJobs ?? []).map((j) => j.id));
  const evs = (all ?? []).filter((e) => e.job_id !== null && real.has(e.job_id));
  const { claimKeyOf } = await import("./sms.core");
  for (const e of evs) {
    out.checked++;
    try {
      const d = (e.details ?? {}) as { booking_id?: string; was?: string; reason?: string };
      if (!d.booking_id || !d.was || !e.job_id || !e.created_at) continue;
      const key = installNoAccessKeys(d.booking_id).sms;
      const { data: rows, error: re } = await (admin as unknown as { from: (t: string) => any }).from("sms_messages").select("idempotency_key, status, detail").like("idempotency_key", `${key}%`);
      if (re) throw new Error(re.message);
      const mine = ((rows ?? []) as { idempotency_key: string; detail: string | null }[]).filter((r) => claimKeyOf(r.idempotency_key) === key);
      const claimed = mine.some((r) => r.idempotency_key === key);
      const heldReasons = mine.filter((r) => r.idempotency_key !== key).map((r) => r.detail ?? "");
      if (!installNoAccessTextCatchUpDue({ claimed, heldReasons, reportedAt: e.created_at }, nowIso)) continue;
      const r = await resendInstallNoAccessText({ jobId: e.job_id, bookingId: d.booking_id, wasStart: d.was, reason: d.reason ?? "", reportedAt: e.created_at });
      if (/^sms sent\b/.test(r)) out.texted++;
    } catch (err) { out.failed++; console.error("couldn't-get-in text catch-up failed", e.job_id, (err as Error).message); }
  }
  return out;
}
