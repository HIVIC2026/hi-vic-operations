import { melbourneToday } from './melbourne-time.core';
import { depositOpenAfterPiesa, type PiesaOutcome } from './piesa-result-route.core';

export const INSTALL_DEPOSIT_REQUEST_EVENT = 'install_deposit_requested';
export const installDepositRequestKey = (invoiceId:string) => `install-deposit:v1:${invoiceId}`;
export type DepositReminder = 'day3'|'day7';
export function depositReminderDue(f:{requestedAt:string|null;paid:boolean;now:Date}):DepositReminder|null {
  if(f.paid || !f.requestedAt)return null;
  const days=(f.now.getTime()-Date.parse(f.requestedAt))/86_400_000;
  return days>=7?'day7':days>=3?'day3':null;
}
/** Jo 2 Nov 2026 (answer 21): the deposit is requested as soon as the PIESA result is in, including when electrical upgrades
 *  are still to come (replaces the 26 Oct "fixes signed off first" order). Booking the install day still needs it paid. */
export function depositRequestEligible(f:{piesaOutcome:PiesaOutcome|null;paid:boolean;booked:boolean;deadline:string|null;now:Date}):boolean {
  return depositOpenAfterPiesa({outcome:f.piesaOutcome}) && !f.paid && !f.booked && !!f.deadline && melbourneToday(f.now)<=f.deadline;
}
