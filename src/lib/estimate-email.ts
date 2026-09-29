/** Pure customer outcome email renderers: no data access, delivery, or side effects. */
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
const SITE = "https://homeinsulationvictoria.com.au";
const BLUE = "#3C51C4";
const GREEN = "#07BF61";
const ACCENT = "#52C875";
const INK = "#22376B";
const PALE_BLUE = "#EEF0FC";
const PALE_GREEN = "#ECF9F1";
const OUTER = "#FBFCFA";
const WHITE = "#ffffff";

export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const money = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
const number = (n: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(n);
const cleanReasons = (reasons: string[] | null | undefined) => (reasons ?? []).map((r) => r.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 6);
const body = (text: string, color = INK) => `<p style="margin:0;color:${color};font-size:15px;line-height:1.55;font-weight:400;">${text}</p>`;
const label = (text: string, color = BLUE) => `<p style="margin:0 0 9px;color:${color};font-size:11px;line-height:1.3;font-weight:800;letter-spacing:1px;">${text}</p>`;
const title = (text: string, color = BLUE, size = 28) => `<h2 style="margin:0 0 16px;color:${color};font-size:${size}px;line-height:1.1;font-weight:800;letter-spacing:-.5px;">${text}</h2>`;
const section = (content: string, pad = "0 28px 32px") => `<tr><td style="padding:${pad};">${content}</td></tr>`;
const card = (content: string, bg = WHITE, border = BLUE, radius = 18) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${bg};border:3px solid ${border};border-radius:${radius}px;"><tr><td style="padding:24px 22px;">${content}</td></tr></table>`;
// Outer accent cell remains visible even in clients that ignore CSS box-shadow.
const offset = (content: string, accent = ACCENT) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${accent}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${accent};border-radius:20px;"><tr><td style="padding:0 6px 6px 0;">${content}</td></tr></table>`;
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
  return section(`<img src="${BASE}/email-preview/hi-vic-logo.png" alt="Home Insulation Victoria" width="230" height="98" style="display:block;width:230px;height:auto;max-width:100%;border:0;">`, "30px 28px 20px");
}
function shell(content: string, preview: string, pixel: string | null, fixedLayout = false) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(preview)}</title></head><body style="margin:0;padding:0;background-color:${OUTER};font-family:'Open Sans',Arial,Helvetica,sans-serif;color:${INK};"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(preview)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:collapse;background-color:${OUTER};"><tr><td align="center" style="padding:18px 8px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;max-width:640px;border-collapse:collapse;background-color:${WHITE};${fixedLayout ? "table-layout:fixed;" : ""}">${content}</table>${pixelTag(pixel)}</td></tr></table></body></html>`;
}

