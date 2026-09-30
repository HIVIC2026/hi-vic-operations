import { READY_CHECK_FEE } from "./readycheck.core";
/** Pure customer outcome email renderers: no data access, delivery, or side effects. */
import { CUSTOMER_ASSESSMENT_ACTION, CUSTOMER_ONSITE_HERO, CUSTOMER_BRAND, CUSTOMER_CALCULATOR_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_READY_CHECK_EMAIL_ACTION, CUSTOMER_VISUAL_SYSTEM, CUSTOMER_WHAT_COULD_CHANGE, customerQuoteRows, CUSTOMER_DISCOUNT_TREATMENT, discountAmount } from "./customer-quote-system";

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
function shell(content: string, preview: string, pixel: string | null, fixedLayout = false) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(preview)}</title></head><body style="margin:0;padding:0;background-color:${OUTER};font-family:'Open Sans',Arial,Helvetica,sans-serif;color:${INK};"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(preview)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:collapse;background-color:${OUTER};"><tr><td align="center" style="padding:18px 8px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;max-width:640px;border-collapse:collapse;background-color:${WHITE};${fixedLayout ? "table-layout:fixed;" : ""}">${content}</table>${pixelTag(pixel)}</td></tr></table></body></html>`;
}

const OPEN_SANS = CUSTOMER_BRAND.font;
function likelyShell(content: string, preview: string, pixel: string | null) {
  const brandedContent = content.replace(/<(table|td|p|h1|h2|a)([^>]*?)style="/g, `<$1$2style="font-family:${OPEN_SANS};`);
  const responsive = `<style type="text/css">
body,table,td,p,h1,h2,a,span{font-family:${OPEN_SANS};}
.hiv-main{table-layout:fixed}.hiv-logo{width:187px;height:auto}.hiv-hero-title{font-size:38px;line-height:.92;letter-spacing:-1.9px}.hiv-heading{font-size:26px;line-height:.98;letter-spacing:-1.04px}.hiv-pad{padding-left:32px!important;padding-right:32px!important}.hiv-card-pad{padding:28px 26px!important}.hiv-price{font-size:44px!important}.hiv-discount{font-size:28px!important}.hiv-payment{font-size:34px!important}
@media only screen and (max-width:480px){.hiv-outer{padding:0!important}.hiv-main{width:100%!important}.hiv-pad{padding-left:18px!important;padding-right:18px!important}.hiv-logo-wrap{padding:20px 18px 16px!important}.hiv-logo{width:112px!important;height:auto!important}.hiv-hero{padding-top:24px!important;padding-bottom:26px!important}.hiv-hero-title{font-size:24px!important;line-height:.94!important;letter-spacing:-1.2px!important}.hiv-heading{font-size:20px!important;line-height:.98!important;letter-spacing:-.8px!important}.hiv-card-pad{padding:20px 18px!important}.hiv-price{font-size:38px!important}.hiv-discount{font-size:24px!important}.hiv-payment{font-size:30px!important}.hiv-quote-label{font-size:12.5px!important;line-height:1.45!important}.hiv-quote-amount{width:82px!important;font-size:14px!important}.hiv-body{font-size:12.5px!important;line-height:1.55!important}.hiv-cta{font-size:11px!important;padding:12px 10px!important}.hiv-footer{padding:14px 18px 16px!important}}
</style>`;
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(preview)}</title><!--[if !mso]><!--><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&display=swap" rel="stylesheet"><!--<![endif]--><!--[if mso]><style type="text/css">body,table,td,p,h1,h2,a,span{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->${responsive}</head><body style="margin:0;padding:0;background-color:${OUTER};font-family:${OPEN_SANS};color:${INK};"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-family:${OPEN_SANS};">${escape(preview)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:collapse;background-color:${OUTER};font-family:${OPEN_SANS};"><tr><td class="hiv-outer" align="center" style="padding:18px 0 36px;font-family:${OPEN_SANS};"><table class="hiv-main" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;max-width:640px;table-layout:fixed;border-collapse:collapse;background-color:${WHITE};font-family:${OPEN_SANS};">${brandedContent}</table>${pixelTag(pixel)}</td></tr></table></body></html>`;
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
  return `${label("COMFORT, ALL YEAR ROUND")}${title("A BETTER FEELING HOME.")}${items.map(([name, copy]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-bottom:1px solid ${PALE_BLUE};"><tr><td width="34" valign="top" style="padding:13px 9px 13px 0;color:${GREEN};font-size:19px;font-weight:800;">✳</td><td style="padding:13px 0;"><p style="margin:0 0 4px;color:${BLUE};font-size:14px;font-weight:800;">${name}</p>${body(copy)}</td></tr></table>`).join("")}${card(`${label("AND THE BEST PART?", GREEN)}<p style="margin:0;color:${INK};font-size:20px;line-height:1.3;font-weight:800;">THE VEU PROGRAM COULD CONTRIBUTE <span style="color:${GREEN};">${escape(money(discount))}</span>.</p><p style="margin:10px 0 0;color:${INK};font-size:12px;line-height:1.5;">Estimated only; your final eligible area, discount and price are confirmed after the onsite assessment.</p>`, PALE_GREEN, GREEN)}`;
}
function referral(url: string | null) {
  if (!url) return "";
  return section(offset(card(`${label("PASS IT ON", GREEN)}${title("KNOW SOMEONE WITH A<br>FREEZING HOUSE? ✳", BLUE, 24)}<p style="margin:0 0 18px;color:${INK};font-size:17px;line-height:1.3;font-weight:800;">DON'T KEEP THE DISCOUNT TO YOURSELF.</p>${body("Share Home Insulation Victoria. They can check their own eligibility; you don't have to share anyone's details.")}<p style="margin:17px 0 0;"><a href="${escape(url)}" style="color:${BLUE};font-size:14px;font-weight:800;text-decoration:underline;">REFER A FRIEND →</a></p>`, PALE_GREEN)), "0 28px 34px");
}
function footer(reference?: string | null, kind: "estimate" | "result" = "estimate") {
  const ref = reference?.trim() ? `<br>Reference: ${escape(reference.trim())}` : "";
  return section(`<p style="margin:0 0 12px;color:${BLUE};font-size:14px;font-weight:800;">Home Insulation Victoria</p><p style="margin:0;color:${INK};font-size:11px;line-height:1.7;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria<br>You are receiving this because you requested a Home Insulation Victoria ${kind === "result" ? "eligibility result" : "eligibility result or estimate"}.${ref}<br><a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact</a><br>A secure unsubscribe link appears directly below this footer.</p>`, `23px 28px 28px;border-top:1px solid ${PALE_BLUE};`);
}

