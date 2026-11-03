import {addMelbourneCalendarDays,melbourneToday} from './melbourne-time.core';
export const BALANCE_DUE_DAYS=7;
export function balanceDueAt(completedAt:string|null|undefined):string|null{
 return completedAt&&Number.isFinite(Date.parse(completedAt))?addMelbourneCalendarDays(completedAt,BALANCE_DUE_DAYS):null;
}
/** Install day (Melbourne date). The owner-facing due date; the overdue clock stays BALANCE_DUE_DAYS after it. */
export function balanceDueDay(completedAt:string|null|undefined):string|null{
 return completedAt&&Number.isFinite(Date.parse(completedAt))?melbourneToday(new Date(completedAt)):null;
}
// (balanceReminderDue — the day-5 / day-7 owner reminder rule — was retired 2 Nov 2026, Part 4 Task 14.)
export function balanceOverdue(completedAt:string|null,paid:boolean,now:Date):boolean{
 const due=balanceDueAt(completedAt);return !paid&&!!due&&now.getTime()>Date.parse(due);
}