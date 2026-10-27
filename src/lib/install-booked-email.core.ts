// Jo 24 Oct 2026 (decisions 43–46, 98, 132): once the install day and time are agreed, the owner gets "Your install is
// booked". Design approved (decision 98): docs/templates/mjml/owner_O35.mjml — "Consent signed and deposit
// received ✓"; day + arrival card with installer and phone (+ deposit/balance rows when known); "⚡ Your power will be
// off"; "On the day" checklist (removal dust line only when removal is included); what happens + balance due; Change day.
// INSTALL_BOOKED_EMAIL_APPROVED is on (decisions 98/151); real delivery still needs customer_comms_enabled. Pure.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { splitDayTime } from "./ready-check-times-email.core";

/** Jo 24 Oct 2026, decisions 98 (O35) and 151 (O35b deposit owed): approved. Delivery still behind customer_comms_enabled. */
export const INSTALL_BOOKED_EMAIL_APPROVED = true as boolean;

export type InstallBookedInput = {
  firstName: string | null; when: string; address: string | null;
  installerName: string | null; installerPhone: string | null; removal: boolean; myJobUrl: string; test?: boolean;
  /** Decision 132: deposit paid + balance due on the day, when the payment record exists. */
  payment?: { depositPaid: number; cardLast4?: string | null; balanceDue: number; payInFullUrl?: string | null } | null;
  /** True once the owner has signed the install consent (decision 97). */
  consentSigned?: boolean;
  /** Decision 139: 10% install deposit by bank transfer / PayID within 48h (day held meanwhile); omitted when already paid or not under the payment rule. */
  deposit?: { amount: string; holdUntil: string | null; bankLines: string[] } | null;
};

const TICK = (html: string) => `<tr><td width="32" valign="top" style="padding:2px 0 12px;"><span class="tick">&#10003;</span></td><td style="padding:0 0 12px;">${html}</td></tr>`;

export function renderInstallBookedEmail(i: InstallBookedInput) {
  const subject = `Your insulation install is booked – ${i.when}`;
  const first = K.cleanName(i.firstName) ?? "there";
  const headline = `Your install is booked, ${first}`;
  const pay = i.payment && i.payment.depositPaid > 0 ? i.payment : null;
  const owed = !pay && i.deposit ? i.deposit : null;
  const lead = owed ? `Your day is held${owed.holdUntil ? ` until ${owed.holdUntil}` : " for 48 hours"}. Pay your deposit to lock it in.` : pay && i.consentSigned ? "Consent signed and deposit received ✓ Your day is locked in." : pay ? "Deposit received ✓ Your day is locked in." : i.consentSigned ? "Consent signed ✓ Your day is locked in." : "Your day is locked in.";
  const preview = owed ? lead : `${pay && i.consentSigned ? "Consent signed and deposit received." : pay ? "Deposit received." : i.consentSigned ? "Consent signed." : "Your day is locked in."} Here's what to do before the day.`;
  const { day, time } = splitDayTime(i.when);
  const installer = i.installerName?.trim() || null;
  const phone = i.installerPhone?.trim() || null;
  const lines = [i.address?.trim() || null, installer ? `Installer: ${installer}${phone ? ` · ${phone}` : ""}` : null].filter((l): l is string => !!l);
  const onTheDay = [
    "An adult (18+) at home to let the installer in and sign off at the end",
    "Clear the area under the ceiling hatch and a path to it",
    "Move cars if you can, so the van can park close",
    "Keep pets away from the work area",
    ...(i.removal ? ["Old insulation is being removed, so expect some dust. Close internal doors and cover anything near the hatch."] : []),
  ];
  const power = "For safety, the power is off while the installer works in your ceiling. Charge phones and laptops first. Plan around the fridge, medical equipment and anyone working from home.";
  const happens = `The installer takes before and after photos (the rebate needs them), lays your insulation and tidies up. Most homes take a few hours.${pay ? "" : " Your remaining balance is due on the day."}`;
  const change = "Need to change the day? Use Change day on your job page. Questions? Just reply to this email.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(lead)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Your install</mj-text><mj-text mj-class="center" font-family="Outfit, Figtree, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif" font-size="24px" line-height="30px" font-weight="800" padding="0 12px 2px">${esc(day)}</mj-text>${time ? `<mj-text mj-class="center" font-weight="700" padding="0 12px ${lines.length ? 8 : 18}px">Arriving ${esc(time)}</mj-text>` : ""}${lines.length ? `<mj-text mj-class="small center" padding="0 16px 18px">${lines.map(esc).join("<br />")}</mj-text>` : ""}</mj-column></mj-section>`,
    pay ? `<mj-section><mj-column mj-class="panel-card"><mj-table padding="8px 18px 0"><tr><td style="padding:10px 0;">Deposit paid${pay.cardLast4 ? ` · card ending ${esc(pay.cardLast4)}` : ""}</td><td align="right" style="padding:10px 0 10px 12px;white-space:nowrap;">${esc(K.cents(pay.depositPaid))}</td></tr><tr><td style="padding:10px 0;border-top:1px solid #E4E9F5;"><strong>Balance due on install day</strong></td><td align="right" style="padding:10px 0 10px 12px;border-top:1px solid #E4E9F5;white-space:nowrap;"><strong>${esc(K.cents(pay.balanceDue))}</strong></td></tr></mj-table><mj-text mj-class="small" padding="4px 18px 16px">Receipt attached.${pay.payInFullUrl ? ` Want to pay the balance now? <a href="${esc(pay.payInFullUrl)}" style="color:#3C51C4;font-weight:700;">Pay in full</a>` : ""}</mj-text></mj-column></mj-section>` : "",
    owed ? `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 6px">Pay your ${esc(owed.amount)} deposit within 48 hours</mj-text><mj-text padding="0 18px 16px">By bank transfer or PayID.${owed.bankLines.map((l) => `<br />${esc(l)}`).join("")}</mj-text></mj-column></mj-section>` : "",
    `<mj-section><mj-column mj-class="panel-amber"><mj-text mj-class="h2" padding="18px 18px 6px">⚡ Your power will be off</mj-text><mj-text padding="0 18px 16px">${esc(power)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">On the day</mj-text><mj-table padding="0 18px 6px">${onTheDay.map((t) => TICK(esc(t))).join("")}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="16px 12px 14px">${esc(happens)}</mj-text><mj-button href="${esc(i.myJobUrl)}">See my job</mj-button><mj-text mj-class="small" padding="0 12px">${esc(change)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([
    headline, "", lead, `When: ${i.when}`, ...(i.address ? [`Address: ${i.address}`] : []), ...(installer ? [`Installer: ${installer}${phone ? `, ${phone}` : ""}`] : []),
    ...(pay ? [`Deposit paid: ${K.cents(pay.depositPaid)}${pay.cardLast4 ? ` (card ending ${pay.cardLast4})` : ""}`, `Balance due on install day: ${K.cents(pay.balanceDue)}`, "Receipt attached.", ...(pay.payInFullUrl ? [`Pay in full: ${pay.payInFullUrl}`] : [])] : []), "",
    ...(owed ? [`PAY YOUR ${owed.amount} DEPOSIT WITHIN 48 HOURS`, "By bank transfer or PayID.", ...owed.bankLines, ""] : []),
    "YOUR POWER WILL BE OFF", power, "",
    "ON THE DAY", ...onTheDay.map((b) => `✓ ${b}`), "",
    happens, "",
    `See my job: ${i.myJobUrl}`, change,
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
