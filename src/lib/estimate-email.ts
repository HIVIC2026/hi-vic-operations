import { READY_CHECK_FEE } from "./readycheck.core";
/** Pure customer outcome email renderers: no data access, delivery, or side effects. */
import { CUSTOMER_BRAND, CUSTOMER_WHAT_COULD_CHANGE } from "./customer-quote-system";

export type CustomerOutcome = "likely" | "onsite" | "ineligible";
export type EstimateEmailInput = {
  estimateUrl: string; outcome?: "likely" | "onsite"; estimatedTotal?: number | null;
  veuDiscount?: number | null; areaM2?: number | null; savingsPercent?: number | null;
  installationPrice?: number | null; installationRatePerM2?: number | null;
  assessmentFee?: number | null; apFee?: number | null; grossProjectTotal?: number | null;
  amountPayableNow?: number | null; estimatedRemainingBalance?: number | null;
  reasons?: string[] | null; apCount?: number | null; reference?: string | null;
  firstName?: string | null; address?: string | null;
  existingInsulationPresent?: boolean;
  /** True when the ceiling size is the typical-home default rather than a declared/measured figure. */
  areaIsTypical?: boolean;
  trackingClickUrl?: string | null; trackingPixelUrl?: string | null; referralUrl?: string | null;
};
export type IneligibleOutcomeEmailInput = {
  reasons?: string[] | null; referralUrl: string; resultUrl?: string | null;
  reference?: string | null | undefined; apCount?: number | null | undefined;
};
export type EstimateEmail = { subject: string; previewText: string; html: string; plainText: string };

const BASE = "https://quote.homeinsulationvictoria.com.au";
/** Verified live brand logo (HTTP 200 image/png) used in every customer email. */
const LOGO_URL = CUSTOMER_BRAND.logoUrl;
const SITE = "https://homeinsulationvictoria.com.au";
const BLUE = CUSTOMER_BRAND.colors.blue;
const GREEN = CUSTOMER_BRAND.colors.green;
const INK = CUSTOMER_BRAND.colors.navy;
const OUTER = CUSTOMER_BRAND.colors.offWhite;
const WHITE = CUSTOMER_BRAND.colors.white;

export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const money = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
const number = (n: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(n);
const cleanReasons = (reasons: string[] | null | undefined) => (reasons ?? []).map((r) => r.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 6);
const customerSafeOnsiteReasons = (reasons: string[] | null | undefined) => {
  const seen = new Set<string>();
  return cleanReasons(reasons).flatMap((reason) => {
    const normalized = reason.toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const matches: Array<[string, string]> = [];
    if (/insulat/.test(normalized)) matches.push(["existing-insulation", "Existing insulation — confirm what is currently installed and whether removal is required."]);
    if (/access|roof space|ceiling space/.test(normalized)) matches.push(["ceiling-access", "Ceiling access — confirm access conditions and whether any access adjustment applies."]);
    if (/area|ceiling size|measure/.test(normalized)) matches.push(["ceiling-area", "Ceiling area — confirm the measured eligible ceiling area."]);
    if (!matches.length) matches.push([normalized, /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(reason.trim()) ? reason.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : reason]);
    return matches.flatMap(([key, copy]) => {
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [copy];
    });
  });
};

/** Tracked Home Insulation Victoria URLs only: /t/e/<token> and /t/o/<token>.gif. */
export function validTrackingUrl(u: string | null | undefined, kind: "click" | "pixel"): string | null {
  if (u == null) return null;
  const x = new URL(u);
  const re = kind === "click" ? /^\/t\/e\/[A-Za-z0-9_-]{43,128}$/ : /^\/t\/o\/[A-Za-z0-9_-]{43,128}\.gif$/;
  if (x.origin !== BASE || !re.test(x.pathname) || x.search || x.hash) throw new Error("A Home Insulation Victoria tracking link is required.");
  return x.toString();
}
export function validEstimateUrl(u: string): URL {
  const link = new URL(u);
  if (link.origin !== BASE || !/^\/estimate\/[A-Za-z0-9_-]+\/?$/.test(link.pathname) || link.search || link.hash) throw new Error("A secure Home Insulation Victoria estimate link is required.");
  return link;
}
const REFERRAL_ORIGIN = SITE;
export function validReferralUrl(u: string | null | undefined): string | null {
  if (u == null) return null;
  const x = new URL(u);
  if (x.origin !== REFERRAL_ORIGIN || x.pathname !== "/homeowner" || x.hash || [...x.searchParams.keys()].join() !== "ref" || !/^[A-Za-z0-9_-]{43}$/.test(x.searchParams.get("ref") ?? "")) throw new Error("A Home Insulation Victoria referral link is required.");
  return x.toString();
}
export const pixelTag = (u: string | null) => (u ? `<img src="${escape(u)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;">` : "");

/** Hidden inbox preview text. Wrapped in a non-MSO conditional so Outlook desktop never receives it. */
export function preheader(preview: string) {
  return `<!--[if !mso]><!--><div style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escape(preview)}</div><!--<![endif]-->`;
}
/** Manual QA marker: test-only banners are injected here, inside the visible 640px body before the logo row. Renders nothing. */
export const TEST_BANNER_SLOT = "<!-- HIV_TEST_BANNER_SLOT -->";

/** Shared link + arithmetic validation for the likely and onsite renderers. Throws rather than rendering $0/undefined. */
function validateQuoteInput(input: EstimateEmailInput) {
  const link = validEstimateUrl(input.estimateUrl);
  const trackedTarget = validTrackingUrl(input.trackingClickUrl, "click");
  const confirmTarget = trackedTarget ?? `${link.toString().replace(/\/$/, "")}#confirm`;
  const calculatorTarget = `${link.toString().replace(/\/$/, "")}#calculator`;
  const pixel = validTrackingUrl(input.trackingPixelUrl, "pixel");
  const referralUrl = validReferralUrl(input.referralUrl);
  const values = [input.estimatedTotal, input.veuDiscount, input.areaM2];
  if (!values.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) throw new Error("Outcome emails require positive estimate total, VEU discount and ceiling area values.");
  const customer = input.estimatedTotal as number;
  const discount = input.veuDiscount as number;
  const area = input.areaM2 as number;
  const packagePrice = customer + discount;
  const breakdownValues = [input.installationPrice, input.assessmentFee, input.apFee, input.grossProjectTotal, input.amountPayableNow, input.estimatedRemainingBalance];
  const hasAnyBreakdown = breakdownValues.some((value) => value != null) || input.installationRatePerM2 != null;
  const hasBreakdown = breakdownValues.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (hasAnyBreakdown && !hasBreakdown) throw new Error("A complete non-negative likely-email quote breakdown is required.");
  const installation = input.installationPrice as number;
  const assessment = input.assessmentFee as number;
  const apFee = input.apFee as number;
  const gross = input.grossProjectTotal as number;
  const payableNow = input.amountPayableNow as number;
  const remaining = input.estimatedRemainingBalance as number;
  const rate = input.installationRatePerM2;
  const closeEnough = (a: number, b: number) => Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= 1;
  if (hasBreakdown) {
    if (!closeEnough(payableNow, READY_CHECK_FEE)) throw new Error("The amount payable now must be $0 because the Home Insulation Ready Check is free.");
    if (!closeEnough(installation + assessment + apFee, gross)) throw new Error("Quote line items must reconcile to the gross project total.");
    if (!closeEnough(gross - discount, customer)) throw new Error("Gross project total less VEU discount must equal the estimated customer price.");
    if (!closeEnough(customer - payableNow, remaining)) throw new Error("Estimated customer price less the amount payable now must equal the remaining balance.");
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) throw new Error("The installation rate must be a finite non-negative value.");
  }
  return { confirmTarget, calculatorTarget, pixel, referralUrl, customer, discount, area, packagePrice, hasBreakdown, installation, assessment, apFee, gross };
}

