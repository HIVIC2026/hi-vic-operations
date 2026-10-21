import { AMOUNT_LH, HEADER_ART_W, HEADING_ART, amountArtWidth, emailArtUrl } from "./email-art.core";
import { READY_CHECK_FEE, effectiveReadyCheckFee } from "./readycheck.core";
/** Pure customer outcome email renderers: no data access, delivery, or side effects. */
import { CUSTOMER_BRAND, CUSTOMER_WHAT_COULD_CHANGE } from "./customer-quote-system";
import { isWellFormedToken } from "./estimatelink.core";
import { EXISTING_PRELIMINARY, REMOVAL_BUDGET_EMAIL_NOTE, removalNote, type EstimateRemoval } from "./estimate-removal.core";

export type CustomerOutcome = "likely" | "onsite" | "ineligible";
import { renderStep3SaveSpot } from "./step3-emails";
export type EstimateEmailInput = {
  estimateUrl: string; outcome?: "likely" | "onsite"; estimatedTotal?: number | null;
  veuDiscount?: number | null; areaM2?: number | null; savingsPercent?: number | null;
  installationPrice?: number | null; installationRatePerM2?: number | null;
  assessmentFee?: number | null; apFee?: number | null; grossProjectTotal?: number | null;
  amountPayableNow?: number | null; estimatedRemainingBalance?: number | null;
  reasons?: string[] | null; apCount?: number | null; reference?: string | null;
  firstName?: string | null; address?: string | null;
  existingInsulationPresent?: boolean;
  /** Follow-up only: initial Group B invitation never opts in. */
  saveSpotRemoval?: EstimateRemoval;
  /** True when the ceiling size is the typical-home default rather than a declared/measured figure. */
  areaIsTypical?: boolean;
  trackingClickUrl?: string | null; trackingPixelUrl?: string | null; referralUrl?: string | null;
  /** Historical input retained for compatibility; the Ready Check is always free. */
  readyCheckFeeIncGst?: number | null;
  /** "current" = new-version cohort: install row also shows ex/inc GST rate wording. */
  pricingCohort?: "pre_cutover" | "legacy_saved_spot" | "current";
};
export type IneligibleOutcomeEmailInput = {
  reasons?: string[] | null; referralUrl: string; resultUrl?: string | null;
  reference?: string | null | undefined; apCount?: number | null | undefined;
};
export type EstimateEmail = { subject: string; previewText: string; html: string; plainText: string };

const BASE = "https://estimate.homeinsulationvictoria.com.au";
/** The locked likely-email pink-box paragraph; the Save your spot version swaps it for Jo's exact wording (7 Oct). */
const LIKELY_NEXT_STEP_INSTRUCTION = "Your installer measures the ceiling, assesses any existing insulation, confirms eligibility and prepares the job scope so we can confirm your quote.";
export const SAVE_SPOT_INSTRUCTION = "We have been inundated with requests from owners all over Victoria. As one of only two Accredited Persons for this activity, and with limited capacity of suitably qualified installers, we need to take on approvals in batches. Save your spot to join the line and we will be in touch as soon as the next installer is available in your area.";
/** The locked small line under the likely-email button; the Save your spot version swaps it for Jo's exact wording (7 Oct). */
const LIKELY_SMALL_PRINT = "Confirm your request on the next page. An installer from our panel will then contact you to arrange a time.";
export const SAVE_SPOT_SMALL_PRINT = "We will be in touch to book your free Ready Check as soon as we can.";
/** The locked likely-email hero closing sentence; the Save your spot version swaps it for Jo's exact wording (7 Oct, 03:24 UTC). */
const LIKELY_HERO_SENTENCE = "A more comfortable home could be closer than you think. We’ll coordinate the installer, electrical checks and paperwork.";
/** Retired from Save your spot (Jo, 7 Oct 17:27 UTC: only four pink-box swaps). Kept for reference only. */
export const SAVE_SPOT_HERO_SENTENCE_RETIRED = "We organise everything for you: a certified installer, the licensed electrician’s Pre Insulation Electrical Safety Assessment (PIESA) and all the rebate paperwork. No hunting for eligible trades, and no juggling multiple quotes and appointments. One team, one price, start to finish.";
/** Verified live brand logo (HTTP 200 image/png) used in every customer email. */
const LOGO_URL = CUSTOMER_BRAND.logoUrl;
const SITE = "https://homeinsulationvictoria.com.au";
/** Privacy page lives on the estimate site (Jo, 6 Oct 2026) — every customer email footer links here. */
export const PRIVACY_URL = `${BASE}/privacy`;
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
    const fee = readyCheckFeeOf(input);
    if (!closeEnough(payableNow, fee)) throw new Error("The amount payable now must be $0 because the Ready Check is free.");
    const removal = input.saveSpotRemoval?.kind === "included" ? input.saveSpotRemoval.amount : 0;
    if (!closeEnough(installation + assessment + apFee + removal + fee, gross)) throw new Error("Quote line items must reconcile to the gross project total.");
    if (!closeEnough(gross - discount, customer)) throw new Error("Gross project total less VEU discount must equal the estimated customer price.");
    if (!closeEnough(customer - payableNow, remaining)) throw new Error("Estimated customer price less the amount payable now must equal the remaining balance.");
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) throw new Error("The installation rate must be a finite non-negative value.");
  }
  return { confirmTarget, calculatorTarget, pixel, referralUrl, customer, discount, area, packagePrice, hasBreakdown, installation, assessment, apFee, gross };
}

