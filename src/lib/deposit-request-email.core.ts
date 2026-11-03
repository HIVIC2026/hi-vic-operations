import { bankDetailLines, type BankDetails } from './payments.core';
import { REST_DUE_SENTENCE } from './owner-wording.core';
import { cents } from './email-kit.core';
import { genericMail } from './mail-mjml.core';
import { weekdayDayMonthLabel } from './owner-email-triggers.core';
import type { DepositReminder } from './deposit-request.core';
import { CLEAR_TO_INSTALL_EMAIL_APPROVED } from './piesa-result-route.core';

export type DepositMessageFacts={name:string;installer:string;jobNumber:string;address:string;ownerPhone:string|null;deadline:string;amountCents:number;link:string;bank:BankDetails;reference:string|null;card:boolean;
  /** "You're clear to install" (#40) extras; all four are needed for the new wording. */
  firstName?:string;checkedOn?:string;electrician?:string;upgrades?:'None'|'Done'};
export function depositOwnerText(f:DepositMessageFacts,step:'request'|'paid'|DepositReminder):string {
  if(step==='paid')return `Deposit received, ${f.installer} will call you to book your install day.`;
  if(step==='request')return `You're clear to install, ${f.name}! Please check your email to pay your deposit so ${f.installer} can book your install day.`;
  return `Deposit reminder, ${f.name}: please check your email to pay your deposit so ${f.installer} can book your install day.`;
}
const PIESA_ATTACHED_PARAGRAPH="Your signed safety check (PIESA) is attached. Please keep it: the VEU program says you must have it at least 24 hours before your install. Please don't let anyone into the ceiling before the install, or the check may need to be done again.";
/** True when the request email uses the approved #40 wording: flag on, first request, and the clear-to-install facts are known. */
export const isClearToInstall=(f:DepositMessageFacts,step:'request'|'paid'|DepositReminder,approved:boolean)=>approved&&step==='request'&&!!f.checkedOn&&!!f.electrician&&!!f.upgrades;
/** #40 (Jo 2 Nov 2026, clear.png): PIESA all clear (or upgrades done on the day) + the one confirm-and-pay button. */
function renderClearToInstall(f:DepositMessageFacts){
  const subject="You're clear to install";
  const deadline=weekdayDayMonthLabel(f.deadline)??f.deadline;
  const checked=weekdayDayMonthLabel(f.checkedOn)??f.checkedOn??'';
  const first=(f.firstName||f.name||'there').trim();
  const lines=[
    `${first},`,
    'Your electrical safety check (PIESA) is all clear. One last step to book your install day:',
    'Confirm your safety check and pay your 10% deposit',
    `${cents(f.amountCents/100)} inc GST`,
  ];
  const after=[
    `Takes about a minute. Card or bank transfer. Then ${f.installer} will call you to book your install day.`,
    `Checked on: ${checked}`,
    `Electrician: ${f.electrician}`,
    `Electrical upgrades needed: ${f.upgrades}`,
    `Install by ${deadline}. The rebate rules need your insulation in within 30 days of the safety check. ${REST_DUE_SENTENCE}`,
    PIESA_ATTACHED_PARAGRAPH,
  ];
  const label='Confirm and pay my deposit';
  return{subject,text:[...lines,`${label}: ${f.link}`,...after].join('\n\n'),html:genericMail({subject,heading:subject,lines,button:{url:f.link,label},afterButtonHtml:after.map(escHtml).join('<br /><br />'),unsubscribe:'slot'})};
}
const escHtml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function renderInstallDepositOwnerEmail(f:DepositMessageFacts,step:'request'|'paid'|DepositReminder,approved:boolean=CLEAR_TO_INSTALL_EMAIL_APPROVED) {
  if(isClearToInstall(f,step,approved))return renderClearToInstall(f);
  const deadline=weekdayDayMonthLabel(f.deadline)??f.deadline;
  const subject=step==='paid'?'Deposit received':step==='request'?'Your 10% install deposit':'Your install deposit reminder';
  const lines=step==='paid'?[`Deposit received, ${f.installer} will call you to book your install day.`,`Your installation must start by ${deadline} (30-day limit).`,REST_DUE_SENTENCE]:[
    `You're clear to install, ${f.name}!`,
    `${step==='request'?'Please pay':'Reminder: please pay'} your 10% install deposit of ${cents(f.amountCents/100)} inc GST against your existing installation invoice so ${f.installer} can book your install day.`,
    f.card?'Pay by card (Stripe) or bank transfer.':'Pay by bank transfer.',
    ...bankDetailLines(f.bank,f.reference),
    `Your installation must start by ${deadline} (30-day limit).`,
    REST_DUE_SENTENCE,
  ];
  return {subject,text:lines.join('\n\n')+(step==='paid'?'':`\n\nPay my deposit: ${f.link}`),html:genericMail({subject,heading:subject,lines,button:step==='paid'?undefined:{url:f.link,label:'Pay my deposit'},unsubscribe:'slot'})};
}
export function renderInstallerDepositPaidEmail(f:DepositMessageFacts) {
  const date=weekdayDayMonthLabel(f.deadline)??f.deadline;
  const text=`${f.jobNumber} ${f.name}, ${f.address}: deposit paid. Call the owner and book the install day by ${date} (30-day limit). Phone: ${f.ownerPhone??'not recorded'}.`;
  return{subject:`${f.jobNumber}: deposit paid`,text,html:genericMail({subject:`${f.jobNumber}: deposit paid`,heading:'Deposit paid',lines:[text]})};
}