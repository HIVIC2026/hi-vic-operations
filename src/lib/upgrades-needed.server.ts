// Part 4 Task 4 (touchpoint 42): sends the "Electrical upgrades needed" email + text for new-flow jobs whose PIESA found upgrades
// still to come. Only when UPGRADES_NEEDED_EMAIL_APPROVED is on AND ownerPiesaRoute says `upgrades_needed`; otherwise the owner's
// standalone signed PIESA copy goes as before (and the 24h safety net in piesa-delivery.server still covers a blocked send).
// The email carries the owner's PIESA copy, so it is a compliance send (purpose piesa_copy) and records the owner
// piesa_deliveries + official_form_deliveries rows once (recordDelivery), idempotently. Wording: upgrades-needed.core.ts.
import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { UPGRADES_NEEDED_EMAIL_APPROVED, type PiesaResultRoute } from './piesa-result-route.core';
import { upgradesNeededEmail, upgradesNeededKey, upgradesNeededText, UPGRADES_NEEDED_PURPOSE, UPGRADES_NEEDED_SMS_TYPE } from './upgrades-needed.core';
import { contactLine } from './owner-wording.core';
import type { TradeContact } from './owner-will-call.core';
import type { EmailAttachment } from './email-kit.core';

export type UpgradesNeededFacts = {
  jobSource: string; piesaRecordId: string; signedCopyId: string; resultAt: string;
  ownerEmail: string; ownerPhone: string | null; firstName: string; found: string[]; electrician: TradeContact;
  installer: string; installBy: string; depositCents: number; confirmUrl: string; attachments: EmailAttachment[];
};
export type UpgradesNeededDeps = {
  approved: boolean;
  candidates: (now: Date) => Promise<string[]>;
  route: (jobId: string) => Promise<PiesaResultRoute[]>;
  facts: (jobId: string, now: Date) => Promise<UpgradesNeededFacts | { held: string }>;
  record: (p: { jobId: string; recipient: 'owner'; piesaRecordId: string; signedCopyId: string; recipientUserId: string | null; to: string; detail: string }) => Promise<void>;
};
const DETAIL = 'with the "Electrical upgrades needed" email';
const LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_PER_TICK = 50;
const STAGES = ['piesa_complete', 'electrical_variation_pending', 'awaiting_deposit_payment', 'rectification_scheduling', 'rectification_booked', 'installation_scheduling'] as const;

export function defaultUpgradesNeededDeps(): UpgradesNeededDeps {
  return {
    approved: UPGRADES_NEEDED_EMAIL_APPROVED,
    route: async (j) => (await import('./piesa-delivery.server')).ownerPiesaRoute(j),
    facts: (j, now) => upgradesNeededFacts(j, now),
    candidates: async (now) => {
      // Current PIESA results with no owner delivery yet; the route check decides which are really "upgrades still to come".
      const { data: recs, error } = await admin.from('piesa_records').select('id, job_id, jobs!inner(stage, deleted_at)').eq('is_current', true)
        .gte('created_at', new Date(now.getTime() - LOOKBACK_MS).toISOString()).in('jobs.stage', [...STAGES]).is('jobs.deleted_at', null).order('created_at').limit(MAX_PER_TICK * 4);
      if (error) throw new Error(`Upgrades-needed sweep could not read safety checks: ${error.message}`);
      if (!recs?.length) return [];
      const { data: done, error: e2 } = await admin.from('piesa_deliveries').select('piesa_record_id').eq('recipient', 'owner').in('piesa_record_id', recs.map((r) => r.id));
      if (e2) throw new Error(`Upgrades-needed sweep could not read deliveries: ${e2.message}`);
      const have = new Set((done ?? []).map((d) => d.piesa_record_id));
      return recs.filter((r) => !have.has(r.id)).map((r) => r.job_id).slice(0, MAX_PER_TICK);
    },
    record: async (p) => { await (await import('./piesa-delivery.server')).recordDelivery(p); },
  };
}