export function renderEstimateEmail(input: EstimateEmailInput): EstimateEmail {
  const outcome = input.outcome ?? "likely";
  if (outcome === "likely") return applyReadyCheckFee(renderLikelyEligibleEmail({ ...input, outcome }), input, false);
  return applyReadyCheckFee(renderOnsiteEmail({ ...input, outcome }), input, false);
}

function readyCheckFeeOf(input: Pick<EstimateEmailInput, "readyCheckFeeIncGst">): number {
  return effectiveReadyCheckFee(input.readyCheckFeeIncGst ?? READY_CHECK_FEE);
}

/** Compatibility export: preserve the approved free-check email without changing any wording. */
export function applyReadyCheckFee(mail: EstimateEmail, input: Pick<EstimateEmailInput, "readyCheckFeeIncGst" | "installationRatePerM2" | "pricingCohort">, _saveSpot: boolean): EstimateEmail {
  readyCheckFeeOf(input);
  return mail;
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
  const previewText = "See your estimated VEU rebate, then arrange your free Ready Check — no obligation to proceed.";
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
  const footerLinks = `<span style="display:inline-block;white-space:nowrap;"><a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact us</a></span><span style="display:inline-block;white-space:nowrap;">&nbsp;·&nbsp;<a href="${PRIVACY_URL}" style="color:${BLUE};text-decoration:underline;">Privacy</a></span>${referralUrl ? `<span style="display:inline-block;white-space:nowrap;">&nbsp;·&nbsp;<a href="${escape(referralUrl)}" style="color:${BLUE};text-decoration:underline;">Refer a friend</a></span>` : ""}<span style="display:inline-block;white-space:nowrap;">&nbsp;·&nbsp;${optOut}</span>`;
  return `<p style="margin:0 0 5px;${F}color:${INK};font-size:14px;line-height:1.4;font-weight:800;text-align:center;">Home Insulation Victoria</p><p style="margin:0;${F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.</p><p style="margin:5px 0 9px;${F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;">${escape(reason)}</p><p style="margin:0;${F}color:${BLUE};font-size:12px;line-height:1.7;text-align:center;">${footerLinks}</p>${reference?.trim() ? `<p style="margin:7px 0 0;${F}color:#5A6785;font-size:10.5px;line-height:1.4;text-align:center;">Reference: ${escape(reference.trim())}</p>` : ""}`;
}
const v2FooterPlain = (reference: string | null | undefined, referralUrl: string | null, reason: string) => [
  "Home Insulation Victoria",
  "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.",
  reason,
  `Contact us: ${SITE}/contact · Privacy: ${PRIVACY_URL}${referralUrl ? ` · Refer a friend: ${referralUrl}` : ""}`,
  ...(reference?.trim() ? [`Reference: ${reference.trim()}`] : []),
];
const v2FooterRow = (footer: string) => `<tr><td class="lx-pad" style="padding:20px 36px;${F}background-color:${WHITE};border-top:1px solid ${LINE};border-radius:0 0 24px 24px;">${footer}</td></tr>`;
const v2Header = (badge: string, nowrap = false) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td valign="middle"><img class="lx-logo hiv-logo" src="${LOGO_URL}" alt="Home Insulation Victoria" width="142" height="61" style="display:block;width:142px;height:auto;max-width:100%;border:0;"></td><td align="right" valign="middle"><span class="lx-badge" style="display:inline-block;padding:7px 11px;background-color:${BLUSH};border-radius:999px;${F}color:${INK};font-size:10px;line-height:1.2;font-weight:800;letter-spacing:.7px;text-transform:uppercase;${nowrap ? "white-space:nowrap;" : ""}">${badge}</span></td></tr></table>`;
const v2Button = (href: string, text: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td align="center" bgcolor="${GREEN}" style="background-color:${GREEN};border:0;border-radius:12px;mso-padding-alt:15px 18px;box-shadow:0 10px 24px -12px rgba(7,191,97,.55);"><a class="lx-button" href="${escape(href)}" style="display:block;padding:15px 18px;${F}color:${WHITE};font-size:16px;line-height:20px;font-weight:800;text-decoration:none;border-radius:12px;">${text}</a></td></tr></table>`;
const neutralItem = (t: string) => `<p style="margin:0 0 6px;${F}color:${INK};font-size:13.5px;line-height:1.5;"><span style="color:#8A96B3;font-weight:800;">•</span>&nbsp; ${escape(t)}</p>`;