export function renderEstimateEmail(input: EstimateEmailInput): EstimateEmail {
  const outcome = input.outcome ?? "likely";
  if (outcome === "likely") return renderLikelyEligibleEmail({ ...input, outcome });
  return renderOnsiteEmail({ ...input, outcome });
}

// ---------------------------------------------------------------------------
// Current approved eligible-outcome email system.
// ---------------------------------------------------------------------------

/** Clean public calculator (no customer data in the URL). */
export const PUBLIC_CALCULATOR_URL = "https://estimate.homeinsulationvictoria.com.au/";
const TEXT_GREEN = "#067A45";
const MIST = "#F3F6FF";
const MINT = "#EDFAF2";
const BLUSH = "#FDF2F6";
const LINE = "#E4E9F5";
const FIGTREE = "'Figtree',Arial,Helvetica,sans-serif";
const OUTFIT = "'Outfit','Figtree',Arial,Helvetica,sans-serif";

export function likelySubjectLine(firstName: string | null | undefined, discount: number | null | undefined) {
  const name = firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const amount = typeof discount === "number" && Number.isFinite(discount) && discount > 0 ? money(discount) : null;
  const subject = amount
    ? `${name ? `${name}, you` : "You"} could save ${amount} on ceiling insulation`
    : `${name ? `${name}, your` : "Your"} preliminary ceiling insulation estimate is ready`;
  const previewText = "See your estimated VEU rebate, then arrange your free measure-up & eligibility check — no obligation to proceed.";
  return { subject, previewText };
}

function likelyV2Shell(content: string, preview: string, pixel: string | null) {
  const css = `<style type="text/css">
body,table,td,p,a,span{font-family:${FIGTREE};}h1,h2,h3{font-family:${OUTFIT};font-weight:800}
a{text-decoration:none}
@media only screen and (max-width:480px){.lx-outer{padding:0!important}.lx-main{border-radius:0!important}.lx-pad{padding-left:18px!important;padding-right:18px!important}.lx-h1{font-size:28px!important;line-height:32px!important}.lx-saving{font-size:32px!important;line-height:36px!important}.lx-cost{font-size:40px!important;line-height:44px!important}.lx-logo{width:124px!important}.lx-badge{font-size:9px!important;padding:6px 9px!important}.lx-result-pad{padding:18px 14px!important}.lx-row-amt{width:80px!important;font-size:13px!important}.lx-button{font-size:14px!important;padding:14px 12px!important}.lx-body{font-size:14px!important}.lx-footer{padding-top:20px!important;padding-bottom:22px!important}}
</style>`;
  return `<!doctype html><html lang="en-AU" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escape(preview)}</title><!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&amp;family=Outfit:wght@700;800&amp;display=swap" rel="stylesheet"><!--<![endif]--><!--[if mso]><style type="text/css">body,table,td,p,a,span{font-family:Arial,Helvetica,sans-serif!important}h1,h2,h3{font-family:Arial,Helvetica,sans-serif!important;font-weight:bold!important}</style><![endif]-->${css}</head><body lang="en-AU" dir="ltr" style="margin:0;padding:0;background-color:${OUTER};font-family:${FIGTREE};color:${INK};">${preheader(preview)}<table role="presentation" lang="en-AU" dir="ltr" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:collapse;background-color:${OUTER};"><tr><td class="lx-outer" align="center" style="padding:20px 0 36px;"><table class="hiv-main lx-main" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;max-width:640px;border-collapse:separate;border-spacing:0;background-color:${WHITE};border-radius:24px;box-shadow:0 30px 70px -45px rgba(34,55,107,.45);">${TEST_BANNER_SLOT}${content}</table>${pixelTag(pixel)}</td></tr></table></body></html>`;
}

