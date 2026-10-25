// Jo 24 Oct 2026 (decisions 80–81): on our leads the owner gets "You're booked" for the free Ready Check, and an updated
// one when either side changes the time. Our leads only (installers' own customers have no portal booking).
// Design approved (decision 81): docs/templates/owner/O12-ready-check-booked.html — green date/time card with address
// and installer name + phone; "Before they arrive"; Change time line; See my job; price box; included / not included.
// Flag on (decisions 81/82); real delivery still needs customer_comms_enabled through the guarded owner-email path. Pure.
import * as K from "./email-kit.core";
import { splitDayTime } from "./ready-check-times-email.core";

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

export function renderReadyCheckBookedEmail(i: ReadyCheckBookedInput) {
  const subject = i.changed ? `Your Ready Check time has changed – ${i.when}` : `You're booked: free Ready Check – ${i.when}`;
  const first = K.cleanName(i.firstName) ?? "there";
  const headline = i.changed ? `Your new Ready Check time, ${first}` : `You're booked, ${first}`;
  const lead = i.changed ? "Your free Ready Check has a new time." : "Your free Ready Check is confirmed.";
  const { day, time } = splitDayTime(i.when);
  const installer = i.installerName?.trim() || null;
  const phone = i.installerPhone?.trim() || null;
  const lines = [i.address?.trim() || null, installer ? `Installer: ${installer}${phone ? ` · ${phone}` : ""}` : null].filter((l): l is string => !!l);
  const before = [
    "Make sure the installer can reach your <strong>ceiling hatch</strong> (clear anything underneath it).",
    "If you have <strong>pets</strong>, keep them away from the work area.",
    "Have a think about any <strong>questions</strong> you'd like to ask.",
  ];
  const change = `Need a different time? Tap <strong>Change time</strong> on your job page and the installer will offer new times.${installer ? ` Or call or text ${K.esc(installer)}${phone ? ` on ${K.esc(phone)}` : ""}.` : ""}`;
  const est = i.estimate && i.estimate.price > 0 ? i.estimate : null;
  const body = [
    K.h1(headline),
    K.p(lead),
    K.dateCard({ label: i.changed ? "Your new Ready Check time" : "Your Ready Check", day, time, lines }),
    K.sectionTitle("Before they arrive", "24px 0 10px"),
    K.checkList(before),
    K.p(change, "6px 0 4px", true),
    K.button(i.myJobUrl, "See my job"),
    est ? `${K.spacer(16)}\n${K.twoFigureBox({ rebate: est.rebate, price: est.price, note: `Estimate incl. GST for ${K.m2(est.areaM2)}. Confirmed at your free Ready Check.` })}\n${K.spacer(8)}\n${K.includedAndNotIncluded({ price: est.price, rebate: est.rebate })}` : "",
  ].join("\n");
  const html = K.emailShell({ body, previewText: `${lead} ${i.when}`, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([
    headline, "", lead, `When: ${i.when}`, ...lines, "",
    "BEFORE THEY ARRIVE", ...before.map((b) => `✓ ${K.stripTags(b)}`), "",
    K.stripTags(change), `See my job: ${i.myJobUrl}`,
    ...(est ? ["", `VEU rebate: ${K.whole(est.rebate)} · You pay about: ${K.whole(est.price)} (estimate incl. GST for ${K.m2(est.areaM2)}, confirmed at your free Ready Check)`, "", ...K.includedAndNotIncludedText({ price: est.price, rebate: est.rebate })] : []),
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