type V2SavingsInput = {
  address: string | null; area: number; areaIsTypical?: boolean; discount: number; customer: number; gross: number;
  rebateLabel: string; costLabel: string; qualifier: string; hasBreakdown: boolean; installation: number; assessment: number; apFee: number;
  apCount?: number | null;
  /** Owner-specific calculator link (campaign emails). Defaults to the public calculator so the locked likely email stays byte-identical. */
  calculatorUrl?: string;
  /** Campaign emails only: adds price-before-discount, VEEC discount and you-pay rows under the itemised list. Absent = locked likely output unchanged. */
  totals?: { veecs: number; veecValue: number };
  removal?: EstimateRemoval;
};

/** The approved estimate/savings module, shared byte-for-byte by eligible-outcome and launch-campaign emails. */
function v2SavingsModule(input: V2SavingsInput) {
  const assumedAreaNote = input.areaIsTypical ? `<p data-assumed-ceiling="true" style="margin:12px 0 0;${F}color:${INK};font-size:14px;line-height:1.5;">You didn’t provide a ceiling size, so we’ve used an average size of ${escape(number(input.area))} m² for this preliminary estimate. Your final price will depend on the measured ceiling area.</p>` : "";
  const areaNote = input.areaIsTypical ? `${escape(number(input.area))} m² (typical-home assumption)` : `${escape(number(input.area))} m²`;
  const summary = `${input.address ? `<tr><td style="padding:4px 0;${F}color:${INK};font-size:13px;">Property</td><td align="right" style="padding:4px 0 4px 12px;${F}color:${INK};font-size:13px;font-weight:800;">${escape(input.address)}</td></tr>` : ""}<tr><td style="padding:4px 0;${F}color:${INK};font-size:13px;">Ceiling</td><td align="right" style="padding:4px 0 4px 12px;${F}color:${INK};font-size:13px;font-weight:800;">${areaNote}</td></tr>`;
  const line = (t: string, amt: string, note: string, top: boolean) => `<tr><td valign="top" style="padding:8px 12px 2px 0;${top ? "" : `border-top:1px solid ${LINE};`}${F}color:${INK};font-size:14px;line-height:1.45;">${t}</td><td class="lx-row-amt" width="96" align="right" valign="top" style="width:96px;padding:8px 0 2px;${top ? "" : `border-top:1px solid ${LINE};`}${F}color:${INK};font-size:14px;line-height:1.45;font-weight:700;white-space:nowrap;">${amt}</td></tr><tr><td colspan="2" style="padding:0 0 8px;${F}color:${INK};font-size:12.5px;line-height:1.45;">${note}</td></tr>`;
  const rows = [
    { title: "Free Ready Check", description: "We measure your ceiling, assess whether any existing insulation can stay or needs removal, and confirm eligibility and the job scope.", amount: `<span style="color:${GREEN};font-weight:800;">FREE</span>`, plain: ": FREE" },
    { title: "R5.0 ceiling insulation — supply & install", description: "Fitted by a pre-vetted Certified Insulation Installer (CII) from our panel.", amount: input.hasBreakdown ? escape(money(input.installation)) : "", plain: input.hasBreakdown ? `: ${money(input.installation)}` : "" },
    ...(input.removal?.kind === "included" ? [{ title: "Removal of existing insulation", description: `${number(input.removal.areaM2)} m² included in this estimate; scope confirmed at your free Ready Check.`, amount: escape(money(input.removal.amount)), plain: `: ${money(input.removal.amount)} inc GST` }] : []),
    { title: "Pre Insulation Electrical Safety Assessment (PIESA)", description: "A mandatory check by a pre-vetted REC electrician, close to installation.", amount: input.hasBreakdown ? escape(money(input.assessment)) : "", plain: input.hasBreakdown ? `: ${money(input.assessment)}` : "" },
    { title: "Accredited Person (AP) management", description: "Our accreditation gives you access to the VEU rebate. We handle compliance, paperwork and your claim.", amount: input.hasBreakdown ? escape(money(input.apFee)) : "", plain: input.hasBreakdown ? `: ${money(input.apFee)}` : "" },
  ];
  const tick = `<span aria-hidden="true" style="white-space:nowrap;color:${GREEN};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1;">✓&nbsp;</span>`;
  const items = rows.map(({ title, description, amount }, i) => line(`${tick}<strong style="font-size:14px;">${escape(title)}</strong>`, amount, escape(description), i === 0)).join("");
  const validApCount = typeof input.apCount === "number" && Number.isInteger(input.apCount) && input.apCount > 0;
  const apCountText = validApCount ? (input.apCount === 2 ? "two" : String(input.apCount)) : null;
  const apTrust = apCountText ? `<p style="margin:11px 0 0;padding-top:11px;border-top:1px solid ${LINE};${F}color:${INK};font-size:12.5px;line-height:1.5;font-weight:700;">We’re one of only ${escape(apCountText)} Accredited Person${input.apCount === 1 ? "" : "s"} approved for VEU ceiling insulation in Victoria.</p>` : "";
  const includes = `<table data-likely-itemised="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;margin-top:14px;border-collapse:separate;background-color:${WHITE};border-radius:14px;"><tr><td style="padding:15px 16px;${F}"><p style="margin:0 0 6px;${FH}color:${INK};font-size:14px;line-height:1.3;font-weight:800;">What this includes</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${items}${input.totals ? totalRows(input) : ""}</table>${apTrust}</td></tr></table>`;
  const calc = `<p data-likely-calculator="true" style="margin:12px 0 0;${F}color:${INK};font-size:14px;line-height:1.5;text-align:center;">Want to explore a different ceiling size? <a href="${escape(input.calculatorUrl ?? PUBLIC_CALCULATOR_URL)}" style="color:${BLUE};font-weight:800;text-decoration:underline;white-space:nowrap;">Open&nbsp;the&nbsp;calculator&nbsp;→</a></p>`;
  const html = `<table data-likely-savings="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MIST}" style="width:100%;border-collapse:separate;background-color:${MIST};border-radius:22px;"><tr><td class="lx-result-pad" style="padding:22px 20px;${F}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MINT}" style="width:100%;border-collapse:separate;background-color:${MINT};border:2px solid ${GREEN};border-radius:18px;"><tr><td align="center" style="padding:18px 12px;${F}"><p style="margin:0;${F}color:${INK};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">${input.rebateLabel}</p><p class="lx-saving" style="margin:5px 0 0;${FH}color:${GREEN};font-size:38px;line-height:42px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">You could save ${escape(money(input.discount))}</p></td></tr></table><div style="text-align:center;padding:18px 0 12px;"><p style="margin:0;${F}color:${INK};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">${input.costLabel}</p><p class="lx-cost" style="margin:5px 0 0;${FH}color:${BLUE};font-size:46px;line-height:50px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">${escape(money(input.customer))}</p><p style="margin:4px 0 0;${F}color:${INK};font-size:12px;line-height:1.4;font-weight:700;">incl. GST · before rebate ${escape(money(input.gross))}</p><p style="margin:8px auto 0;max-width:390px;${F}color:${INK};font-size:11px;line-height:1.5;">${input.qualifier}</p></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid ${LINE};">${summary}</table>${calc}${includes}</td></tr></table>`;
  const removal = input.removal ? `<p data-removal-clarification="true" style="margin:12px auto 0;max-width:440px;${F}color:${INK};font-size:14px;line-height:1.5;font-weight:700;">${escape(removalNote(input.removal))}</p><p style="margin:8px auto 0;max-width:440px;${F}color:${INK};font-size:13px;line-height:1.5;">${escape(EXISTING_PRELIMINARY)}</p>` : "";
  return { html: html.replace(`<p style="margin:8px auto 0;max-width:390px;`, `${removal}<p style="margin:8px auto 0;max-width:390px;`).replace('<p data-likely-calculator="true"', `${assumedAreaNote}<p data-likely-calculator="true"`), rows, apCountText };
}