const ONSITE_FALLBACK_REASON = "A few property details that can only be confirmed onsite, such as ceiling size, existing insulation and access.";
const F = `font-family:${FIGTREE};`;
const FH = `font-family:${OUTFIT};`;
/** Approved compact white footer (likely email). `reason` is the only outcome-specific line. */
function v2Footer(reference: string | null | undefined, referralUrl: string | null, reason: string, campaignOptOutUrl?: string | null) {
  const optOut = campaignOptOutUrl
    ? `<a href="${escape(campaignOptOutUrl)}" style="color:${BLUE};text-decoration:underline;">Remove my enquiry</a>`
    : "<!--HIV_SECURE_UNSUBSCRIBE_LINK-->";
  const footerLinks = `<span style="display:inline-block;white-space:nowrap;"><a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact us</a></span><span style="display:inline-block;white-space:nowrap;">&nbsp;·&nbsp;<a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a></span>${referralUrl ? `<span style="display:inline-block;white-space:nowrap;">&nbsp;·&nbsp;<a href="${escape(referralUrl)}" style="color:${BLUE};text-decoration:underline;">Refer a friend</a></span>` : ""}<span style="display:inline-block;white-space:nowrap;">&nbsp;·&nbsp;${optOut}</span>`;
  return `<p style="margin:0 0 5px;${F}color:${INK};font-size:14px;line-height:1.4;font-weight:800;text-align:center;">Home Insulation Victoria</p><p style="margin:0;${F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.</p><p style="margin:5px 0 9px;${F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;">${escape(reason)}</p><p style="margin:0;${F}color:${BLUE};font-size:12px;line-height:1.7;text-align:center;">${footerLinks}</p>${reference?.trim() ? `<p style="margin:7px 0 0;${F}color:#5A6785;font-size:10.5px;line-height:1.4;text-align:center;">Reference: ${escape(reference.trim())}</p>` : ""}`;
}
const v2FooterPlain = (reference: string | null | undefined, referralUrl: string | null, reason: string) => [
  "Home Insulation Victoria",
  "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.",
  reason,
  `Contact us: ${SITE}/contact · Privacy: ${SITE}/privacy${referralUrl ? ` · Refer a friend: ${referralUrl}` : ""}`,
  ...(reference?.trim() ? [`Reference: ${reference.trim()}`] : []),
];
const v2FooterRow = (footer: string) => `<tr><td class="lx-pad" style="padding:20px 36px;${F}background-color:${WHITE};border-top:1px solid ${LINE};border-radius:0 0 24px 24px;">${footer}</td></tr>`;
const v2Header = (badge: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td valign="middle"><img class="lx-logo hiv-logo" src="${LOGO_URL}" alt="Home Insulation Victoria" width="142" height="61" style="display:block;width:142px;height:auto;max-width:100%;border:0;"></td><td align="right" valign="middle"><span class="lx-badge" style="display:inline-block;padding:7px 11px;background-color:${BLUSH};border-radius:999px;${F}color:${INK};font-size:10px;line-height:1.2;font-weight:800;letter-spacing:.7px;text-transform:uppercase;">${badge}</span></td></tr></table>`;
const v2Button = (href: string, text: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td align="center" bgcolor="${GREEN}" style="background-color:${GREEN};border:0;border-radius:12px;mso-padding-alt:15px 18px;box-shadow:0 10px 24px -12px rgba(7,191,97,.55);"><a class="lx-button" href="${escape(href)}" style="display:block;padding:15px 18px;${F}color:${WHITE};font-size:16px;line-height:20px;font-weight:800;text-decoration:none;border-radius:12px;">${text}</a></td></tr></table>`;
const neutralItem = (t: string) => `<p style="margin:0 0 6px;${F}color:${INK};font-size:13.5px;line-height:1.5;"><span style="color:#8A96B3;font-weight:800;">•</span>&nbsp; ${escape(t)}</p>`;

type V2SavingsInput = {
  address: string | null; area: number; areaIsTypical?: boolean; discount: number; customer: number; gross: number;
  rebateLabel: string; costLabel: string; qualifier: string; hasBreakdown: boolean; installation: number; assessment: number; apFee: number;
  apCount?: number | null;
};

/** The approved estimate/savings module, shared byte-for-byte by eligible-outcome and launch-campaign emails. */
function v2SavingsModule(input: V2SavingsInput) {
  const areaNote = input.areaIsTypical ? `${escape(number(input.area))} m² (typical-home assumption)` : `${escape(number(input.area))} m²`;
  const summary = `${input.address ? `<tr><td style="padding:4px 0;${F}color:${INK};font-size:13px;">Property</td><td align="right" style="padding:4px 0 4px 12px;${F}color:${INK};font-size:13px;font-weight:800;">${escape(input.address)}</td></tr>` : ""}<tr><td style="padding:4px 0;${F}color:${INK};font-size:13px;">Ceiling</td><td align="right" style="padding:4px 0 4px 12px;${F}color:${INK};font-size:13px;font-weight:800;">${areaNote}</td></tr>`;
  const line = (t: string, amt: string, note: string, top: boolean) => `<tr><td valign="top" style="padding:8px 12px 2px 0;${top ? "" : `border-top:1px solid ${LINE};`}${F}color:${INK};font-size:14px;line-height:1.45;">${t}</td><td class="lx-row-amt" width="96" align="right" valign="top" style="width:96px;padding:8px 0 2px;${top ? "" : `border-top:1px solid ${LINE};`}${F}color:${INK};font-size:14px;line-height:1.45;font-weight:700;white-space:nowrap;">${amt}</td></tr><tr><td colspan="2" style="padding:0 0 8px;${F}color:${INK};font-size:12.5px;line-height:1.45;">${note}</td></tr>`;
  const rows = [
    { title: "Free Insulation Measure-Up & Eligibility Check", description: "We measure your ceiling, assess whether any existing insulation can stay or needs removal, and confirm eligibility and the job scope.", amount: `<span style="color:${GREEN};font-weight:800;">FREE</span>`, plain: ": FREE" },
    { title: "R5.0 ceiling insulation — supply & install", description: "Fitted by a pre-vetted Certified Insulation Installer (CII) from our panel.", amount: input.hasBreakdown ? escape(money(input.installation)) : "", plain: input.hasBreakdown ? `: ${money(input.installation)}` : "" },
    { title: "Electrical safety assessment (PIESA)", description: "A mandatory check by a pre-vetted REC electrician, close to installation.", amount: input.hasBreakdown ? escape(money(input.assessment)) : "", plain: input.hasBreakdown ? `: ${money(input.assessment)}` : "" },
    { title: "Accredited Person (AP) management", description: "Our accreditation gives you access to the VEU rebate. We handle compliance, paperwork and your claim.", amount: input.hasBreakdown ? escape(money(input.apFee)) : "", plain: input.hasBreakdown ? `: ${money(input.apFee)}` : "" },
  ];
  const tick = `<span aria-hidden="true" style="white-space:nowrap;color:${GREEN};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1;">✓&nbsp;</span>`;
  const items = rows.map(({ title, description, amount }, i) => line(`${tick}<strong style="font-size:14px;">${escape(title)}</strong>`, amount, escape(description), i === 0)).join("");
  const validApCount = typeof input.apCount === "number" && Number.isInteger(input.apCount) && input.apCount > 0;
  const apCountText = validApCount ? (input.apCount === 2 ? "two" : String(input.apCount)) : null;
  const apTrust = apCountText ? `<p style="margin:11px 0 0;padding-top:11px;border-top:1px solid ${LINE};${F}color:${INK};font-size:12.5px;line-height:1.5;font-weight:700;">We’re one of only ${escape(apCountText)} Accredited Person${input.apCount === 1 ? "" : "s"} approved for VEU ceiling insulation in Victoria.</p>` : "";
  const includes = `<table data-likely-itemised="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;margin-top:14px;border-collapse:separate;background-color:${WHITE};border-radius:14px;"><tr><td style="padding:15px 16px;${F}"><p style="margin:0 0 6px;${FH}color:${INK};font-size:14px;line-height:1.3;font-weight:800;">What this includes</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${items}</table>${apTrust}</td></tr></table>`;
  const calc = `<p data-likely-calculator="true" style="margin:12px 0 0;${F}color:${INK};font-size:14px;line-height:1.5;text-align:center;">Want to explore a different ceiling size? <a href="${escape(PUBLIC_CALCULATOR_URL)}" style="color:${BLUE};font-weight:800;text-decoration:underline;white-space:nowrap;">Open&nbsp;the&nbsp;calculator&nbsp;→</a></p>`;
  const html = `<table data-likely-savings="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MIST}" style="width:100%;border-collapse:separate;background-color:${MIST};border-radius:22px;"><tr><td class="lx-result-pad" style="padding:22px 20px;${F}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MINT}" style="width:100%;border-collapse:separate;background-color:${MINT};border:2px solid ${GREEN};border-radius:18px;"><tr><td align="center" style="padding:18px 12px;${F}"><p style="margin:0;${F}color:${INK};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">${input.rebateLabel}</p><p class="lx-saving" style="margin:5px 0 0;${FH}color:${GREEN};font-size:38px;line-height:42px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">You could save ${escape(money(input.discount))}</p></td></tr></table><div style="text-align:center;padding:18px 0 12px;"><p style="margin:0;${F}color:${INK};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">${input.costLabel}</p><p class="lx-cost" style="margin:5px 0 0;${FH}color:${BLUE};font-size:46px;line-height:50px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">${escape(money(input.customer))}</p><p style="margin:4px 0 0;${F}color:${INK};font-size:12px;line-height:1.4;font-weight:700;">incl. GST · before rebate ${escape(money(input.gross))}</p><p style="margin:8px auto 0;max-width:390px;${F}color:${INK};font-size:11px;line-height:1.5;">${input.qualifier}</p></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid ${LINE};">${summary}</table>${calc}${includes}</td></tr></table>`;
  return { html, rows, apCountText };
}

function v2WhatCouldChange() {
  const changes = ["Final measured ceiling size", "Existing insulation or removal", "Ceiling access", "Electrical rectification identified during PIESA"];
  const changeItems = changes.map((item) => `<p style="margin:0 0 6px;${F}color:${INK};font-size:13px;line-height:1.45;"><span style="color:${GREEN};font-weight:800;">•</span>&nbsp; ${escape(item)}</p>`).join("");
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MIST}" style="width:100%;border-collapse:separate;background-color:${MIST};border-radius:14px;"><tr><td style="padding:17px 18px;${F}"><p style="margin:0 0 10px;${FH}color:${INK};font-size:17px;line-height:1.3;font-weight:800;">What could change this price?</p>${changeItems}<p style="margin:12px 0 0;padding-top:12px;border-top:1px solid ${LINE};${F}color:${INK};font-size:13px;line-height:1.5;font-weight:700;">${escape(CUSTOMER_WHAT_COULD_CHANGE.closing)}</p></td></tr></table>`;
  return { html, changes };
}