/** Editorial likely-eligible email: one money card, one trust band, no card grids. */
function renderLikelyEmail(input: EstimateEmailInput): EstimateEmail {
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
    if (!closeEnough(payableNow, READY_CHECK_FEE)) throw new Error("The amount payable now must be the $99 Home Insulation Ready Check incl GST.");
    if (!closeEnough(installation + assessment + apFee, gross)) throw new Error("Quote line items must reconcile to the gross project total.");
    if (!closeEnough(gross - discount, customer)) throw new Error("Gross project total less VEU discount must equal the estimated customer price.");
    if (!closeEnough(customer - payableNow, remaining)) throw new Error("Estimated customer price less the amount payable now must equal the remaining balance.");
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) throw new Error("The installation rate must be a finite non-negative value.");
  }
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
    : `GOOD NEWS${name ? `, ${escape(name.toUpperCase())}` : ""}.<br>YOUR HOME LOOKS LIKELY TO QUALIFY.`;
  const heroSub = onsite ? `<div data-onsite-reasons="true"><p class="hiv-body" style="margin:14px 0 10px;color:#B2F7C9;font-family:${OPEN_SANS};font-size:14px;line-height:1.45;font-weight:800;">${onsiteSub}</p>${reasonItems.map((r) => `<p style="margin:0 0 7px;color:${WHITE};font-family:${OPEN_SANS};font-size:13.5px;line-height:1.5;font-weight:600;"><span style="color:#93F3B6;font-weight:800;">✓</span>&nbsp; ${escape(r)}</p>`).join("")}</div>` : "";
  const propertyBlock = address ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#3248A9" style="width:100%;margin-top:17px;border-collapse:separate;border-spacing:0;background-color:#3248A9;border:1px solid #7C8BE0;border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td style="padding:14px 16px;font-family:${OPEN_SANS};"><p style="margin:0 0 3px;color:#B2F7C9;font-family:${OPEN_SANS};font-size:9px;line-height:1.3;font-weight:800;letter-spacing:1.5px;">PROPERTY</p><p style="margin:0;color:${WHITE};font-family:${OPEN_SANS};font-size:15px;line-height:1.4;font-weight:800;">${escape(address)}</p></td></tr></table>` : "";
  const hero = `<p style="margin:0 0 10px;color:#93F3B6;font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.8px;">YOUR PRELIMINARY VEU INSULATION ESTIMATE</p><h1 class="hiv-hero-title" style="margin:0;color:${WHITE};font-family:${OPEN_SANS};font-size:38px;line-height:.92;font-weight:800;letter-spacing:-1.9px;">${heroTitle}</h1>${heroSub}${propertyBlock}`;

  const quoteRow = (nameText: string, amount: number, note = "") => `<tr><td class="hiv-quote-label" valign="top" style="padding:13px 12px 13px 0;border-bottom:1px solid #DDE4FB;color:${INK};font-family:${OPEN_SANS};font-size:14px;line-height:1.45;font-weight:700;overflow-wrap:break-word;word-break:normal;">${nameText}${note ? `<br><span style="color:${INK};font-family:${OPEN_SANS};font-size:12px;font-weight:400;">${note}</span>` : ""}</td><td class="hiv-quote-amount" width="112" align="right" valign="top" style="width:112px;padding:13px 0;border-bottom:1px solid #DDE4FB;color:${BLUE};font-family:${OPEN_SANS};font-size:15px;line-height:1.45;font-weight:800;white-space:nowrap;">${escape(money(amount))}</td></tr>`;
  const detailedRows = hasBreakdown ? customerQuoteRows({ piesa: assessment, installation, apManagement: apFee }).map(({ label: rowLabel, amount }) => quoteRow(escape(rowLabel), amount)).join("") : "";
  const discountBand = `<table data-discount-band="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CUSTOMER_DISCOUNT_TREATMENT.bandBackground}" style="width:100%;margin:6px 0 18px;border-collapse:separate;border-spacing:0;background-color:${CUSTOMER_DISCOUNT_TREATMENT.bandBackground};border:1px solid ${CUSTOMER_DISCOUNT_TREATMENT.bandBorder};border-radius:12px;font-family:${OPEN_SANS};"><tr><td class="hiv-quote-label" style="padding:14px 10px 14px 14px;color:${CUSTOMER_DISCOUNT_TREATMENT.amountColor};font-family:${OPEN_SANS};font-size:14px;line-height:1.35;font-weight:800;">${CUSTOMER_QUOTE_LABELS.discount}</td><td class="hiv-quote-amount hiv-discount" width="120" align="right" style="width:120px;padding:14px 14px 14px 0;color:${CUSTOMER_DISCOUNT_TREATMENT.amountColor};font-family:${OPEN_SANS};font-size:26px;line-height:1;font-weight:800;white-space:nowrap;">${escape(discountAmount(discount))}</td></tr></table>`;
  const quoteSummary = hasBreakdown
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;font-family:${OPEN_SANS};">${detailedRows}<tr><td class="hiv-quote-label" style="padding:16px 12px 8px 0;color:${INK};font-family:${OPEN_SANS};font-size:14px;line-height:1.4;font-weight:800;">${CUSTOMER_QUOTE_LABELS.projectTotal}</td><td class="hiv-quote-amount" width="112" align="right" style="width:112px;padding:16px 0 8px;color:${BLUE};font-family:${OPEN_SANS};font-size:18px;font-weight:800;white-space:nowrap;">${escape(money(gross))}</td></tr></table>${discountBand}`
    : `<p style="margin:0;color:${INK};font-size:14px;line-height:1.5;font-weight:800;">${CUSTOMER_QUOTE_LABELS.projectTotal} &nbsp;<span style="color:${BLUE};">${escape(money(packagePrice))}</span></p>${discountBand}`;
  const reassurance = `<div style="margin-top:17px;padding-top:16px;border-top:1px solid #DDE4FB;"><p style="margin:0 0 8px;color:${BLUE};font-family:${OPEN_SANS};font-size:13px;line-height:1.35;font-weight:800;">${CUSTOMER_WHAT_COULD_CHANGE.heading}</p><p class="hiv-body" style="margin:0 0 11px;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;">${escape(CUSTOMER_WHAT_COULD_CHANGE.intro)}</p>${CUSTOMER_WHAT_COULD_CHANGE.items.map(({ lead, copy }) => `<p class="hiv-body" style="margin:0 0 7px;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;"><strong>${escape(lead)} —</strong> ${escape(copy)}</p>`).join("")}<p class="hiv-body" style="margin:11px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;font-weight:700;">${escape(CUSTOMER_WHAT_COULD_CHANGE.closing)}</p></div>`;
  const areaRow = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 4px;border-collapse:collapse;font-family:${OPEN_SANS};"><tr><td style="padding:0;color:${INK};font-family:${OPEN_SANS};font-size:13px;line-height:1.4;font-weight:700;">Estimated ceiling size: <strong>${escape(number(area))} m²</strong></td><td width="76" align="right" style="width:76px;padding:0;font-family:${OPEN_SANS};"><a href="${escape(calculatorTarget)}" style="color:${BLUE};font-family:${OPEN_SANS};font-size:12px;line-height:1.4;font-weight:800;text-decoration:underline;letter-spacing:.4px;white-space:nowrap;">CHANGE →</a></td></tr></table><p class="hiv-body" style="margin:0 0 12px;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;font-weight:400;">Based on the estimated ceiling size provided in your enquiry. Change it to see a revised estimate.</p>`;
  const calculatorButton = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${GREEN};border-radius:12px;"><tr><td style="padding:0 4px 4px 0;font-family:${OPEN_SANS};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${WHITE};border:2px solid ${BLUE};border-radius:12px;"><tr><td align="center" style="padding:0;"><a class="hiv-cta" href="${escape(calculatorTarget)}" style="display:block;padding:14px 16px;color:${BLUE};font-family:${OPEN_SANS};font-size:13px;line-height:1.3;font-weight:800;text-decoration:none;letter-spacing:.8px;">OPEN THE INTERACTIVE CALCULATOR →</a></td></tr></table></td></tr></table>`;
  const calculatorCallout = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${WHITE};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${OPEN_SANS};"><p style="margin:0 0 6px;color:${GREEN};font-family:${OPEN_SANS};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.5px;">WANT TO CHECK THE NUMBERS FIRST?</p><h2 style="margin:0 0 9px;color:${BLUE};font-family:${OPEN_SANS};font-size:18px;line-height:1.2;font-weight:800;">TRY ANOTHER PROPERTY OR CEILING SIZE</h2><p class="hiv-body" style="margin:0 0 14px;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.55;">Your estimate is based on your property address and the ${escape(number(area))} m² ceiling size you entered. Use our interactive calculator to see how a different Victorian property address or ceiling size could change your estimated project total, VEU / VEEC discount and estimated cost after discount.</p>${calculatorButton}<p style="margin:10px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:10.5px;line-height:1.5;text-align:center;">Calculator changes are for comparison only and do not overwrite your enquiry.</p></td></tr></table>`;


  const confirmationSection = `<div data-ready-check-inside-quote="true" style="margin-top:20px;padding:18px 16px 16px;background-color:${PALE_GREEN};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softGreenBorder};border-radius:14px;"><p style="margin:0 0 6px;color:${GREEN};font-family:${OPEN_SANS};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.5px;">${CUSTOMER_READY_CHECK_EMAIL_ACTION.eyebrow}</p><h2 style="margin:0 0 10px;color:${BLUE};font-family:${OPEN_SANS};font-size:20px;line-height:1.15;font-weight:800;">${CUSTOMER_READY_CHECK_EMAIL_ACTION.heading}</h2><p class="hiv-body" style="margin:0 0 7px;color:${INK};font-family:${OPEN_SANS};font-size:12.5px;line-height:1.55;">${escape(CUSTOMER_READY_CHECK_EMAIL_ACTION.sentence)}</p><p class="hiv-body" style="margin:0 0 14px;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;font-weight:800;">${escape(CUSTOMER_READY_CHECK_EMAIL_ACTION.credit)}</p>${likelyCta(ctaText)}<p style="margin:9px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:10.5px;line-height:1.5;text-align:center;">${escape(CUSTOMER_READY_CHECK_EMAIL_ACTION.helper)}</p>${verifiedAp ? `<p style="margin:8px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:10px;line-height:1.5;font-weight:700;">HOME INSULATION VICTORIA IS ONE OF ONLY ${input.apCount} ACCREDITED PERSONS CURRENTLY APPROVED FOR ACTIVITY 48 IN VICTORIA.</p>` : ""}</div>`;
  const moneyCard = `<table data-main-quote-card="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${ACCENT}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${ACCENT};border-radius:20px;"><tr><td style="padding:0 4px 5px 0;font-family:${OPEN_SANS};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${WHITE};border:2px solid ${BLUE};border-radius:20px;font-family:${OPEN_SANS};"><tr><td class="hiv-card-pad" style="padding:24px 22px;font-family:${OPEN_SANS};"><p style="margin:0;color:${GREEN};font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.87px;">YOUR PRELIMINARY QUOTE</p>${areaRow}${quoteSummary}<p style="margin:0 0 4px;color:${BLUE};font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.87px;">${CUSTOMER_QUOTE_LABELS.finalCost}</p><p class="hiv-price" style="margin:0;color:${BLUE};font-family:${OPEN_SANS};font-size:44px;line-height:1;font-weight:800;letter-spacing:-1.76px;">${escape(money(customer))}</p>${confirmationSection}${reassurance}<p style="margin:13px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:11px;line-height:1.5;font-weight:700;">${CUSTOMER_WHAT_COULD_CHANGE.gst}</p></td></tr></table></td></tr></table>`;

  const referralStrip = referralUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALE_GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${PALE_GREEN};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softGreenBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${OPEN_SANS};"><p style="margin:0 0 6px;color:${BLUE};font-family:${OPEN_SANS};font-size:13px;line-height:1.3;font-weight:800;letter-spacing:.4px;">KNOW SOMEONE WHO MIGHT QUALIFY?</p><p style="margin:0 0 12px;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.55;">Share Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="border-collapse:separate;border-spacing:0;background-color:${GREEN};border-radius:10px;"><tr><td style="padding:0;"><a href="${escape(referralUrl)}" style="display:block;padding:11px 20px;color:${WHITE};font-family:${OPEN_SANS};font-size:12px;line-height:1.3;font-weight:800;text-decoration:none;letter-spacing:.6px;">REFER A FRIEND →</a></td></tr></table></td></tr></table>` : "";
  const footerBlock = `<p style="margin:0 0 5px;color:${BLUE};font-size:12px;font-weight:800;">Home Insulation Victoria</p><p style="margin:0;color:${INK};font-size:10px;line-height:1.55;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference?.trim() ? ` &nbsp;·&nbsp; Reference: ${escape(input.reference.trim())}` : ""}<br><a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact</a> &nbsp;·&nbsp; A secure unsubscribe link appears below.</p>`;

  const html = likelyShell(`${likelySection(`<img class="hiv-logo" src="${LOGO_URL}" alt="Home Insulation Victoria" width="187" height="80" style="display:block;width:187px;height:auto;max-width:100%;border:0;font-family:${OPEN_SANS};">`, "24px 32px 20px", "hiv-logo-wrap hiv-pad")}${likelySection(hero, "26px 32px 28px", "hiv-hero hiv-pad").replace("<tr><td", `<tr bgcolor="${BLUE}" style="background-color:${BLUE};"><td bgcolor="${BLUE}"`)}${likelySection(moneyCard, "24px 32px 14px")}${likelySection(calculatorCallout, "0 32px 16px")}${referralStrip ? likelySection(referralStrip, "0 32px 12px") : ""}${likelySection(footerBlock, "12px 32px 16px", "hiv-footer hiv-pad").replace("<tr><td", `<tr bgcolor="#F1F8F3" style="background-color:#F1F8F3;border-top:3px solid ${GREEN};"><td bgcolor="#F1F8F3"`)}`, previewText, pixel);

  const plainBreakdown = hasBreakdown ? `${CUSTOMER_QUOTE_LABELS.piesa}: ${money(assessment)}\n${CUSTOMER_QUOTE_LABELS.insulation}: ${money(installation)}\n${CUSTOMER_QUOTE_LABELS.apManagement}: ${money(apFee)}\n${CUSTOMER_QUOTE_LABELS.projectTotal}: ${money(gross)}\n${CUSTOMER_QUOTE_LABELS.discount}: ${discountAmount(discount)}\n${CUSTOMER_QUOTE_LABELS.finalCost}: ${money(customer)}` : `${CUSTOMER_QUOTE_LABELS.projectTotal}: ${money(packagePrice)}\n${CUSTOMER_QUOTE_LABELS.discount}: ${discountAmount(discount)}\n${CUSTOMER_QUOTE_LABELS.finalCost}: ${money(customer)}`;
  const plainReasons = onsite ? `\n${onsiteSub}\n${reasonItems.map((r) => `✓ ${r}`).join("\n")}` : "";
  const plainChangeExplanation = `${CUSTOMER_WHAT_COULD_CHANGE.heading}\n${CUSTOMER_WHAT_COULD_CHANGE.intro}\n${CUSTOMER_WHAT_COULD_CHANGE.items.map(({ lead, copy }) => `• ${lead} — ${copy}`).join("\n")}\n${CUSTOMER_WHAT_COULD_CHANGE.closing}\n${CUSTOMER_WHAT_COULD_CHANGE.gst}`;
  const plainText = `${subject}\n\n${onsite ? `${CUSTOMER_ONSITE_HERO.heading}${name ? `, ${name}.` : "."}${plainReasons}` : `GOOD NEWS${name ? `, ${name}` : ""}. YOUR HOME LOOKS LIKELY TO QUALIFY.`}${address ? `\nPROPERTY\n${address}` : ""}\n\nYOUR PRELIMINARY QUOTE\nEstimated ceiling size: ${number(area)} m² — CHANGE: ${calculatorTarget}\nBased on the estimated ceiling size provided in your enquiry. Change it to see a revised estimate.\n\n${plainBreakdown}\n\n${plainChangeExplanation}\n\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.eyebrow}\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.heading}\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.sentence}\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.credit}\n${ctaPlain}: ${confirmTarget}\n${CUSTOMER_READY_CHECK_EMAIL_ACTION.helper}\n\nWANT TO CHECK THE NUMBERS FIRST?\nTRY ANOTHER PROPERTY OR CEILING SIZE\nYour estimate is based on your property address and the ${number(area)} m² ceiling size you entered. Use our interactive calculator to see how a different Victorian property address or ceiling size could change your estimated project total, VEU / VEEC discount and estimated cost after discount.\nOPEN THE INTERACTIVE CALCULATOR: ${calculatorTarget}\nCalculator changes are for comparison only and do not overwrite your enquiry.${verifiedAp ? `\nHome Insulation Victoria is one of only ${input.apCount} Accredited Persons currently approved for VEU Activity 48 in Victoria.` : ""}${referralUrl ? `\n\nKNOW SOMEONE WHO MIGHT QUALIFY?\nShare Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.\nREFER A FRIEND: ${referralUrl}` : ""}\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference ? ` · Reference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy · Contact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}

