// Part 4 Task 12 (touchpoint 53): the 15-minute tick sends ONE reminder (email + text) per job on days 1, 3 and 7 after install day,
// only for what is still undone, behind AFTER_INSTALL_REMINDERS_APPROVED (off). Each day is recorded once as a workflow event before
// any send; the email also has its own once-only key. The old balance day-5/due emails and rebate-form reminders (O61) stop when this
// is on, so a job never gets both. After day 7 nothing goes to the owner; the office sees "Balance overdue" (office-needs).
// Wording: after-install-reminders.core.ts. TEST jobs use test-send; real owners go through the guarded email path and the one SMS sender.
import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import {
  AFTER_INSTALL_EVENT, AFTER_INSTALL_PURPOSE, AFTER_INSTALL_REMINDERS_APPROVED, AFTER_INSTALL_SMS_TYPE, afterInstallKey, afterInstallReminder, afterInstallReminderDue,
  type AfterInstallDay, type AfterInstallMail,
} from './after-install-reminders.core';
import { aud } from './payments.core';

export type AfterInstallJob = {
  jobId: string; jobSource: string; installDay: string; veecSigned: boolean; balancePaid: boolean; balanceCents: number;
  firstName: string; ownerEmail: string | null; ownerPhone: string | null; link: string | null;
};
export type AfterInstallDeps = {
  approved: boolean;
  jobs: (now: Date) => Promise<AfterInstallJob[]>;
  doneDays: (jobId: string) => Promise<AfterInstallDay[]>;
  record: (jobId: string, day: AfterInstallDay) => Promise<void>;
  deliver: (job: AfterInstallJob, day: AfterInstallDay, build: (unsubscribeUrl: string | null) => AfterInstallMail) => Promise<string>;
};
type Db = typeof admin;

/** Days already handled: this reminder's own events, plus the OLD reminders for the same day (rebate form reminders 1/3/7 and the
 *  balance "due" email, which was day 7) so a job in flight gets one reminder per day, not two. */
export async function readDoneDays(jobId: string, db: Db = admin): Promise<AfterInstallDay[]> {
  const [ev, bal] = await Promise.all([
    db.from('workflow_events').select('event_type, details').eq('job_id', jobId).in('event_type', [AFTER_INSTALL_EVENT, 'veec_sign_reminder']),
    db.from('customer_email_sends').select('idempotency_key').eq('job_id', jobId).eq('purpose', 'balance_reminder'),
  ]);
  if (ev.error || bal.error) throw new Error('Could not read reminder history.');
  const days = new Set<AfterInstallDay>();
  for (const e of ev.data ?? []) {
    const d = e.details as { day?: number; step?: string } | null;
    if (e.event_type === AFTER_INSTALL_EVENT && (d?.day === 1 || d?.day === 3 || d?.day === 7)) days.add(d.day);
    const m = e.event_type === 'veec_sign_reminder' ? /^reminder_(1|3|7)$/.exec(d?.step ?? '') : null;
    if (m) days.add(Number(m[1]) as AfterInstallDay);
  }
  if ((bal.data ?? []).some((b) => String(b.idempotency_key).endsWith(':due'))) days.add(7);
  return [...days];
}

