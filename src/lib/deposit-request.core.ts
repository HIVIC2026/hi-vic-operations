import { melbourneToday } from './melbourne-time.core';
import { depositOpenAfterPiesa, type PiesaOutcome } from './piesa-result-route.core';

export const INSTALL_DEPOSIT_REQUEST_EVENT = 'install_deposit_requested';
export const installDepositRequestKey = (invoiceId:string) => `install-deposit:v1:${invoiceId}`;
export type DepositReminder = 'day1'|'day3'|'day7';
/** Default reminder offsets (days after the request). Part 5b: the one clear-to-install series passes [1, 3, 7] instead. */
export const DEPOSIT_REMINDER_DAYS:readonly number[] = [3,7];
/** The latest reminder day reached, or null. Each day's send is claimed once by its own key, so a missed earlier day is skipped. */
export function depositReminderDue(f:{requestedAt:string|null;paid:boolean;now:Date;days?:readonly number[]}):DepositReminder|null {
  if(f.paid || !f.requestedAt)return null;
  const days=(f.now.getTime()-Date.parse(f.requestedAt))/86_400_000;
  const reached=[...(f.days??DEPOSIT_REMINDER_DAYS)].filter(d=>d===1||d===3||d===7).sort((a,b)=>b-a).find(d=>days>=d);
  return reached?`day${reached}` as DepositReminder:null;
}
/** Jo 2 Nov 2026 (answer 21): the deposit is requested as soon as the PIESA result is in, including when electrical upgrades
 *  are still to come (replaces the 26 Oct "fixes signed off first" order). Booking the install day still needs it paid. */
export function depositRequestEligible(f:{piesaOutcome:PiesaOutcome|null;paid:boolean;booked:boolean;deadline:string|null;now:Date}):boolean {
  return depositOpenAfterPiesa({outcome:f.piesaOutcome}) && !f.paid && !f.booked && !!f.deadline && melbourneToday(f.now)<=f.deadline;
}
