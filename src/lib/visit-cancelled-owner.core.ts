// Part 4 Task 8 (Jo, 2 Nov 2026, answer 4; cl 24): when a trade drops a booked visit ("Can't do this one"), the owner is
// emailed straight away, before the office decides who takes the job. Pure wording + keys only.
// The line is Jo's, verbatim: "Your visit on {day} can't go ahead. We'll be in touch about a new day."
// The subject and the "Hi {first}," greeting are DRAFTS for Jo (shown to her as a picture before the flag turns on).
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";

/** Flip to true only when Jo approves the subject + greeting on the picture. Off: nothing is sent to real owners (TEST jobs still test-send). */
export const VISIT_CANCELLED_OWNER_APPROVED = false as boolean;
export const VISIT_CANCELLED_PURPOSE = "visit_cant_go_ahead";
/** Recorded once per booking, before the send. */
export const VISIT_CANCELLED_EVENT = "visit_cancelled_owner_notice";
/** Jo's line, verbatim. `day` is "Fri 13 Nov". */
export const VISIT_CANT_GO_AHEAD_LINE = (day: string) => `Your visit on ${day} can't go ahead. We'll be in touch about a new day.`;
/** One email per booking, ever. */
export const visitCancelledKey = (bookingId: string) => `visit-cancelled:v1:${bookingId}`;

/** "Fri 13 Nov" in Melbourne time. */
export function visitCancelledDay(iso: string): string {
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("weekday")} ${g("day")} ${g("month")}`;
}

export function visitCancelledOwnerEmail(i: { firstName: string | null; startIso: string; test?: boolean }): { subject: string; text: string; html: string } {
  // Suite look (Jo 5 Nov 2026): greeting line, big heading (the draft subject), Jo's line. No other words.
  const day = visitCancelledDay(i.startIso);
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = `Your visit on ${day} can't go ahead`; // draft for Jo
  const greeting = `Hi ${first},`; // draft for Jo
  const line = VISIT_CANT_GO_AHEAD_LINE(day);
  const body = `<mj-section><mj-column><mj-text mj-class="hi">${esc(greeting)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(subject)}</mj-text><mj-text>${esc(line)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview: line, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([greeting, "", subject, "", line], { testLabel: i.test === true });
  return { subject, text, html };
}
