// Electrical safety check (PIESA) owner emails (Jo 24 Oct 2026, decisions 94 and 137).
// "Pick a time" design approved: docs/templates/approved/O26-safety-check-times.html — "{First}, pick a time for your
// electrical safety check"; "{Electrician}, a licensed electrician, has offered these times"; 3 time buttons; Suggest
// other days; the red "⏰ The 30-day clock" box; "At your safety check". The booked email mirrors the Ready Check
// "You're booked" email (decision 81) with the electrician's name/phone, the switchboard line and the 30-day box.
// Sent through approved-owner-emails.server.ts; SAFETY_CHECK_EMAILS_APPROVED is on (decision 94), real delivery behind customer_comms_enabled. Pure.
import * as K from "./email-kit.core";
import { splitDayTime, type ReadyCheckTimeSlot } from "./ready-check-times-email.core";

/** Jo 24 Oct 2026, decision 94 (O26 safety check times + the mirrored booked email): approved. Delivery still behind customer_comms_enabled. */
export const SAFETY_CHECK_EMAILS_APPROVED = true as boolean;

export type SafetyCheckTimesInput = {
  firstName: string | null; electricianName: string | null; times: Array<string | ReadyCheckTimeSlot>; myJobUrl: string;
  /** Amount already paid for the check (e.g. 349). */
  paid?: number | null; test?: boolean;
};

export function renderSafetyCheckTimesEmail(i: SafetyCheckTimesInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const el = i.electricianName?.trim() || "Your electrician";
  const subject = "Pick a time for your electrical safety check";
  const headline = `${first}, pick a time for your electrical safety check`;
  const intro = `${el}, a licensed electrician, has offered these times. Tap the one that suits you and it's booked.`;
  const slots = i.times.map((t) => (typeof t === "string" ? splitDayTime(t) : t)).map((t) => ({ day: t.day, time: t.time, href: t.href || i.myJobUrl }));
  const at = `The electrician checks your switchboard, ceiling wiring and downlights are safe to insulate over.${i.paid && i.paid > 0 ? ` It's already paid for (${K.cents(i.paid)}).` : ""} If anything needs fixing, we'll send you a separate quote first. Nothing is done without your OK.`;
  const body = [K.h1(headline), K.p(intro), K.tapTimeButtons(slots, { href: i.myJobUrl }), K.thirtyDayClockBox({ kind: "safety_check" }), K.sectionTitle("At your safety check"), K.p(at)].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([headline, "", intro, "", ...slots.map((s) => `• ${s.day}${s.time ? ` ${s.time}` : ""}`), `Pick a time: ${i.myJobUrl}`, `None suit? Suggest other days: ${i.myJobUrl}`, "", K.THIRTY_DAY_CLOCK_TEXT(), "", "AT YOUR SAFETY CHECK", at], { testLabel: i.test === true });
  return { subject, html, text };
}

export type SafetyCheckBookedInput = {
  firstName: string | null; when: string; electricianName: string | null; electricianPhone?: string | null; address?: string | null; changed: boolean; myJobUrl: string; test?: boolean;
};

export function renderSafetyCheckBookedEmail(i: SafetyCheckBookedInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = i.changed ? `Your electrical safety check time has changed – ${i.when}` : `You're booked: electrical safety check – ${i.when}`;
  const headline = i.changed ? `Your new safety check time, ${first}` : `You're booked, ${first}`;
  const lead = i.changed ? "Your electrical safety check has a new time." : "Your electrical safety check is confirmed.";
  const { day, time } = splitDayTime(i.when);
  const el = i.electricianName?.trim() || null;
  const phone = i.electricianPhone?.trim() || null;
  const lines = [i.address?.trim() || null, el ? `Electrician: ${el}${phone ? ` · ${phone}` : ""}` : null].filter((l): l is string => !!l);
  const before = [
    "Make sure the electrician can reach your <strong>switchboard</strong> and your <strong>ceiling hatch</strong> (clear anything underneath it).",
    "If you have <strong>pets</strong>, keep them away from the work area.",
    "Have a think about any <strong>questions</strong> you'd like to ask.",
  ];
  const change = `Need a different time? Tap <strong>Change time</strong> on your job page and the electrician will offer new times.${el ? ` Or call or text ${K.esc(el)}${phone ? ` on ${K.esc(phone)}` : ""}.` : ""}`;
  const body = [K.h1(headline), K.p(lead), K.dateCard({ label: i.changed ? "Your new safety check time" : "Your electrical safety check", day, time, lines }), K.thirtyDayClockBox({ kind: "safety_check" }), K.sectionTitle("Before they arrive", "24px 0 10px"), K.checkList(before), K.p(change, "6px 0 4px", true), K.button(i.myJobUrl, "See my job")].join("\n");
  const html = K.emailShell({ body, previewText: `${lead} ${i.when}`, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([headline, "", lead, `When: ${i.when}`, ...lines, "", K.THIRTY_DAY_CLOCK_TEXT(), "", "BEFORE THEY ARRIVE", ...before.map((b) => `✓ ${K.stripTags(b)}`), "", K.stripTags(change), `See my job: ${i.myJobUrl}`], { testLabel: i.test === true });
  return { subject, html, text };
}