function renderLikelyEligibleEmail(input: EstimateEmailInput): EstimateEmail {
  return renderV2QuoteEmail(input, "likely");
}
function renderOnsiteEmail(input: EstimateEmailInput): EstimateEmail {
  return renderV2QuoteEmail(input, "onsite");
}

function renderV2QuoteEmail(input: EstimateEmailInput, kind: "likely" | "onsite"): EstimateEmail {
  const { confirmTarget, pixel, referralUrl, customer, discount, area, packagePrice, hasBreakdown, installation, assessment, apFee, gross } = validateQuoteInput(input);
  const onsite = kind === "onsite";
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60) || null;
  const address = input.address?.trim().replace(/\s+/g, " ").slice(0, 180) || null;
  const { subject, previewText } = onsite
    ? { subject: "Your insulation estimate — a few details to confirm", previewText: "See your potential VEU rebate, then arrange your free measure-up & eligibility check — no obligation to proceed." }
    : likelySubjectLine(name, discount);
  const onsiteReasons = onsite ? (customerSafeOnsiteReasons(input.reasons).length ? customerSafeOnsiteReasons(input.reasons) : [ONSITE_FALLBACK_REASON]) : [];
  const onsiteIntro = `${name ? `${name}, your` : "Your"} home may qualify for a VEU ceiling insulation rebate. We just need to confirm a few details onsite.`;
  const rebateLabel = onsite ? "Your potential VEU rebate" : "Your estimated VEU rebate";
  const costLabel = onsite ? "Estimated cost if eligible" : "Your estimated cost after rebate";
  const qualifier = onsite ? "Indicative estimate only. Eligibility, ceiling measurements and final pricing still need to be confirmed." : "Estimate only. Eligibility, measurements and final pricing confirmed after assessment.";
  const row = (content: string, pad = "0 36px 28px", extra = "") => `<tr><td class="lx-pad" style="padding:${pad};${F}${extra}">${content}</td></tr>`;
  const p = (t: string, s = "") => `<p class="lx-body" style="margin:0;${F}color:${INK};font-size:15px;line-height:1.6;${s}">${t}</p>`;
  const h2 = (t: string) => `<h2 style="margin:0 0 12px;${FH}color:${INK};font-size:23px;line-height:1.2;font-weight:800;letter-spacing:0;">${t}</h2>`;

  // 1. Header
  const header = v2Header("Free estimate · no obligation");

  // 2. Hero
  const goodNews = name ? `Good news, ${escape(name)} — based` : "Good news — based";
  const likelyHero = `<p style="margin:0 0 8px;${F}color:${TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Preliminary eligibility result</p><h1 class="lx-h1 hiv-hero-title" style="margin:0 0 14px;${FH}color:${INK};font-size:34px;line-height:39px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">How much could you save on ceiling insulation?</h1>${p(`${goodNews} on what you’ve told us, your home looks likely to qualify for a VEU ceiling insulation rebate.`)}${p("A more comfortable home could be closer than you think. We’ll coordinate the installer, electrical checks and paperwork.", "margin-top:8px;")}`;
  const hero = onsite
    ? `<p style="margin:0 0 8px;${F}color:${TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Preliminary eligibility result</p><h1 class="lx-h1 hiv-hero-title" style="margin:0 0 14px;${FH}color:${INK};font-size:34px;line-height:39px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">It’s looking good — let’s check a few details</h1>${p(escape(onsiteIntro))}<div data-onsite-reasons="true" style="margin-top:16px;"><p style="margin:0 0 8px;${FH}color:${INK};font-size:15px;line-height:1.3;font-weight:800;">What we need to confirm</p>${onsiteReasons.map(neutralItem).join("")}</div>`
    : likelyHero;

  // 3. Savings module (echoes the standalone calculator) with the single inclusions breakdown
  const savingsModule = v2SavingsModule({ address, area, ...(input.areaIsTypical == null ? {} : { areaIsTypical: input.areaIsTypical }), discount, customer, gross: hasBreakdown ? gross : packagePrice, rebateLabel, costLabel, qualifier, hasBreakdown, installation, assessment, apFee, ...(input.apCount === undefined ? {} : { apCount: input.apCount }) });
  const savings = savingsModule.html;
  const { rows, apCountText } = savingsModule;

  // 4. Primary conversion: the next step
  const nextStep = `<table data-likely-next-step="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUSH}" style="width:100%;border-collapse:separate;background-color:${BLUSH};border-radius:20px;"><tr><td style="padding:22px 22px;${F}">${h2("Free Insulation Measure-Up &amp; Eligibility Check")}<p class="lx-body" style="margin:0 0 12px;${F}color:${INK};font-size:14px;line-height:1.55;">Your installer measures the ceiling, assesses any existing insulation, confirms eligibility and prepares the job scope so we can confirm your quote.</p><p style="margin:0 0 12px;${F}color:${INK};font-size:14px;line-height:1.45;font-weight:800;">Demand is high. Installer availability is limited.</p>${v2Button(confirmTarget, "Arrange my free measure-up &amp; eligibility check →")}<p style="margin:10px 0 0;${F}color:${INK};font-size:12.5px;line-height:1.5;text-align:center;">Confirm your request on the next page. An installer from our panel will then contact you to arrange a time.</p><p style="margin:8px 0 0;${F}color:${INK};font-size:12.5px;line-height:1.5;font-weight:700;text-align:center;">No payment required. No obligation to proceed with installation.</p></td></tr></table>`;

  // 6. Price qualifications
  const changesModule = v2WhatCouldChange();
  const estimate = changesModule.html;
  const { changes } = changesModule;

  // 7. Footer
  const footer = v2Footer(input.reference, referralUrl, "You’re receiving this because you requested an insulation estimate.");

  const html = likelyV2Shell(
    `${row(header, "22px 36px 18px")}${row(hero, "8px 36px 24px")}${row(savings, "0 28px 22px")}${row(nextStep, "0 28px 18px")}${row(estimate, "0 28px 24px")}${v2FooterRow(footer)}`,
    previewText, pixel,
  );

  const plainText = [
    subject, "",
    ...(onsite
      ? ["It’s looking good — let’s check a few details", "", onsiteIntro, "", "WHAT WE NEED TO CONFIRM", ...onsiteReasons.map((r) => `• ${r}`), ""]
      : ["How much could you save on ceiling insulation?", "",
        `${name ? `Good news, ${name} — based` : "Good news — based"} on what you’ve told us, your home looks likely to qualify for a VEU ceiling insulation rebate.`,
        "A more comfortable home could be closer than you think. We’ll coordinate the installer, electrical checks and paperwork.", ""]),
    "YOUR ESTIMATE",
    `${rebateLabel}: You could save ${money(discount)}`,
    `${costLabel}: ${money(customer)}`,
    `incl. GST · before rebate ${money(hasBreakdown ? gross : packagePrice)}`,
    qualifier,
    ...(address ? [`Property: ${address}`] : []),
    `Ceiling: ${number(area)} m²${input.areaIsTypical ? " (typical-home assumption)" : ""}`,
    `Want to explore a different ceiling size? Open the calculator: ${PUBLIC_CALCULATOR_URL}`, "", "WHAT THIS INCLUDES", ...rows.map(({ title, description, plain }) => `✓ ${title}${plain}
${description}`),
    ...(apCountText ? [`We’re one of only ${apCountText} Accredited Person${input.apCount === 1 ? "" : "s"} approved for VEU ceiling insulation in Victoria.`] : []), "",
    "FREE INSULATION MEASURE-UP & ELIGIBILITY CHECK",
    "Your installer measures the ceiling, assesses any existing insulation, confirms eligibility and prepares the job scope so we can confirm your quote.",
    "Demand is high. Installer availability is limited.",
    `Arrange my free measure-up & eligibility check: ${confirmTarget}`,
    "Confirm your request on the next page. An installer from our panel will then contact you to arrange a time.",
    "No payment required. No obligation to proceed with installation.", "",
    "WHAT COULD CHANGE THIS PRICE?",
    ...changes.map((item) => `• ${item}`),
    CUSTOMER_WHAT_COULD_CHANGE.closing, "",
    ...v2FooterPlain(input.reference, referralUrl, "You’re receiving this because you requested an insulation estimate."),
  ].join("\n");
  return { subject, previewText, html, plainText };
}