/** Campaign-only totals under the itemised list, styled like the itemised rows. */
function totalRows(input: V2SavingsInput) {
  const t = input.totals!;
  const r = (label: string, amt: string, style: string) => `<tr><td valign="top" style="padding:8px 12px 2px 0;border-top:1px solid ${LINE};${F}color:${INK};font-size:14px;line-height:1.45;${style}">${label}</td><td class="lx-row-amt" width="96" align="right" valign="top" style="width:96px;padding:8px 0 2px;border-top:1px solid ${LINE};${F}color:${INK};font-size:14px;line-height:1.45;white-space:nowrap;${style}">${amt}</td></tr>`;
  return r("<strong>Price before discount</strong>", `<strong>${escape(money(input.gross))}</strong>`, "")
    + r(`VEU discount (${t.veecs} VEECs × ${escape(money(t.veecValue))})`, `−${escape(money(input.discount))}`, `color:${TEXT_GREEN};font-weight:800;`)
    + r(`<span style="${FH}font-size:16px;font-weight:800;">You pay about</span>`, `<span style="${FH}font-size:18px;font-weight:800;color:${BLUE};">${escape(money(input.customer))}</span>`, "padding-top:10px;");
}

function v2WhatCouldChange() {
  const changes = ["Final measured ceiling size", "Existing insulation or removal", "Ceiling access", "electrical fixes identified during PIESA"];
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
    ? { subject: "Your insulation estimate — a few details to confirm", previewText: "See your potential VEU rebate, then arrange your free Ready Check — no obligation to proceed." }
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
  const savingsModule = v2SavingsModule({ address, area, ...(input.areaIsTypical == null ? {} : { areaIsTypical: input.areaIsTypical }), discount, customer, gross: hasBreakdown ? gross : packagePrice, rebateLabel, costLabel, qualifier, hasBreakdown, installation, assessment, apFee, ...(input.apCount === undefined ? {} : { apCount: input.apCount }), ...(input.saveSpotRemoval ? { removal: input.saveSpotRemoval } : {}) });
  const savings = savingsModule.html;
  const { rows, apCountText } = savingsModule;

  // 4. Primary conversion: the next step
  const nextStep = `<table data-likely-next-step="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUSH}" style="width:100%;border-collapse:separate;background-color:${BLUSH};border-radius:20px;"><tr><td style="padding:22px 22px;${F}">${h2("Free Ready Check")}<p class="lx-body" style="margin:0 0 12px;${F}color:${INK};font-size:14px;line-height:1.55;">Your installer measures the ceiling, assesses any existing insulation, confirms eligibility and prepares the job scope so we can confirm your quote.</p><p style="margin:0 0 12px;${F}color:${INK};font-size:14px;line-height:1.45;font-weight:800;">Demand is high. Installer availability is limited.</p>${v2Button(confirmTarget, "Arrange my free Ready Check →")}<p style="margin:10px 0 0;${F}color:${INK};font-size:12.5px;line-height:1.5;text-align:center;">Confirm your request on the next page. An installer from our panel will then contact you to arrange a time.</p><p style="margin:8px 0 0;${F}color:${INK};font-size:12.5px;line-height:1.5;font-weight:700;text-align:center;">No payment required. No obligation to proceed with installation.</p></td></tr></table>`;

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
    ...(input.saveSpotRemoval ? [removalNote(input.saveSpotRemoval), EXISTING_PRELIMINARY] : []),
    qualifier,
    ...(address ? [`Property: ${address}`] : []),
    `Ceiling: ${number(area)} m²${input.areaIsTypical ? " (typical-home assumption)" : ""}`,
    ...(input.areaIsTypical ? [`You didn’t provide a ceiling size, so we’ve used an average size of ${number(area)} m² for this preliminary estimate. Your final price will depend on the measured ceiling area.`] : []),
    `Want to explore a different ceiling size? Open the calculator: ${PUBLIC_CALCULATOR_URL}`, "", "WHAT THIS INCLUDES", ...rows.map(({ title, description, plain }) => `✓ ${title}${plain}
${description}`),
    ...(apCountText ? [`We’re one of only ${apCountText} Accredited Person${input.apCount === 1 ? "" : "s"} approved for VEU ceiling insulation in Victoria.`] : []), "",
    "FREE READY CHECK",
    "Your installer measures the ceiling, assesses any existing insulation, confirms eligibility and prepares the job scope so we can confirm your quote.",
    "Demand is high. Installer availability is limited.",
    `Arrange my free Ready Check: ${confirmTarget}`,
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
  referralUrl?: string | null;
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
  /** Declared existing insulation; drives the removal sentence. */
  insulation?: string | null;
  /** Cost breakdown (defaults: current $349 PIESA, $349 AP fee, installation = price before discount minus both; $70 per VEEC). */
  installation?: number; assessmentFee?: number; apFee?: number; veecValue?: number;
  /** Owner's no-login My job link (same token). Optional. */
  myJobUrl?: string | null;
  /** Office draft wording (preview only). Blank/missing = approved default. "{name}" = first name. */
  copy?: Partial<Record<LaunchCopyField, string>> | null;
};
export const CAMPAIGN_H1_MAX_CHARS = 54;
export type LaunchCopyField = "subject" | "previewText" | "headline" | "intro" | "video" | "nextTitle" | "urgency" | "button";

