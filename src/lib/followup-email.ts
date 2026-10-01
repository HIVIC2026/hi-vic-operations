/** Pure Step 3 follow-up renderers (3-day unopened, 3-day engaged, 7-day). No data access or delivery.
 * Uses the approved outcome-email theme (V2_THEME) so reminders match the likely/onsite/ineligible emails. */
import { escape, V2_THEME, validEstimateUrl, validReferralUrl, validTrackingUrl, pixelTag, type EstimateEmail } from "./estimate-email";
import type { FollowupKind } from "./engagement.core";
import { CUSTOMER_BRAND } from "./customer-quote-system";

export type FollowupEmailInput = { kind: FollowupKind; estimateUrl: string; trackingClickUrl?: string | null; trackingPixelUrl?: string | null; referralUrl?: string | null };

const SERVICE = "Free Insulation Measure-Up & Eligibility Check";
const PIESA = "The mandatory electrical safety assessment (PIESA) is a separate paid step, completed later by a licensed electrician, close to installation.";
const REASSURE = "No payment required. No obligation to proceed with installation.";
const DEMAND = "Demand is high. Installer availability is limited.";
const HELPER = "Your secure estimate link is personal to your property.";

type Copy = { subject: string; preview: string; badge: string; heading: string; intro: string; listTitle: string; ticks: string[]; listNote?: string; actionTitle: string; actionBody: string; demand?: boolean; cta: string; hash?: string };
const COPY: Record<FollowupKind, Copy> = {
  estimate_unopened_3d: {
    subject: "Just checking you received your Home Insulation Victoria estimate",
    preview: "Your preliminary ceiling insulation estimate is ready whenever you are.",
    badge: "Your estimate",
    heading: "Just checking you received your estimate",
    intro: "We prepared a preliminary ceiling insulation estimate for your home a few days ago, including your estimated VEU rebate and what’s included.",
    listTitle: "What your estimate shows",
    ticks: ["Your estimated VEU rebate", "Your estimated cost, including GST", "What the quote includes", `Your next step: a ${SERVICE}`],
    actionTitle: "Take a look when it suits you",
    actionBody: "Your estimate is saved and ready. Open it any time to review the details.",
    cta: "View my estimate →",
  },
  estimate_engaged_no_booking_3d: {
    subject: `Ready for your ${SERVICE}?`,
    preview: "Your free measure-up & eligibility check confirms the details so we can update your estimate.",
    badge: "Next step",
    heading: "Ready for your free measure-up & eligibility check?",
    intro: "Thanks for taking a look at your preliminary estimate. Your free measure-up & eligibility check confirms ceiling size, existing insulation and access so we can update your estimate.",
    listTitle: "What the free visit covers",
    ticks: ["Ceiling measurements", "Existing insulation, removal and access", "Eligibility evidence and site photos", "An updated estimate for you to review"],
    listNote: PIESA,
    actionTitle: `Your free measure-up & eligibility check`,
    actionBody: "An installer from our pre-vetted panel will contact you to arrange a time.",
    demand: true,
    cta: "Arrange my free measure-up & eligibility check →", hash: "#confirm",
  },
  estimate_second_reminder_7d: {
    subject: "Your Home Insulation Victoria estimate is still here for you",
    preview: "Your preliminary ceiling insulation estimate is ready when you are.",
    badge: "Your estimate",
    heading: "Your estimate is still here when you’re ready",
    intro: "A quick, final reminder about your preliminary ceiling insulation estimate. There’s no pressure — it’s there whenever suits you.",
    listTitle: "Why homeowners upgrade",
    ticks: ["Warmer in winter and cooler in summer", "PIESA by a licensed electrician employed by a REC; installation by an EEC Certified Insulation Installer (CII)", "Transparent Home Insulation Victoria pricing — partner trades do not decide what you pay"],
    actionTitle: "Pick up where you left off",
    actionBody: "Your estimate is saved. Open it to review the details or arrange your free measure-up & eligibility check.",
    cta: "View my estimate →",
  },
};

const { F, FH, colors: C } = V2_THEME;
const tick = (t: string) => `<tr><td valign="top" width="24" style="width:24px;padding:0 0 9px;font-family:Arial,Helvetica,sans-serif;color:${C.GREEN};font-size:16px;line-height:20px;font-weight:800;">✓</td><td valign="top" style="padding:0 0 9px;${F}color:${C.INK};font-size:14px;line-height:20px;font-weight:700;">${escape(t)}</td></tr>`;

