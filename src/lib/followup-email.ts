/** Pure Step 3 follow-up renderers (3-day unopened, 3-day engaged, 7-day). No data access or delivery. */
import { escape, pixelTag, validEstimateUrl, validReferralUrl, validTrackingUrl, type EstimateEmail } from "./estimate-email";
import type { FollowupKind } from "./engagement.core";

export type FollowupEmailInput = { kind: FollowupKind; estimateUrl: string; trackingClickUrl?: string | null; trackingPixelUrl?: string | null; referralUrl?: string | null };

const INCLUDED = "The $349 onsite Measure + PIESA is already included in your indicative project total if you proceed — it is not an extra charge.";
const FOOTNOTE = "*Victorian Government estimates/averages. Actual savings vary with home, climate, energy use, energy prices and heating/cooling habits.";
const COPY: Record<FollowupKind, { subject: string; preview: string; heading: string; paras: string[]; bullets?: string[]; cta: string }> = {
  estimate_unopened_3d: {
    subject: "Just checking you received your HI VIC estimate",
    preview: "Your personalised HI VIC insulation estimate is ready whenever you are.",
    heading: "Just checking you received your HI VIC estimate",
    paras: ["We prepared a personalised indicative estimate for your home a few days ago, including your estimated VEU discount and what's included.", INCLUDED],
    cta: "VIEW MY ESTIMATE",
  },
  estimate_engaged_no_booking_3d: {
    subject: "Ready for us to confirm your estimate onsite?",
    preview: "One onsite Measure + PIESA visit turns your estimate into a final HI VIC-priced quote.",
    heading: "Ready for us to confirm your estimate onsite?",
    paras: ["Thanks for taking a look at your estimate. The next step is a single onsite Measure + PIESA visit by a licensed electrician employed by a Registered Electrical Contractor (REC).", "It confirms your ceiling area, existing insulation, access and electrical safety so we can prepare your final HI VIC-priced quote.", INCLUDED],
    cta: "VIEW MY ESTIMATE",
  },
  estimate_second_reminder_7d: {
    subject: "Your HI VIC insulation estimate is still here for you",
    preview: "A warmer, cooler, more efficient home — your estimate is ready when you are.",
    heading: "Your estimate is still here when you're ready",
    paras: ["A quick, final reminder about your personalised HI VIC estimate. There's no pressure — it's there whenever suits you."],
    bullets: ["Warmer in winter and cooler in summer", "$400+ / year* average potential energy-bill savings", "PIESA by a licensed electrician employed by a REC; installation by an EEC Certified Insulation Installer (CII)", "Transparent HI VIC pricing — partner trades do not decide what you pay"],
    cta: "VIEW MY ESTIMATE",
  },
};

const p = (c: string, extra = "") => `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#22376B;${extra}">${c}</p>`;

export function renderFollowupEmail(input: FollowupEmailInput): EstimateEmail {
  const c = COPY[input.kind];
  if (!c) throw new Error("Unknown follow-up kind.");
  const link = validEstimateUrl(input.estimateUrl);
  const target = validTrackingUrl(input.trackingClickUrl, "click") ?? link.toString();
  const pixel = validTrackingUrl(input.trackingPixelUrl, "pixel");
  const referral = validReferralUrl(input.referralUrl);
  const bullets = c.bullets ? c.bullets.map((b) => p(`<span style="color:#07BF61;font-weight:800;">✓</span> ${escape(b)}`, "margin:0 0 8px;")).join("") + p(escape(FOOTNOTE), "font-size:11px;margin-top:10px;") : "";
  const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(c.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#FBFCFA;font-family:'Open Sans',Arial,Helvetica,sans-serif;color:#22376B;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(c.preview)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#FBFCFA;"><tr><td align="center" style="padding:22px 12px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;">
<tr><td style="padding:24px 24px 18px;"><img src="https://quote.homeinsulationvictoria.com.au/email-preview/hi-vic-logo.png" alt="Home Insulation Victoria" width="205" height="88" style="display:block;width:205px;height:auto;max-width:100%;border:0;"></td></tr>
<tr><td style="padding:0 24px 8px;"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#3C51C4;font-weight:800;">${escape(c.heading)}</h1>${c.paras.map((x) => p(escape(x))).join("")}${bullets}</td></tr>
<tr><td style="padding:8px 24px 28px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" style="background-color:#07BF61;border-radius:8px;"><a href="${escape(target)}" style="display:block;padding:16px 18px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;">${escape(c.cta)}</a></td></tr></table>${p("Your secure estimate link is personal to your property.", "margin-top:10px;font-size:12px;text-align:center;")}</td></tr>
<tr><td style="padding:18px 24px 28px;border-top:1px solid #EEF0FC;">${referral ? p(`Know someone else who may benefit? <a href="${escape(referral)}" style="color:#3C51C4;text-decoration:underline;">Share HI VIC.</a>`, "font-size:12px;") : ""}${p("Home Insulation Victoria", "font-weight:800;margin:0;")}${p("DC Construction Solutions Pty Ltd t/a Home Insulation Victoria", "font-size:12px;margin:0;")}${p('<a href="https://homeinsulationvictoria.com.au" style="color:#3C51C4;text-decoration:underline;">homeinsulationvictoria.com.au</a>', "font-size:12px;margin:0;")}</td></tr>
</table>${pixelTag(pixel)}</td></tr></table></body></html>`;
  const plainText = `${c.heading}\n\n${c.paras.join("\n\n")}\n${c.bullets ? `\n${c.bullets.map((b) => `✓ ${b}`).join("\n")}\n${FOOTNOTE}\n` : ""}\n${c.cta}: ${target}\nYour secure estimate link is personal to your property.${referral ? `\n\nKnow someone else who may benefit? Share HI VIC: ${referral}` : ""}\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd t/a Home Insulation Victoria\nhomeinsulationvictoria.com.au`;
  return { subject: c.subject, previewText: c.preview, html, plainText };
}