const OPEN_SANS = "'Open Sans',Arial,Helvetica,sans-serif";
function likelyShell(content: string, preview: string, pixel: string | null) {
  const brandedContent = content.replace(/<(table|td|p|h1|h2|a)([^>]*?)style="/g, `<$1$2style="font-family:${OPEN_SANS};`);
  const responsive = `<style type="text/css">
body,table,td,p,h1,h2,a,span{font-family:${OPEN_SANS};}
.hiv-main{table-layout:fixed}.hiv-logo{width:187px;height:auto}.hiv-hero-title{font-size:38px;line-height:.92;letter-spacing:-1.9px}.hiv-heading{font-size:26px;line-height:.98;letter-spacing:-1.04px}.hiv-pad{padding-left:32px!important;padding-right:32px!important}.hiv-card-pad{padding:28px 26px!important}.hiv-price{font-size:44px!important}.hiv-discount{font-size:28px!important}.hiv-payment{font-size:34px!important}
@media only screen and (max-width:480px){.hiv-outer{padding:0!important}.hiv-main{width:100%!important}.hiv-pad{padding-left:18px!important;padding-right:18px!important}.hiv-logo-wrap{padding:20px 18px 16px!important}.hiv-logo{width:112px!important;height:auto!important}.hiv-hero{padding-top:24px!important;padding-bottom:26px!important}.hiv-hero-title{font-size:24px!important;line-height:.94!important;letter-spacing:-1.2px!important}.hiv-heading{font-size:20px!important;line-height:.98!important;letter-spacing:-.8px!important}.hiv-card-pad{padding:20px 18px!important}.hiv-price{font-size:38px!important}.hiv-discount{font-size:24px!important}.hiv-payment{font-size:30px!important}.hiv-quote-label{font-size:12.5px!important;line-height:1.45!important}.hiv-quote-amount{width:82px!important;font-size:14px!important}.hiv-body{font-size:12.5px!important;line-height:1.55!important}.hiv-cta{font-size:11px!important;padding:16px 12px!important}.hiv-footer{padding:14px 18px 16px!important}}
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
    if (!closeEnough(assessment, 349) || !closeEnough(apFee, 349)) throw new Error("Measure + PIESA and AP & Compliance Management must each be $349 incl GST.");
    if (!closeEnough(installation + assessment + apFee, gross)) throw new Error("Quote line items must reconcile to the gross project total.");
    if (!closeEnough(gross - discount, customer)) throw new Error("Gross project total less VEU discount must equal the estimated customer price.");
    if (!closeEnough(customer - payableNow, remaining)) throw new Error("Estimated customer price less the amount payable now must equal the remaining balance.");
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) throw new Error("The installation rate must be a finite non-negative value.");
  }
  const onsite = input.outcome === "onsite";
  const subject = onsite ? "Good news — your preliminary Home Insulation Victoria quote is ready" : "Good news — your home looks likely to qualify for a VEU insulation discount";
  const previewText = `${money(discount)} estimated VEU discount and an estimated customer price of ${money(customer)}.`;
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const address = input.address?.trim().replace(/\s+/g, " ").slice(0, 180);
  const verifiedAp = typeof input.apCount === "number" && Number.isInteger(input.apCount) && input.apCount > 0;
  const reasons = cleanReasons(input.reasons);
  const ctaText = "CONFIRM MY QUOTE →";
  const ctaPlain = "CONFIRM MY QUOTE";
  const likelySection = (content: string, pad = "0 32px 40px", className = "hiv-pad") => `<tr><td class="${className}" style="padding:${pad};font-family:${OPEN_SANS};">${content}</td></tr>`;
  const likelyCta = (text: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${GREEN};"><tr><td style="padding:0 6px 6px 0;font-family:${OPEN_SANS};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUE}" style="width:100%;border-collapse:collapse;background-color:${BLUE};"><tr><td align="center" style="padding:0;font-family:${OPEN_SANS};"><a class="hiv-cta" href="${escape(confirmTarget)}" style="display:block;padding:18px 16px;color:${WHITE};font-family:${OPEN_SANS};font-size:13px;line-height:1.35;font-weight:800;text-decoration:none;letter-spacing:1.2px;">${text}</a></td></tr></table></td></tr></table>`;

  const heroTitle = onsite
    ? `YOUR PRELIMINARY ESTIMATE IS READY${name ? `, ${escape(name.toUpperCase())}` : ""}.`
    : `GOOD NEWS${name ? `, ${escape(name.toUpperCase())}` : ""}.<br>YOUR HOME LOOKS LIKELY TO QUALIFY.`;
  const heroSub = onsite ? `<p class="hiv-body" style="margin:14px 0 0;color:#B2F7C9;font-family:${OPEN_SANS};font-size:14px;line-height:1.45;font-weight:800;">YOU COULD STILL QUALIFY — WE JUST NEED TO CONFIRM A FEW THINGS.</p>` : "";
  const propertyBlock = address ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#3248A9" style="width:100%;margin-top:17px;border-collapse:collapse;background-color:#3248A9;border-left:4px solid ${GREEN};"><tr><td style="padding:10px 12px;font-family:${OPEN_SANS};"><p style="margin:0 0 3px;color:#B2F7C9;font-family:${OPEN_SANS};font-size:9px;line-height:1.3;font-weight:800;letter-spacing:1.5px;">PROPERTY</p><p style="margin:0;color:${WHITE};font-family:${OPEN_SANS};font-size:15px;line-height:1.4;font-weight:800;">${escape(address)}</p></td></tr></table>` : "";
  const hero = `<p style="margin:0 0 10px;color:#93F3B6;font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.8px;">YOUR PRELIMINARY VEU INSULATION ESTIMATE</p><h1 class="hiv-hero-title" style="margin:0;color:${WHITE};font-family:${OPEN_SANS};font-size:38px;line-height:.92;font-weight:800;letter-spacing:-1.9px;">${heroTitle}</h1>${heroSub}${propertyBlock}`;

  const quoteRow = (nameText: string, amount: number, note = "") => `<tr><td class="hiv-quote-label" valign="top" style="padding:13px 12px 13px 0;border-bottom:1px solid #DDE4FB;color:${INK};font-family:${OPEN_SANS};font-size:14px;line-height:1.45;font-weight:700;overflow-wrap:break-word;word-break:normal;">${nameText}${note ? `<br><span style="color:${INK};font-family:${OPEN_SANS};font-size:12px;font-weight:400;">${note}</span>` : ""}</td><td class="hiv-quote-amount" width="112" align="right" valign="top" style="width:112px;padding:13px 0;border-bottom:1px solid #DDE4FB;color:${BLUE};font-family:${OPEN_SANS};font-size:15px;line-height:1.45;font-weight:800;white-space:nowrap;">${escape(money(amount))}</td></tr>`;
  const detailedRows = hasBreakdown ? `${quoteRow("Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", assessment, "Includes onsite ceiling measure-up.")}${quoteRow("R5.0 ceiling insulation — supply &amp; install", installation)}${quoteRow("Home Insulation Victoria — Accredited Person Management", apFee)}` : "";
  const quoteSummary = hasBreakdown
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;font-family:${OPEN_SANS};">${detailedRows}<tr><td class="hiv-quote-label" style="padding:16px 12px 8px 0;color:${INK};font-family:${OPEN_SANS};font-size:14px;line-height:1.4;font-weight:800;">Estimated project total</td><td class="hiv-quote-amount" width="112" align="right" style="width:112px;padding:16px 0 8px;color:${BLUE};font-family:${OPEN_SANS};font-size:18px;font-weight:800;white-space:nowrap;">${escape(money(gross))}</td></tr><tr><td class="hiv-quote-label" style="padding:8px 12px 18px 0;color:${GREEN};font-family:${OPEN_SANS};font-size:14px;line-height:1.35;font-weight:800;">Estimated VEU / VEEC discount</td><td class="hiv-quote-amount hiv-discount" width="112" align="right" style="width:112px;padding:8px 0 18px;color:${GREEN};font-family:${OPEN_SANS};font-size:28px;line-height:1;font-weight:800;white-space:nowrap;">−${escape(money(discount))}</td></tr></table>`
    : `<p style="margin:0;color:${INK};font-size:14px;line-height:1.5;">Estimated project total &nbsp;<span style="text-decoration:line-through;">${escape(money(packagePrice))}</span></p><p style="margin:20px 0 4px;color:${GREEN};font-size:11px;line-height:1.3;font-weight:800;letter-spacing:1px;">ESTIMATED VEU DISCOUNT</p><p style="margin:0 0 18px;color:${GREEN};font-size:44px;line-height:1;font-weight:800;">−${escape(money(discount))}</p>`;
  const existingInsulationNote = input.existingInsulationPresent === true ? `<p class="hiv-body" style="margin:12px 0 0;padding:11px 13px;background-color:${PALE_GREEN};border-left:4px solid ${GREEN};color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.5;font-weight:600;"><strong>Existing insulation:</strong> Removal may be required and is not included in this estimate. We’ll confirm and quote it before you decide whether to proceed.</p>` : "";
  const reassurance = `<div style="margin-top:17px;padding-top:16px;border-top:1px solid #DDE4FB;"><p class="hiv-body" style="margin:0 0 9px;color:${INK};font-family:${OPEN_SANS};font-size:12.5px;line-height:1.55;">This estimate includes your R5.0 ceiling insulation supply &amp; installation, mandatory electrical safety assessment and Home Insulation Victoria Accredited Person management, less your estimated VEU discount.</p><p class="hiv-body" style="margin:0 0 9px;color:${BLUE};font-family:${OPEN_SANS};font-size:12.5px;line-height:1.5;font-weight:800;">THERE ARE NO OTHER STANDARD FEES TO ADD TO THIS ESTIMATE.</p><p class="hiv-body" style="margin:0 0 9px;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.55;">The only things that could change the final price are site-specific works we can’t confirm until the onsite assessment — such as ${input.existingInsulationPresent === true ? "the existing insulation removal noted above" : "existing insulation removal (if required)"} or electrical rectification if an unsafe condition is identified.</p><p class="hiv-body" style="margin:0;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.55;font-weight:800;">If anything additional is required, we’ll quote it separately and get your approval before any additional work or cost is incurred.</p></div>`;
  const areaRow = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 4px;border-collapse:collapse;font-family:${OPEN_SANS};"><tr><td style="padding:0;color:${INK};font-family:${OPEN_SANS};font-size:13px;line-height:1.4;font-weight:700;">Estimated ceiling size: <strong>${escape(number(area))} m²</strong></td><td width="76" align="right" style="width:76px;padding:0;font-family:${OPEN_SANS};"><a href="${escape(calculatorTarget)}" style="color:${BLUE};font-family:${OPEN_SANS};font-size:12px;line-height:1.4;font-weight:800;text-decoration:underline;letter-spacing:.4px;white-space:nowrap;">CHANGE →</a></td></tr></table><p class="hiv-body" style="margin:0 0 12px;color:${INK};font-family:${OPEN_SANS};font-size:11.5px;line-height:1.5;font-weight:400;">Based on the estimated ceiling size provided in your enquiry. Change it to see a revised estimate.</p>`;
  const moneyCard = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${ACCENT}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${ACCENT};border-radius:20px;"><tr><td style="padding:0 4px 5px 0;font-family:${OPEN_SANS};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${WHITE};border:2px solid ${BLUE};border-radius:20px;font-family:${OPEN_SANS};"><tr><td class="hiv-card-pad" style="padding:24px 22px;font-family:${OPEN_SANS};"><p style="margin:0;color:${GREEN};font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.87px;">YOUR PRELIMINARY QUOTE</p>${areaRow}${quoteSummary}<p style="margin:0 0 4px;color:${BLUE};font-family:${OPEN_SANS};font-size:11px;line-height:1.35;font-weight:800;letter-spacing:1.87px;">YOUR ESTIMATED COST AFTER DISCOUNT</p><p class="hiv-price" style="margin:0;color:${BLUE};font-family:${OPEN_SANS};font-size:44px;line-height:1;font-weight:800;letter-spacing:-1.76px;">${escape(money(customer))}</p>${reassurance}<p style="margin:13px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:11px;line-height:1.5;font-weight:700;">All prices include GST.</p><p style="margin:4px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:11px;line-height:1.5;font-weight:400;">This is a preliminary estimate. Final eligibility, eligible area, VEU discount and price are confirmed after the onsite assessment.</p>${existingInsulationNote}</td></tr></table></td></tr></table>`;

  const reasonCard = onsite ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALE_BLUE}" style="width:100%;border-collapse:collapse;background-color:${PALE_BLUE};border:2px solid ${BLUE};border-radius:18px;"><tr><td class="hiv-card-pad" style="padding:22px 22px;font-family:${OPEN_SANS};"><p style="margin:0 0 10px;color:${BLUE};font-size:16px;font-weight:800;">What we need to confirm</p>${(reasons.length ? reasons : ["Existing insulation, access and electrical safety onsite."]).map((r) => `<p style="margin:0 0 8px;color:${INK};font-size:14px;line-height:1.5;"><span style="color:${GREEN};font-weight:800;">✓</span> ${escape(r)}</p>`).join("")}<p style="margin:10px 0 0;color:${BLUE};font-size:13px;font-weight:800;">YOUR ANSWERS HAVEN'T RULED YOU OUT.</p></td></tr></table>` : "";

  const confirmationSection = `${likelyCta(ctaText)}<p class="hiv-body" style="margin:14px 0 0;color:${INK};font-family:${OPEN_SANS};font-size:12px;line-height:1.5;text-align:center;">Home Insulation Victoria manages the VEU pathway from assessment through compliance and VEEC processing.</p>${verifiedAp ? `<p style="margin:8px 0 0;color:${INK};font-size:10.5px;line-height:1.5;font-weight:700;text-align:center;">HOME INSULATION VICTORIA IS ONE OF ONLY ${input.apCount} ACCREDITED PERSONS CURRENTLY APPROVED FOR ACTIVITY 48 IN VICTORIA.</p>` : ""}`;

  const referralStrip = referralUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GREEN}" style="width:100%;border-collapse:collapse;background-color:${GREEN};"><tr><td class="hiv-pad" style="padding:18px 32px;"><p style="margin:0 0 4px;color:${WHITE};font-size:13px;font-weight:800;letter-spacing:.5px;">KNOW SOMEONE WHO MIGHT QUALIFY?</p><a href="${escape(referralUrl)}" style="color:${WHITE};font-size:14px;font-weight:800;text-decoration:underline;">Refer a friend →</a></td></tr></table>` : "";
  const footerBlock = `<p style="margin:0 0 5px;color:${BLUE};font-size:12px;font-weight:800;">Home Insulation Victoria</p><p style="margin:0;color:${INK};font-size:10px;line-height:1.55;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference?.trim() ? ` &nbsp;·&nbsp; Reference: ${escape(input.reference.trim())}` : ""}<br><a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact</a> &nbsp;·&nbsp; A secure unsubscribe link appears below.</p>`;

  const html = likelyShell(`${likelySection(`<img class="hiv-logo" src="${BASE}/email-preview/hi-vic-logo.png" alt="Home Insulation Victoria" width="187" height="80" style="display:block;width:187px;height:auto;max-width:100%;border:0;font-family:${OPEN_SANS};">`, "24px 32px 20px", "hiv-logo-wrap hiv-pad")}${likelySection(hero, "26px 32px 28px", "hiv-hero hiv-pad").replace("<tr><td", `<tr bgcolor="${BLUE}" style="background-color:${BLUE};"><td bgcolor="${BLUE}"`)}${likelySection(moneyCard, "24px 32px 16px")}${reasonCard ? likelySection(reasonCard, "0 32px 16px") : ""}${likelySection(confirmationSection, "0 32px 22px")}${referralStrip ? likelySection(referralStrip, "0", "") : ""}${likelySection(footerBlock, "16px 32px 18px", "hiv-footer hiv-pad").replace("<tr><td", `<tr bgcolor="#F1F8F3" style="background-color:#F1F8F3;border-top:3px solid ${GREEN};"><td bgcolor="#F1F8F3"`)}`, previewText, pixel);

  const plainBreakdown = hasBreakdown ? `Mandatory Pre-Installation Electrical Safety Assessment (PIESA): ${money(assessment)}\nIncludes onsite ceiling measure-up.\nR5.0 ceiling insulation — supply & install: ${money(installation)}\nHome Insulation Victoria — Accredited Person Management: ${money(apFee)}\nEstimated project total: ${money(gross)}\nEstimated VEU / VEEC discount: −${money(discount)}\nYOUR ESTIMATED COST AFTER DISCOUNT: ${money(customer)}` : `Estimated project total: ${money(packagePrice)}\nEstimated VEU discount: ${money(discount)}\nEstimated price after discount: ${money(customer)}`;
  const plainReasons = onsite ? `\n\nWHAT WE NEED TO CONFIRM\n${(reasons.length ? reasons : ["Existing insulation, access and electrical safety onsite."]).map((r) => `• ${r}`).join("\n")}\nYOUR ANSWERS HAVEN'T RULED YOU OUT.` : "";
  const plainText = `${subject}\n\n${onsite ? `YOUR PRELIMINARY ESTIMATE IS READY${name ? `, ${name}` : ""}.\nYOU COULD STILL QUALIFY — WE JUST NEED TO CONFIRM A FEW THINGS.` : `GOOD NEWS${name ? `, ${name}` : ""}. YOUR HOME LOOKS LIKELY TO QUALIFY.`}${address ? `\nPROPERTY\n${address}` : ""}\n\nYOUR PRELIMINARY QUOTE\nEstimated ceiling size: ${number(area)} m² — CHANGE: ${calculatorTarget}\nBased on the estimated ceiling size provided in your enquiry. Change it to see a revised estimate.\n\n${plainBreakdown}\n\nThis estimate includes your R5.0 ceiling insulation supply & installation, mandatory electrical safety assessment and Home Insulation Victoria Accredited Person management, less your estimated VEU discount.\nTHERE ARE NO OTHER STANDARD FEES TO ADD TO THIS ESTIMATE.\nThe only things that could change the final price are site-specific works we can’t confirm until the onsite assessment — such as ${input.existingInsulationPresent === true ? "the existing insulation removal noted below" : "existing insulation removal (if required)"} or electrical rectification if an unsafe condition is identified.\nIf anything additional is required, we’ll quote it separately and get your approval before any additional work or cost is incurred.\nAll prices include GST.\nThis is a preliminary estimate. Final eligibility, eligible area, VEU discount and price are confirmed after the onsite assessment.${input.existingInsulationPresent === true ? "\nExisting insulation: Removal may be required and is not included in this estimate. We’ll confirm and quote it before you decide whether to proceed." : ""}${plainReasons}\n\n${ctaPlain}: ${confirmTarget}\nHome Insulation Victoria manages the VEU pathway from assessment through compliance and VEEC processing.${verifiedAp ? `\nHome Insulation Victoria is one of only ${input.apCount} Accredited Persons currently approved for VEU Activity 48 in Victoria.` : ""}${referralUrl ? `\n\nKNOW SOMEONE WHO MIGHT QUALIFY? Refer a friend: ${referralUrl}` : ""}\n\nHome Insulation Victoria\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria${input.reference ? ` · Reference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy · Contact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}

