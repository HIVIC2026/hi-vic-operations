import { READY_CHECK_FEE } from "./readycheck.core";
/** Pure customer outcome email renderers: no data access, delivery, or side effects. */
import { CUSTOMER_ASSESSMENT_ACTION, CUSTOMER_ONSITE_HERO, CUSTOMER_LIKELY_HERO, CUSTOMER_INELIGIBLE_COPY, CUSTOMER_BRAND, CUSTOMER_CALCULATOR_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_READY_CHECK_EMAIL_ACTION, CUSTOMER_VISUAL_SYSTEM, CUSTOMER_WHAT_COULD_CHANGE, customerQuoteRows, CUSTOMER_DISCOUNT_TREATMENT, discountAmount, CUSTOMER_PIESA_NOTE, CUSTOMER_READY_CHECK } from "./customer-quote-system";

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
const ACCENT = CUSTOMER_BRAND.colors.accent;
const INK = CUSTOMER_BRAND.colors.navy;
const PALE_BLUE = "#EEF0FC";
const PALE_GREEN = CUSTOMER_VISUAL_SYSTEM.paleGreen;
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
const body = (text: string, color: string = INK) => `<p style="margin:0;color:${color};font-size:15px;line-height:1.55;font-weight:400;">${text}</p>`;
const label = (text: string, color: string = BLUE) => `<p style="margin:0 0 9px;color:${color};font-size:11px;line-height:1.3;font-weight:800;letter-spacing:1px;">${text}</p>`;
const title = (text: string, color: string = BLUE, size = 28) => `<h2 style="margin:0 0 16px;color:${color};font-size:${size}px;line-height:1.1;font-weight:800;letter-spacing:-.5px;">${text}</h2>`;
const section = (content: string, pad = "0 28px 32px") => `<tr><td style="padding:${pad};">${content}</td></tr>`;
const card = (content: string, bg: string = WHITE, border: string = BLUE, radius = 18) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${bg};border:3px solid ${border};border-radius:${radius}px;"><tr><td style="padding:24px 22px;">${content}</td></tr></table>`;
// Outer accent cell remains visible even in clients that ignore CSS box-shadow.
const offset = (content: string, accent: string = ACCENT) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${accent}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${accent};border-radius:20px;"><tr><td style="padding:0 6px 6px 0;">${content}</td></tr></table>`;
const cta = (url: string, text = "CONTINUE WITH HOME INSULATION VICTORIA →") => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUE}" style="border-collapse:separate;border-spacing:0;background-color:${BLUE};border-radius:12px;"><tr><td align="center" style="padding:0;"><a href="${escape(url)}" style="display:block;padding:19px 16px;color:${WHITE};font-size:14px;line-height:1.35;font-weight:800;text-decoration:none;letter-spacing:.2px;">${text}</a></td></tr></table>`;

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

function logo() {
  return section(`<img src="${LOGO_URL}" alt="Home Insulation Victoria" width="230" height="98" style="display:block;width:230px;height:auto;max-width:100%;border:0;">`, "30px 28px 20px");
}
/** Hidden inbox preview text. Wrapped in a non-MSO conditional so Outlook desktop never receives it. */
export function preheader(preview: string) {
  return `<!--[if !mso]><!--><div style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escape(preview)}</div><!--<![endif]-->`;
}
/** Manual QA marker: test-only banners are injected here, inside the visible 640px body before the logo row. Renders nothing. */
export const TEST_BANNER_SLOT = "<!-- HIV_TEST_BANNER_SLOT -->";
function shell(content: string, preview: string, pixel: string | null, fixedLayout = false) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(preview)}</title></head><body style="margin:0;padding:0;background-color:${OUTER};font-family:'Open Sans',Arial,Helvetica,sans-serif;color:${INK};">${preheader(preview)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:collapse;background-color:${OUTER};"><tr><td align="center" style="padding:18px 8px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;max-width:640px;border-collapse:collapse;background-color:${WHITE};${fixedLayout ? "table-layout:fixed;" : ""}">${TEST_BANNER_SLOT}${content}</table>${pixelTag(pixel)}</td></tr></table></body></html>`;
}

