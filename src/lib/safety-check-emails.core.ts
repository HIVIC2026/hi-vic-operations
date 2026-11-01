// Electrical safety check (PIESA) owner emails (Jo 24 Oct 2026, decisions 94 and 137).
// Designs: docs/templates/mjml/owner_O26.mjml and owner_safety-check-booked.mjml (MJML email refresh, Jo 27 Oct 2026) — "{First}, pick a time for your
// electrical safety check"; "{Electrician}, a licensed electrician, has offered these times"; 3 time buttons; Suggest
// other days; the amber "⏰ The 30-day clock" box; "At your safety check". The booked email mirrors the Ready Check
// "You're booked" email (decision 81) with the electrician's name/phone, the switchboard line and the 30-day box.
// Sent through approved-owner-emails.server.ts; SAFETY_CHECK_EMAILS_APPROVED is on (decision 94), real delivery behind customer_comms_enabled. Pure.
import { myJobScreen } from "./mail-mjml.core";
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";
import { mjTimeButtons, splitDayTime, type ReadyCheckTimeSlot } from "./ready-check-times-email.core";
import { mjBeforeRows, mjBookingBox } from "./ready-check-booked-email.core";

/** Jo 24 Oct 2026, decision 94 (O26 safety check times + the mirrored booked email): approved. Delivery still behind customer_comms_enabled. */
export const SAFETY_CHECK_EMAILS_APPROVED = true as boolean;

export type SafetyCheckTimesInput = {
  firstName: string | null; electricianName: string | null; times: Array<string | ReadyCheckTimeSlot>; myJobUrl: string;
  /** Amount already paid for the check (e.g. 349). */
  paid?: number | null; test?: boolean;
};

/** Amber "⏰ The 30-day clock" box (O26, safety check booked, O29, install window). `bodyHtml` is already safe HTML. */
export const mjThirtyDayClock = (bodyHtml: string) =>
  `<mj-section><mj-column mj-class="panel-amber"><mj-text mj-class="h2" color="#8A5200" padding="18px 18px 6px">&#9200; The 30-day clock</mj-text><mj-text font-size="15px" line-height="23px" padding="0 18px 18px">${bodyHtml}</mj-text></mj-column></mj-section>`;
/** Decision 137 wording; `expiresOn` (e.g. "5 December") gives the fixes-quote variant. Same words as THIRTY_DAY_CLOCK_TEXT. */
export const thirtyDayClockHtml = (expiresOn?: string | null) => expiresOn
  ? `<strong>Please approve this quickly.</strong> Your safety check expires 30 days after it was done (on <strong>${esc(expiresOn)}</strong>), and the fixes and the install both need to happen before then. If it expires, a new safety check is needed and may be charged.`
  : "<strong>Your install must happen within 30 days of this safety check.</strong> After 30 days the check expires and has to be done again, and a new check may be charged. So once it's done, please book your install day as soon as the installer offers times, and approve any electrical fixes quickly.";

export function renderSafetyCheckTimesEmail(i: SafetyCheckTimesInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const el = i.electricianName?.trim() || "Your electrician";
  const subject = "Pick a time for your electrical safety check";
  const headline = `${first}, pick a time for your electrical safety check`;
  const intro = `${el}, a licensed electrician, has offered these times. Tap the one that suits you and it's booked.`;
  const pick = myJobScreen(i.myJobUrl, "book");
  const slots = i.times.map((t) => (typeof t === "string" ? splitDayTime(t) : t)).map((t) => ({ day: t.day, time: t.time, href: t.href || pick }));
  const paid = i.paid && i.paid > 0 ? i.paid : null;
  const n = slots.length;
  const preview = `${el} has offered ${n} time${n === 1 ? "" : "s"}. Tap one and it's booked${paid ? " – it's already paid for" : ""}.`;
  const at = `The electrician checks your switchboard, ceiling wiring and downlights are safe to insulate over.${paid ? ` It's already paid for (${K.cents(paid)}).` : ""} If anything needs fixing, we'll send you a separate quote first. Nothing is done without your OK.`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    mjTimeButtons(slots, pick),
    mjThirtyDayClock(thirtyDayClockHtml()),
    `<mj-section><mj-column><mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 6px">At your safety check</mj-text><mj-text padding="0 12px 0">${esc(at)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([headline, "", intro, "", ...slots.map((s) => `• ${s.day}${s.time ? ` ${s.time}` : ""}`), `Pick a time: ${pick}`, `None suit? Suggest other days: ${pick}`, "", K.THIRTY_DAY_CLOCK_TEXT(), "", "AT YOUR SAFETY CHECK", at], { testLabel: i.test === true });
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
  const address = i.address?.trim() || null;
  const lines = [address, el ? `Electrician: ${el}${phone ? ` · ${phone}` : ""}` : null].filter((l): l is string => !!l);
  const preview = el && address ? `${el} will come to ${address}. Here's how to get ready.` : `${lead} ${i.when}`;
  const before = [
    "Make sure the electrician can reach your <strong>switchboard</strong> and your <strong>ceiling hatch</strong> (clear anything underneath it).",
    "If you have <strong>pets</strong>, keep them away from the work area.",
    "Have a think about any <strong>questions</strong> you'd like to ask.",
  ];
  const change = `Need a different time? Tap <strong>Change time</strong> on your job page and the electrician will offer new times.${el ? ` Or call or text ${esc(el)}${phone ? ` on ${esc(phone)}` : ""}.` : ""}`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(lead)}</mj-text></mj-column></mj-section>`,
    mjBookingBox({ label: i.changed ? "Your new safety check time" : "Your electrical safety check", day, time, lines }),
    mjThirtyDayClock(thirtyDayClockHtml()),
    `<mj-section><mj-column><mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 10px">Before they arrive</mj-text><mj-table padding="0 12px 6px">${mjBeforeRows(before)}</mj-table><mj-text>${change}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([headline, "", lead, `When: ${i.when}`, ...lines, "", K.THIRTY_DAY_CLOCK_TEXT(), "", "BEFORE THEY ARRIVE", ...before.map((b) => `✓ ${K.stripTags(b)}`), "", K.stripTags(change), `See my job: ${i.myJobUrl}`], { testLabel: i.test === true });
  return { subject, html, text };
}