export function renderEstimateEmail(input: EstimateEmailInput): EstimateEmail {
  const outcome = input.outcome ?? "likely";
  if (outcome === "likely" || outcome === "onsite") return renderLikelyEmail({ ...input, outcome });
  const link = validEstimateUrl(input.estimateUrl);
  const target = validTrackingUrl(input.trackingClickUrl, "click") ?? link.toString();
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
  const hasBreakdown = breakdownValues.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (breakdownValues.some((value) => value != null) && !hasBreakdown) throw new Error("A complete non-negative outcome-email quote breakdown is required.");
  if (hasBreakdown && (input.assessmentFee !== 349 || input.apFee !== 349)) throw new Error("Measure + PIESA and AP & Compliance Management must each be $349 incl GST.");
  const computedPercent = Math.round((discount / packagePrice) * 100);
  const savingsPercent = typeof input.savingsPercent === "number" && Number.isFinite(input.savingsPercent) && input.savingsPercent > 0 ? Math.round(input.savingsPercent) : computedPercent;
  const onsite = outcome === "onsite";
  const subject = onsite ? "Good news — your preliminary Home Insulation Victoria quote is ready" : "Good news — your home looks likely to qualify for a VEU insulation discount";
  const previewText = `${money(discount)} estimated VEU discount and an estimated customer price of ${money(customer)}.`;
  const reasons = cleanReasons(input.reasons);
  const statusCopy = onsite
    ? "Your property remains a positive candidate for the VEU pathway. A few details need onsite confirmation before eligibility and final pricing can be confirmed."
    : "Based on your answers and our initial checks, your property looks likely to qualify for the VEU ceiling-insulation pathway, subject to onsite confirmation.";
  const name = input.firstName?.trim().replace(/\s+/g, " ").slice(0, 60);
  const address = input.address?.trim().replace(/\s+/g, " ").slice(0, 180);
  const intro = `${label("YOUR PRELIMINARY VEU INSULATION ESTIMATE", GREEN)}<h1 style="margin:0 0 10px;color:${BLUE};font-size:34px;line-height:1.07;font-weight:800;letter-spacing:-.5px;">${onsite ? `YOUR PRELIMINARY ESTIMATE IS READY <span style="color:${GREEN};">✳</span>` : `GOOD NEWS${name ? `, ${escape(name)}` : ""}! <span style="color:${GREEN};">✳</span>`}</h1><p style="margin:0 0 12px;color:${INK};font-size:17px;line-height:1.3;font-weight:800;">${onsite ? "YOU COULD STILL QUALIFY — WE JUST NEED TO CONFIRM A FEW THINGS." : "YOUR HOME LOOKS LIKELY TO QUALIFY."}</p>${address ? `<p style="display:inline-block;margin:0 0 12px;padding:7px 12px;border-radius:20px;background-color:${PALE_BLUE};color:${BLUE};font-size:12px;line-height:1.4;font-weight:700;">${escape(address)}</p>` : ""}${body(statusCopy)}`;
  const quoteLines = hasBreakdown ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;border-collapse:collapse;"><tr><td style="padding:6px 8px 6px 0;color:${INK};font-size:12px;">R5.0 installation estimate</td><td align="right" style="color:${BLUE};font-weight:800;">${money(input.installationPrice as number)}</td></tr><tr><td style="padding:6px 8px 6px 0;color:${INK};font-size:12px;">Onsite Measure + PIESA</td><td align="right" style="color:${BLUE};font-weight:800;">$349</td></tr><tr><td style="padding:6px 8px 6px 0;color:${INK};font-size:12px;">Home Insulation Victoria — AP &amp; Compliance Management</td><td align="right" style="color:${BLUE};font-weight:800;">$349</td></tr><tr><td style="padding:10px 8px 6px 0;border-top:1px solid ${BLUE};color:${INK};font-size:12px;font-weight:800;">Estimated project total</td><td align="right" style="border-top:1px solid ${BLUE};color:${BLUE};font-weight:800;">${money(input.grossProjectTotal as number)}</td></tr></table>` : "";
  const quote = `${quoteLines}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUE}" style="border-collapse:collapse;background-color:${BLUE};border-radius:9px;"><tr><td style="padding:16px 18px;"><p style="margin:0 0 5px;color:${WHITE};font-size:11px;line-height:1.3;font-weight:800;letter-spacing:1px;">YOUR PRELIMINARY QUOTE</p><p style="margin:0;color:${WHITE};font-size:13px;line-height:1.4;font-weight:700;">ESTIMATED PROJECT TOTAL &nbsp; <span style="font-size:20px;font-weight:800;text-decoration:line-through;">${escape(money(hasBreakdown ? input.grossProjectTotal as number : packagePrice))}</span></p></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALE_GREEN}" style="margin-top:12px;border-collapse:collapse;background-color:${PALE_GREEN};border-left:6px solid ${GREEN};border-radius:8px;"><tr><td style="padding:21px 18px 23px;">${label("ESTIMATED VEU DISCOUNT", GREEN)}<p style="margin:0;color:${GREEN};font-size:54px;line-height:1;font-weight:800;">−${escape(money(discount))}</p></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:20px 0 0;">${label("YOUR ESTIMATED PRICE")}<p style="margin:0;color:${BLUE};font-size:50px;line-height:1;font-weight:800;">${escape(money(customer))}</p></td></tr></table><p style="margin:14px 0 0;color:${INK};font-size:12px;line-height:1.55;">Based on ${escape(number(area))} m². ${hasBreakdown ? `<strong>$349 payable now</strong> for Onsite Measure + PIESA only. It is included above, is not an extra charge and is not paid again. Estimated remaining balance: <strong>${money(input.estimatedRemainingBalance as number)}</strong>.` : ""}</p><p style="margin:12px 0 0;color:${INK};font-size:11px;line-height:1.5;">Indicative only. Final eligible area, VEU discount and price are confirmed after the onsite assessment.</p>`;
  const reasonCard = onsite ? section(card(`${label("ONSITE CONFIRMATION", BLUE)}${title("What we need to confirm", BLUE, 23)}${reasons.length ? reasons.map((r) => `<p style="margin:0 0 10px;color:${INK};font-size:14px;line-height:1.5;"><span style="color:${GREEN};font-weight:800;">✓</span> ${escape(r)}</p>`).join("") : body("We’ll confirm the relevant onsite details, including existing insulation, access and electrical safety.")}<p style="margin:13px 0 0;color:${BLUE};font-size:13px;font-weight:800;">YOUR ANSWERS HAVEN'T RULED YOU OUT.</p>`, PALE_BLUE), "0 28px 32px") : "";
  const next = card(`${label("YOUR NEXT STEP", GREEN)}${title("MEASURE + ELECTRICAL<br>SAFETY ASSESSMENT", BLUE, 25)}${body("One onsite visit confirms the eligible ceiling area, existing insulation and any removal needs, roof access, electrical safety, final VEU discount and final customer price.")}<p style="margin:12px 0 18px;color:${INK};font-size:13px;line-height:1.6;">✓ Ceiling area &amp; access &nbsp; ✓ Insulation &amp; removal<br>✓ Electrical safety &nbsp; ✓ Final price</p>${cta(target)}<p style="margin:11px 0 0;color:${INK};font-size:12px;line-height:1.5;">Capacity is reserved across our certified network for qualifying projects.</p>`, PALE_GREEN, GREEN);
  const html = shell(`${logo()}${section(intro, "0 28px 22px")}${section(offset(card(quote)), "0 28px 18px")}${section(`<p style="margin:0;text-align:center;"><a href="${escape(calculatorTarget)}" style="color:${BLUE};font-size:13px;font-weight:800;text-decoration:underline;">ADJUST MY ESTIMATE →</a></p>`, "0 28px 20px")}${section(cta(target), "0 28px 32px")}${reasonCard}${section(packageSection())}${section(trust(input.apCount))}${section(benefits(discount))}${section(next)}${referral(referralUrl)}${footer(input.reference)}`, previewText, pixel);
  const plainReasons = onsite ? `\n\nWHAT WE NEED TO CONFIRM\n${reasons.length ? reasons.map((r) => `• ${r}`).join("\n") : "We’ll confirm existing insulation, access and electrical safety onsite."}\nYOUR ANSWERS HAVEN'T RULED YOU OUT.` : "";
  const plainText = `${subject}\n\n${onsite ? "YOUR PRELIMINARY ESTIMATE IS READY" : `GOOD NEWS${name ? `, ${name}` : ""}! YOUR HOME LOOKS LIKELY TO QUALIFY.`}${address ? `\n${address}` : ""}\n${statusCopy}\n\nYOUR PRELIMINARY QUOTE\n${hasBreakdown ? `R5.0 installation estimate: ${money(input.installationPrice as number)}\nOnsite Measure + PIESA: $349 incl GST\nHome Insulation Victoria — AP & Compliance Management: $349 incl GST\nEstimated project total: ${money(input.grossProjectTotal as number)}\n` : `Estimated project total: ${money(packagePrice)}\n`}Estimated VEU discount: ${money(discount)}\nYour estimated price: ${money(customer)}\nBased on ${number(area)} m²${hasBreakdown ? `\n$349 payable now for Onsite Measure + PIESA only. Included in the project total; not extra and not paid again.\nEstimated remaining balance: ${money(input.estimatedRemainingBalance as number)}` : ""}${savingsPercent ? `\n${savingsPercent}% reduction from project total` : ""}\nADJUST MY ESTIMATE: ${calculatorTarget}\nIndicative only. Final eligible area, VEU discount and price are confirmed after the onsite assessment.\n\nCONTINUE WITH HOME INSULATION VICTORIA: ${target}${plainReasons}\n\nTHIS ISN'T JUST AN INSULATION QUOTE.\nEligibility, onsite measure, electrical safety assessment, R5.0 insulation, compliance and evidence, VEEC processing.\n\nYOU'RE IN THE RIGHT HANDS.\n${apStatement(input.apCount)} Electrical work through appropriately licensed electricians and Registered Electrical Contractors; insulation providers appropriately EEC-certified. Capacity reserved across our certified network for qualifying projects.\n\nWARMER IN WINTER. COOLER IN SUMMER. LESS HEATING & COOLING DEMAND.\nThe VEU program could contribute ${money(discount)} (estimated, subject to onsite confirmation).\n\nYOUR NEXT STEP\nOnsite Measure + Electrical Safety Assessment confirms eligible ceiling area, existing insulation and removal needs, roof access, electrical safety, final VEU discount and final customer price.\nCONTINUE WITH HOME INSULATION VICTORIA: ${target}${referralUrl ? `\n\nREFER A FRIEND: ${referralUrl}` : ""}\n\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria\nYou are receiving this because you requested a Home Insulation Victoria eligibility result or estimate.${input.reference ? `\nReference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy\nContact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}