export function renderIneligibleOutcomeEmail(input: IneligibleOutcomeEmailInput): EstimateEmail {
  const referralUrl = validReferralUrl(input.referralUrl);
  if (!referralUrl) throw new Error("A Home Insulation Victoria referral link is required.");
  const reasons = cleanReasons(input.reasons);
  const resultUrl = input.resultUrl ?? `${SITE}/homeowner`;
  const parsedResultUrl = new URL(resultUrl);
  const secureEstimateResult = parsedResultUrl.origin === BASE && /^\/estimate\/[A-Za-z0-9_-]+\/?$/.test(parsedResultUrl.pathname) && !parsedResultUrl.search && (!parsedResultUrl.hash || parsedResultUrl.hash === "#result");
  const homeownerResult = parsedResultUrl.origin === SITE && parsedResultUrl.pathname === "/homeowner" && !parsedResultUrl.search && !parsedResultUrl.hash;
  if (!secureEstimateResult && !homeownerResult) throw new Error("A secure Home Insulation Victoria result link is required.");
  const subject = "Your ceiling insulation eligibility result";
  const previewText = "Your preliminary eligibility result, and what to do if any details look wrong.";
  const fallback = "Based on the details provided, the property doesn’t meet the current requirements for a VEU ceiling insulation rebate.";
  const resultReasons = [...new Set(reasons.length ? reasons : [fallback])];
  const intro = "Based on the information provided, this property doesn’t appear eligible for a VEU ceiling insulation rebate at this stage.";
  const row = (content: string, pad: string) => `<tr><td class="lx-pad" style="padding:${pad};${F}">${content}</td></tr>`;
  const hero = `<p style="margin:0 0 8px;${F}color:${TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Preliminary eligibility result</p><h1 class="lx-h1 hiv-hero-title" style="margin:0 0 14px;${FH}color:${INK};font-size:34px;line-height:39px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">Your ceiling insulation eligibility result</h1><p class="lx-body" style="margin:0;${F}color:${INK};font-size:15px;line-height:1.6;">${escape(intro)}</p>`;
  const found = `<table data-ineligible-found="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MIST}" style="width:100%;border-collapse:separate;background-color:${MIST};border-radius:18px;"><tr><td class="lx-result-pad" style="padding:20px 20px;${F}"><p style="margin:0 0 10px;${FH}color:${INK};font-size:17px;line-height:1.3;font-weight:800;">What we found</p>${resultReasons.map(neutralItem).join("")}<p style="margin:10px 0 0;padding-top:10px;border-top:1px solid ${LINE};${F}color:${INK};font-size:12.5px;line-height:1.5;">For eligible upgrades, we coordinate pre-vetted installers and electricians, compliance and the rebate paperwork.</p></td></tr></table>`;
  const review = `<table data-ineligible-review="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUSH}" style="width:100%;border-collapse:separate;background-color:${BLUSH};border-radius:20px;"><tr><td style="padding:22px 22px;${F}"><h2 style="margin:0 0 12px;${FH}color:${INK};font-size:23px;line-height:1.2;font-weight:800;letter-spacing:0;">Something doesn’t look right?</h2><p class="lx-body" style="margin:0 0 14px;${F}color:${INK};font-size:14px;line-height:1.55;">If any details are incorrect, review your result or contact us so we can check them.</p>${v2Button(resultUrl, "Review my result →")}<p style="margin:10px 0 0;${F}color:${INK};font-size:13px;line-height:1.5;text-align:center;">Or <a href="${SITE}/contact" style="color:${BLUE};font-weight:800;text-decoration:underline;">contact us</a></p></td></tr></table>`;
  const refer = `<p data-ineligible-referral="true" style="margin:0;${F}color:${INK};font-size:13.5px;line-height:1.55;text-align:center;">Know someone else thinking about ceiling insulation? They can check their own eligibility. <a href="${escape(referralUrl)}" style="color:${BLUE};font-weight:800;text-decoration:underline;white-space:nowrap;">Refer&nbsp;a&nbsp;friend&nbsp;→</a></p>`;
  const reason = "You’re receiving this because you requested an eligibility check.";
  const html = likelyV2Shell(`${row(v2Header("Eligibility result"), "22px 36px 18px")}${row(hero, "8px 36px 24px")}${row(found, "0 28px 18px")}${row(review, "0 28px 18px")}${row(refer, "4px 36px 24px")}${v2FooterRow(v2Footer(input.reference, referralUrl, reason))}`, previewText, null);
  const plainText = [
    subject, "", "Your ceiling insulation eligibility result", "", intro, "",
    "WHAT WE FOUND", ...resultReasons.map((r) => `• ${r}`),
    "For eligible upgrades, we coordinate pre-vetted installers and electricians, compliance and the rebate paperwork.", "",
    "SOMETHING DOESN’T LOOK RIGHT?",
    "If any details are incorrect, review your result or contact us so we can check them.",
    `Review my result: ${resultUrl}`,
    `Or contact us: ${SITE}/contact`, "",
    "Know someone else thinking about ceiling insulation? They can check their own eligibility.",
    `Refer a friend: ${referralUrl}`, "",
    ...v2FooterPlain(input.reference, referralUrl, reason),
  ].join("\n");
  return { subject, previewText, html, plainText };
}

