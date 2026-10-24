// Jo 24 Oct 2026 (decisions 43–46, 98, 132): once the install day and time are agreed, the owner gets "Your install is
// booked". Design approved (decision 98): docs/templates/approved/O35-install-booked.html — "Consent signed and deposit
// received ✓"; day + arrival card with installer and phone (+ deposit/balance rows when known); "⚡ Your power will be
// off"; "On the day" checklist (removal dust line only when removal is included); what happens + balance due; Change day.
// INSTALL_BOOKED_EMAIL_APPROVED is on (decisions 98/151); real delivery still needs customer_comms_enabled. Pure.
import * as K from "./email-kit.core";
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

export function renderInstallBookedEmail(i: InstallBookedInput) {
  const subject = `Your insulation install is booked – ${i.when}`;
  const first = K.cleanName(i.firstName) ?? "there";
  const headline = `Your install is booked, ${first}`;
  const pay = i.payment && i.payment.depositPaid > 0 ? i.payment : null;
  const owed = !pay && i.deposit ? i.deposit : null;
  const lead = owed ? `Your day is held${owed.holdUntil ? ` until ${owed.holdUntil}` : " for 48 hours"}. Pay your deposit to lock it in.` : pay && i.consentSigned ? "Consent signed and deposit received ✓ Your day is locked in." : pay ? "Deposit received ✓ Your day is locked in." : i.consentSigned ? "Consent signed ✓ Your day is locked in." : "Your day is locked in.";
  const { day, time } = splitDayTime(i.when);
  const installer = i.installerName?.trim() || null;
  const phone = i.installerPhone?.trim() || null;
  const lines = [i.address?.trim() || null, installer ? `Installer: ${installer}${phone ? ` · ${phone}` : ""}` : null].filter((l): l is string => !!l);
  const payRows = pay ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid ${K.KIT.MINT_LINE};"><tr><td style="padding:8px 0 2px;font-size:13px;color:${K.KIT.NAVY};">Deposit paid${pay.cardLast4 ? ` · card ending ${K.esc(pay.cardLast4)}` : ""}</td><td align="right" style="padding:8px 0 2px;font-size:13px;font-weight:bold;color:${K.KIT.NAVY};">${K.esc(K.cents(pay.depositPaid))}</td></tr>
<tr><td style="font-size:13px;color:${K.KIT.NAVY};">Balance due on install day</td><td align="right" style="font-size:13px;font-weight:bold;color:${K.KIT.NAVY};">${K.esc(K.cents(pay.balanceDue))}</td></tr>
<tr><td colspan="2" style="padding-top:6px;font-size:12px;color:${K.KIT.SUB};">Receipt attached.${pay.payInFullUrl ? ` Want to pay the balance now? ${K.link(pay.payInFullUrl, "Pay in full")}` : ""}</td></tr></table>` : null;
  const onTheDay = [
    "An <strong>adult (18+)</strong> at home to let the installer in and sign off at the end",
    "<strong>Clear the area under the ceiling hatch</strong> and a path to it",
    "<strong>Move cars</strong> if you can, so the van can park close",
    "<strong>Keep pets</strong> away from the work area",
    ...(i.removal ? ["Old insulation is being removed, so <strong>expect some dust</strong>. Close internal doors and cover anything near the hatch."] : []),
  ];
  const power = "For safety, the power is switched off while the installer works in your ceiling. Charge phones and laptops beforehand, and plan around the fridge, medical equipment and anyone working from home.";
  const happens = `The installer takes before and after photos (the rebate needs them), lays your insulation and tidies up. Most homes take a few hours.${pay ? ` The rest, <strong>${K.esc(K.cents(pay.balanceDue))}</strong>, is due on the day.` : " Your remaining balance is due on the day."}`;
  const body = [
    K.h1(headline),
    K.p(lead),
    K.dateCard({ label: "Your install", day, time: time ? `Arriving ${time}` : "", lines, extraHtml: payRows }),
    ...(owed ? [K.mistBox(`Pay your ${K.esc(owed.amount)} deposit within 48 hours`, `<div style="font-size:14px;color:${K.KIT.NAVY};line-height:1.5;margin-top:4px;">By bank transfer or PayID.${owed.bankLines.map((l) => `<br>${K.esc(l)}`).join("")}</div>`, { marginTop: 16, padding: "14px 16px", radius: 14 }).replace("margin-bottom:6px;", "")] : []),
    K.mistBox("⚡ Your power will be off", `<div style="font-size:14px;color:${K.KIT.NAVY};line-height:1.5;margin-top:4px;">${K.esc(power)}</div>`, { marginTop: 16, padding: "14px 16px", radius: 14 }).replace("margin-bottom:6px;", ""),
    K.sectionTitle("On the day", "24px 0 10px"),
    K.checkList(onTheDay),
    K.p(happens, "8px 0 0", true),
    K.small("Need to change the day? Use Change day on your job page. Questions? Just reply to this email.", "16px 0 0", { html: true }).replace("Use Change day", "Use <strong>Change day</strong>"),
    K.button(i.myJobUrl, "See my job"),
  ].join("\n");
  const html = K.emailShell({ body, previewText: `${lead} ${i.when}`, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([
    headline, "", lead, `When: ${i.when}`, ...(i.address ? [`Address: ${i.address}`] : []), ...(installer ? [`Installer: ${installer}${phone ? `, ${phone}` : ""}`] : []),
    ...(pay ? [`Deposit paid: ${K.cents(pay.depositPaid)}${pay.cardLast4 ? ` (card ending ${pay.cardLast4})` : ""}`, `Balance due on install day: ${K.cents(pay.balanceDue)}`, ...(pay.payInFullUrl ? [`Pay in full: ${pay.payInFullUrl}`] : [])] : []), "",
    ...(owed ? [`PAY YOUR ${owed.amount} DEPOSIT WITHIN 48 HOURS`, "By bank transfer or PayID.", ...owed.bankLines, ""] : []),
    "YOUR POWER WILL BE OFF", power, "",
    "ON THE DAY", ...onTheDay.map((b) => `✓ ${K.stripTags(b)}`), "",
    K.stripTags(happens), "",
    "Need to change the day? Use Change day on your job page. Questions? Just reply to this email.", `See my job: ${i.myJobUrl}`,
  ], { testLabel: i.test === true });
  return { subject, html, text };
}