const OPEN_SANS = CUSTOMER_BRAND.font;
export function likelyShell(content: string, preview: string, pixel: string | null) {
  const brandedContent = content.replace(/<(table|td|p|h1|h2|a)([^>]*?)style="/g, `<$1$2style="font-family:${OPEN_SANS};`);
  const responsive = `<style type="text/css">
body,table,td,p,h1,h2,a,span{font-family:${OPEN_SANS};}
.hiv-main{table-layout:fixed}.hiv-logo{width:187px;height:auto}.hiv-hero-title{font-size:38px;line-height:40px;mso-line-height-rule:exactly;letter-spacing:-1.9px}.hiv-heading{font-size:26px;line-height:.98;letter-spacing:-1.04px}.hiv-pad{padding-left:32px!important;padding-right:32px!important}.hiv-card-pad{padding:28px 26px!important}.hiv-price{font-size:44px!important}.hiv-discount{font-size:28px!important}.hiv-payment{font-size:34px!important}
@media only screen and (max-width:480px){.hiv-outer{padding:0!important}.hiv-main{width:100%!important}.hiv-pad{padding-left:18px!important;padding-right:18px!important}.hiv-logo-wrap{padding:20px 18px 16px!important}.hiv-logo{width:112px!important;height:auto!important}.hiv-hero{padding-top:24px!important;padding-bottom:26px!important}.hiv-hero-title{font-size:24px!important;line-height:25px!important;letter-spacing:-1.2px!important}.hiv-heading{font-size:20px!important;line-height:.98!important;letter-spacing:-.8px!important}.hiv-card-pad{padding:20px 18px!important}.hiv-price{font-size:38px!important}.hiv-discount{font-size:24px!important}.hiv-payment{font-size:30px!important}.hiv-quote-label{font-size:12.5px!important;line-height:1.45!important}.hiv-quote-amount{width:82px!important;font-size:14px!important}.hiv-body{font-size:12.5px!important;line-height:1.55!important}.hiv-cta{font-size:11px!important;padding:12px 10px!important}.hiv-footer{padding:14px 18px 16px!important}}
</style>`;
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(preview)}</title><!--[if !mso]><!--><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&display=swap" rel="stylesheet"><!--<![endif]--><!--[if mso]><style type="text/css">body,table,td,p,h1,h2,a,span{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->${responsive}</head><body style="margin:0;padding:0;background-color:${OUTER};font-family:${OPEN_SANS};color:${INK};">${preheader(preview)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:collapse;background-color:${OUTER};font-family:${OPEN_SANS};"><tr><td class="hiv-outer" align="center" style="padding:18px 0 36px;font-family:${OPEN_SANS};"><table class="hiv-main" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;max-width:640px;table-layout:fixed;border-collapse:collapse;background-color:${WHITE};font-family:${OPEN_SANS};">${TEST_BANNER_SLOT}${brandedContent}</table>${pixelTag(pixel)}</td></tr></table></body></html>`;
}
function packageSection() {
  const items: Array<[string, string, string]> = [
    ["01", "ELIGIBILITY", "A guided VEU pathway for your home."],
    ["02", "MEASURE", "The eligible ceiling area checked onsite."],
    ["03", "ELECTRICAL", "PIESA through a licensed electrician and REC."],
    ["04", "INSTALLATION", "R5.0 insulation for the confirmed area."],
    ["05", "COMPLIANCE", "Required checks and evidence managed."],
    ["06", "DISCOUNT", "VEEC processing by the Accredited Person."],
  ];
  const cells = items.map(([icon, name, copy]) => `<td width="50%" valign="top" style="width:50%;padding:0 5px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:collapse;background-color:${OUTER};border-radius:12px;"><tr><td style="padding:16px 12px;vertical-align:top;"><span style="display:inline-block;padding:8px 7px;background-color:${GREEN};border-radius:50%;color:${WHITE};font-size:12px;line-height:1;font-weight:800;">${icon}</span><p style="margin:12px 0 4px;color:${BLUE};font-size:13px;font-weight:800;line-height:1.25;">${name}</p><p style="margin:0;color:${INK};font-size:12px;line-height:1.5;">${copy}</p></td></tr></table></td>`);
  return `${label("THE FULL PACKAGE")}${title("THIS ISN'T JUST AN<br>INSULATION QUOTE.")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;"><tr>${cells.slice(0, 2).join("")}</tr><tr>${cells.slice(2, 4).join("")}</tr><tr>${cells.slice(4).join("")}</tr></table>`;
}
function apStatement(apCount?: number | null) {
  const verified = typeof apCount === "number" && Number.isInteger(apCount) && apCount > 0;
  return verified
    ? `Home Insulation Victoria is one of only ${apCount} Accredited Person${apCount === 1 ? "" : "s"} currently approved for VEU Activity 48 in Victoria.`
    : "Home Insulation Victoria is an Accredited Person approved for this VEU activity.";
}
function trust(apCount?: number | null, compact = false) {
  const blocks: Array<[string, string]> = [
    ["ACCREDITED PERSON", apStatement(apCount)],
    ["VETTED TRADE NETWORK", "Electrical work through appropriately licensed electricians and Registered Electrical Contractors; insulation providers appropriately EEC-certified."],
  ];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUE}" style="width:100%;border-collapse:collapse;background-color:${BLUE};border-radius:18px;"><tr><td style="padding:27px 23px;">${label("THE HOME INSULATION VICTORIA DIFFERENCE", ACCENT)}${title("YOU'RE IN THE<br>RIGHT HANDS.", WHITE, compact ? 24 : 30)}${blocks.map(([name, copy]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-top:1px solid ${ACCENT};"><tr><td style="padding:13px 0;"><p style="margin:0 0 5px;color:${ACCENT};font-size:11px;line-height:1.3;font-weight:800;letter-spacing:.6px;">${name}</p>${body(escape(copy), WHITE)}</td></tr></table>`).join("")}</td></tr></table>`;
}
function benefits(discount: number) {
  const items: Array<[string, string]> = [
    ["WARMER IN WINTER", "Help retain warmth when temperatures fall."],
    ["COOLER IN SUMMER", "Help slow heat entering through the ceiling."],
    ["LESS HEATING & COOLING DEMAND", "Enjoy year-round comfort with less reliance on mechanical heating and cooling."],
  ];
  return `${label("COMFORT, ALL YEAR ROUND")}${title("A BETTER FEELING HOME.")}${items.map(([name, copy]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-bottom:1px solid ${PALE_BLUE};"><tr><td width="34" valign="top" style="padding:13px 9px 13px 0;color:${GREEN};font-size:19px;font-weight:800;">✳</td><td style="padding:13px 0;"><p style="margin:0 0 4px;color:${BLUE};font-size:14px;font-weight:800;">${name}</p>${body(copy)}</td></tr></table>`).join("")}${card(`${label("AND THE BEST PART?", GREEN)}<p style="margin:0;color:${INK};font-size:20px;line-height:1.3;font-weight:800;">THE VEU PROGRAM COULD CONTRIBUTE <span style="color:${GREEN};">${escape(money(discount))}</span>.</p><p style="margin:10px 0 0;color:${INK};font-size:12px;line-height:1.5;">Estimated only; your final eligible area, discount and price are confirmed after your Ready Check.</p>`, PALE_GREEN, GREEN)}`;
}
function referral(url: string | null) {
  if (!url) return "";
  return section(offset(card(`${label("PASS IT ON", GREEN)}${title("KNOW SOMEONE WITH A<br>FREEZING HOUSE? ✳", BLUE, 24)}<p style="margin:0 0 18px;color:${INK};font-size:17px;line-height:1.3;font-weight:800;">DON'T KEEP THE DISCOUNT TO YOURSELF.</p>${body("Share Home Insulation Victoria. They can check their own eligibility; you don't have to share anyone's details.")}<p style="margin:17px 0 0;"><a href="${escape(url)}" style="color:${BLUE};font-size:14px;font-weight:800;text-decoration:underline;">REFER A FRIEND →</a></p>`, PALE_GREEN)), "0 28px 34px");
}
function footer(reference?: string | null, kind: "estimate" | "result" = "estimate") {
  const ref = reference?.trim() ? `<br>Reference: ${escape(reference.trim())}` : "";
  return section(`<p style="margin:0 0 12px;color:${BLUE};font-size:14px;font-weight:800;">Home Insulation Victoria</p><p style="margin:0;color:${INK};font-size:11px;line-height:1.7;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria<br>You are receiving this because you requested a Home Insulation Victoria ${kind === "result" ? "eligibility result" : "eligibility result or estimate"}.${ref}<br><a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact</a><br>A secure unsubscribe link appears directly below this footer.</p>`, `23px 28px 28px;border-top:1px solid ${PALE_BLUE};`);
}

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