export function renderFollowupEmail(input: FollowupEmailInput): EstimateEmail {
  const c = COPY[input.kind];
  if (!c) throw new Error("Unknown follow-up kind.");
  const link = validEstimateUrl(input.estimateUrl);
  const base = link.toString().replace(/\/$/, "");
  const target = validTrackingUrl(input.trackingClickUrl, "click") ?? (c.hash ? `${base}${c.hash}` : link.toString());
  const pixel = validTrackingUrl(input.trackingPixelUrl, "pixel");
  const referral = validReferralUrl(input.referralUrl);
  const row = (content: string, pad: string) => `<tr><td class="lx-pad" style="padding:${pad};${F}">${content}</td></tr>`;
  const hero = `<p style="margin:0 0 8px;${F}color:${C.TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Your preliminary estimate</p><h1 class="lx-h1 hiv-hero-title" style="margin:0 0 14px;${FH}color:${C.INK};font-size:34px;line-height:39px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">${escape(c.heading)}</h1><p class="lx-body" style="margin:0;${F}color:${C.INK};font-size:15px;line-height:1.6;">${escape(c.intro)}</p>`;
  const list = `<table data-followup-list="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.MIST}" style="width:100%;border-collapse:separate;background-color:${C.MIST};border-radius:18px;"><tr><td class="lx-result-pad" style="padding:20px 20px 12px;${F}"><p style="margin:0 0 12px;${FH}color:${C.INK};font-size:17px;line-height:1.3;font-weight:800;">${escape(c.listTitle)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${c.ticks.map(tick).join("")}</table>${c.listNote ? `<p style="margin:4px 0 8px;padding-top:10px;border-top:1px solid ${C.LINE};${F}color:${C.INK};font-size:12.5px;line-height:1.5;">${escape(c.listNote)}</p>` : ""}</td></tr></table>`;
  const action = `<table data-followup-action="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.BLUSH}" style="width:100%;border-collapse:separate;background-color:${C.BLUSH};border-radius:20px;"><tr><td style="padding:22px 22px;${F}"><h2 style="margin:0 0 10px;${FH}color:${C.INK};font-size:23px;line-height:1.2;font-weight:800;letter-spacing:0;">${escape(c.actionTitle)}</h2><p class="lx-body" style="margin:0 0 14px;${F}color:${C.INK};font-size:14px;line-height:1.55;">${escape(c.actionBody)}</p>${c.demand ? `<p style="margin:0 0 12px;${F}color:${C.TEXT_GREEN};font-size:14px;line-height:1.45;font-weight:800;">${DEMAND}</p>` : ""}${V2_THEME.button(target, escape(c.cta))}<p style="margin:10px 0 0;${F}color:${C.INK};font-size:13px;line-height:1.5;text-align:center;">${HELPER}</p><p style="margin:6px 0 0;${F}color:${C.INK};font-size:13px;line-height:1.5;text-align:center;font-weight:700;">${REASSURE}</p></td></tr></table>`;
  const refer = referral ? `<p data-followup-referral="true" style="margin:0;${F}color:${C.INK};font-size:13.5px;line-height:1.55;text-align:center;">Know someone else thinking about ceiling insulation? They can check their own eligibility. <a href="${escape(referral)}" style="color:${C.BLUE};font-weight:800;text-decoration:underline;white-space:nowrap;">Refer&nbsp;a&nbsp;friend&nbsp;→</a></p>` : "";
  const reason = "You’re receiving this because you requested a ceiling insulation estimate.";
  const html = V2_THEME.shell(`${row(V2_THEME.header(c.badge), "22px 36px 18px")}${row(hero, "8px 36px 24px")}${row(list, "0 28px 18px")}${row(action, "0 28px 18px")}${refer ? row(refer, "4px 36px 24px") : ""}${V2_THEME.footerRow(V2_THEME.footer(null, referral, reason))}`, c.preview, null).replace("</table></td></tr></table></body>", `</table>${pixelTag(pixel)}</td></tr></table></body>`);
  const plainText = [
    c.heading, "", c.intro, "",
    c.listTitle.toUpperCase(), ...c.ticks.map((t) => `✓ ${t}`), ...(c.listNote ? [c.listNote] : []), "",
    c.actionTitle.toUpperCase(), c.actionBody, ...(c.demand ? [DEMAND] : []),
    `${c.cta.replace(/ →$/, "")}: ${target}`, HELPER, REASSURE,
    ...(referral ? ["", "Know someone else thinking about ceiling insulation? They can check their own eligibility.", `Refer a friend: ${referral}`] : []), "",
    ...V2_THEME.footerPlain(null, referral, reason),
  ].join("\n");
  void CUSTOMER_BRAND;
  return { subject: c.subject, previewText: c.preview, html, plainText };
}
