// "You're in!" acceptance + safety check receipt email (Jo 24 Oct 2026, decisions 90, 126).
// Design approved: docs/templates/owner/O22-youre-in.html — payment received card (amount, date, card, Paid, remaining
// balance with the 10% / install-day split); next steps (electrician offers times; separate quote only if fixes needed;
// installer offers 3 install days within 30 days of the safety check); See my job; signed acceptance + receipt attached.
// Sent through approved-owner-emails.server.ts (sendOwnerTemplateEmail): TEST jobs via test-send, real owners only with
// ACCEPTANCE_EMAIL_APPROVED (on since decision 90) AND customer_comms_enabled, through the guarded owner-email path. Pure.
import * as K from "./email-kit.core";

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
  const remainingLine = `Remaining: ${K.cents(remaining)} (10% to book your install day, the rest on install day)`;
  const payCard = pay ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${K.KIT.MIST};border-radius:16px;"><tr><td style="padding:16px 18px;">
<div style="font-size:11px;font-weight:bold;letter-spacing:1.3px;text-transform:uppercase;color:${K.KIT.NAVY};">Payment received</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
<tr><td style="font-size:14px;color:${K.KIT.NAVY};padding:4px 0;">${K.esc(pay.label ?? "Electrical safety check")}</td><td align="right" style="font-size:14px;font-weight:bold;color:${K.KIT.NAVY};">${K.esc(K.cents(pay.amount))}</td></tr>
<tr><td style="font-size:13px;color:${K.KIT.SUB};padding:4px 0;">Paid ${K.esc(pay.paidOn)}${pay.cardLast4 ? ` · card ending ${K.esc(pay.cardLast4)}` : ""}</td><td align="right" style="font-size:13px;color:${K.KIT.GREEN};font-weight:bold;">Paid &#10003;</td></tr>
<tr><td colspan="2" style="font-size:13px;color:${K.KIT.SUB};padding:8px 0 0;border-top:1px solid ${K.KIT.LINE};">${K.esc(remainingLine)}</td></tr>
</table>
</td></tr></table>` : "";
  const installer = i.installerName?.trim() || "Your installer";
  const steps: K.Step[] = [
    { title: "Electrical safety check", detail: "A licensed electrician will offer you times. They check your wiring, downlights and switchboard are safe to insulate over." },
    { title: "Only if something needs fixing", detail: "We'll send you a separate quote. Nothing is done without your OK." },
    { title: "Book your install day", detail: `${installer} offers you 3 days. Your install is done within 30 days of the safety check.` },
  ];
  const closing = i.factsheetAttached
    ? "Your signed acceptance and receipt are attached, with the Victorian Energy Upgrades consumer factsheet, and always on your job page. Questions? Just reply to this email."
    : "Your signed acceptance and receipt are attached, and always on your job page. Questions? Just reply to this email.";
  const body = [K.h1(headline, 8), K.p(intro), payCard, K.sectionTitle("What happens next", "24px 0 12px"), K.numberedSteps(steps), K.button(i.myJobUrl, "See my job", "6px 0 4px"), K.small(closing)].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([
    headline, "", intro, "",
    ...(pay ? ["PAYMENT RECEIVED", `${pay.label ?? "Electrical safety check"}: ${K.cents(pay.amount)} — Paid ${pay.paidOn}${pay.cardLast4 ? ` (card ending ${pay.cardLast4})` : ""}`, remainingLine, ""] : []),
    "WHAT HAPPENS NEXT", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "", `See my job: ${i.myJobUrl}`, "", closing,
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