/** Editorial preliminary-quote email. Now serves the onsite outcome only; likely uses renderLikelyEligibleEmail. */
function renderLikelyEmail(input: EstimateEmailInput): EstimateEmail {
  const { confirmTarget, calculatorTarget, pixel, referralUrl, customer, discount, area, packagePrice, hasBreakdown, installation, assessment, apFee, gross } = validateQuoteInput(input);
  const onsite = input.outcome === "onsite";
  const subject = onsite ? "Good news — your preliminary Home Insulation Victoria quote is ready" : "Good news — your home looks likely to qualify for a VEU insulation discount";
  const previewText = `Your estimated cost after discount is ${money(customer)}, including an estimated VEU / VEEC discount of ${money(discount)}.`;
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const address = input.address?.trim().replace(/\s+/g, " ").slice(0, 180);
  const verifiedAp = typeof input.apCount === "number" && Number.isInteger(input.apCount) && input.apCount > 0;
  const onsiteReasons = customerSafeOnsiteReasons(input.reasons);
  const ctaText = escape(CUSTOMER_ASSESSMENT_ACTION.cta);
  const ctaPlain = CUSTOMER_ASSESSMENT_ACTION.cta;
  const likelySection = (content: string, pad = "0 32px 40px", className = "hiv-pad") => `<tr><td class="${className}" style="padding:${pad};font-family:${OPEN_SANS};">${content}</td></tr>`;
  const likelyCta = (text: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${GREEN};border-radius:12px;"><tr><td style="padding:0 4px 4px 0;font-family:${OPEN_SANS};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${BLUE};border-radius:12px;"><tr><td align="center" style="padding:0;font-family:${OPEN_SANS};"><a class="hiv-cta" href="${escape(confirmTarget)}" style="display:block;padding:18px 16px;color:${WHITE};font-family:${OPEN_SANS};font-size:15px;line-height:1.3;font-weight:800;text-decoration:none;letter-spacing:1.1px;">${text}</a></td></tr></table></td></tr></table>`;
  const secondaryCard = (content: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${OUTER};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${OPEN_SANS};">${content}</td></tr></table>`;
  const reasonItems = onsiteReasons.length ? onsiteReasons : ["We need to confirm the ceiling area, existing insulation and site conditions during your Ready Check."];
  const onsiteSub = CUSTOMER_ONSITE_HERO.subheading(onsiteReasons.length || 3);
  const heroTitle = onsite
    ? `${CUSTOMER_ONSITE_HERO.heading}${name ? `, ${escape(name.toUpperCase())}.` : "."}`
    : `${CUSTOMER_LIKELY_HERO.heading}${name ? `, ${escape(name.toUpperCase())}.` : "."}`;
  const heroP = (t: string, extra = "") => `<p class="hiv-body" style="margin:12px 0 0;color:${WHITE};font-family:${OPEN_SANS};font-size:14px;line-height:1.55;font-weight:500;${extra}">${escape(t)}</p>`;
  const heroSub = onsite ? `<div data-onsite-reasons="true"><p class="hiv-body" style="margin:14px 0 10px;color:#B2F7C9;font-family:${OPEN_SANS};font-size:14px;line-height:1.45;font-weight:800;">${onsiteSub}</p>${reasonItems.map((r) => `<p style="margin:0 0 7px;color:${WHITE};font-family:${OPEN_SANS};font-size:13.5px;line-height:1.5;font-weight:600;"><span style="color:#93F3B6;font-weight:800;">✓</span>&nbsp; ${escape(r)}</p>`).join("")}</div>${heroP(CUSTOMER_ONSITE_HERO.transition, "font-size:13px;")}` : `${heroP(CUSTOMER_LIKELY_HERO.intro)}${heroP(CUSTOMER_LIKELY_HERO.next)}`;
  const propertyBlock = address ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#3248A9" style="width:100%;margin-top:17px;border-collapse:separate;border-spacing:0;background-color:#3248A9;border:1px solid #7C8BE0;border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td style="padding:14px 16px;font-family:${OPEN_SANS};"><p style="margin:0 0 3px;color:#B2F7C9;font-family:${OPEN_SANS};font-size:9px;line-height:1.3;font-weight:800;letter-spacing:1.5px;">PROPERTY</p><p style="margin:0;color:${WHITE};font-family:${OPEN_SANS};font-size:15px;line-height:1.4;font-weight:800;">${escape(address)}</p></td></tr></table>` : "";
  const hero = `<p style="margin:0 0 10px;color:#93F3B6;font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.8px;">YOUR PRELIMINARY VEU INSULATION ESTIMATE</p><div class="hiv-hero-title" role="heading" aria-level="1" style="margin:0;color:#FFFFFF;font-family:${OPEN_SANS};font-size:38px;line-height:40px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:-1.9px;">${heroTitle}</div>${heroSub}${propertyBlock}`;

  const quoteRow = (nameText: string, amount: number, note = "") => `<tr><td class="hiv-quote-label" valign="top" style="padding:13px 12px 13px 0;border-bottom:1px solid #DDE4FB;color:${INK};font-family:${OPEN_SANS};font-size:14px;line-height:1.45;font-weight:700;overflow-wrap:break-word;word-break:normal;">${nameText}${note ? `<br><span style="color:${INK};font-family:${OPEN_SANS};font-size:12px;font-weight:400;">${note}</span>` : ""}</td><td class="hiv-quote-amount" width="112" align="right" valign="top" style="width:112px;padding:13px 0;border-bottom:1px solid #DDE4FB;color:${BLUE};font-family:${OPEN_SANS};font-size:15px;line-height:1.45;font-weight:800;white-space:nowrap;">${escape(money(amount))}</td></tr>`;
  const detailedRows = hasBreakdown ? customerQuoteRows({ piesa: assessment, installation, apManagement: apFee }).map(({ label: rowLabel, amount }) => quoteRow(escape(rowLabel), amount)).join("") : "";
  const discountBand = `<table data-discount-band="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CUSTOMER_DISCOUNT_TREATMENT.bandBackground}" style="width:100%;margin:6px 0 18px;border-collapse:separate;border-spacing:0;background-color:${CUSTOMER_DISCOUNT_TREATMENT.bandBackground};border:1px solid ${CUSTOMER_DISCOUNT_TREATMENT.bandBorder};border-radius:12px;font-family:${OPEN_SANS};"><tr><td class="hiv-quote-label" style="padding:14px 10px 14px 14px;color:${CUSTOMER_DISCOUNT_TREATMENT.amountColor};font-family:${OPEN_SANS};font-size:14px;line-height:1.35;font-weight:800;">${CUSTOMER_QUOTE_LABELS.discount}</td><td class="hiv-quote-amount hiv-discount" width="120" align="right" style="width:120px;padding:14px 14px 14px 0;color:${CUSTOMER_DISCOUNT_TREATMENT.amountColor};font-family:${OPEN_SANS};font-size:26px;line-height:1;font-weight:800;white-space:nowrap;">${escape(discountAmount(discount))}</td></tr></table>`;
  const quoteSummary = hasBreakdown
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;font-family:${OPEN_SANS};">${detailedRows}<tr><td class="hiv-quote-label" style="padding:16px 12px 8px 0;color:${INK};font-family:${OPEN_SANS};font-size:14px;line-height:1.4;font-weight:800;">${CUSTOMER_QUOTE_LABELS.projectTotal}</td><td class="hiv-quote-amount" width="112" align="right" style="width:112px;padding:16px 0 8px;color:${BLUE};font-family:${OPEN_SANS};font-size:18px;font-weight:800;white-space:nowrap;">${escape(money(gross))}</td></tr></table>${discountBand}`
    : `<p style="margin:0;color:${INK};font-size:14px;line-height:1.5;font-weight:800;">${CUSTOMER_QUOTE_LABELS.projectTotal} &nbsp;<span style="color:${BLUE};">${escape(money(packagePrice))}</span></p>${discountBand}`;
  const reassurance = `<div style="margin-top:17px;padding-top:16px;border-top:1px solid #DDE4FB;"><p style="margin:0 0 8px;color:${BLUE};font-family:${OPEN_SANS};font-size:13px;line-height:1.35;font-weight:800;">${CUSTOMER_WHAT_COULD_CHANGE.heading}</p><p class="hiv-body" style="margin:0 0 11px;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;">${escape(CUSTOMER_WHAT_COULD_CHANGE.intro)}</p>${CUSTOMER_WHAT_COULD_CHANGE.items.map(({ lead, copy }) => `<p class="hiv-body" style="margin:0 0 7px;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;"><strong>${escape(lead)} —</strong> ${escape(copy)}</p>`).join("")}<p class="hiv-body" style="margin:11px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;font-weight:700;">${escape(CUSTOMER_WHAT_COULD_CHANGE.closing)}</p></div>`;
  const areaRow = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 4px;border-collapse:collapse;font-family:${OPEN_SANS};"><tr><td style="padding:0;color:${INK};font-family:${OPEN_SANS};font-size:13px;line-height:1.4;font-weight:700;">Estimated ceiling size: <strong>${escape(number(area))} m²</strong></td><td width="76" align="right" style="width:76px;padding:0;font-family:${OPEN_SANS};"><a href="${escape(calculatorTarget)}" style="color:${BLUE};font-family:${OPEN_SANS};font-size:12px;line-height:1.4;font-weight:800;text-decoration:underline;letter-spacing:.4px;white-space:nowrap;">CHANGE →</a></td></tr></table><p class="hiv-body" style="margin:0 0 12px;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;font-weight:400;">${input.areaIsTypical ? "Based on a typical Victorian home size — your Ready Check confirms the exact area. Change it to see a revised estimate." : "Based on the estimated ceiling size provided in your enquiry. Change it to see a revised estimate."}</p>`;
  const calculatorButton = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${GREEN};border-radius:12px;"><tr><td style="padding:0 4px 4px 0;font-family:${OPEN_SANS};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${WHITE};border:2px solid ${BLUE};border-radius:12px;"><tr><td align="center" style="padding:0;"><a class="hiv-cta" href="${escape(calculatorTarget)}" style="display:block;padding:14px 16px;color:${BLUE};font-family:${OPEN_SANS};font-size:13px;line-height:1.3;font-weight:800;text-decoration:none;letter-spacing:.8px;">OPEN THE INTERACTIVE CALCULATOR →</a></td></tr></table></td></tr></table>`;
  const calculatorCallout = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${WHITE};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${OPEN_SANS};"><p style="margin:0 0 6px;color:${GREEN};font-family:${OPEN_SANS};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.5px;">WANT TO CHECK THE NUMBERS FIRST?</p><h2 style="margin:0 0 9px;color:${BLUE};font-family:${OPEN_SANS};font-size:18px;line-height:1.2;font-weight:800;">TRY ANOTHER PROPERTY OR CEILING SIZE</h2><p class="hiv-body" style="margin:0 0 14px;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.55;">Your estimate is based on your property address and ${input.areaIsTypical ? `a typical ${escape(number(area))} m² ceiling size` : `the ${escape(number(area))} m² ceiling size you entered`}. Use our interactive calculator to see how a different Victorian property address or ceiling size could change your estimated project total, VEU / VEEC discount and estimated cost after discount.</p>${calculatorButton}<p style="margin:10px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:10.5px;line-height:1.5;text-align:center;">Calculator changes are for comparison only and do not overwrite your enquiry.</p></td></tr></table>`;


  const confirmationSection = `<div data-ready-check-inside-quote="true" style="margin-top:20px;padding:18px 16px 16px;background-color:${PALE_GREEN};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softGreenBorder};border-radius:14px;"><p style="margin:0 0 6px;color:${GREEN};font-family:${OPEN_SANS};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.5px;">${CUSTOMER_READY_CHECK_EMAIL_ACTION.eyebrow}</p><h2 style="margin:0 0 10px;color:${BLUE};font-family:${OPEN_SANS};font-size:20px;line-height:1.15;font-weight:800;">${CUSTOMER_READY_CHECK_EMAIL_ACTION.heading}</h2><p class="hiv-body" style="margin:0 0 7px;color:${INK};font-family:${OPEN_SANS};font-size:12.5px;line-height:1.55;">${escape(CUSTOMER_READY_CHECK_EMAIL_ACTION.sentence)}</p><p class="hiv-body" style="margin:0 0 14px;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;font-weight:800;">${escape(CUSTOMER_READY_CHECK_EMAIL_ACTION.credit)}</p>${likelyCta(ctaText)}<p style="margin:9px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:10.5px;line-height:1.5;text-align:center;">${escape(CUSTOMER_READY_CHECK_EMAIL_ACTION.helper)}</p>${verifiedAp ? `<p style="margin:8px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:10px;line-height:1.5;font-weight:700;">HOME INSULATION VICTORIA IS ONE OF ONLY ${input.apCount} ACCREDITED PERSONS CURRENTLY APPROVED FOR ACTIVITY 48 IN VICTORIA.</p>` : ""}</div>`;
  const moneyCard = `<table data-main-quote-card="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${ACCENT}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${ACCENT};border-radius:20px;"><tr><td style="padding:0 4px 5px 0;font-family:${OPEN_SANS};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${WHITE};border:2px solid ${BLUE};border-radius:20px;font-family:${OPEN_SANS};"><tr><td class="hiv-card-pad" style="padding:24px 22px;font-family:${OPEN_SANS};"><p style="margin:0;color:${GREEN};font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.87px;">YOUR PRELIMINARY QUOTE</p>${areaRow}${quoteSummary}<p style="margin:0 0 4px;color:${BLUE};font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.87px;">${CUSTOMER_QUOTE_LABELS.finalCost}</p><p class="hiv-price" style="margin:0;color:${BLUE};font-family:${OPEN_SANS};font-size:44px;line-height:1;font-weight:800;letter-spacing:-1.76px;">${escape(money(customer))}</p>${confirmationSection}${reassurance}<p style="margin:13px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:11px;line-height:1.5;font-weight:700;">${CUSTOMER_WHAT_COULD_CHANGE.gst}</p></td></tr></table></td></tr></table>`;

  const referralStrip = referralUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALE_GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${PALE_GREEN};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softGreenBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${OPEN_SANS};"><p style="margin:0 0 6px;color:${BLUE};font-family:${OPEN_SANS};font-size:13px;line-height:1.3;font-weight:800;letter-spacing:.4px;">KNOW SOMEONE WHO MIGHT QUALIFY?</p><p style="margin:0 0 12px;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.55;">Share Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="border-collapse:separate;border-spacing:0;background-color:${GREEN};border-radius:10px;"><tr><td style="padding:0;"><a href="${escape(referralUrl)}" style="display:block;padding:11px 20px;color:${WHITE};font-family:${OPEN_SANS};font-size:12px;line-height:1.3;font-weight:800;text-decoration:none;letter-spacing:.6px;">REFER A FRIEND →</a></td></tr></table></td></tr></table>` : "";
  const footerBlock = `<p style="margin:0 0 5px;color:${BLUE};font-size:12px;font-weight:800;">Home Insulation Victoria</p><p style="margin:0;color:${INK};font-size:10px;line-height:1.55;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference?.trim() ? ` &nbsp;·&nbsp; Reference: ${escape(input.reference.trim())}` : ""}<br><a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact</a> &nbsp;·&nbsp; A secure unsubscribe link appears below.</p>`;

  const html = likelyShell(`${likelySection(`<img class="hiv-logo" src="${LOGO_URL}" alt="Home Insulation Victoria" width="187" height="80" style="display:block;width:187px;height:auto;max-width:100%;border:0;font-family:${OPEN_SANS};">`, "24px 32px 20px", "hiv-logo-wrap hiv-pad")}${likelySection(hero, "26px 32px 28px", "hiv-hero hiv-pad").replace("<tr><td", `<tr bgcolor="${BLUE}" style="background-color:${BLUE};"><td bgcolor="${BLUE}"`)}${likelySection(moneyCard, "24px 32px 14px")}${likelySection(calculatorCallout, "0 32px 16px")}${referralStrip ? likelySection(referralStrip, "0 32px 12px") : ""}${likelySection(footerBlock, "12px 32px 16px", "hiv-footer hiv-pad").replace("<tr><td", `<tr bgcolor="#F1F8F3" style="background-color:#F1F8F3;border-top:3px solid ${GREEN};"><td bgcolor="#F1F8F3"`)}`, previewText, pixel);

  const plainBreakdown = hasBreakdown ? `${CUSTOMER_QUOTE_LABELS.piesa}: ${money(assessment)}\n${CUSTOMER_QUOTE_LABELS.insulation}: ${money(installation)}\n${CUSTOMER_QUOTE_LABELS.apManagement}: ${money(apFee)}\n${CUSTOMER_QUOTE_LABELS.projectTotal}: ${money(gross)}\n${CUSTOMER_QUOTE_LABELS.discount}: ${discountAmount(discount)}\n${CUSTOMER_QUOTE_LABELS.finalCost}: ${money(customer)}` : `${CUSTOMER_QUOTE_LABELS.projectTotal}: ${money(packagePrice)}\n${CUSTOMER_QUOTE_LABELS.discount}: ${discountAmount(discount)}\n${CUSTOMER_QUOTE_LABELS.finalCost}: ${money(customer)}`;
  const plainReasons = onsite ? `\n${onsiteSub}\n${reasonItems.map((r) => `✓ ${r}`).join("\n")}\n\n${CUSTOMER_ONSITE_HERO.transition}` : "";
  const plainChangeExplanation = `${CUSTOMER_WHAT_COULD_CHANGE.heading}\n${CUSTOMER_WHAT_COULD_CHANGE.intro}\n${CUSTOMER_WHAT_COULD_CHANGE.items.map(({ lead, copy }) => `• ${lead} — ${copy}\n`).join("")}${CUSTOMER_WHAT_COULD_CHANGE.closing}\n${CUSTOMER_WHAT_COULD_CHANGE.gst}`;
  const plainText = `${subject}\n\n${onsite ? `${CUSTOMER_ONSITE_HERO.heading}${name ? `, ${name}.` : "."}${plainReasons}` : `${CUSTOMER_LIKELY_HERO.heading}${name ? `, ${name}.` : "."}\n${CUSTOMER_LIKELY_HERO.intro}\n${CUSTOMER_LIKELY_HERO.next}`}${address ? `\nPROPERTY\n${address}` : ""}\n\nYOUR PRELIMINARY QUOTE\nEstimated ceiling size: ${number(area)} m² — CHANGE: ${calculatorTarget}\n${input.areaIsTypical ? "Based on a typical Victorian home size — your Ready Check confirms the exact area. Change it to see a revised estimate." : "Based on the estimated ceiling size provided in your enquiry. Change it to see a revised estimate."}\n\n${plainBreakdown}\n\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.eyebrow}\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.heading}\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.sentence}\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.credit}\n${ctaPlain}: ${confirmTarget}\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.helper}\n\n${plainChangeExplanation}\n\nWANT TO CHECK THE NUMBERS FIRST?\nTRY ANOTHER PROPERTY OR CEILING SIZE\nYour estimate is based on your property address and ${input.areaIsTypical ? `a typical ${number(area)} m² ceiling size` : `the ${number(area)} m² ceiling size you entered`}. Use our interactive calculator to see how a different Victorian property address or ceiling size could change your estimated project total, VEU / VEEC discount and estimated cost after discount.\nOPEN THE INTERACTIVE CALCULATOR: ${calculatorTarget}\nCalculator changes are for comparison only and do not overwrite your enquiry.${verifiedAp ? `\nHome Insulation Victoria is one of only ${input.apCount} Accredited Persons currently approved for VEU Activity 48 in Victoria.` : ""}${referralUrl ? `\n\nKNOW SOMEONE WHO MIGHT QUALIFY?\nShare Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.\nREFER A FRIEND: ${referralUrl}` : ""}\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference ? ` · Reference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy · Contact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}

export function renderEstimateEmail(input: EstimateEmailInput): EstimateEmail {
  const outcome = input.outcome ?? "likely";
  if (outcome === "likely") return renderLikelyEligibleEmail({ ...input, outcome });
  return renderLikelyEmail({ ...input, outcome });
}

// ---------------------------------------------------------------------------
// LIKELY ELIGIBLE — premium proposal-style email (2026-10 redesign).
// Isolated from the onsite/ineligible renderers above; shares only validation, escaping and URL guards.
// ---------------------------------------------------------------------------

/** Clean public calculator (no customer data in the URL). */
export const PUBLIC_CALCULATOR_URL = "https://estimate.homeinsulationvictoria.com.au/calculator";
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

function renderLikelyEligibleEmail(input: EstimateEmailInput): EstimateEmail {
  const { confirmTarget, pixel, referralUrl, customer, discount, area, packagePrice, hasBreakdown, installation, assessment, apFee, gross } = validateQuoteInput(input);
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60) || null;
  const address = input.address?.trim().replace(/\s+/g, " ").slice(0, 180) || null;
  const { subject, previewText } = likelySubjectLine(name, discount);
  const F = `font-family:${FIGTREE};`;
  const FH = `font-family:${OUTFIT};`;
  const row = (content: string, pad = "0 36px 28px", extra = "") => `<tr><td class="lx-pad" style="padding:${pad};${F}${extra}">${content}</td></tr>`;
  const p = (t: string, s = "") => `<p class="lx-body" style="margin:0;${F}color:${INK};font-size:15px;line-height:1.6;${s}">${t}</p>`;
  const h2 = (t: string) => `<h2 style="margin:0 0 12px;${FH}color:${INK};font-size:23px;line-height:1.2;font-weight:800;letter-spacing:0;">${t}</h2>`;
  const button = (href: string, text: string, primary: boolean) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td align="center" bgcolor="${primary ? GREEN : WHITE}" style="background-color:${primary ? GREEN : WHITE};border:${primary ? "0" : `2px solid ${BLUE}`};border-radius:12px;mso-padding-alt:15px 18px;${primary ? "box-shadow:0 10px 24px -12px rgba(7,191,97,.55);" : ""}"><a class="lx-button" href="${escape(href)}" style="display:block;padding:15px 18px;${F}color:${primary ? WHITE : BLUE};font-size:16px;line-height:20px;font-weight:800;text-decoration:none;border-radius:12px;">${text}</a></td></tr></table>`;

  // 1. Header
  const header = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td valign="middle"><img class="lx-logo hiv-logo" src="${LOGO_URL}" alt="Home Insulation Victoria" width="142" height="61" style="display:block;width:142px;height:auto;max-width:100%;border:0;"></td><td align="right" valign="middle"><span class="lx-badge" style="display:inline-block;padding:7px 11px;background-color:${BLUSH};border-radius:999px;${F}color:${INK};font-size:10px;line-height:1.2;font-weight:800;letter-spacing:.7px;text-transform:uppercase;">Free estimate · no obligation</span></td></tr></table>`;

  // 2. Hero
  const goodNews = name ? `Good news, ${escape(name)} — based` : "Good news — based";
  const hero = `<p style="margin:0 0 8px;${F}color:${TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Preliminary eligibility result</p><h1 class="lx-h1 hiv-hero-title" style="margin:0 0 14px;${FH}color:${INK};font-size:34px;line-height:39px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">How much could you save on ceiling insulation?</h1>${p(`${goodNews} on what you’ve told us, your home looks likely to qualify for a VEU ceiling insulation rebate.`)}${p("A more comfortable home could be closer than you think. We’ll coordinate the installer, electrical checks and paperwork.", "margin-top:8px;")}`;

  // 3. Savings module (echoes the standalone calculator)
  const areaNote = input.areaIsTypical ? `${escape(number(area))} m² (typical-home assumption)` : `${escape(number(area))} m²`;
  const summary = `${address ? `<tr><td style="padding:4px 0;${F}color:${INK};font-size:13px;">Property</td><td align="right" style="padding:4px 0 4px 12px;${F}color:${INK};font-size:13px;font-weight:800;">${escape(address)}</td></tr>` : ""}<tr><td style="padding:4px 0;${F}color:${INK};font-size:13px;">Ceiling</td><td align="right" style="padding:4px 0 4px 12px;${F}color:${INK};font-size:13px;font-weight:800;">${areaNote}</td></tr>`;
  const savings = `<table data-likely-savings="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MIST}" style="width:100%;border-collapse:separate;background-color:${MIST};border-radius:22px;"><tr><td class="lx-result-pad" style="padding:22px 20px;${F}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MINT}" style="width:100%;border-collapse:separate;background-color:${MINT};border:2px solid ${GREEN};border-radius:18px;"><tr><td align="center" style="padding:18px 12px;${F}"><p style="margin:0;${F}color:${INK};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">Your estimated VEU rebate</p><p class="lx-saving" style="margin:5px 0 0;${FH}color:${GREEN};font-size:38px;line-height:42px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">You could save ${escape(money(discount))}</p></td></tr></table><div style="text-align:center;padding:18px 0 12px;"><p style="margin:0;${F}color:${INK};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">Your estimated cost after rebate</p><p class="lx-cost" style="margin:5px 0 0;${FH}color:${BLUE};font-size:46px;line-height:50px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">${escape(money(customer))}</p><p style="margin:4px 0 0;${F}color:${INK};font-size:12px;line-height:1.4;font-weight:700;">incl. GST · before rebate ${escape(money(hasBreakdown ? gross : packagePrice))}</p><p style="margin:8px auto 0;max-width:390px;${F}color:${INK};font-size:11px;line-height:1.5;">Estimate only. Eligibility, measurements and final pricing confirmed after assessment.</p></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid ${LINE};">${summary}</table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;margin-top:16px;border-collapse:separate;background-color:${WHITE};border-radius:14px;"><tr><td style="padding:16px;${F}"><p style="margin:0 0 4px;${FH}color:${INK};font-size:17px;line-height:1.3;font-weight:800;">Want to try a different ceiling size?</p><p style="margin:0 0 12px;${F}color:${INK};font-size:13px;line-height:1.5;">Change the ceiling size or property details and see your estimate update instantly.</p>${button(PUBLIC_CALCULATOR_URL, "Open the calculator →", false)}</td></tr></table></td></tr></table>`;

  // 4. What we take care of
  const benefits: Array<[string, string]> = [
    ["Free Home Insulation Ready Check", "A certified insulation installer confirms the ceiling size, access and existing insulation."],
    ["R5.0 ceiling insulation — supply & install", "Fitted by a vetted EEC-certified insulation installer."],
    ["Mandatory PIESA", "A licensed electrician completes this paid safety assessment close to installation."],
    ["Paperwork and rebate", "Home Insulation Victoria handles the required paperwork and VEU rebate processing."],
  ];
  const care = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;border-collapse:separate;background-color:${WHITE};border:1px solid ${LINE};border-radius:18px;"><tr><td style="padding:22px 20px;">${h2("What this includes")}${benefits.map(([t, c]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td width="32" valign="top" style="width:32px;padding:2px 0 12px;color:${GREEN};font-size:16px;font-weight:800;">✓</td><td valign="top" style="padding:0 0 12px;${F}"><p style="margin:0 0 2px;${F}color:${INK};font-size:14px;line-height:1.4;font-weight:800;">${t}</p><p style="margin:0;${F}color:${INK};font-size:13px;line-height:1.5;">${c}</p></td></tr></table>`).join("")}</td></tr></table>`;

  // 5. Primary conversion
  const nextStep = `<table data-likely-next-step="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUSH}" style="width:100%;border-collapse:separate;background-color:${BLUSH};border-radius:20px;"><tr><td style="padding:24px 22px;${F}"><p style="margin:0 0 7px;${F}color:${TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;">High demand</p>${h2("Demand is high. Installer availability is limited.")}${p("Arrange your free Ready Check so we can confirm your ceiling size and discuss availability in your area.")}<div style="height:16px;line-height:16px;">&nbsp;</div>${button(confirmTarget, "Arrange my free Ready Check →", true)}<p style="margin:10px 0 0;${F}color:${INK};font-size:12px;line-height:1.5;font-weight:700;text-align:center;">Free Ready Check. No obligation to proceed.</p></td></tr></table>`;

  // 6. Itemised estimate
  const line = (t: string, amt: string, opts: { note?: string; bold?: boolean; color?: string; top?: boolean } = {}) => `<tr><td valign="top" style="padding:10px 12px 10px 0;${opts.top ? `border-top:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};` : ""}${F}color:${INK};font-size:15px;line-height:1.45;font-weight:${opts.bold ? 800 : 400};">${t}${opts.note ? `<br><span style="${F}font-size:13px;line-height:1.45;font-weight:400;color:${INK};">${opts.note}</span>` : ""}</td><td class="lx-row-amt" width="104" align="right" valign="top" style="width:104px;padding:10px 0;${opts.top ? `border-top:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};` : ""}${F}color:${opts.color ?? INK};font-size:15px;line-height:1.45;font-weight:${opts.bold ? 800 : 600};white-space:nowrap;">${amt}</td></tr>`;
  const items = hasBreakdown ? customerQuoteRows({ piesa: assessment, installation, apManagement: apFee }).map(({ key, label: l, amount }, i) => line(escape(l), escape(money(amount)), { ...(key === "piesa" ? { note: escape(CUSTOMER_PIESA_NOTE) } : {}), top: i === 0 })).join("") : "";
  const changes = ["Final measured ceiling size", "Existing insulation or removal", "Ceiling access", "Electrical rectification identified during PIESA"];
  const estimate = `${h2("Your estimate breakdown")}<table data-likely-itemised="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${line(`${escape(CUSTOMER_READY_CHECK.name)}`, "Free", { note: "Separate from the paid project estimate below.", color: TEXT_GREEN, bold: true })}${items}${line(escape(CUSTOMER_QUOTE_LABELS.projectTotal), escape(money(hasBreakdown ? gross : packagePrice)), { bold: true, top: true })}${line(escape(CUSTOMER_QUOTE_LABELS.discount), escape(discountAmount(discount)), { color: TEXT_GREEN, bold: true })}${line("Estimated cost after rebate", escape(money(customer)), { bold: true, color: BLUE, top: true })}</table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MIST}" style="width:100%;margin-top:18px;border-collapse:separate;background-color:${MIST};border-radius:14px;"><tr><td style="padding:16px;${F}"><p style="margin:0 0 8px;${FH}color:${INK};font-size:16px;line-height:1.3;font-weight:800;">What could change this price?</p>${changes.map((change) => `<p style="margin:4px 0;${F}color:${INK};font-size:13px;line-height:1.45;"><span style="color:${GREEN};font-weight:800;">✓</span>&nbsp; ${change}</p>`).join("")}<p style="margin:10px 0 0;${F}color:${INK};font-size:13px;line-height:1.5;font-weight:700;">${escape(CUSTOMER_WHAT_COULD_CHANGE.closing)} ${escape(CUSTOMER_WHAT_COULD_CHANGE.gst)}</p></td></tr></table>`;

  // 7. Footer
  const ref = input.reference?.trim() ? ` · Reference: ${escape(input.reference.trim())}` : "";
  const footer = `<p style="margin:0 0 5px;${F}color:${INK};font-size:13px;line-height:1.4;font-weight:800;">Home Insulation Victoria</p><p style="margin:0;${F}color:${INK};font-size:11px;line-height:1.65;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria${ref}<br>You’re receiving this because you requested an eligibility result or estimate.<br><a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy policy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact us</a>${referralUrl ? ` &nbsp;·&nbsp; <a href="${escape(referralUrl)}" style="color:${BLUE};text-decoration:underline;">Refer a friend</a>` : ""}<br>A secure unsubscribe link appears below.</p>`;

  const html = likelyV2Shell(
    `${row(header, "22px 36px 18px")}${row(hero, "8px 36px 24px")}${row(savings, "0 28px 26px")}${row(care, "0 28px 20px")}${row(nextStep, "0 28px 24px")}${row(estimate, "4px 36px 28px")}${row(footer, "20px 36px 22px", `background-color:${MINT};border-top:1px solid ${LINE};border-radius:0 0 24px 24px;`)}`,
    previewText, pixel,
  );

  const plainItems = hasBreakdown ? customerQuoteRows({ piesa: assessment, installation, apManagement: apFee }).map(({ key, label: l, amount }) => `${l}: ${money(amount)}${key === "piesa" ? `\n  (${CUSTOMER_PIESA_NOTE})` : ""}`).join("\n") + "\n" : "";
  const plainText = [
    subject, "",
    "How much could you save on ceiling insulation?", "",
    `${name ? `Good news, ${name} — based` : "Good news — based"} on what you’ve told us, your home looks likely to qualify for a VEU ceiling insulation rebate.`,
    "A more comfortable home could be closer than you think. We’ll coordinate the installer, electrical checks and paperwork.", "",
    "YOUR ESTIMATE",
    `Your estimated VEU rebate: You could save ${money(discount)}`,
    `Your estimated cost after rebate: ${money(customer)}`,
    `incl. GST · before rebate ${money(hasBreakdown ? gross : packagePrice)}`,
    "Estimate only. Eligibility, measurements and final pricing confirmed after assessment.",
    ...(address ? [`Property: ${address}`] : []),
    `Ceiling: ${number(area)} m²${input.areaIsTypical ? " (typical-home assumption)" : ""}`, "",
    "Want to try a different ceiling size?",
    "Change the ceiling size or property details and see your estimate update instantly.",
    `Open the calculator: ${PUBLIC_CALCULATOR_URL}`, "",
    "WHAT THIS INCLUDES",
    ...benefits.map(([t, c]) => `✓ ${t} — ${c}`), "",
    "Demand is high. Installer availability is limited.",
    "Arrange your free Ready Check so we can confirm your ceiling size and discuss availability in your area.",
    `Arrange my free Ready Check: ${confirmTarget}`,
    "Free Ready Check. No obligation to proceed.", "",
    "YOUR ESTIMATE BREAKDOWN",
    `${CUSTOMER_READY_CHECK.name}: Free (separate from the paid project estimate below)`,
    `${plainItems}${CUSTOMER_QUOTE_LABELS.projectTotal}: ${money(hasBreakdown ? gross : packagePrice)}`,
    `${CUSTOMER_QUOTE_LABELS.discount}: ${discountAmount(discount)}`,
    `Estimated cost after rebate: ${money(customer)}`,
    "",
    "WHAT COULD CHANGE THIS PRICE?",
    ...changes.map((change) => `• ${change}`),
    `${CUSTOMER_WHAT_COULD_CHANGE.closing} ${CUSTOMER_WHAT_COULD_CHANGE.gst}`, "",
    "Home Insulation Victoria",
    `DC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference?.trim() ? ` · Reference: ${input.reference.trim()}` : ""}`,
    `Privacy: ${SITE}/privacy · Contact: ${SITE}/contact${referralUrl ? ` · Refer a friend: ${referralUrl}` : ""}`,
    "A secure unsubscribe link appears below.",
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
  const subject = "Your Home Insulation Victoria eligibility result";
  const previewText = "Your eligibility result and the options available from here.";
  const resultReasons = [...new Set(reasons.length ? reasons : ["Based on the information provided, this property does not meet the current requirements for this VEU ceiling-insulation offer."])];
  const reasonList = resultReasons.map((r) => `<p class="hiv-body" style="margin:0 0 9px;color:${INK};font-family:${OPEN_SANS};font-size:13px;line-height:1.55;"><span style="color:${BLUE};font-weight:800;">•</span> ${escape(r)}</p>`).join("");
  const ineligibleSection = (content: string, pad = "0 32px 24px", className = "hiv-pad") => `<tr><td class="${className}" style="padding:${pad};font-family:${OPEN_SANS};">${content}</td></tr>`;
  const reviewCta = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${GREEN};border-radius:12px;"><tr><td style="padding:0 4px 4px 0;font-family:${OPEN_SANS};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${BLUE};border-radius:12px;"><tr><td align="center" style="padding:0;font-family:${OPEN_SANS};"><a class="hiv-cta" href="${escape(resultUrl)}" style="display:block;padding:12px 14px;color:${WHITE};font-family:${OPEN_SANS};font-size:12.5px;line-height:1.3;font-weight:800;text-decoration:none;letter-spacing:1.1px;">${CUSTOMER_INELIGIBLE_COPY.cta}</a></td></tr></table></td></tr></table>`;
  const secondaryCard = (content: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${OUTER};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${OPEN_SANS};">${content}</td></tr></table>`;
  const lbl = (t: string) => `<p style="margin:0 0 10px;color:${GREEN};font-family:${OPEN_SANS};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.5px;">${t}</p>`;
  const resultCard = secondaryCard(`${lbl("YOUR RESULT")}<h2 class="hiv-heading" style="margin:0 0 12px;color:${BLUE};font-family:${OPEN_SANS};font-size:24px;line-height:1.05;font-weight:800;letter-spacing:-.8px;">${CUSTOMER_INELIGIBLE_COPY.heading}</h2><p class="hiv-body" style="margin:0 0 10px;color:${INK};font-family:${OPEN_SANS};font-size:12.5px;line-height:1.55;">${escape(CUSTOMER_INELIGIBLE_COPY.intro)}</p>${reasonList}<div style="margin-top:14px;padding-top:14px;border-top:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};"><p style="margin:0 0 6px;color:${BLUE};font-family:${OPEN_SANS};font-size:13px;line-height:1.3;font-weight:800;">${CUSTOMER_INELIGIBLE_COPY.reviewHeading}</p><p class="hiv-body" style="margin:0;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.55;">${escape(CUSTOMER_INELIGIBLE_COPY.review)}</p></div>`);
  const trustLine = secondaryCard(`<p class="hiv-body" style="margin:0;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.55;"><strong style="color:${BLUE};">HOME INSULATION VICTORIA</strong><br>${escape(apStatement(input.apCount))} We coordinate qualified trades, compliance and VEEC processing for eligible upgrades.</p>`);
  const referralStrip = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALE_GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${PALE_GREEN};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softGreenBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${OPEN_SANS};"><p style="margin:0 0 6px;color:${BLUE};font-family:${OPEN_SANS};font-size:13px;line-height:1.3;font-weight:800;letter-spacing:.4px;">KNOW SOMEONE WHO MIGHT QUALIFY?</p><p style="margin:0 0 12px;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.55;">Share Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="border-collapse:separate;border-spacing:0;background-color:${GREEN};border-radius:10px;"><tr><td style="padding:0;"><a href="${escape(referralUrl)}" style="display:block;padding:11px 20px;color:${WHITE};font-family:${OPEN_SANS};font-size:12px;line-height:1.3;font-weight:800;text-decoration:none;letter-spacing:.6px;">REFER A FRIEND →</a></td></tr></table></td></tr></table>`;
  const compactFooter = `<p style="margin:0 0 5px;color:${BLUE};font-size:12px;font-weight:800;">Home Insulation Victoria</p><p style="margin:0;color:${INK};font-size:10px;line-height:1.55;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference?.trim() ? ` &nbsp;·&nbsp; Reference: ${escape(input.reference.trim())}` : ""}<br><a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact</a> &nbsp;·&nbsp; A secure unsubscribe link appears below.</p>`;
  const hero = `<p style="margin:0 0 10px;color:#93F3B6;font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.8px;">YOUR HOME INSULATION VICTORIA RESULT</p><div class="hiv-hero-title" role="heading" aria-level="1" style="margin:0;color:#FFFFFF;font-family:${OPEN_SANS};font-size:38px;line-height:40px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:-1.9px;">WE'VE COMPLETED YOUR PROPERTY CHECK.</div>`;
  const html = likelyShell(`${ineligibleSection(`<img class="hiv-logo" src="${LOGO_URL}" alt="Home Insulation Victoria" width="187" height="80" style="display:block;width:187px;height:auto;max-width:100%;border:0;font-family:${OPEN_SANS};">`, "24px 32px 20px", "hiv-logo-wrap hiv-pad")}${ineligibleSection(hero, "26px 32px 28px", "hiv-hero hiv-pad").replace("<tr><td", `<tr bgcolor="${BLUE}" style="background-color:${BLUE};"><td bgcolor="${BLUE}"`)}${ineligibleSection(resultCard, "24px 32px 16px")}${ineligibleSection(reviewCta, "0 32px 13px")}${ineligibleSection(trustLine, "0 32px 13px")}${ineligibleSection(referralStrip, "0 32px 12px")}${ineligibleSection(compactFooter, "12px 32px 16px", "hiv-footer hiv-pad").replace("<tr><td", `<tr bgcolor="#F1F8F3" style="background-color:#F1F8F3;border-top:3px solid ${GREEN};"><td bgcolor="#F1F8F3"`)}`, previewText, null);
  const plainText = `${subject}\n\nWE'VE COMPLETED YOUR PROPERTY CHECK.\n\n${CUSTOMER_INELIGIBLE_COPY.heading}\n\n${CUSTOMER_INELIGIBLE_COPY.intro}\n${resultReasons.map((r) => `• ${r}`).join("\n")}\n\n${CUSTOMER_INELIGIBLE_COPY.reviewHeading}\n${CUSTOMER_INELIGIBLE_COPY.review}\n\nREVIEW MY RESULT: ${resultUrl}\n\n${apStatement(input.apCount)} We coordinate qualified trades, compliance and VEEC processing for eligible upgrades.\n\nKNOW SOMEONE WHO MIGHT QUALIFY?\nShare Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.\nREFER A FRIEND: ${referralUrl}\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference ? ` · Reference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy · Contact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}
