// Jo 24 Oct 2026 (decisions 52–53, 77): when the installer offers Ready Check times, the owner gets a link to pick one.
// Design: docs/templates/mjml/owner_O11.mjml (MJML email refresh, Jo 27 Oct 2026) — "{First}, pick a time for your
// free Ready Check"; the offered times as tap buttons; "None suit? Suggest other days"; "At your Ready Check"; rebate
// and price boxes; included / not included. READY_CHECK_TIMES_EMAIL_APPROVED is on (decision 77); real delivery
// still needs customer_comms_enabled through the guarded owner-email path. Pure.
import * as K from "./email-kit.core";
import { esc, mjEmail, plusRow, tickRow } from "./mail-mjml.core";

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

/** MJML tap-a-time buttons (day left, time right) plus "None suit? Suggest other days" (O11, O26). */
export function mjTimeButtons(times: { day: string; time: string; href: string }[], suggestHref: string): string {
  const a = (href: string, color: string, text: string) => `<a href="${esc(href)}" style="color:${color};font-weight:700;text-decoration:none;font-size:16px;">${text}</a>`;
  const rows = times.map((t) => `<tr><td style="padding:0 0 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #3C51C4;border-radius:14px;border-collapse:separate;"><tr><td style="padding:14px 16px;">${a(t.href, "#22376B", esc(t.day))}</td><td align="right" style="padding:14px 16px;white-space:nowrap;">${a(t.href, "#3C51C4", `${t.time ? `${esc(t.time)} ` : ""}&rsaquo;`)}</td></tr></table></td></tr>`).join("");
  return `<mj-section><mj-column><mj-table padding="4px 12px 4px">${rows}</mj-table><mj-text mj-class="small center" font-size="14px" padding="0 12px 18px">None suit? <a href="${esc(suggestHref)}" style="color:#3C51C4;font-weight:700;">Suggest other days</a></mj-text></mj-column></mj-section>`;
}

/** Saved-spot figures before the Ready Check (O11, O12): rebate box, price box, included / not included, closing line. */
export type ReadyCheckEstimate = { rebate: number; price: number; areaM2: number };
const estimateNote = (e: ReadyCheckEstimate) => `Estimate incl. GST for ${K.m2(e.areaM2)}. Confirmed at your free Ready Check.`;
const INCLUDED = (rebate: number) => [
  { title: "Licensed electrician safety check", detail: "Needed before any insulation goes in. They check your wiring, downlights and cables are safe." },
  { title: "Premium R5.0 ceiling batts", detail: "VEU-approved and made to Australian Standard AS/NZS 4859.1." },
  { title: "Fitted by an EEC-certified installer", detail: "A Certified Insulation Installer (CII) through the Energy Efficiency Council, working to Australian Standard AS 3999." },
  { title: "We handle the rebate", detail: `As a VEU Accredited Person (${K.AP_NUMBER}), we do the government paperwork. The ${K.whole(rebate)} comes straight off your price.` },
];
const NOT_INCLUDED: [string, string][] = [
  ["Removing old insulation", ", if any needs to come out"],
  ["Ceiling access fee", ", if your ceiling is hard to get into"],
  ["Electrical fixes", ", if the safety check finds any"],
  ["A bigger ceiling", " than you told us"],
];
const CLOSING = "You'll know your exact price before you agree to anything.";

export function mjReadyCheckEstimate(e: ReadyCheckEstimate): string {
  const inc = INCLUDED(e.rebate);
  return [
    `<mj-section><mj-column mj-class="panel-mint"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Your VEU rebate</mj-text><mj-text mj-class="big-green" padding="0 12px 18px">You save ${esc(K.whole(e.rebate))}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">You pay about</mj-text><mj-text mj-class="big-blue">${esc(K.whole(e.price))}</mj-text><mj-text mj-class="small center" padding="4px 16px 18px">${esc(estimateNote(e))}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">What's included in ${esc(K.whole(e.price))}</mj-text><mj-table padding="0 18px 6px">${inc.map((t, n) => tickRow(esc(t.title), esc(t.detail), n === inc.length - 1)).join("")}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">Not included – only if needed</mj-text><mj-table padding="0 18px 6px">${NOT_INCLUDED.map(([b, rest]) => plusRow(`<strong>${esc(b)}</strong>${esc(rest)}`)).join("")}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(CLOSING)}</mj-text></mj-column></mj-section>`,
  ].join("");
}
/** Plain-text twin of `mjReadyCheckEstimate`. */
export function readyCheckEstimateText(e: ReadyCheckEstimate): string[] {
  return [
    `Your VEU rebate: you save ${K.whole(e.rebate)}`,
    `You pay about: ${K.whole(e.price)} (${estimateNote(e)})`, "",
    `WHAT'S INCLUDED IN ${K.whole(e.price)}`, ...INCLUDED(e.rebate).map((t) => `✓ ${t.title}: ${t.detail}`), "",
    "NOT INCLUDED – ONLY IF NEEDED", ...NOT_INCLUDED.map(([b, rest]) => `+ ${b}${rest}`), "",
    CLOSING,
  ];
}

export function renderReadyCheckTimesEmail(i: ReadyCheckTimesInput) {
  const subject = "Choose a time for your free Ready Check";
  const first = K.cleanName(i.firstName) ?? "there";
  const headline = `${first}, pick a time for your free Ready Check`;
  const suburb = i.suburb?.trim() || null;
  const where = suburb ? ` near ${suburb}` : "";
  const intro = `Good news: a certified installer${where} is ready for you. Tap the time that suits you and it's booked.`;
  const slots = i.times.map((t) => (typeof t === "string" ? splitDayTime(t) : t)).map((t) => ({ day: t.day, time: t.time, href: t.href || i.myJobUrl }));
  const n = slots.length;
  const preview = `A certified installer${where} has offered ${n} time${n === 1 ? "" : "s"}. Tap one and it's booked.`;
  const at = "The installer measures your ceiling, checks your existing insulation and access, and confirms your exact price. It's free. No payment, no obligation.";
  const est = i.estimate && i.estimate.price > 0 ? i.estimate : null;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    mjTimeButtons(slots, i.myJobUrl),
    `<mj-section><mj-column><mj-text mj-class="h2" css-class="email-sub" padding="6px 12px 6px">At your Ready Check</mj-text><mj-text>${esc(at)}</mj-text></mj-column></mj-section>`,
    est ? mjReadyCheckEstimate(est) : "",
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([
    headline, "", intro, "",
    ...slots.map((s) => `• ${s.day}${s.time ? ` ${s.time}` : ""}`),
    `Pick a time: ${i.myJobUrl}`, `None suit? Suggest other days: ${i.myJobUrl}`, "",
    "AT YOUR READY CHECK", at,
    ...(est ? ["", ...readyCheckEstimateText(est)] : []),
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
