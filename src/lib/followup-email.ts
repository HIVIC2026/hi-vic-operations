/** Pure Step 3 follow-up renderers (3-day unopened, 3-day engaged, 7-day). No data access or delivery. */
import { escape, likelyShell, validEstimateUrl, validReferralUrl, validTrackingUrl, type EstimateEmail } from "./estimate-email";
import type { FollowupKind } from "./engagement.core";
import { CUSTOMER_BRAND, CUSTOMER_READY_CHECK_EMAIL_ACTION, CUSTOMER_VISUAL_SYSTEM } from "./customer-quote-system";

export type FollowupEmailInput = { kind: FollowupKind; estimateUrl: string; trackingClickUrl?: string | null; trackingPixelUrl?: string | null; referralUrl?: string | null };

const INCLUDED = `${CUSTOMER_READY_CHECK_EMAIL_ACTION.sentence} ${CUSTOMER_READY_CHECK_EMAIL_ACTION.credit}`;
const COPY: Record<FollowupKind, { subject: string; preview: string; heading: string; paras: string[]; bullets?: string[]; cta: string; hash?: string }> = {
  estimate_unopened_3d: {
    subject: "Just checking you received your Home Insulation Victoria estimate",
    preview: "Your personalised Home Insulation Victoria insulation estimate is ready whenever you are.",
    heading: "Just checking you received your Home Insulation Victoria estimate",
    paras: ["We prepared a personalised preliminary estimate for your home a few days ago, including your estimated VEU / VEEC discount and what's included.", INCLUDED],
    cta: "VIEW MY ESTIMATE",
  },
  estimate_engaged_no_booking_3d: {
    subject: "Ready to book your Home Insulation Ready Check?",
    preview: "Your $99 Ready Check turns your estimate into a measured Home Insulation Victoria project estimate.",
    heading: "Ready to book your Home Insulation Ready Check?",
    paras: ["Thanks for taking a look at your preliminary estimate.", INCLUDED, "The Ready Check is not the mandatory PIESA. Your PIESA is completed later by a licensed electrician, close to installation."],
    cta: "BOOK MY READY CHECK", hash: "#confirm",
  },
  estimate_second_reminder_7d: {
    subject: "Your Home Insulation Victoria estimate is still here for you",
    preview: "A warmer, cooler, more efficient home — your estimate is ready when you are.",
    heading: "Your estimate is still here when you're ready",
    paras: ["A quick, final reminder about your personalised Home Insulation Victoria preliminary estimate. There's no pressure — it's there whenever suits you."],
    bullets: ["Warmer in winter and cooler in summer", "PIESA by a licensed electrician employed by a REC; installation by an EEC Certified Insulation Installer (CII)", "Transparent Home Insulation Victoria pricing — partner trades do not decide what you pay"],
    cta: "VIEW MY ESTIMATE",
  },
};

const F = CUSTOMER_BRAND.font;
const B = CUSTOMER_BRAND.colors.blue, G = CUSTOMER_BRAND.colors.green, N = CUSTOMER_BRAND.colors.navy;
const p = (c: string, extra = "") => `<p class="hiv-body" style="margin:0 0 12px;font-family:${F};font-size:13px;line-height:1.6;color:${N};${extra}">${c}</p>`;
const row = (content: string, pad: string, cls = "hiv-pad") => `<tr><td class="${cls}" style="padding:${pad};font-family:${F};">${content}</td></tr>`;

