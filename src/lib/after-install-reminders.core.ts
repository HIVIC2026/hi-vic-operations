// Part 4 Task 12 (Jo 2 Nov 2026, touchpoint 53, bal.png): after the install, ONE reminder (email + text) on days 1, 3 and 7 after
// install day, mentioning only what is still undone (the rebate form, the balance, or both). After day 7 the owner hears nothing
// more; the job goes to the office as "Balance overdue". Replaces the balance day-5 / due emails and the separate rebate-form
// reminders (O61, days 1/3/7). The balance is due on install day; it counts as overdue 7 days later (BALANCE_DUE_DAYS).
// PURE: no network, no database. Sent by after-install-reminders.server.ts, behind AFTER_INSTALL_REMINDERS_APPROVED.
import { addYmd, melbourneToday } from './melbourne-time.core';
import { genericMail } from './mail-mjml.core';

/** Verbatim phrases from the decisions file (#53); the one-thing-left versions, subjects, greeting and button labels are drafts for Jo. */
export const AFTER_INSTALL_REMINDERS_APPROVED = true as boolean; // ON at go-live 5 Nov 2026
export type AfterInstallDay = 1 | 3 | 7;
export const AFTER_INSTALL_DAYS: readonly AfterInstallDay[] = [1, 3, 7];
export const AFTER_INSTALL_EVENT = 'after_install_reminder';
export const AFTER_INSTALL_PURPOSE = 'after_install_reminder';
export const AFTER_INSTALL_SMS_TYPE = 'after_install_reminder';
export const afterInstallKey = (jobId: string, day: AfterInstallDay) => `after-install:v1:${jobId}:${day}`;

const dayNumber = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Math.round(Date.UTC(y!, m! - 1, d!) / 86400000); };
const validYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Which reminder is due now, or null. At most one; a day already done (here or by the old reminders) is skipped, an older day never
 *  goes after a newer one, and nothing goes after day 7 (the office row takes over). */
export function afterInstallReminderDue(f: { installDay: string; veecSigned: boolean; balancePaid: boolean; done: AfterInstallDay[]; now: Date }): AfterInstallDay | null {
  if (!validYmd(f.installDay) || (f.veecSigned && f.balancePaid)) return null;
  const elapsed = dayNumber(melbourneToday(f.now)) - dayNumber(f.installDay);
  if (elapsed < 1 || elapsed > 7) return null;
  const newest = Math.max(0, ...f.done);
  const due = AFTER_INSTALL_DAYS.filter((d) => d <= elapsed && d > newest);
  return due.length ? due[due.length - 1]! : null;
}

/** The office's "Balance overdue": unpaid after day 7 (Melbourne date). */
export function balanceOverdueForOffice(f: { installDay: string | null | undefined; balancePaid: boolean; now: Date }): boolean {
  if (f.balancePaid || !f.installDay || !validYmd(f.installDay)) return false;
  return melbourneToday(f.now) > addYmd(f.installDay, 7);
}

export type AfterInstallInput = { day: AfterInstallDay; firstName: string; balance: string; veecSigned: boolean; balancePaid: boolean; link: string; unsubscribeUrl?: string | null };
export type AfterInstallMail = { subject: string; text: string; html: string; sms: string };

export function afterInstallReminder(f: AfterInstallInput): AfterInstallMail {
  const needForm = !f.veecSigned, needPay = !f.balancePaid;
  if (!needForm && !needPay) throw new Error('Nothing left to remind about');
  const n = (needForm ? 1 : 0) + (needPay ? 1 : 0);
  const todo = needForm && needPay ? `sign your rebate form and pay your ${f.balance} balance` : needPay ? `pay your ${f.balance} balance` : 'sign your rebate form';
  const left = `just ${n} thing${n === 1 ? '' : 's'} left: ${todo}`;
  const first = f.firstName.trim() || 'there';
  let subject: string, body: string[], inline: string;
  if (f.day === 1) {
    subject = `Just ${n} thing${n === 1 ? '' : 's'} left`;
    inline = `${left}.`;
    body = [`Hi ${first}, ${inline}`];
  } else if (f.day === 3) {
    subject = `Reminder: just ${n} thing${n === 1 ? '' : 's'} left`;
    inline = `Reminder: ${left}${needPay ? ' (it was due on install day)' : ''}.`;
    body = [`Hi ${first},`, inline];
  } else if (needPay) {
    subject = 'Your balance is now overdue';
    inline = `your ${f.balance} balance is now overdue. Please pay today.${needForm ? ' Your rebate form still needs your signature too.' : ''} If you've already paid, thanks and please ignore this.`;
    body = [`Hi ${first}, ${inline}`];
  } else {
    subject = 'Your rebate form still needs your signature';
    inline = 'your rebate form still needs your signature. Please sign it today.';
    body = [`Hi ${first}, ${inline}`];
  }
  const button = needForm && needPay ? 'Sign and pay' : needPay ? 'Pay my balance' : 'Sign my rebate form';
  const text = [subject, '', ...body, '', `${button}: ${f.link}`].join('\n');
  const html = genericMail({ subject, heading: subject, lines: body, button: { url: f.link, label: button }, unsubscribe: f.unsubscribeUrl ?? null });
  const sms = `${body.join(' ')} ${f.link} Reply STOP to opt out.`;
  return { subject, text, html, sms };
}
