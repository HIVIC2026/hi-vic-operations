// Part 4 Task 4 (touchpoint 42, Jo 2 Nov 2026): "Your safety check found electrical upgrades needed" owner email + text.
// Pure wording. Sent by upgrades-needed.server.ts, only when piesa-result-route.core routes the job to `upgrades_needed`
// (flag UPGRADES_NEEDED_EMAIL_APPROVED, off). Verbatim from the decisions file: the two numbered lines' first half, the text, the
// electrician contact line. Drafts for Jo: the subject/heading, the intro line, step 2 and the button (answer 21 replaced the
// approved "Once the upgrades are done, we'll email you…" line), the 30-day sentence (reused from the PIESA "You're booked").
import { cents } from './email-kit.core';
import { genericMail } from './mail-mjml.core';
import { weekdayDayMonthLabel } from './owner-email-triggers.core';
import { contactLine } from './owner-wording.core';
import type { TradeContact } from './owner-will-call.core';

export const UPGRADES_NEEDED_PURPOSE = 'piesa_copy'; // carries the owner's legal PIESA copy: a compliance send, also reaches unsubscribed owners
export const UPGRADES_NEEDED_SMS_TYPE = 'upgrades_needed';
export const upgradesNeededKey = (piesaRecordId: string) => `upgrades-needed:v1:${piesaRecordId}`;
export const UPGRADES_NEEDED_SUBJECT = 'Your safety check found electrical upgrades needed';
const BUTTON = 'Confirm and pay my deposit';
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type UpgradesNeededInput = { firstName: string; found: string[]; electrician: TradeContact; installer: string; installBy: string; depositCents: number; confirmUrl: string };

export function upgradesNeededEmail(i: UpgradesNeededInput): { subject: string; text: string; html: string } {
  const contact = contactLine(i.electrician);
  if (!contact) throw new Error('Electrician office phone or email missing');
  const name = (i.electrician.tradingName || i.electrician.name).trim();
  const installBy = weekdayDayMonthLabel(i.installBy) ?? i.installBy;
  const lines = [
    `${i.firstName.trim() || 'there'},`,
    'Your electrical safety check (PIESA) found electrical upgrades needed:',
    ...i.found.map((f) => `- ${f}`),
    `1. ${name} will quote the upgrades and book them with you directly. You pay them, not us.`,
    `2. You don't need to wait for the upgrades: confirm your safety check and pay your deposit now, then ${i.installer} will call you to book your install day.`,
    `${cents(i.depositCents / 100)} inc GST`,
  ];
  const after = [
    `The 30-day rule: Your insulation must be installed within 30 days of this check, or it has to be done again. Install by ${installBy}.`,
    contact,
    'Your signed safety check (PIESA) is attached.',
  ];
  return {
    subject: UPGRADES_NEEDED_SUBJECT,
    text: [...lines, `${BUTTON}: ${i.confirmUrl}`, ...after].join('\n\n'),
    html: genericMail({ subject: UPGRADES_NEEDED_SUBJECT, heading: UPGRADES_NEEDED_SUBJECT, lines, button: { url: i.confirmUrl, label: BUTTON }, afterButtonHtml: after.map(escHtml).join('<br /><br />'), unsubscribe: 'slot' }),
  };
}

/** #42 text, verbatim. */
export const upgradesNeededText = (first: string | null, electrician: string) =>
  `Home Insulation Victoria: Hi ${(first ?? '').trim() || 'there'}, your safety check found electrical upgrades needed. ${electrician} will quote and book them with you directly. Details in your email.`;
