// Jo 24 Oct 2026 (decisions 80–81): on our leads the owner gets "You're booked" for the free Ready Check, and an updated
// one when either side changes the time. Our leads only (installers' own customers have no portal booking).
// Design: docs/templates/mjml/owner_O12.mjml (MJML email refresh, Jo 27 Oct 2026) — blue date/time box with address
// and installer name + phone; "Before they arrive"; Change time line; See my job; rebate and price boxes; included / not included.
// Flag on (decisions 81/82); real delivery still needs customer_comms_enabled through the guarded owner-email path. Pure.
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";
import { mjReadyCheckEstimate, readyCheckEstimateText, splitDayTime } from "./ready-check-times-email.core";

/** Jo 24 Oct 2026, decision 81 (O12 "You're booked"): approved. Delivery still behind customer_comms_enabled. */
export const READY_CHECK_BOOKED_EMAIL_APPROVED = true as boolean;
/** Jo 24 Oct 2026, decision 82: the "Booked!" owner text wording (B) is approved. No sender uses this flag yet; any text still goes only through sendRealSms. */
export const READY_CHECK_BOOKED_TEXT_APPROVED = true as boolean;

export type ReadyCheckBookedInput = {
  firstName: string | null;
  /** "Tuesday 28 October at 8:00am" */
  when: string; installerName: string | null; installerPhone?: string | null; address?: string | null; changed: boolean; myJobUrl: string;
  estimate?: { rebate: number; price: number; areaM2: number } | null;
  test?: boolean;
};

const DISPLAY = "Outfit, Figtree, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif";
/** Blue booking box: caps label, day, blue time, address/contact lines (O12, safety check booked). */
export function mjBookingBox(i: { label: string; day: string; time: string; lines: string[] }): string {
  const lines = i.lines.map(esc).join("<br />");
  return `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow" padding="18px 18px 6px">${esc(i.label)}</mj-text><mj-text font-family="${DISPLAY}" font-size="24px" line-height="30px" font-weight="800" padding="0 18px 2px">${esc(i.day)}</mj-text>${i.time ? `<mj-text font-family="${DISPLAY}" font-size="24px" line-height="30px" font-weight="800" color="#3C51C4" padding="0 18px ${lines ? 10 : 18}px">${esc(i.time)}</mj-text>` : ""}${lines ? `<mj-text font-size="15px" line-height="22px" padding="0 18px 18px">${lines}</mj-text>` : ""}</mj-column></mj-section>`;
}
/** "Before they arrive" tick rows (HTML with <strong>, already safe). */
export const mjBeforeRows = (rows: string[]) => rows.map((b) => `<tr><td width="32" valign="top" style="padding:2px 0 12px;"><span class="tick">&#10003;</span></td><td style="padding:0 0 12px;">${b}</td></tr>`).join("");

export function renderReadyCheckBookedEmail(i: ReadyCheckBookedInput) {
  const subject = i.changed ? `Your Ready Check time has changed – ${i.when}` : `You're booked: free Ready Check – ${i.when}`;
  const first = K.cleanName(i.firstName) ?? "there";
  const headline = i.changed ? `Your new Ready Check time, ${first}` : `You're booked, ${first}`;
  const lead = i.changed ? "Your free Ready Check has a new time." : "Your free Ready Check is confirmed.";
  const { day, time } = splitDayTime(i.when);
  const installer = i.installerName?.trim() || null;
  const phone = i.installerPhone?.trim() || null;
  const address = i.address?.trim() || null;
  const lines = [address, installer ? `Installer: ${installer}${phone ? ` · ${phone}` : ""}` : null].filter((l): l is string => !!l);
  const preview = installer && address ? `${installer} will come to ${address}. Here's how to get ready.` : `${lead} ${i.when}`;
  const before = [
    "Make sure the installer can reach your <strong>ceiling hatch</strong> (clear anything underneath it).",
    "If you have <strong>pets</strong>, keep them away from the work area.",
    "Have a think about any <strong>questions</strong> you'd like to ask.",
  ];
  const change = `Need a different time? Tap <strong>Change time</strong> on your job page and the installer will offer new times.${installer ? ` Or call or text ${esc(installer)}${phone ? ` on ${esc(phone)}` : ""}.` : ""}`;
  const est = i.estimate && i.estimate.price > 0 ? i.estimate : null;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(lead)}</mj-text></mj-column></mj-section>`,
    mjBookingBox({ label: i.changed ? "Your new Ready Check time" : "Your Ready Check", day, time, lines }),
    `<mj-section><mj-column><mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 10px">Before they arrive</mj-text><mj-table padding="0 12px 6px">${mjBeforeRows(before)}</mj-table><mj-text>${change}</mj-text></mj-column></mj-section>`,
    est ? mjReadyCheckEstimate(est) : "",
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([
    headline, "", lead, `When: ${i.when}`, ...lines, "",
    "BEFORE THEY ARRIVE", ...before.map((b) => `✓ ${K.stripTags(b)}`), "",
    K.stripTags(change), 
    ...(est ? ["", ...readyCheckEstimateText(est)] : []),
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
