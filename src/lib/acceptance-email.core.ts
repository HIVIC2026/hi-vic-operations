// "You're in!" acceptance + safety check receipt email (Jo 24 Oct 2026, decisions 90, 126).
// Design: docs/templates/mjml/owner_O22.mjml (MJML email refresh, Jo 27 Oct 2026) — payment received box (amount, date, card, Paid, still-to-pay
// balance with the 10% / install-day split); next steps (electrician offers times; separate quote only if fixes needed;
// installer offers 3 install days within 30 days of the safety check); See my job; signed acceptance + receipt attached.
// Sent through approved-owner-emails.server.ts (sendOwnerTemplateEmail): TEST jobs via test-send, real owners only with
// ACCEPTANCE_EMAIL_APPROVED (on since decision 90) AND customer_comms_enabled, through the guarded owner-email path. Pure.
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";

/** Jo 24 Oct 2026, decision 90 (O22 "You're in!" + $349 receipt): approved. Delivery still behind customer_comms_enabled. */
export const ACCEPTANCE_EMAIL_APPROVED = true as boolean;

export type AcceptanceEmailInput = {
  firstName: string | null; rebate: number | null; totalIncGst: number;
  payment: { amount: number; paidOn: string; cardLast4?: string | null; label?: string } | null;
  installerName: string | null; myJobUrl: string; test?: boolean;
  /** Decision 320: the ESC VEU consumer factsheet PDF goes with this email (only when it is on file). */
  factsheetAttached?: boolean;
};

export function renderYoureInEmail(i: AcceptanceEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = `You're in, ${first}! Your quote is accepted`;
  const headline = `You're in, ${first}!`;
  const intro = `Thanks for accepting your quote. Warmer winters and cooler summers are on the way${i.rebate && i.rebate > 0 ? `, with ${K.whole(i.rebate)} off` : ""}.`;
  const pay = i.payment;
  const remaining = pay ? Math.max(0, i.totalIncGst - pay.amount) : i.totalIncGst;
  const remainingLine = `Still to pay: ${K.cents(remaining)} (10% to book your install day, the rest on install day)`;
  const payLabel = pay?.label ?? "Electrical safety check";
  const preview = pay ? `We've got your ${K.cents(pay.amount)} payment. Next up: your electrical safety check.` : "Next up: your electrical safety check.";
  const payCard = pay
    ? `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow" padding="18px 18px 10px">Payment received</mj-text><mj-table padding="0 18px 6px">`
      + `<tr><td style="padding:0 12px 4px 0;font-size:16px;">${esc(payLabel)}</td><td align="right" style="padding:0 0 4px;white-space:nowrap;font-size:16px;"><strong>${esc(K.cents(pay.amount))}</strong></td></tr>`
      + `<tr><td class="muted" style="padding:0 12px 12px 0;font-size:13px;color:#5A6785;">Paid ${esc(pay.paidOn)}${pay.cardLast4 ? ` · card ending ${esc(pay.cardLast4)}` : ""}</td><td align="right" style="padding:0 0 12px;white-space:nowrap;font-size:14px;color:#057D40;"><strong>Paid &#10003;</strong></td></tr>`
      + `<tr><td colspan="2" style="border-top:1px solid #E4E9F5;padding:12px 0 12px;font-size:14px;color:#5A6785;">${esc(remainingLine)}</td></tr>`
      + `</mj-table></mj-column></mj-section>`
    : "";
  const installer = i.installerName?.trim() || "Your installer";
  const steps: K.Step[] = [
    { title: "Electrical safety check", detail: "A licensed electrician will offer you times. They check your wiring, downlights and switchboard are safe to insulate over." },
    { title: "Only if something needs fixing", detail: "We'll send you a separate quote. Nothing is done without your OK." },
    { title: "Book your install day", detail: `${installer} offers you 3 days. Your install is done within 30 days of the safety check.` },
  ];
  const closing = i.factsheetAttached
    ? "Your signed acceptance and receipt are attached, with the Victorian Energy Upgrades consumer factsheet. Please keep this email. Questions? Just reply to this email."
    : "Your signed acceptance and receipt are attached. Please keep this email. Questions? Just reply to this email.";
  const stepRows = steps.map((s, n) => { const last = n === steps.length - 1; return `<tr><td width="36" valign="top" style="padding:2px 0 ${last ? 12 : 14}px;"><span class="num">${n + 1}</span></td><td style="padding:0 0 ${last ? 12 : 14}px;"><strong>${esc(s.title)}</strong>${s.detail ? `<br /><span class="muted">${esc(s.detail)}</span>` : ""}</td></tr>`; }).join("");
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    payCard,
    `<mj-section><mj-column><mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 12px">What happens next</mj-text><mj-table padding="0 12px 6px">${stepRows}</mj-table><mj-button href="${esc(i.myJobUrl)}">See my job</mj-button><mj-text mj-class="small" padding="0 12px 0">${esc(closing)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([
    headline, "", intro, "",
    ...(pay ? ["PAYMENT RECEIVED", `${payLabel}: ${K.cents(pay.amount)} — Paid ${pay.paidOn}${pay.cardLast4 ? ` (card ending ${pay.cardLast4})` : ""}`, remainingLine, ""] : []),
    "WHAT HAPPENS NEXT", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "", `See my job: ${i.myJobUrl}`, "", closing,
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