export function renderFollowupEmail(input: FollowupEmailInput): EstimateEmail {
  const c = COPY[input.kind];
  if (!c) throw new Error("Unknown follow-up kind.");
  const link = validEstimateUrl(input.estimateUrl);
  const base = link.toString().replace(/\/$/, "");
  const target = validTrackingUrl(input.trackingClickUrl, "click") ?? (c.hash ? `${base}${c.hash}` : link.toString());
  const pixel = validTrackingUrl(input.trackingPixelUrl, "pixel");
  const referral = validReferralUrl(input.referralUrl);
  const bullets = c.bullets ? c.bullets.map((b) => p(`<span style="color:${G};font-weight:800;">✓</span>&nbsp; ${escape(b)}`, "margin:0 0 8px;")).join("") : "";
  const card = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;border-collapse:separate;border-spacing:0;background-color:#FFFFFF;border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${F};">${c.paras.map((x) => p(escape(x))).join("")}${bullets}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${G}" style="width:100%;margin-top:6px;border-collapse:separate;border-spacing:0;background-color:${G};border-radius:12px;"><tr><td style="padding:0 4px 4px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${B}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${B};border-radius:12px;"><tr><td align="center"><a class="hiv-cta" href="${escape(target)}" style="display:block;padding:15px 16px;color:#FFFFFF;font-family:${F};text-decoration:none;font-size:14px;line-height:1.3;font-weight:800;letter-spacing:1px;">${escape(c.cta)} →</a></td></tr></table></td></tr></table>${p("Your secure estimate link is personal to your property.", "margin:10px 0 0;font-size:11px;text-align:center;")}</td></tr></table>`;
  const hero = `<p style="margin:0 0 10px;color:#93F3B6;font-family:${F};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.8px;">YOUR PRELIMINARY VEU INSULATION ESTIMATE</p><div class="hiv-hero-title" role="heading" aria-level="1" style="margin:0;color:#FFFFFF;font-family:${F};font-size:30px;line-height:32px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:-1.2px;text-transform:uppercase;">${escape(c.heading)}</div>`;
  const refer = referral ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CUSTOMER_VISUAL_SYSTEM.paleGreen}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${CUSTOMER_VISUAL_SYSTEM.paleGreen};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softGreenBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${F};"><p style="margin:0 0 6px;color:${B};font-family:${F};font-size:13px;font-weight:800;">KNOW SOMEONE WHO MIGHT QUALIFY?</p>${p("Share Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.")}<a href="${escape(referral)}" style="color:${B};font-family:${F};font-size:12px;font-weight:800;text-decoration:underline;">REFER A FRIEND →</a></td></tr></table>` : "";
  const footer = `<p style="margin:0 0 5px;color:${B};font-size:12px;font-weight:800;">Home Insulation Victoria</p><p style="margin:0;color:${N};font-size:10px;line-height:1.55;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria<br><a href="https://homeinsulationvictoria.com.au/privacy" style="color:${B};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="https://homeinsulationvictoria.com.au/contact" style="color:${B};text-decoration:underline;">Contact</a> &nbsp;·&nbsp; A secure unsubscribe link appears below.</p>`;
  const html = likelyShell(`${row(`<img class="hiv-logo" src="${CUSTOMER_BRAND.logoUrl}" alt="${CUSTOMER_BRAND.name}" width="187" height="80" style="display:block;width:187px;height:auto;max-width:100%;border:0;">`, "24px 32px 20px", "hiv-logo-wrap hiv-pad")}${row(hero, "26px 32px 28px", "hiv-hero hiv-pad").replace("<tr><td", `<tr bgcolor="${B}" style="background-color:${B};"><td bgcolor="${B}"`)}${row(card, "24px 32px 16px")}${refer ? row(refer, "0 32px 12px") : ""}${row(footer, "12px 32px 16px", "hiv-footer hiv-pad").replace("<tr><td", `<tr bgcolor="#F1F8F3" style="background-color:#F1F8F3;border-top:3px solid ${G};"><td bgcolor="#F1F8F3"`)}`, c.preview, pixel);
  const plainText = `${c.heading}\n\n${c.paras.join("\n\n")}\n${c.bullets ? `\n${c.bullets.map((b) => `✓ ${b}`).join("\n")}\n` : ""}\n${c.cta}: ${target}\nYour secure estimate link is personal to your property.${referral ? `\n\nKNOW SOMEONE WHO MIGHT QUALIFY?\nShare Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.\nREFER A FRIEND: ${referral}` : ""}\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria\nPrivacy: https://homeinsulationvictoria.com.au/privacy · Contact: https://homeinsulationvictoria.com.au/contact\nA secure unsubscribe link appears below.`;
  return { subject: c.subject, previewText: c.preview, html, plainText };
}