/** Everything the email needs, or { held } (never sent without the owner's PIESA, the electrician's office contact and a deposit to pay). */
async function upgradesNeededFacts(jobId: string, now: Date): Promise<UpgradesNeededFacts | { held: string }> {
  const HELD = (why: string) => ({ held: why });
  try {
    const { data: job } = await admin.from('jobs').select('job_number, source, stage, owners(full_name, email, phone)').eq('id', jobId).maybeSingle();
    const owner = job?.owners as { full_name: string | null; email: string | null; phone: string | null } | null | undefined;
    if (!job || !owner?.email?.trim()) return HELD('owner email missing');
    const { currentCopy } = await import('./official-forms.server');
    const pe = await currentCopy(jobId, 'piesa');
    const { data: rec } = await admin.from('piesa_records').select('id, created_at').eq('job_id', jobId).eq('is_current', true).maybeSingle();
    if (pe.unavailable || !pe.copy || !rec) return HELD('Upgrades needed documents not ready');
    const { officialPiesaPdf, pdfAttachment } = await import('./official-piesa-pdf.server');
    const piesa = await officialPiesaPdf(jobId, job.job_number ?? '');
    if (!piesa || piesa.copyId !== pe.copy.id) return HELD('Upgrades needed documents not ready');
    const { businessContactForJob } = await import('./owner-contact.server');
    const [el, inst] = await Promise.all([businessContactForJob(jobId, 'electrician'), businessContactForJob(jobId, 'installer')]);
    if (!el || !contactLine(el)) return HELD('Electrician office phone or email missing');
    const installer = (inst?.tradingName || inst?.name || '').replace(/^\[TEST PARTNER\]\s*/, '').trim();
    if (!installer) return HELD('installer not assigned');
    const [{ fixesFormNeededFor }, { installDayContext }, { jobPaymentView }, { isStepPaid }, { ownerMyJobLink }] = await Promise.all([
      import('./fixes-day.server'), import('./install-days.server'), import('./payments.server'), import('./payments.core'), import('./veec-copy-email.server'),
    ]);
    const [fixes, c, v, link] = await Promise.all([fixesFormNeededFor(jobId), installDayContext(jobId), jobPaymentView(jobId, now), ownerMyJobLink(jobId)]);
    if (!fixes.repairList.length) return HELD('no upgrades listed');
    if (!c.deadline || c.booked) return HELD('install deadline missing or install already booked');
    if (!v || !v.invoices.install?.xero_invoice_id || v.plan.installDepositCents <= 0 || isStepPaid(v.steps, 'install_deposit')) return HELD('deposit not payable');
    if (!link) return HELD('owner link missing');
    return {
      jobSource: job.source, piesaRecordId: rec.id, signedCopyId: pe.copy.id, resultAt: rec.created_at, ownerEmail: owner.email.trim(), ownerPhone: owner.phone,
      firstName: owner.full_name?.trim().split(/\s+/)[0] ?? '', found: fixes.repairList,
      electrician: { ...el, name: el.name.replace(/^\[TEST PARTNER\]\s*/, ''), tradingName: el.tradingName?.replace(/^\[TEST PARTNER\]\s*/, '') ?? null },
      installer, installBy: c.deadline, depositCents: v.steps.find((s) => s.key === 'install_deposit')?.outstandingCents ?? v.plan.installDepositCents,
      confirmUrl: `${link}${link.includes('?') ? '&' : '?'}screen=clear`, attachments: [pdfAttachment(piesa)],
    };
  } catch (e) {
    console.error('upgrades needed facts unavailable', jobId, e instanceof Error ? e.message : e);
    return HELD('Upgrades needed documents not ready');
  }
}

/** One job. Returns what happened; 'sent' only when the email went. Safe to call every tick. */
export async function sendUpgradesNeeded(jobId: string, now: Date, deps: UpgradesNeededDeps): Promise<string> {
  if (!deps.approved) return 'not approved';
  if (!(await deps.route(jobId)).includes('upgrades_needed')) return 'not this route';
  // Quiet hours are checked before either channel; no deferred text at a different time to its email.
  if ((await import('./quote-hold.core')).smsQuietReason(now.toISOString())) return 'quiet hours';
  const f = await deps.facts(jobId, now);
  if ('held' in f) return f.held;
  const contact = contactLine(f.electrician);
  if (!contact) return 'Electrician office phone or email missing';
  const key = upgradesNeededKey(f.piesaRecordId);
  const comms = await import('./comms.server');
  await comms.assertCustomerDeliveryAllowed(jobId, 'Electrical upgrades needed email', 'piesa_copy');
  const prior = await admin.from('customer_email_sends').select('status').eq('job_id', jobId).eq('idempotency_key', key).maybeSingle();
  if (prior.error) throw new Error('Could not read upgrades-needed history.');
  let status = prior.data?.status === 'sent' ? 'sent-before' : '';
  if (!status) {
    const mail = upgradesNeededEmail({ firstName: f.firstName, found: f.found, electrician: f.electrician, installer: f.installer, installBy: f.installBy, depositCents: f.depositCents, confirmUrl: f.confirmUrl });
    status = await (await import('./owner-email-send.server')).sendGuardedOwnerEmail({
      jobId, jobSource: f.jobSource, to: f.ownerEmail, purpose: UPGRADES_NEEDED_PURPOSE, key, retryAfterDefiniteFailure: true,
      beforeSend: async () => { await comms.assertCustomerDeliveryAllowed(jobId, 'Electrical upgrades needed email', 'piesa_copy'); },
      build: () => ({ ...mail, attachments: f.attachments }),
    });
  }
  if (status !== 'sent' && status !== 'sent-before') return `email ${status}`;
  // Sent (now, or on an earlier tick that crashed before recording): the owner delivery row is written once.
  // Idempotent: a replay after a provider-accepted send must not double-record.
  const have = await admin.from('piesa_deliveries').select('id', { count: 'exact', head: true }).eq('piesa_record_id', f.piesaRecordId).eq('recipient', 'owner');
  if (have.error) throw new Error('Could not read PIESA deliveries.');
  if (!have.count) await deps.record({ jobId, recipient: 'owner', piesaRecordId: f.piesaRecordId, signedCopyId: f.signedCopyId, recipientUserId: null, to: f.ownerEmail, detail: DETAIL });
  if (status === 'sent' && f.ownerPhone) {
    // TEST jobs stay behind the canonical sender's TEST boundary (no real SMS).
    await (await import('./sms.server')).sendRealSms({
      type: UPGRADES_NEEDED_SMS_TYPE, jobId, to: f.ownerPhone, body: upgradesNeededText(f.firstName, (f.electrician.tradingName || f.electrician.name).trim()),
      idempotencyKey: `${key}:sms`, event: { at: f.resultAt, current: true },
    });
  }
  return 'sent';
}

/** 15-minute tick (allocation-tick). */
export async function sweepUpgradesNeeded(now = new Date(), deps: UpgradesNeededDeps = defaultUpgradesNeededDeps()): Promise<{ checked: number; sent: number }> {
  if (!deps.approved) return { checked: 0, sent: 0 };
  const ids = await deps.candidates(now);
  let sent = 0;
  for (const jobId of ids) {
    try { if ((await sendUpgradesNeeded(jobId, now, deps)) === 'sent') sent++; }
    catch (e) { console.error('upgrades needed send failed', jobId, e instanceof Error ? e.message : e); }
  }
  return { checked: ids.length, sent };
}