export function renderEstimateEmail(input: EstimateEmailInput): EstimateEmail {
  const outcome = input.outcome ?? "likely";
  return renderLikelyEmail({ ...input, outcome });
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
  const reviewCta = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${GREEN};border-radius:12px;"><tr><td style="padding:0 4px 4px 0;font-family:${OPEN_SANS};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${BLUE};border-radius:12px;"><tr><td align="center" style="padding:0;font-family:${OPEN_SANS};"><a class="hiv-cta" href="${escape(resultUrl)}" style="display:block;padding:12px 14px;color:${WHITE};font-family:${OPEN_SANS};font-size:12.5px;line-height:1.3;font-weight:800;text-decoration:none;letter-spacing:1.1px;">REVIEW MY RESULT →</a></td></tr></table></td></tr></table>`;
  const secondaryCard = (content: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${OUTER};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${OPEN_SANS};">${content}</td></tr></table>`;
  const resultCard = secondaryCard(`<p style="margin:0 0 10px;color:${GREEN};font-family:${OPEN_SANS};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.5px;">YOUR RESULT</p><h2 class="hiv-heading" style="margin:0 0 14px;color:${BLUE};font-family:${OPEN_SANS};font-size:24px;line-height:1.05;font-weight:800;letter-spacing:-.8px;">UNFORTUNATELY, THIS PROPERTY DOESN'T APPEAR TO BE ELIGIBLE AT THIS STAGE.</h2><p class="hiv-body" style="margin:0 0 12px;color:${INK};font-family:${OPEN_SANS};font-size:12.5px;line-height:1.55;">Based on the information we have, this is because:</p>${reasonList}<p class="hiv-body" style="margin:13px 0 0;padding-top:13px;border-top:1px solid ${CUSTOMER_VISUAL_SYSTEM.softBlueBorder};color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.55;">If any of the information above isn't correct, you can review your details and we'll reassess the result.</p>`);
  const trustLine = secondaryCard(`<p class="hiv-body" style="margin:0;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.55;"><strong style="color:${BLUE};">HOME INSULATION VICTORIA</strong><br>${escape(apStatement(input.apCount))} We coordinate qualified trades, compliance and VEEC processing for eligible upgrades.</p>`);
  const referralStrip = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALE_GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${PALE_GREEN};border:1px solid ${CUSTOMER_VISUAL_SYSTEM.softGreenBorder};border-radius:${CUSTOMER_VISUAL_SYSTEM.secondaryRadiusPx}px;"><tr><td class="hiv-secondary-pad" style="padding:${CUSTOMER_VISUAL_SYSTEM.secondaryPaddingPx}px;font-family:${OPEN_SANS};"><p style="margin:0 0 6px;color:${BLUE};font-family:${OPEN_SANS};font-size:13px;line-height:1.3;font-weight:800;letter-spacing:.4px;">KNOW SOMEONE WHO MIGHT QUALIFY?</p><p style="margin:0 0 12px;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.55;">Share Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="border-collapse:separate;border-spacing:0;background-color:${GREEN};border-radius:10px;"><tr><td style="padding:0;"><a href="${escape(referralUrl)}" style="display:block;padding:11px 20px;color:${WHITE};font-family:${OPEN_SANS};font-size:12px;line-height:1.3;font-weight:800;text-decoration:none;letter-spacing:.6px;">REFER A FRIEND →</a></td></tr></table></td></tr></table>`;
  const compactFooter = `<p style="margin:0 0 5px;color:${BLUE};font-size:12px;font-weight:800;">Home Insulation Victoria</p><p style="margin:0;color:${INK};font-size:10px;line-height:1.55;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference?.trim() ? ` &nbsp;·&nbsp; Reference: ${escape(input.reference.trim())}` : ""}<br><a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact</a> &nbsp;·&nbsp; A secure unsubscribe link appears below.</p>`;
  const hero = `<p style="margin:0 0 10px;color:#93F3B6;font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.8px;">YOUR HOME INSULATION VICTORIA RESULT</p><h1 class="hiv-hero-title" style="margin:0;color:${WHITE};font-family:${OPEN_SANS};font-size:38px;line-height:.96;font-weight:800;letter-spacing:-1.9px;">WE'VE COMPLETED YOUR PROPERTY CHECK.</h1>`;
  const html = likelyShell(`${ineligibleSection(`<img class="hiv-logo" src="${LOGO_URL}" alt="Home Insulation Victoria" width="187" height="80" style="display:block;width:187px;height:auto;max-width:100%;border:0;font-family:${OPEN_SANS};">`, "24px 32px 20px", "hiv-logo-wrap hiv-pad")}${ineligibleSection(hero, "26px 32px 28px", "hiv-hero hiv-pad").replace("<tr><td", `<tr bgcolor="${BLUE}" style="background-color:${BLUE};"><td bgcolor="${BLUE}"`)}${ineligibleSection(resultCard, "24px 32px 16px")}${ineligibleSection(reviewCta, "0 32px 13px")}${ineligibleSection(trustLine, "0 32px 13px")}${ineligibleSection(referralStrip, "0 32px 12px")}${ineligibleSection(compactFooter, "12px 32px 16px", "hiv-footer hiv-pad").replace("<tr><td", `<tr bgcolor="#F1F8F3" style="background-color:#F1F8F3;border-top:3px solid ${GREEN};"><td bgcolor="#F1F8F3"`)}`, previewText, null);
  const plainText = `${subject}\n\nWE'VE COMPLETED YOUR PROPERTY CHECK.\n\nUNFORTUNATELY, THIS PROPERTY DOESN'T APPEAR TO BE ELIGIBLE AT THIS STAGE.\n\nBased on the information we have, this is because:\n${resultReasons.map((r) => `• ${r}`).join("\n")}\n\nIf any of the information above isn't correct, you can review your details and we'll reassess the result.\n\nREVIEW MY RESULT: ${resultUrl}\n\n${apStatement(input.apCount)} We coordinate qualified trades, compliance and VEEC processing for eligible upgrades.\n\nKNOW SOMEONE WHO MIGHT QUALIFY?\nShare Home Insulation Victoria with a friend or family member. They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.\nREFER A FRIEND: ${referralUrl}\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference ? ` · Reference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy · Contact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}
