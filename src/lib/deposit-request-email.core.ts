import { bankDetailLines, type BankDetails } from './payments.core';
import { cents } from './email-kit.core';
import { genericMail } from './mail-mjml.core';
import { weekdayDayMonthLabel } from './owner-email-triggers.core';
import type { DepositReminder } from './deposit-request.core';

export type DepositMessageFacts={name:string;installer:string;jobNumber:string;address:string;ownerPhone:string|null;deadline:string;amountCents:number;link:string;bank:BankDetails;reference:string|null;card:boolean};
export function depositOwnerText(f:DepositMessageFacts,step:'request'|'paid'|DepositReminder):string {
  if(step==='paid')return `Deposit received, ${f.installer} will call you to book your install day.`;
  if(step==='request')return `You're clear to install, ${f.name}! Please check your email to pay your deposit so ${f.installer} can book your install day.`;
  return `Deposit reminder, ${f.name}: please check your email to pay your deposit so ${f.installer} can book your install day.`;
}
export function renderInstallDepositOwnerEmail(f:DepositMessageFacts,step:'request'|'paid'|DepositReminder) {
  const deadline=weekdayDayMonthLabel(f.deadline)??f.deadline;
  const subject=step==='paid'?'Deposit received':step==='request'?'Your 10% install deposit':'Your install deposit reminder';
  const lines=step==='paid'?[`Deposit received, ${f.installer} will call you to book your install day.`,`Your installation must start by ${deadline} (30-day limit).`]:[
    `You're clear to install, ${f.name}!`,
    `${step==='request'?'Please pay':'Reminder: please pay'} your 10% install deposit of ${cents(f.amountCents/100)} inc GST against your existing installation invoice so ${f.installer} can book your install day.`,
    f.card?'Pay by card (Stripe) or bank transfer.':'Pay by bank transfer.',
    ...bankDetailLines(f.bank,f.reference),
    `Your installation must start by ${deadline} (30-day limit).`,
    'The rest is due within 7 days of your install.',
  ];
  return {subject,text:lines.join('\n\n')+(step==='paid'?'':`\n\nPay my deposit: ${f.link}`),html:genericMail({subject,heading:subject,lines,button:step==='paid'?undefined:{url:f.link,label:'Pay my deposit'},unsubscribe:'slot'})};
}
export function renderInstallerDepositPaidEmail(f:DepositMessageFacts) {
  const date=weekdayDayMonthLabel(f.deadline)??f.deadline;
  const text=`${f.jobNumber} ${f.name}, ${f.address}: deposit paid. Call the owner and book the install day by ${date} (30-day limit). Phone: ${f.ownerPhone??'not recorded'}.`;
  return{subject:`${f.jobNumber}: deposit paid`,text,html:genericMail({subject:`${f.jobNumber}: deposit paid`,heading:'Deposit paid',lines:[text]})};
}