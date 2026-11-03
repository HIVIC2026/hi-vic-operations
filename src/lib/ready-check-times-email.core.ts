// Shared pieces for the owner time-and-estimate emails (tap-a-time buttons, the saved-spot figures boxes). The O11 "pick a
// time for your free Ready Check" email itself was removed (Part 3 Task 16, Jo 2 Nov 2026: the installer will call
// instead). Pure.
import * as K from "./email-kit.core";
import { esc, mjEmail, plusRow, tickRow } from "./mail-mjml.core";

export type ReadyCheckTimeSlot = { day: string; time: string; href?: string | null };
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
  { title: "Electrical safety check (PIESA) by a licensed electrician", detail: "Needed before any insulation goes in. They check your wiring, downlights and cables are safe." },
  { title: "Premium R5.0 ceiling batts", detail: "VEU-approved and made to Australian Standard AS/NZS 4859.1." },
  { title: "Fitted by an EEC-certified installer", detail: "A Certified Insulation Installer (CII) through the Energy Efficiency Council, working to Australian Standard AS 3999." },
  { title: "We handle the rebate", detail: `As a VEU Accredited Person (${K.AP_NUMBER}), we do the government paperwork. The ${K.whole(rebate)} comes straight off your price.` },
];
const NOT_INCLUDED: [string, string][] = [
  ["Removing old insulation", ", if any needs to come out"],
  ["Ceiling access fee", ", if your ceiling is hard to get into"],
  ["Electrical upgrades", ", if the electrical safety check (PIESA) finds any"],
  ["A bigger ceiling", " than you told us"],
];
const CLOSING = "You'll know your exact price before you agree to anything.";

export function mjReadyCheckEstimate(e: ReadyCheckEstimate): string {
  const inc = INCLUDED(e.rebate);
  return [
    `<mj-section><mj-column mj-class="panel-mint"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Your VEU rebate</mj-text><mj-text mj-class="big-green" padding="0 12px 18px">You save ${esc(K.whole(e.rebate))}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Your estimated quote based on what you've told us</mj-text><mj-text mj-class="big-blue">${esc(K.whole(e.price))}</mj-text><mj-text mj-class="small center" padding="4px 16px 18px">${esc(estimateNote(e))}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">What's included in ${esc(K.whole(e.price))}</mj-text><mj-table padding="0 18px 6px">${inc.map((t, n) => tickRow(esc(t.title), esc(t.detail), n === inc.length - 1)).join("")}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">Not included – only if needed</mj-text><mj-table padding="0 18px 6px">${NOT_INCLUDED.map(([b, rest]) => plusRow(`<strong>${esc(b)}</strong>${esc(rest)}`)).join("")}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(CLOSING)}</mj-text></mj-column></mj-section>`,
  ].join("");
}
/** Plain-text twin of `mjReadyCheckEstimate`. */
export function readyCheckEstimateText(e: ReadyCheckEstimate): string[] {
  return [
    `Your VEU rebate: you save ${K.whole(e.rebate)}`,
    `Your estimated quote based on what you've told us: ${K.whole(e.price)} (${estimateNote(e)})`, "",
    `WHAT'S INCLUDED IN ${K.whole(e.price)}`, ...INCLUDED(e.rebate).map((t) => `✓ ${t.title}: ${t.detail}`), "",
    "NOT INCLUDED – ONLY IF NEEDED", ...NOT_INCLUDED.map(([b, rest]) => `+ ${b}${rest}`), "",
    CLOSING,
  ];
}