export function renderIneligibleOutcomeEmail(input: IneligibleOutcomeEmailInput): EstimateEmail {
  const referralUrl = validReferralUrl(input.referralUrl);
  if (!referralUrl) throw new Error("A Home Insulation Victoria referral link is required.");
  const reasons = cleanReasons(input.reasons);
  const resultUrl = input.resultUrl ?? `${SITE}/homeowner`;
  const parsedResultUrl = new URL(resultUrl);
  if (parsedResultUrl.origin !== SITE || parsedResultUrl.pathname !== "/homeowner" || parsedResultUrl.search || parsedResultUrl.hash) throw new Error("A Home Insulation Victoria result link is required.");
  const subject = "Your Home Insulation Victoria eligibility result";
  const previewText = "Your eligibility result and the options available from here.";
  const reasonList = reasons.length ? reasons.map((r) => `<p style="margin:0 0 10px;color:${INK};font-size:15px;line-height:1.5;"><span style="color:${BLUE};font-weight:800;">•</span> ${escape(r)}</p>`).join("") : body("Based on the information provided, this property does not meet the preliminary requirements for this VEU ceiling-insulation offer.");
  const html = shell(`${logo()}${section(`${label("YOUR ELIGIBILITY RESULT", GREEN)}<h1 style="margin:0;color:${BLUE};font-size:33px;line-height:1.12;font-weight:800;">THIS PROPERTY DOES NOT APPEAR ELIGIBLE.</h1>`, "0 28px 23px")}${section(offset(card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUE}" style="border-collapse:collapse;background-color:${BLUE};border-radius:8px;"><tr><td style="padding:14px 16px;color:${WHITE};font-size:11px;line-height:1.4;font-weight:800;letter-spacing:1px;">YOUR PRELIMINARY RESULT</td></tr></table><div style="padding-top:21px;">${title("Why we reached this result", BLUE, 23)}${reasonList}<p style="margin:13px 0 0;color:${INK};font-size:13px;line-height:1.55;">Based on the information provided, we can’t present a VEU discount or preliminary quote for this property. This is a preliminary result, not a guarantee or final determination.</p></div>`, PALE_BLUE)), "0 28px 25px")}${section(`${cta(resultUrl, "REVIEW MY RESULT →")}<p style="margin:10px 0 0;text-align:center;color:${INK};font-size:12px;line-height:1.5;">Review the pathway or submit updated information if your property details have changed.</p>`, "0 28px 34px")}${referral(referralUrl)}${section(trust(input.apCount, true))}${section(`${label("WHY INSULATION MATTERS")}${title("COMFORT THROUGH THE SEASONS.", BLUE, 23)}${body("Warmer in winter. Cooler in summer. Less heating and cooling demand. A more comfortable home year-round.")}`)}${footer(input.reference, "result")}`, previewText, null);
  const plainText = `${subject}\n\nKNOW SOMEONE WITH A FREEZING HOUSE? Share Home Insulation Victoria with a friend.\n\nYOUR ELIGIBILITY RESULT\nThis property does not appear eligible.\nBased on the information provided, we can’t present a VEU discount or preliminary quote for this property. This is a preliminary result, not a guarantee or final determination.\n\nWHY WE REACHED THIS RESULT\n${reasons.length ? reasons.map((r) => `• ${r}`).join("\n") : "Based on the information provided, this property does not meet the preliminary requirements for this VEU ceiling-insulation offer."}\n\nREVIEW MY RESULT: ${resultUrl}\n\nREFER A FRIEND: ${referralUrl}\n\n${apStatement(input.apCount)} Our vetted network includes appropriately licensed electricians and Registered Electrical Contractors, and appropriately EEC-certified insulation providers.\n\nWarmer in winter. Cooler in summer. Less heating and cooling demand.\n\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria\nYou are receiving this because you requested a Home Insulation Victoria eligibility result.${input.reference ? `\nReference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy\nContact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}
