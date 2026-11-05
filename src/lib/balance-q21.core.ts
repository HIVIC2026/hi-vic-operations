import {addMelbourneCalendarDays,endOfMelbourneYmd,melbourneToday} from './melbourne-time.core';
/** Legacy clock (Q21, before Part 5b): 7 days after recorded completion. Still used for installs booked before the cutover
 *  and for the office "Balance overdue" row (after-install-reminders.core). */
export const BALANCE_DUE_DAYS=7;
/** Part 5b (Jo 1–5 Nov 2026): the balance (90%) is due ON INSTALL DAY. Installs booked before this moment keep the legacy
 *  date, so nobody's agreed due date moves under them. No flag column: the booking's own created_at decides. */
export const BALANCE_INSTALL_DAY_FROM='2026-11-06T00:00:00+11:00';
export type BalanceRule='install_day'|'legacy_7_days';
export type BalanceRuleFacts={bookedAt?:string|null;completedAt?:string|null};
const t=(v:string|null|undefined)=>v&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
/** Which clock applies: the install booking's time (created_at), else the completion time; nothing known = the new rule. */
export function balanceRule(f:BalanceRuleFacts={}):BalanceRule{
 const at=t(f.bookedAt)??t(f.completedAt);
 return at!=null&&at<Date.parse(BALANCE_INSTALL_DAY_FROM)?'legacy_7_days':'install_day';
}
/** When the balance falls due (ISO). New rule: end of install day in Melbourne; legacy: 7 calendar days after completion. */
export function balanceDueAt(completedAt:string|null|undefined,f:BalanceRuleFacts={}):string|null{
 if(!completedAt||!Number.isFinite(Date.parse(completedAt)))return null;
 return balanceRule({completedAt,...f})==='install_day'?endOfMelbourneYmd(melbourneToday(new Date(completedAt))):addMelbourneCalendarDays(completedAt,BALANCE_DUE_DAYS);
}
/** Install day (Melbourne date). The owner-facing due date under both rules. */
export function balanceDueDay(completedAt:string|null|undefined):string|null{
 return completedAt&&Number.isFinite(Date.parse(completedAt))?melbourneToday(new Date(completedAt)):null;
}
// (balanceReminderDue — the day-5 / day-7 owner reminder rule — was retired 2 Nov 2026, Part 4 Task 14.)
/** Unpaid after the due moment: from the day after install day (new rule) or after the legacy 7 days. */
export function balanceOverdue(completedAt:string|null,paid:boolean,now:Date,f:BalanceRuleFacts={}):boolean{
 const due=balanceDueAt(completedAt,f);return !paid&&!!due&&now.getTime()>Date.parse(due);
}
