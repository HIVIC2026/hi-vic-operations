import { addYmd, melbourneToday } from './melbourne-time.core';
import { IN_HOUSE_ELECTRICIAN_BOOKING_BLOCKER } from './worker-compliance.core';
import { OWNER_BOOKED_V2_APPROVED, ownerBookedNotice, type BookedKind } from './owner-booked-notice.core';
import type { TradeContact } from './owner-will-call.core';
export { OWNER_BOOKED_V2_APPROVED };
export function emptyBookingTeamBlocker(kind:string,workers:BookingWorker[]):string|null {
  if((kind==='assessment'||kind==='rectification')&&!workers.some(w=>w.tradeRole==='electrician'&&w.electricianVerified))return IN_HOUSE_ELECTRICIAN_BOOKING_BLOCKER;
  if(kind==='installation'&&!workers.some(w=>bookingWorkerBlocker(kind,w)===null)){
    const waiting=workers.find(w=>w.tradeRole==='installer'&&w.workerRole==='lead'&&w.cleared&&!w.reason&&(!w.escRegistered||!w.escRegisteredAt));
    return waiting?registrationWaitingReason(waiting.name):NO_ELIGIBLE_LEAD_REASON;
  }
  return null;
}
export const LEAD_INSTALLER_BOOKING_REASON = 'Choose the Lead Installer to book. We need to name them on the ESC install notice at least 24 hours before the install.';
export const NO_ELIGIBLE_LEAD_REASON = 'Add a Lead Installer to your Team to book the install. ESC needs us to name a registered Lead Installer on the install notice at least 24 hours before.';
export const registrationWaitingReason=(name:string)=>`Waiting for Home Insulation Victoria to register ${name} with ESC. Every Lead Installer must be registered with ESC before we can lodge the install notice.`;
export const LEAD_INSTALLER_NOTICE_WAIT = 'Waiting for Home Insulation Victoria to update the ESC notice for your new Lead Installer.';
export type BookingWorker = { id:string; name:string; phone:string|null; tradeRole:string; workerRole?:string|null; cleared:boolean; reason:string|null; electricianVerified?:boolean; escRegistered?:boolean; escRegisteredAt?:string|null };
export function bookingWorkerBlocker(kind:string,w:BookingWorker|null):string|null {
  if(!w)return kind==='installation'?LEAD_INSTALLER_BOOKING_REASON:'Choose the person going before booking.';
  if(kind==='assessment'||kind==='rectification')return w.tradeRole==='electrician'&&w.electricianVerified?null:'Choose a verified electrician from your Team before booking the safety check.';
  if(kind!=='installation')return w.reason;
  if(w.tradeRole!=='installer'||w.workerRole!=='lead')return LEAD_INSTALLER_BOOKING_REASON;
  if(!w.cleared)return w.reason||'The office must verify this Lead Installer’s current CII certificate before booking.';
  if(!w.escRegistered||!w.escRegisteredAt)return registrationWaitingReason(w.name);
  return w.reason;
}
export type LeadChange = {id:string;start:string;at:string};
export function leadNoticePending(change:LeadChange|null,ack:string|null,now=new Date()):boolean {
  return !!change&&ack!==change.id&&now.getTime()>=Date.parse(change.start);
}
export function bookingNotice(i:{kind:'ready_check'|'piesa'|'install';start:string;who:Pick<BookingWorker,'name'|'phone'>;installer:string;phone:string|null}) {
  const label={ready_check:'Ready Check',piesa:'Pre Insulation Electrical Safety Assessment (PIESA)',install:'install'}[i.kind];
  const when=new Date(i.start).toLocaleString('en-AU',{timeZone:'Australia/Melbourne',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit'});
  const person=`${i.who.name}${i.kind==='install'?' (Lead Installer)':''}${i.who.phone?`, phone ${i.who.phone}`:''}`;
  const text=`You're booked for your ${label}: ${when}. Who's coming: ${person}. Need a different time? Call ${i.installer} on ${i.phone||'the number in your booking details'}.`;
  return {subject:`You're booked — ${label}`,text,sms:`You're booked for your ${label}: ${when}. ${person} is coming. Details in your email.`};
}
/** Owner "You're booked" message for an in-house visit. A kind whose OWNER_BOOKED_V2_APPROVED flag is on → the approved
 *  wording (owner-booked-notice.core: #24 Ready Check, #38 PIESA, #46 install; office phone only, held when the office phone
 *  or business email is missing); otherwise the current bookingNotice wording. `business` is the business coming: the
 *  installer, and for PIESA the ELECTRICIAN's (`installerName` then names who calls to book the install). */
export type OwnerBookedInput = Parameters<typeof bookingNotice>[0] & { ownerName: string|null; business: TradeContact|null; changed: boolean; test?: boolean; installerName?: string|null|undefined; installDeadline?: string|undefined; balanceCents?: number|null|undefined };
export function ownerBookedMessage(i:OwnerBookedInput,approved:Record<BookedKind,boolean>=OWNER_BOOKED_V2_APPROVED):
  {version:'v1';subject:string;text:string;sms:string}|{version:'v2';subject:string;text:string;html:string;sms:string}|{held:string} {
  if(approved[i.kind]){
    if(!i.business)return{held:i.kind==='piesa'?'No electrician business on file':'No installer business on file'};
    const n=ownerBookedNotice({kind:i.kind,firstName:i.ownerName,startIso:i.start,whoName:i.who.name,business:i.business,changed:i.changed,installerName:i.installerName,installDeadline:i.installDeadline,balanceCents:i.balanceCents},{test:i.test===true});
    return 'held' in n?n:{version:'v2',...n};
  }
  const old=bookingNotice(i);
  return{version:'v1',subject:old.subject,text:old.text,sms:old.sms};
}
export type DigestInstall={jobId:string;jobNumber:string;start:string;name:string;url:string};
export function tomorrowInstallDigest(rows:DigestInstall[],now=new Date()):DigestInstall[]{
  const hour=Number(new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Melbourne',hour:'numeric',hour12:false}).format(now))%24;
  if(hour<14)return [];
  const tomorrow=addYmd(melbourneToday(now),1);
  return rows.filter(r=>melbourneToday(new Date(r.start))===tomorrow).sort((a,b)=>a.start.localeCompare(b.start));
}
