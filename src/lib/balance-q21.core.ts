import {addMelbourneCalendarDays,addYmd,melbourneToday} from './melbourne-time.core';
export const BALANCE_DUE_DAYS=7;
export function balanceDueAt(completedAt:string|null|undefined):string|null{
 return completedAt&&Number.isFinite(Date.parse(completedAt))?addMelbourneCalendarDays(completedAt,BALANCE_DUE_DAYS):null;
}
export function balanceReminderDue(completedAt:string|null,paid:boolean,now:Date):'day5'|'due'|null{
 if(!completedAt||paid)return null;
 const day=melbourneToday(new Date(completedAt)),today=melbourneToday(now);
 return today===addYmd(day,5)?'day5':today===addYmd(day,7)?'due':null;
}
export function balanceOverdue(completedAt:string|null,paid:boolean,now:Date):boolean{
 const due=balanceDueAt(completedAt);return !paid&&!!due&&now.getTime()>Date.parse(due);
}