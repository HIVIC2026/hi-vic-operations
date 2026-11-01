import { melbourneToday } from './melbourne-time.core';

export const INSTALL_DEPOSIT_REQUEST_EVENT = 'install_deposit_requested';
export const installDepositRequestKey = (invoiceId:string) => `install-deposit:v1:${invoiceId}`;
export type DepositReminder = 'day3'|'day7';
export function depositReminderDue(f:{requestedAt:string|null;paid:boolean;now:Date}):DepositReminder|null {
  if(f.paid || !f.requestedAt)return null;
  const days=(f.now.getTime()-Date.parse(f.requestedAt))/86_400_000;
  return days>=7?'day7':days>=3?'day3':null;
}
/** Task 6 requests only after actual electrical completion, never on the electrician-at-install shortcut. */
export function depositRequestEligible(f:{cleared:boolean;basis:string|null;paid:boolean;booked:boolean;deadline:string|null;now:Date}):boolean {
  return f.cleared && (f.basis==='initial_piesa'||f.basis==='section_c') && !f.paid && !f.booked && !!f.deadline && melbourneToday(f.now)<=f.deadline;
}