/** Shared approved theme kit for other customer emails (follow-ups, service updates). Read-only re-export; does not alter outcome emails. */
export const V2_THEME = {
  shell: likelyV2Shell, header: v2Header, button: v2Button, footer: v2Footer, footerPlain: v2FooterPlain, footerRow: v2FooterRow, neutralItem, savings: v2SavingsModule, whatCouldChange: v2WhatCouldChange,
  F, FH, colors: { BLUE, GREEN, INK, TEXT_GREEN, MIST, MINT, BLUSH, LINE, WHITE }, site: SITE,
} as const;

export type LaunchCampaignEmailInput = {
  group: "likely" | "onsite";
  campaignUrl: string;
  unsubscribeUrl: string;
  firstName?: string | null;
  estimatedTotal: number;
  veuDiscount: number;
  grossTotal: number;
  areaM2: number;
  address?: string | null;
  reference?: string | null;
  /** Office draft wording (preview only). Blank/missing = approved default. "{name}" = first name. */
  copy?: Partial<Record<LaunchCopyField, string>> | null;
};
export type LaunchCopyField = "subject" | "previewText" | "headline" | "intro" | "video" | "nextTitle" | "urgency" | "button";

/** Draft-only launch email assembled from the exact approved V2 outcome-email pieces. */
export function renderLaunchCampaignEmail(input: LaunchCampaignEmailInput): EstimateEmail {
  const campaign = new URL(input.campaignUrl);
  if (campaign.origin !== BASE || !/^\/estimate\/[A-Za-z0-9_-]{43,128}\/campaign$/.test(campaign.pathname) || campaign.search || campaign.hash) throw new Error("A secure Home Insulation Victoria campaign link is required.");
  const unsubscribe = new URL(input.unsubscribeUrl);
  if (unsubscribe.origin !== BASE || unsubscribe.pathname !== "/email/unsubscribe" || !isWellFormedToken(unsubscribe.searchParams.get("t"))) throw new Error("A secure unsubscribe link is required.");
  const amounts = [input.estimatedTotal, input.veuDiscount, input.grossTotal, input.areaM2];
  if (!amounts.every((value) => Number.isFinite(value) && value > 0) || Math.abs(input.estimatedTotal + input.veuDiscount - input.grossTotal) > 0.01) throw new Error("Campaign email estimate values must be positive and reconcile.");
  const onsite = input.group === "onsite";
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60) || null;
  const c = input.copy ?? {};
  const fill = (v: string | undefined) => (v && v.trim() ? v.trim().replace(/\{name\}\s*/g, name ? `${name} ` : "").replace(/\s+([,!.])/g, "$1").replace(/^[,\s]+/, "").replace(/^./, (x) => x.toUpperCase()) : null);
  const greeting0 = onsite ? `Good news${name ? `, ${escape(name)}` : ""}!` : `Great news${name ? `, ${escape(name)}` : ""}!`;
  const eligibility0 = onsite ? "Your home could be eligible for a VEU ceiling insulation rebate." : "Your home appears eligible for a VEU ceiling insulation rebate.";
  const subject0 = onsite ? `${name ? `${name}, your` : "Your"} home could be eligible for an insulation rebate` : `${name ? `${name}, your` : "Your"} home appears eligible for an insulation rebate`;
  const previewText0 = onsite ? "Send one quick manhole video and jump the queue." : "Save your place for a free Ready Check. No payment and no obligation.";
  const greeting = fill(c.headline) ? escape(fill(c.headline)!) : greeting0;
  const eligibility = fill(c.intro) ? escape(fill(c.intro)!) : eligibility0;
  const subject = fill(c.subject) ?? subject0;
  const previewText = fill(c.previewText) ?? previewText0;
  const row = (content: string, pad: string) => `<tr><td class="lx-pad" style="padding:${pad};${F}">${content}</td></tr>`;
  const hero = `<p style="margin:0 0 8px;${F}color:${TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Preliminary eligibility result</p><h1 class="lx-h1 hiv-hero-title" style="margin:0 0 14px;${FH}color:${INK};font-size:34px;line-height:39px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">${greeting}</h1><p class="lx-body" style="margin:0;${F}color:${INK};font-size:15px;line-height:1.6;">${eligibility}</p>`;
  const savings = V2_THEME.savings({ address: input.address?.trim() || null, area: input.areaM2, discount: input.veuDiscount, customer: input.estimatedTotal, gross: input.grossTotal, rebateLabel: "Your estimated VEU rebate", costLabel: "Your estimated cost after rebate", qualifier: "Estimate only. Eligibility, measurements and final pricing confirmed after assessment.", hasBreakdown: false, installation: 0, assessment: 0, apFee: 0 }).html;
  const videoLine = fill(c.video) ?? "Send us one short video from your manhole. It lets us check your existing insulation before we book you in, so nobody's time is wasted. Homes with a video get booked first.";
  const nextTitle = fill(c.nextTitle) ?? (onsite ? "Want to jump the queue?" : "Save your spot");
  const urgency = fill(c.urgency) ?? "Demand is high — hundreds of enquiries since 1 October, installers are limited, first come first served.";
  const buttonText = fill(c.button) ?? (onsite ? "Send my video →" : "Save my spot →");
  const videoUrl = new URL(campaign); videoUrl.pathname = videoUrl.pathname.replace(/\/campaign$/, "/video");
  const actionUrl = onsite ? videoUrl.toString() : campaign.toString();
  const nextStep = `<table data-likely-next-step="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUSH}" style="width:100%;border-collapse:separate;background-color:${BLUSH};border-radius:20px;"><tr><td style="padding:22px 22px;${F}"><h2 style="margin:0 0 12px;${FH}color:${INK};font-size:23px;line-height:1.2;font-weight:800;letter-spacing:0;">${escape(nextTitle)}</h2>${onsite ? `<p class="lx-body" style="margin:0 0 12px;${F}color:${INK};font-size:14px;line-height:1.55;">${escape(videoLine)} <strong>Homes with a video get booked first.</strong></p><p style="margin:0 0 12px;${F}color:${INK};font-size:12px;line-height:1.5;">Only if you can do it safely. Please don’t climb into or walk through the roof space.</p>` : ""}<p style="margin:0 0 12px;${F}color:${INK};font-size:14px;line-height:1.45;font-weight:800;">${escape(urgency)}</p>${V2_THEME.button(actionUrl, buttonText)}${onsite ? `<p style="margin:12px 0 0;${F}font-size:13px;line-height:1.5;text-align:center;">Can’t do a video? No worries. <a href="${escape(campaign.toString())}" style="color:${BLUE};font-weight:700;">Just save my spot</a></p>` : ""}<p style="margin:10px 0 0;${F}font-size:13px;text-align:center;color:${INK};">No payment, no obligation.</p></td></tr></table>`;
  const footerReason = "We’re the Accredited Person. Independent licensed trades carry out the work. This estimate is based only on your online enquiry; your final price is confirmed after your free onsite Ready Check.";
  const html = V2_THEME.shell(`${row(V2_THEME.header("Free estimate · no obligation"), "22px 36px 18px")}${row(hero, "8px 36px 24px")}${row(savings, "0 28px 22px")}${row(nextStep, "0 28px 18px")}${row(V2_THEME.whatCouldChange().html, "0 28px 24px")}${V2_THEME.footerRow(V2_THEME.footer(input.reference, null, footerReason, unsubscribe.toString()))}`, previewText, null);
  const action = buttonText.replace(/\s*→\s*$/, "");
  const plainText = [subject, "", greeting, eligibility, ...(onsite ? [videoLine, "Homes with a video get booked first.", "Only if you can do it safely. Please don’t climb into or walk through the roof space."] : []), "", `You could save ${money(input.veuDiscount)}`, `Your estimated cost after rebate: ${money(input.estimatedTotal)} incl. GST`, `Before rebate: ${money(input.grossTotal)}`, `Ceiling: ${number(input.areaM2)} m²`, "", "WHAT THIS INCLUDES", "Free Ready Check", "R5.0 ceiling insulation — supply & install", "Electrical safety assessment (PIESA)", "Accredited Person (AP) management", "", urgency, `${action}: ${actionUrl}`, ...(onsite ? [`Can't do a video? No worries. Just save my spot: ${campaign}`] : []), "No payment, no obligation.", "", "WHAT COULD CHANGE THIS PRICE?", ...V2_THEME.whatCouldChange().changes.map((item) => `• ${item}`), CUSTOMER_WHAT_COULD_CHANGE.closing, "", footerReason, `Remove my enquiry: ${unsubscribe}`, ...(input.reference?.trim() ? [`Reference: ${input.reference.trim()}`] : [])].join("\n");
  return { subject, previewText, html, plainText };
}