export function defaultAfterInstallDeps(): AfterInstallDeps {
  return {
    approved: AFTER_INSTALL_REMINDERS_APPROVED,
    doneDays: (id) => readDoneDays(id),
    record: async (jobId, day) => {
      const { logEvent } = await import('./workflow.server');
      await logEvent(jobId, null, AFTER_INSTALL_EVENT, `After-install reminder (day ${day}) prepared for the owner`, { day }, { internal: true });
    },
    jobs: async (now) => {
      const { balanceDueDay } = await import('./balance-q21.core');
      const { isStepPaid } = await import('./payments.core');
      const since = new Date(now.getTime() - 9 * 86400000).toISOString();
      const out: AfterInstallJob[] = [];
      for (let from = 0; ; from += 200) {
        const { data, error } = await admin.from('jobs').select('id, source, installation_completed_at, owners(full_name, email, phone)').is('deleted_at', null)
          .not('stage', 'in', '(cancelled,on_hold)').gte('installation_completed_at', since).order('id').range(from, from + 199);
        if (error) throw new Error('Could not read after-install reminder jobs.');
        const ids = (data ?? []).map((j) => j.id);
        const { data: asg, error: ae } = ids.length ? await admin.from('customer_assignments').select('job_id, consumer_signed_at').in('job_id', ids).eq('record_kind', 'final_veec_assignment').neq('status', 'cancelled') : { data: [], error: null };
        if (ae) throw new Error('Could not read rebate form state.');
        const signed = new Set((asg ?? []).filter((a) => a.consumer_signed_at).map((a) => a.job_id));
        for (const j of data ?? []) {
          try {
            const installDay = balanceDueDay(j.installation_completed_at);
            if (!installDay) continue;
            const view = await (await import('./payments.server')).jobPaymentView(j.id, now);
            if (!view?.invoices.install) continue; // no invoice = no balance to name; never guess
            const balanced = isStepPaid(view.steps, 'balance');
            const cents = view.steps.find((s) => s.key === 'balance')?.outstandingCents ?? 0;
            const link = await (await import('./veec-copy-email.server')).ownerMyJobLink(j.id);
            const owner = j.owners as { full_name: string | null; email: string | null; phone: string | null } | null;
            out.push({ jobId: j.id, jobSource: j.source, installDay, veecSigned: signed.has(j.id), balancePaid: balanced, balanceCents: cents, firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? '', ownerEmail: owner?.email?.trim() || null, ownerPhone: owner?.phone ?? null, link: link ? `${link}${link.includes('?') ? '&' : '?'}screen=finish` : null });
          } catch (e) { console.error('After-install reminder facts held', j.id, e instanceof Error ? e.message : 'read failed'); }
        }
        if ((data?.length ?? 0) < 200) break;
      }
      return out;
    },
    deliver: async (j, day, build) => {
      const out: string[] = [];
      const key = afterInstallKey(j.jobId, day);
      if (j.jobSource === 'qa_test') {
        const { data: asg } = await admin.from('job_assignments').select('businesses(onboarding_notes)').eq('job_id', j.jobId).eq('role', 'installer').eq('active', true).maybeSingle();
        const { isTestPartner } = await import('./test-send.core');
        const { sendTestEmail, sendTestSms } = await import('./test-send.server');
        const ctx = { jobId: j.jobId, jobSource: j.jobSource, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `after_install:${day}`, actorId: null };
        const mail = build(null);
        if (j.ownerEmail) { const e = await sendTestEmail(ctx, j.ownerEmail, mail.subject, mail.html, mail.text); out.push(`email ${e.status}: ${e.detail}`); }
        const s = await sendTestSms(ctx, j.ownerPhone ?? '', mail.sms); out.push(`sms ${s.status}: ${s.detail}`);
        return out.join('; ');
      }
      if (j.ownerEmail) {
        try {
          const comms = await import('./comms.server');
          await comms.assertCustomerDeliveryAllowed(j.jobId, 'After-install reminder email');
          out.push(`email ${await (await import('./owner-email-send.server')).sendGuardedOwnerEmail({ jobId: j.jobId, jobSource: j.jobSource, to: j.ownerEmail, purpose: AFTER_INSTALL_PURPOSE, key, retryAfterDefiniteFailure: true, build })}`);
        } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
      }
      const { sendRealSms } = await import('./sms.server');
      const s = await sendRealSms({ type: AFTER_INSTALL_SMS_TYPE, idempotencyKey: `${key}:sms`, to: j.ownerPhone, body: build(null).sms, jobId: j.jobId });
      out.push(`sms ${s.status}: ${s.detail}`);
      return out.join('; ');
    },
  };
}

/** 15-minute tick (allocation-tick). One due reminder per job; safe to run every tick. */
export async function sweepAfterInstallReminders(now = new Date(), deps: AfterInstallDeps = defaultAfterInstallDeps()): Promise<{ checked: number; sent: number }> {
  if (!deps.approved) return { checked: 0, sent: 0 };
  // Quiet hours cover both channels; nothing is recorded, so the next tick in the morning sends it.
  if ((await import('./quote-hold.core')).smsQuietReason(now.toISOString())) return { checked: 0, sent: 0 };
  const jobs = await deps.jobs(now);
  let sent = 0;
  for (const j of jobs) {
    try {
      if (!j.link || (!j.balancePaid && j.balanceCents <= 0)) continue; // never name an amount we can't state, or send without a working link
      const day = afterInstallReminderDue({ installDay: j.installDay, veecSigned: j.veecSigned, balancePaid: j.balancePaid, done: await deps.doneDays(j.jobId), now });
      if (!day) continue;
      await deps.record(j.jobId, day);
      await deps.deliver(j, day, (unsubscribeUrl) => afterInstallReminder({ day, firstName: j.firstName, balance: aud(j.balanceCents), veecSigned: j.veecSigned, balancePaid: j.balancePaid, link: j.link!, unsubscribeUrl }));
      sent++;
    } catch (e) { console.error('After-install reminder failed', j.jobId, e instanceof Error ? e.message : e); }
  }
  return { checked: jobs.length, sent };
}
