// Jo 24 Oct 2026 (decisions 52–53, 77): when the installer offers Ready Check times, the owner gets a link to pick one.
// Design approved (decision 77): docs/templates/owner/O11-ready-check-times.html — "{First}, pick a time for your
// free Ready Check"; the 3 offered times as tap buttons; "None suit? Suggest other days"; "At your Ready Check";
// two-figure price box; included / not included. READY_CHECK_TIMES_EMAIL_APPROVED is on (decision 77); real delivery
// still needs customer_comms_enabled through the guarded owner-email path. Pure.
import * as K from "./email-kit.core";

/** Jo 24 Oct 2026, decision 77 (O11 pick a time for your free Ready Check): approved. Delivery still behind customer_comms_enabled. */
export const READY_CHECK_TIMES_EMAIL_APPROVED = true as boolean;

export type ReadyCheckTimeSlot = { day: string; time: string; href?: string | null };
export type ReadyCheckTimesInput = {
  firstName: string | null;
  /** Offered times: day + time (tap buttons) or pre-formatted strings. */
  times: Array<string | ReadyCheckTimeSlot>;
  installerName: string | null; suburb?: string | null; myJobUrl: string;
  /** Saved-spot figures for the price box (omitted when unknown). */
  estimate?: { rebate: number; price: number; areaM2: number } | null;
  test?: boolean;
};

/** "Tuesday 28 October at 8:00am" → { day, time }. */
export function splitDayTime(s: string): ReadyCheckTimeSlot {
  const m = /^(.*?)\s+at\s+(\S+)$/.exec(s.trim());
  return m ? { day: m[1]!, time: m[2]! } : { day: s.trim(), time: "" };
}

export function renderReadyCheckTimesEmail(i: ReadyCheckTimesInput) {
  const subject = "Choose a time for your free Ready Check";
  const first = K.cleanName(i.firstName) ?? "there";
  const headline = `${first}, pick a time for your free Ready Check`;
  const where = i.suburb?.trim() ? ` near ${i.suburb.trim()}` : "";
  const intro = `Good news: a certified installer${where} is ready for you. Tap the time that suits you and it's booked.`;
  const slots = i.times.map((t) => (typeof t === "string" ? splitDayTime(t) : t)).map((t) => ({ day: t.day, time: t.time, href: t.href || i.myJobUrl }));
  const at = "The installer measures your ceiling, checks your existing insulation and access, and confirms your exact price. It's free, with no payment and no obligation.";
  const est = i.estimate && i.estimate.price > 0 ? i.estimate : null;
  const body = [
    K.h1(headline),
    K.p(intro),
    K.tapTimeButtons(slots, { href: i.myJobUrl }),
    K.sectionTitle("At your Ready Check"),
    K.p(at),
    est ? `${K.twoFigureBox({ rebate: est.rebate, price: est.price, note: `Estimate incl. GST for ${K.m2(est.areaM2)}. Confirmed at your free Ready Check.` })}\n${K.spacer(8)}\n${K.includedAndNotIncluded({ price: est.price, rebate: est.rebate })}` : "",
  ].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([
    headline, "", intro, "",
    ...slots.map((s) => `• ${s.day}${s.time ? ` ${s.time}` : ""}`),
    `Pick a time: ${i.myJobUrl}`, `None suit? Suggest other days: ${i.myJobUrl}`, "",
    "AT YOUR READY CHECK", at,
    ...(est ? ["", `VEU rebate: ${K.whole(est.rebate)} · You pay about: ${K.whole(est.price)} (estimate incl. GST for ${K.m2(est.areaM2)}, confirmed at your free Ready Check)`, "", ...K.includedAndNotIncludedText({ price: est.price, rebate: est.rebate })] : []),
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