// ---------------------------------------------------------------------------
// DRAFT (not yet approved for sending): existing-insulation calculator + optional phone video invitation.
// Same visual system; existing renderers above are untouched.
// ---------------------------------------------------------------------------
export type InsulationVideoEmailInput = { captureUrl: string; firstName?: string | null; reference?: string | null; referralUrl?: string | null };
export function renderInsulationVideoEmail(input: InsulationVideoEmailInput): EstimateEmail {
  const u = new URL(input.captureUrl);
  if (u.origin !== BASE || !/^\/estimate\/[A-Za-z0-9_-]{43,128}\/video$/.test(u.pathname) || u.search || u.hash) throw new Error("A secure Home Insulation Victoria video link is required.");
  const referralUrl = validReferralUrl(input.referralUrl ?? null);
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60) || null;
  const subject = `${name ? `${name}, a` : "A"} quick next step for your insulation enquiry`;
  const previewText = "Check your estimate, and optionally send a short phone video of your existing insulation.";
  const row = (content: string, pad: string) => `<tr><td class="lx-pad" style="padding:${pad};${F}">${content}</td></tr>`;
  const intro = "You told us there’s already some insulation in your ceiling. Everything else you shared looks good, so the next step is checking that existing insulation.";
  const hero = `<p style="margin:0 0 8px;${F}color:${TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Your next step</p><h1 class="lx-h1" style="margin:0 0 14px;${FH}color:${INK};font-size:32px;line-height:37px;font-weight:800;">${name ? `${escape(name)}, help` : "Help"} us check your existing insulation</h1><p style="margin:0;${F}color:${INK};font-size:15px;line-height:1.6;">${escape(intro)}</p>`;
  const card = (bg: string, title: string, body: string, button: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="width:100%;border-collapse:separate;background-color:${bg};border-radius:18px;"><tr><td class="lx-result-pad" style="padding:20px;${F}"><h2 style="margin:0 0 8px;${FH}color:${INK};font-size:19px;line-height:1.25;font-weight:800;">${title}</h2>${body}<div style="height:14px;line-height:14px;">&nbsp;</div>${button}</td></tr></table>`;
  const p = (t: string) => `<p style="margin:0 0 6px;${F}color:${INK};font-size:14px;line-height:1.55;">${t}</p>`;
  const calc = card(MIST, "1. Check your estimate", p("Use our online calculator to see your potential VEU rebate."), v2Button(PUBLIC_CALCULATOR_URL, "Open the calculator"));
  const video = card(MINT, "2. Optional: send a short phone video", `${p("If you can do it safely — for example, holding your phone up through the ceiling hatch from a stable ladder — a 20–60 second video helps us review your enquiry sooner.")}${p("<strong>Please don’t climb into or walk through the roof space.</strong> If you can’t record safely, skip this step and we’ll check everything at your free onsite visit.")}`, v2Button(input.captureUrl, "Record or upload a video"));
  const note = `<p style="margin:0;${F}color:#5A6785;font-size:12.5px;line-height:1.55;text-align:center;">A video helps us prioritise your enquiry. It doesn’t confirm eligibility on its own — that is still confirmed at the free onsite check.</p>`;
  const reason = "You’re receiving this because you requested an eligibility check.";
  const html = likelyV2Shell(`${row(v2Header("Next step"), "22px 36px 18px")}${row(hero, "8px 36px 22px")}${row(calc, "0 28px 16px")}${row(video, "0 28px 16px")}${row(note, "4px 36px 22px")}${v2FooterRow(v2Footer(input.reference, referralUrl, reason))}`, previewText, null);
  const plainText = [
    subject, "", intro, "",
    "1. CHECK YOUR ESTIMATE", `Open the calculator: ${PUBLIC_CALCULATOR_URL}`, "",
    "2. OPTIONAL: SEND A SHORT PHONE VIDEO",
    "If you can do it safely — for example, holding your phone up through the ceiling hatch from a stable ladder — a 20–60 second video helps us review your enquiry sooner.",
    "Please don’t climb into or walk through the roof space. If you can’t record safely, skip this step and we’ll check everything at your free onsite visit.",
    `Record or upload a video: ${input.captureUrl}`, "",
    "A video helps us prioritise your enquiry. It doesn’t confirm eligibility on its own — that is still confirmed at the free onsite check.", "",
    ...v2FooterPlain(input.reference, referralUrl, reason),
  ].join("\n");
  return { subject, previewText, html, plainText };
}