/** Draft-only launch email. Jo-approved opening (6 Oct 2026): logo-green caps line, navy headline with green rebate, plain on white, big green button in the opening. */
/** Origins campaign links may use: the live customer domain, plus the preview host for allowlisted TEST sends only. */
export const CAMPAIGN_LINK_ORIGINS = [BASE] as const;

/** Campaign + spot-saved only (Jo, 6 Oct): web fonts are blocked in Outlook/Gmail, so every element carries an inline
 * fallback stack close to Outfit/Figtree. The locked likely-eligible/needs-onsite emails are NOT passed through this. */
export const CAMPAIGN_HEADING_STACK = "'Outfit','Avenir Next','Avenir','Century Gothic','Segoe UI',Helvetica,Arial,sans-serif";
export const CAMPAIGN_BODY_STACK = "'Figtree','Avenir Next','Avenir','Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";
export function applyCampaignFonts(html: string): string {
  let out = html.split(OUTFIT).join(CAMPAIGN_HEADING_STACK).split(FIGTREE).join(CAMPAIGN_BODY_STACK);
  // Outlook desktop conditional block: same stacks instead of forcing Arial.
  out = out.replace("<!--[if mso]><style type=\"text/css\">body,table,td,p,a,span{font-family:Arial,Helvetica,sans-serif!important}h1,h2,h3{font-family:Arial,Helvetica,sans-serif!important;font-weight:bold!important}</style><![endif]-->",
    `<!--[if mso]><style type="text/css">body,table,td,p,a,span{font-family:${CAMPAIGN_BODY_STACK}!important}h1,h2,h3{font-family:${CAMPAIGN_HEADING_STACK}!important;font-weight:bold!important}</style><![endif]-->`);
  // Buttons use the heading stack.
  out = out.replace(/(<a class="lx-button"[^>]*style="[^"]*?)font-family:[^;"]*;/g, `$1font-family:${CAMPAIGN_HEADING_STACK};`);
  // Every text element gets an inline stack (Outlook strips <style>).
  out = out.replace(/<(p|td|a|span|strong|h1|h2|div|li)(\s[^>]*?)?\sstyle="(?![^"]*font-family)([^"]*)"/g, (_m, tag: string, attrs = "", st: string) => `<${tag}${attrs} style="font-family:${/^h\d$/.test(tag) ? CAMPAIGN_HEADING_STACK : CAMPAIGN_BODY_STACK};${st}"`);
  out = out.replace(/<(strong|h1|h2)>/g, (_m, tag: string) => `<${tag} style="font-family:${tag === "strong" ? CAMPAIGN_BODY_STACK : CAMPAIGN_HEADING_STACK};">`);
  return out;
}

/** Jo-approved final Save my spot email (6 Oct 2026). Group A and B share one structure. */
/** Campaign + spot-saved button: the shared bulletproof button plus an Outlook desktop VML fallback (Jo, 6 Oct v6). */
export function campaignButton(href: string, text: string, vmlWidth = 520) {
  const t = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escape(href)}" style="height:50px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="24%" stroke="f" fillcolor="${GREEN}"><w:anchorlock/><center style="color:#FFFFFF;font-family:${CAMPAIGN_HEADING_STACK.replace(/'/g, "")};font-size:16px;font-weight:bold;">${t}</center></v:roundrect><![endif]--><!--[if !mso]><!-->${v2Button(href, text)}<!--<![endif]-->`;
}
/** Per-owner brand image row (logo, pill, caps line, headline) for campaign emails; alt carries the words. */
export function campaignArtImg(src: string, alt: string) {
  // v7 phone-first: natural width is the phone column (354px); shown 1:1 on phones and at natural size on desktop.
  return `<tr><td class="lx-pad" style="padding:0 36px;"><img src="${escape(src)}" width="${HEADER_ART_W}" alt="${escape(alt)}" style="display:block;width:100%;max-width:${HEADER_ART_W}px;height:auto;border:0;outline:none;text-decoration:none;${FH}color:${INK};font-size:24px;line-height:1.25;font-weight:800;"></td></tr>`;
}
/** Fixed card heading as an Outfit/Figtree image (v7); unknown text stays live. */
export function campaignHeadingImg(origin: string, token: string, text: string, live: string) {
  const a = HEADING_ART[text];
  if (!a) return live;
  const mb = a.style === "h2" ? 12 : 10;
  return `<img src="${escape(emailArtUrl(origin, token, a.kind))}" width="${a.w}" height="${a.h}" alt="${escape(text)}" style="display:block;width:${a.w}px;max-width:100%;height:auto;margin:0 0 ${mb}px;border:0;outline:none;text-decoration:none;${FH}color:${INK};font-size:${a.style === "h2" ? 23 : 11}px;line-height:1.2;font-weight:800;">`;
}
/** "You pay about" amount as an Outfit 800 image; alt is the amount. */
export function campaignAmountImg(src: string, amount: string) {
  return `<img src="${escape(src)}" width="${amountArtWidth(amount)}" height="${AMOUNT_LH}" alt="${escape(amount)}" style="display:inline-block;width:${amountArtWidth(amount)}px;height:${AMOUNT_LH}px;border:0;vertical-align:middle;${FH}color:${INK};font-size:30px;line-height:${AMOUNT_LH}px;font-weight:800;">`;
}

/** Save my spot for likely-eligible owners: ALWAYS the Jo-approved locked email (7 Oct 2026 12:52). Group B keeps its own renderer. */
export function renderLaunchGroupEmail(input: LaunchCampaignEmailInput): EstimateEmail {
  if (input.group !== "likely") return renderLaunchCampaignEmail(input);
  return renderStep3SaveSpot({
    estimateUrl: input.campaignUrl.replace(/\/campaign$/, ""), campaignUrl: input.campaignUrl, unsubscribeUrl: input.unsubscribeUrl, referralUrl: input.referralUrl ?? null,
    estimatedTotal: input.estimatedTotal, veuDiscount: input.veuDiscount, grossTotal: input.grossTotal, areaM2: input.areaM2,
    firstName: input.firstName ?? null, address: input.address ?? null, reference: input.reference ?? null,
    existingInsulationPresent: input.insulation === "present",
    ...(input.installation === undefined ? {} : { installation: input.installation }),
    ...(input.assessmentFee === undefined ? {} : { assessmentFee: input.assessmentFee }),
    ...(input.apFee === undefined ? {} : { apFee: input.apFee }),
  });
}

/** Group B (onsite) campaign email only. The v9 likely-eligible Save my spot version is RETIRED (Jo, 7 Oct) and refuses to render. */
export function renderLaunchCampaignEmail(input: LaunchCampaignEmailInput): EstimateEmail {
  if (input.group === "likely") throw new Error("The old Save my spot email is retired. Use renderSaveSpotFromLikelyEmail.");
  const campaign = new URL(input.campaignUrl);
  if (campaign.origin !== BASE || !/^\/estimate\/[A-Za-z0-9_-]{43,128}\/campaign$/.test(campaign.pathname) || campaign.search || campaign.hash) throw new Error("A secure Home Insulation Victoria campaign link is required.");
  const base = renderStep3SaveSpot({
    estimateUrl: input.campaignUrl.replace(/\/campaign$/, ""), campaignUrl: input.campaignUrl, unsubscribeUrl: input.unsubscribeUrl,
    referralUrl: input.referralUrl ?? null, firstName: input.firstName ?? null, address: input.address ?? null, reference: input.reference ?? null,
    estimatedTotal: input.estimatedTotal, veuDiscount: input.veuDiscount, grossTotal: input.grossTotal, areaM2: input.areaM2,
    existingInsulationPresent: true,
    ...(input.installation === undefined ? {} : { installation: input.installation }),
    ...(input.assessmentFee === undefined ? {} : { assessmentFee: input.assessmentFee }),
    ...(input.apFee === undefined ? {} : { apFee: input.apFee }),
  });
  const instruction = "Demand is high and installer capacity is limited. Your enquiry is behind eligible homes while we check your existing insulation. To JUMP THE QUEUE, send manhole video/photos or select ‘I confirm this is below R2’. Our office will assess it. If it appears below R2 and your home qualifies, we’ll move you into the eligible queue so you can save your spot.";
  const small = "Office review first. No payment. No obligation.";
  const intro = "your home could qualify for a VEU ceiling insulation rebate, subject to checking the existing insulation.";
  const replace = (value: string) => value
    .replace("your home looks likely to qualify for a VEU ceiling insulation rebate.", intro)
    .replace("Your estimated VEU rebate", "Your potential VEU rebate")
    .replace("Your estimated cost after rebate", "Estimated cost if eligible")
    .replace("Estimate only. Eligibility, measurements and final pricing confirmed after assessment.", `${REMOVAL_BUDGET_EMAIL_NOTE} Estimate only; eligibility and final price subject to assessment.`)
    .replace(SAVE_SPOT_INSTRUCTION, instruction)
    .replace(SAVE_SPOT_SMALL_PRINT, small);
  const html = replace(base.html)
    .replace("Save your spot</h2>", "JUMP THE QUEUE</h2>")
    .replace(`href="${escape(input.campaignUrl)}"`, `href="${escape(input.campaignUrl.replace(/\/campaign$/, "/video"))}"`)
    .replace("Save my spot →", "Send my insulation details →");
  const plainText = replace(base.plainText)
    .replace("SAVE YOUR SPOT\n", "JUMP THE QUEUE\n")
    .replace(`Save my spot: ${input.campaignUrl}`, `Send my insulation details: ${input.campaignUrl.replace(/\/campaign$/, "/video")}`);
  return { subject: `${input.firstName?.trim() || "Your home"} — your preliminary insulation estimate`, previewText: "Limited installer capacity. Help us check your insulation so you could move into the eligible queue and save your spot.", html, plainText };
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

/** Save your spot (likely eligible). APPROVED by Jo Lowe, 7 Oct 2026 (12:52) — FINAL; replaces v9–v14. Do not change without Jo's approval.
 *  The Step 3 likely email with ONLY four pink-box swaps (heading, paragraph, button -> campaign link, small line) — Jo, 7 Oct 17:27 UTC.
 *  Same hero, price rows and footer (Refer a friend + Unsubscribe, filled by withUnsubscribe in step3-emails.ts).
 *  Used by the hot-leads campaign for likely-eligible owners. */
export function renderSaveSpotFromLikelyEmail(input: EstimateEmailInput & { campaignUrl: string; campaignOptOutUrl?: string }): EstimateEmail {
  const base = renderV2QuoteEmail(input, "likely");
  const must = (s: string, from: string | RegExp, to: string) => { const out = s.replace(from, () => to); if (out === s) throw new Error(`Save-spot render: anchor missing (${String(from).slice(0, 40)})`); return out; };
  const card0 = base.html.match(/<table data-likely-next-step="true"[\s\S]*?No obligation to proceed with installation\.<\/p><\/td><\/tr><\/table>/)?.[0];
  if (!card0) throw new Error("Save-spot render: next-step card missing");
  let card = must(card0, "Free Ready Check", "Save your spot");
  card = must(card, LIKELY_NEXT_STEP_INSTRUCTION, SAVE_SPOT_INSTRUCTION);
  card = must(card, "Arrange my free Ready Check →", "Save my spot →");
  card = must(card, /href="[^"]*"/, `href="${escape(input.campaignUrl)}"`);
  card = must(card, LIKELY_SMALL_PRINT, SAVE_SPOT_SMALL_PRINT);
  let html = base.html.replace(card0, () => card);
  let text = must(base.plainText, /FREE READY CHECK\n/, "SAVE YOUR SPOT\n");
  text = must(text, LIKELY_NEXT_STEP_INSTRUCTION, SAVE_SPOT_INSTRUCTION);
  text = must(text, /Arrange my free Ready Check: .*/, `Save my spot: ${input.campaignUrl}`);
  text = must(text, LIKELY_SMALL_PRINT, SAVE_SPOT_SMALL_PRINT);
  return applyReadyCheckFee({ subject: base.subject, previewText: base.previewText, html, plainText: text }, input, true);
}
