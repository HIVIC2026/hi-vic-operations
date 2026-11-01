import { addMelbourneBusinessDays, addYmd, melbourneToday } from './melbourne-time.core';
export const LEAD_INSTALLER_BOOKING_REASON = 'Choose the Lead Installer to book. We need to name them on the ESC install notice at least 24 hours before the install.';
export const LEAD_INSTALLER_NOTICE_WAIT = 'Waiting for Home Insulation Victoria to update the ESC notice for your new Lead Installer.';
export type BookingWorker = { id:string; name:string; phone:string|null; tradeRole:string; workerRole?:string|null; cleared:boolean; reason:string|null; electricianVerified?:boolean; escRegistered?:boolean; escRegisteredAt?:string|null };
export function bookingWorkerBlocker(kind:string,w:BookingWorker|null):string|null {
  if(!w)return kind==='installation'?LEAD_INSTALLER_BOOKING_REASON:'Choose the person going before booking.';
  if(kind==='assessment'||kind==='rectification')return w.tradeRole==='electrician'&&w.electricianVerified?null:'Choose a verified electrician from your Team before booking the safety check.';
  if(kind!=='installation')return w.reason;
  if(w.tradeRole!=='installer'||w.workerRole!=='lead')return LEAD_INSTALLER_BOOKING_REASON;
  if(!w.cleared)return w.reason||'The office must verify this Lead Installer’s current CII certificate before booking.';
  if(!w.escRegistered||!w.escRegisteredAt)return 'The office must record this Lead Installer as an ESC-registered scheme participant before booking.';
  return w.reason;
}
export type LeadChange = {id:string;start:string;at:string};
export function leadNoticePending(change:LeadChange|null,ack:string|null,now=new Date()):boolean {
  return !!change&&ack!==change.id&&melbourneToday(new Date(change.at))===melbourneToday(new Date(change.start))&&melbourneToday(now)>=melbourneToday(new Date(change.start));
}
export function bookingNotice(i:{kind:'ready_check'|'piesa'|'install';start:string;who:Pick<BookingWorker,'name'|'phone'>;installer:string;phone:string|null}) {
  const label={ready_check:'Ready Check',piesa:'Pre Insulation Electrical Safety Assessment (PIESA)',install:'install'}[i.kind];
  const when=new Date(i.start).toLocaleString('en-AU',{timeZone:'Australia/Melbourne',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit'});
  const person=`${i.who.name}${i.kind==='install'?' (Lead Installer)':''}${i.who.phone?`, phone ${i.who.phone}`:''}`;
  const text=`You're booked for your ${label}: ${when}. Who's coming: ${person}. Need a different time? Call ${i.installer} on ${i.phone||'the number in your booking details'}.`;
  return {subject:`You're booked — ${label}`,text,sms:`You're booked for your ${label}: ${when}. ${person} is coming. Details in your email.`};
}
export type DigestInstall={jobId:string;jobNumber:string;start:string;name:string;url:string};
export function tomorrowInstallDigest(rows:DigestInstall[],now=new Date()):DigestInstall[]{
  const hour=Number(new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Melbourne',hour:'numeric',hour12:false}).format(now))%24;
  if(hour<14)return [];
  const tomorrow=addYmd(melbourneToday(now),1);
  return rows.filter(r=>melbourneToday(new Date(r.start))===tomorrow).sort((a,b)=>a.start.localeCompare(b.start));
}
export function bookingOverdue(givenAt:string|null,booked:boolean,now=new Date()):boolean {
  return !!givenAt&&!booked&&Number.isFinite(Date.parse(givenAt))&&now.getTime()>Date.parse(addMelbourneBusinessDays(givenAt,2));
}