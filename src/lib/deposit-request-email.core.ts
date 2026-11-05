import { bankDetailLines, type BankDetails } from './payments.core';
import { REST_DUE_SENTENCE, restDueWithAmount } from './owner-wording.core';
import { cents, esc } from './email-kit.core';
import { genericMail } from './mail-mjml.core';
import { weekdayDayMonthLabel } from './owner-email-triggers.core';
import type { DepositReminder } from './deposit-request.core';
import { CLEAR_TO_INSTALL_EMAIL_APPROVED } from './piesa-result-route.core';

export type DepositMessageFacts={name:string;installer:string;jobNumber:string;address:string;ownerPhone:string|null;deadline:string;amountCents:number;link:string;bank:BankDetails;reference:string|null;card:boolean;
  /** "You're clear to install" (#40) extras; all four are needed for the new wording. */
  firstName?:string;checkedOn?:string;electrician?:string;upgrades?:'None'|'Done';
  /** #43/#44/#45 (Task 6): installer OFFICE phone, balance due on install day, the plan's 10% deposit, upgrades still to come, full owner name, installer portal link. */
  officePhone?:string|null;balanceCents?:number;depositCents?:number;upgradesToCome?:boolean;ownerFullName?:string;bookUrl?:string};
/** Task 6: Jo's approved #43/#44/#45 wording. Off: the current reminder, Deposit received and office wording go out unchanged. */
export const DEPOSIT_MESSAGES_V2_APPROVED=false as boolean;
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
    'Confirm your safety check and pay your deposit',
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
/** #43 (dep-rem-p.png): day 3 and day 7 share one wording. Upgrades still to come: the opening "You're clear to install." is dropped. */
function renderReminderV2(f:DepositMessageFacts){
  const subject='Reminder: one last step to book your install';
  const deadline=weekdayDayMonthLabel(f.deadline)??f.deadline;
  const ask=`Confirm your safety check and pay your deposit, then ${f.installer} will call you to book your install day. It takes about a minute.`;
  const lines=[f.upgradesToCome?ask:`You're clear to install. ${ask}`,`${cents(f.amountCents/100)} inc GST`];
  const after=['Card or bank transfer.',`Install by ${deadline}.`,REST_DUE_SENTENCE];
  const label='Confirm and pay my deposit';const url=f.link.replace('screen=pay','screen=clear');
  return{subject,text:[...lines,`${label}: ${url}`,...after].join('\n\n'),html:genericMail({subject,heading:subject,lines,button:{url,label},afterButtonHtml:after.map(escHtml).join('<br /><br />'),unsubscribe:'slot'})};
}
/** #44 (dep-paid-p.png): needs the office phone and the balance; the receipt line only when a receipt is really attached. */
export const paidV2Ready=(f:DepositMessageFacts)=>!!f.officePhone?.trim()&&typeof f.balanceCents==='number';
function renderPaidV2(f:DepositMessageFacts,receiptAttached:boolean){
  const subject='Deposit received, thanks!';
  const deadline=weekdayDayMonthLabel(f.deadline)??f.deadline;
  const lines=[
    `We've got your ${cents((f.depositCents??f.amountCents)/100)} deposit. ${f.installer} will call you from ${f.officePhone} to book your install day.`,
    `Install by ${deadline} (30-day rule).`,
    restDueWithAmount(cents((f.balanceCents??0)/100)),
    ...(receiptAttached?['Your receipt is attached.']:[]),
  ];
  return{subject,text:lines.join('\n\n'),html:genericMail({subject,heading:subject,lines,unsubscribe:'slot'})};
}
export function renderInstallDepositOwnerEmail(f:DepositMessageFacts,step:'request'|'paid'|DepositReminder,approved:boolean=CLEAR_TO_INSTALL_EMAIL_APPROVED,v2:boolean=DEPOSIT_MESSAGES_V2_APPROVED,opts:{receiptAttached?:boolean}={}) {
  if(isClearToInstall(f,step,approved))return renderClearToInstall(f);
  if(v2&&(step==='day3'||step==='day7'))return renderReminderV2(f);
  if(v2&&step==='paid'&&paidV2Ready(f))return renderPaidV2(f,opts.receiptAttached===true);
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
/** #45 (dep-inst-p.png): the office is told the deposit is in and to book the install. */
function renderInstallerPaidV2(f:DepositMessageFacts){
  const first=f.name.split(' ')[0]||'the owner';
  const full=f.ownerFullName||f.name;
  const date=weekdayDayMonthLabel(f.deadline)??f.deadline;
  const subject=`${f.jobNumber}: deposit in, ready to book`;
  const heading=`Good news: ${first}'s deposit is in 🎉`;
  const lead=`${f.jobNumber} is ready to book. Give ${first} a call, agree the install day, then add it and your Lead Installer on the job.`;
  const rows:[string,string][]=[['Owner',full],['Phone',f.ownerPhone??'not recorded'],['Address',f.address],['Install by',date]];
  const label='Book the install';const url=f.bookUrl??'';
  const rest=`${first} pays the rest on install day.`;
  const table=`<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows.map(([k,v])=>`<tr><td style="padding:2px 16px 2px 0;color:#667;">${esc(k)}</td><td style="padding:2px 0;"><strong>${esc(v)}</strong></td></tr>`).join('')}</table>`;
  const text=[heading,lead,...rows.map(([k,v])=>`${k}: ${v}`),...(url?[`${label}: ${url}`]:[]),rest].join('\n\n');
  return{subject,text,html:genericMail({subject,heading,bodyHtml:`${esc(lead)}<br /><br />${table}`,...(url?{button:{url,label}}:{}),afterButtonHtml:esc(rest)})};
}
export function renderInstallerDepositPaidEmail(f:DepositMessageFacts,v2:boolean=DEPOSIT_MESSAGES_V2_APPROVED) {
  if(v2)return renderInstallerPaidV2(f);
  const date=weekdayDayMonthLabel(f.deadline)??f.deadline;
  const text=`${f.jobNumber} ${f.name}, ${f.address}: deposit paid. Call the owner and book the install day by ${date} (30-day limit). Phone: ${f.ownerPhone??'not recorded'}.`;
  return{subject:`${f.jobNumber}: deposit paid`,text,html:genericMail({subject:`${f.jobNumber}: deposit paid`,heading:'Deposit paid',lines:[text]})};
}