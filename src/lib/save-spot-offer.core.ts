// Save My Spot – Jo-approved three-variant email + personal-calculator choice (Jo, 12 Oct 2026). PURE: no I/O.
// Used by Office "Prepare email to copy" (manual copy only – nothing here sends) and by the owner's calculator save.
// Variant 3 (existing insulation reviewed, appears under R2) is chosen ONLY from an authoritative recorded media review.
import { CUSTOMER_BRAND } from "./customer-quote-system";
import { campaignButton, escape, preheader, PRIVACY_URL, SAVE_SPOT_INSTRUCTION, TEST_BANNER_SLOT } from "./estimate-email";
import { UNSUBSCRIBE_LINK_SLOT, withUnsubscribe } from "./emailsafety.core";
import type { EstimateRemoval } from "./estimate-removal.core";
import { DEFAULT_ESTIMATED_AREA_M2 } from "./estimate.core";

export type SaveSpotVariant = "no_insulation_owner_size" | "no_insulation_assumed_size" | "reviewed_under_r2";
export const SAVE_SPOT_VARIANT_LABEL: Record<SaveSpotVariant, string> = {
  no_insulation_owner_size: "Save your spot – no existing insulation, owner's ceiling size (approved)",
  no_insulation_assumed_size: "Save your spot – no existing insulation, assumed ceiling size (approved)",
  reviewed_under_r2: "Save your spot – existing insulation reviewed, appears under R2 (approved)",
};

/** Picks the approved variant from recorded facts. Never infers "no insulation" and never treats uploaded media as reviewed. */
export function pickSaveSpotVariant(x: {
  route: "offer_spot" | "request_insulation" | "ineligible" | "none";
  insulation: string | null; mediaReview: string | null; criteriaPassed: boolean; areaAssumed: boolean;
}): { variant: SaveSpotVariant; assumedArea: boolean } | { blocked: string } {
  if (x.route === "offer_spot") {
    if (x.insulation !== "none") return { blocked: "The estimate does not record 'no existing insulation' – no approved Save my spot email applies." };
    return { variant: x.areaAssumed ? "no_insulation_assumed_size" : "no_insulation_owner_size", assumedArea: x.areaAssumed };
  }
  if (x.route === "request_insulation") {
    if (x.mediaReview !== "below_r2" || !x.criteriaPassed)
      return { blocked: "Existing insulation has not been reviewed as under R2 by the office. Review the photos/video first – no Save my spot email until then." };
    if (x.insulation !== "present") return { blocked: "The current estimate does not record the existing insulation. Recalculate it before preparing an email." };
    return { variant: "reviewed_under_r2", assumedArea: x.areaAssumed };
  }
  return { blocked: "No approved Save my spot email applies to this lead." };
}

export type SaveSpotOfferFacts = {
  variant: SaveSpotVariant; assumedArea: boolean;
  address: string; areaM2: number; firstName: string | null; reference: string | null;
  installation: number; assessmentFee: number; apFee: number; gross: number; discount: number; customer: number;
  removal: EstimateRemoval; removalRatePerM2?: number;
  /** Configured AP count; must be a positive integer (fails closed). */
  apCount: number;
  calculatorUrl: string; originalSaveUrl: string; unsubscribeUrl: string; referralUrl: string | null;
};

const moneyC = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
const m2 = (n: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(n);
const CUSTOMER_ORIGIN = "https://estimate.homeinsulationvictoria.com.au";
const APPROVED_DEMAND_AP_COUNT = 2;

/** The approved demand paragraph with the configured AP count; the approved wording is used unchanged for two. */
export function demandParagraph(apCount: number): string {
  if (!Number.isInteger(apCount) || apCount < 1) throw new Error("Accredited Person count is not configured.");
  if (apCount === APPROVED_DEMAND_AP_COUNT) return SAVE_SPOT_INSTRUCTION;
  const words = ["", "the only", "two", "three", "four", "five"];
  return SAVE_SPOT_INSTRUCTION.replace("one of only two Accredited Persons", apCount === 1 ? "the only Accredited Person" : `one of only ${words[apCount] ?? apCount} Accredited Persons`);
}

export function saveSpotIntro(f: Pick<SaveSpotOfferFacts, "variant" | "assumedArea" | "address" | "areaM2">): string[] {
  const area = m2(f.areaM2);
  const assumed = `As you didn’t provide a ceiling size, we’ve used an assumed area of ${area} m² to prepare your preliminary estimate. This is an assumed size, not a measurement. We’ll confirm your actual ceiling area at the free Ready Check.`;
  if (f.variant === "reviewed_under_r2") {
    const p = [`Thanks for sending through the photos/video of the existing ceiling insulation at ${f.address}. It appears to be under R2, which is good news — based on the information currently available, your home looks likely to be eligible for the Victorian Energy Upgrades ceiling insulation rebate. We’ll confirm the existing insulation and eligibility at your free Ready Check, including whether any areas need removal.`];
    return f.assumedArea ? [...p, assumed] : p;
  }
  const first = `Great news — based on the information you’ve provided, your home at ${f.address} looks likely to be eligible for the Victorian Energy Upgrades ceiling insulation rebate.`;
  if (f.variant === "no_insulation_assumed_size") return [first, `You’ve indicated that there is no existing ceiling insulation. ${assumed}`];
  return [first, `You’ve indicated that there is no existing ceiling insulation. We’ve used your supplied ceiling area of ${area} m² to prepare the preliminary estimate below.`];
}

export type PriceLine = { label: string; amount: number; kind: "item" | "subtotal" | "less" | "total" };
/** Itemised breakdown; throws when the stored figures don't add up (never shows inconsistent prices). */
export function saveSpotPriceLines(f: Pick<SaveSpotOfferFacts, "installation" | "assessmentFee" | "apFee" | "gross" | "discount" | "customer" | "removal" | "areaM2">): PriceLine[] {
  const removal = f.removal.kind === "included" ? f.removal.amount : 0;
  const cents = (n: number) => Math.round(n * 100);
  if ([f.installation, f.assessmentFee, f.apFee, f.gross, f.discount, f.customer].some((n) => !Number.isFinite(n) || n < 0)) throw new Error("Estimate figures are missing.");
  if (cents(f.installation) + cents(removal) + cents(f.assessmentFee) + cents(f.apFee) !== cents(f.gross)) throw new Error("Estimate line items do not add up to the total before rebate.");
  if (cents(f.gross) - cents(f.discount) !== cents(f.customer)) throw new Error("Estimated cost after rebate does not match total less rebate.");
  return [
    { label: "Free Ready Check", amount: 0, kind: "item" },
    { label: "R5.0 ceiling insulation supply & install", amount: f.installation, kind: "item" },
    ...(f.removal.kind === "included" ? [{ label: `Existing insulation removal (${m2(f.removal.areaM2)} m²)`, amount: removal, kind: "item" as const }] : []),
    { label: "Electrical safety assessment (PIESA)", amount: f.assessmentFee, kind: "item" },
    { label: "Accredited Person (AP) management", amount: f.apFee, kind: "item" },
    { label: "Total before rebate", amount: f.gross, kind: "subtotal" },
    { label: "Less estimated VEU rebate", amount: f.discount, kind: "less" },
    { label: "Estimated cost after rebate", amount: f.customer, kind: "total" },
  ];
}

export const SAVE_SPOT_INCLUDES = [
  "A free onsite ceiling measure, eligibility and access check (Ready Check)",
  "Installation by a vetted Certified Insulation Installer (CII)",
  "The Pre-Installation Electrical Safety Assessment (PIESA), carried out separately by a licensed electrician before installation",
  "Accredited Person coordination, compliance, paperwork and your rebate claim",
];
export function saveSpotExclusions(f: Pick<SaveSpotOfferFacts, "variant" | "removal" | "removalRatePerM2">): string[] {
  const rate = f.removalRatePerM2 ?? 15;
  const removal = f.removal.kind === "included"
    ? `Existing insulation removal for ${m2(f.removal.areaM2)} m² is included above (${moneyC(f.removal.amount)} inc GST). Any change to the removal area will be confirmed at your Ready Check and shown in your confirmed quote.`
    : f.variant === "reviewed_under_r2"
      ? `Existing insulation removal is not included. If removal is required, please budget an additional ${moneyC(rate)} per m², including GST, only for the areas that need removal. The installer will assess this at your Ready Check, and we’ll include any required removal area and cost in your confirmed quote.`
      : "Removal of existing insulation, unless it is itemised above";
  return [
    removal,
    "Additional charges for difficult ceiling access",
    "Electrical repairs or upgrades identified at the PIESA (the assessment fee covers the assessment, not rectification work)",
  ];
}
export const SAVE_SPOT_FINAL_PRICE = "Your final price and rebate depend on the measured eligible ceiling area and the confirmed job requirements. We will show you any additional work and cost and obtain your approval before proceeding.";
export const SAVE_SPOT_LINKS_EXPLAINER = "Open your calculator to change the ceiling area and see the revised price and estimated rebate. You can save your spot using that revised estimate, or keep the original estimate shown in this email.";
export const SAVE_SPOT_NOT_SURE = "Not sure of the size? You can still save your spot using the original estimate — we’ll measure it at your free Ready Check.";
export const SAVE_SPOT_EXISTING_NOTE = "Changing the ceiling size in your calculator doesn’t change what we’ve recorded about your existing insulation, and removal stays additional unless it is itemised above.";
export const SAVE_SPOT_FOOTER = "There’s nothing to pay now and no obligation to proceed. We will be in touch to book your free Ready Check as soon as we can.";
export const BUTTON_CALCULATOR = "Explore a Different Ceiling Size";
export const BUTTON_ORIGINAL = "Save My Spot — Original Estimate";

/** Customer links must be this job's secure token on the published customer domain. */
export function saveSpotLinks(token: string, base = CUSTOMER_ORIGIN) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid secure link.");
  if (base !== CUSTOMER_ORIGIN) throw new Error("Customer links must use the customer domain.");
  return { calculatorUrl: `${base}/estimate/${token}/calculator`, originalSaveUrl: `${base}/estimate/${token}/calculator?keep=original` };
}

const B = CUSTOMER_BRAND.colors;
const F = "font-family:'Figtree','Segoe UI',Helvetica,Arial,sans-serif;";
const FH = "font-family:'Outfit','Segoe UI',Helvetica,Arial,sans-serif;";
const p = (t: string, extra = "") => `<p style="margin:0 0 14px;${F}color:${B.navy};font-size:15px;line-height:1.55;${extra}">${escape(t)}</p>`;
const list = (items: string[], mark: string) => items.map((t) => `<tr><td width="22" valign="top" style="width:22px;padding:0 0 6px;${F}color:${B.green};font-size:14px;font-weight:800;">${mark}</td><td valign="top" style="padding:0 0 6px;${F}color:${B.navy};font-size:13.5px;line-height:1.5;">${escape(t)}</td></tr>`).join("");

export function renderSaveSpotOfferEmail(f: SaveSpotOfferFacts) {
  if (!f.address.trim()) throw new Error("Property address is required.");
  if (!(f.areaM2 > 0)) throw new Error("Ceiling area is required.");
  if (f.assumedArea && f.areaM2 !== DEFAULT_ESTIMATED_AREA_M2) throw new Error("Assumed area does not match the configured assumption.");
  if (f.variant === "no_insulation_assumed_size" && !f.assumedArea) throw new Error("Variant requires an assumed area.");
  for (const u of [f.calculatorUrl, f.originalSaveUrl]) if (!u.startsWith(`${CUSTOMER_ORIGIN}/estimate/`)) throw new Error("Customer links must be the job's secure link on the customer domain.");
  const lines = saveSpotPriceLines(f);
  const intro = saveSpotIntro(f);
  const exclusions = saveSpotExclusions(f);
  const demand = demandParagraph(f.apCount);
  const name = f.firstName?.trim().split(/\s+/)[0]?.slice(0, 60) || null;
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const subject = `${name ? `${name}, save` : "Save"} your spot – estimated ${moneyC(f.discount)} VEU rebate on ceiling insulation`;
  const previewText = `Estimated cost after rebate ${moneyC(f.customer)} inc GST. Nothing to pay now.`;
  const linkNotes = [SAVE_SPOT_LINKS_EXPLAINER, ...(f.assumedArea ? [SAVE_SPOT_NOT_SURE] : []), ...(f.variant === "reviewed_under_r2" ? [SAVE_SPOT_EXISTING_NOTE] : [])];
  const areaLabel = f.assumedArea ? `${m2(f.areaM2)} m² (assumed – not measured)` : `${m2(f.areaM2)} m²`;

  const row = (l: PriceLine) => {
    const strong = l.kind !== "item";
    const amt = l.kind === "less" ? `−${moneyC(l.amount)}` : l.amount === 0 && l.kind === "item" ? "$0" : moneyC(l.amount);
    const color = l.kind === "less" ? B.green : l.kind === "total" ? B.blue : B.navy;
    const size = l.kind === "total" ? "17px" : "14px";
    return `<tr><td style="padding:9px 12px 9px 0;border-top:1px solid #E3E8F2;${l.kind === "total" ? FH : F}color:${B.navy};font-size:${size};line-height:1.4;${strong ? "font-weight:800;" : ""}">${escape(l.label)}</td><td align="right" width="110" style="width:110px;padding:9px 0;border-top:1px solid #E3E8F2;${F}color:${color};font-size:${size};line-height:1.4;font-weight:${strong ? 800 : 700};white-space:nowrap;">${escape(amt)}</td></tr>`;
  };
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${B.white}" style="width:100%;border-collapse:collapse;background-color:${B.white};"><tr><td style="padding:0 0 8px;${F}color:${B.navy};font-size:13px;">Property</td><td align="right" style="padding:0 0 8px;${F}color:${B.navy};font-size:13px;font-weight:800;">${escape(f.address)}</td></tr><tr><td style="padding:0 0 8px;${F}color:${B.navy};font-size:13px;">Ceiling area</td><td align="right" style="padding:0 0 8px;${F}color:${B.navy};font-size:13px;font-weight:800;">${escape(areaLabel)}</td></tr>${lines.map(row).join("")}<tr><td colspan="2" style="padding:6px 0 0;${F}color:#5A6785;font-size:12px;">All prices include GST.</td></tr></table>`;
  const box = (title: string, inner: string, bg: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="width:100%;border-collapse:separate;background-color:${bg};border-radius:14px;margin:0 0 16px;"><tr><td style="padding:16px 18px;"><p style="margin:0 0 10px;${FH}color:${B.navy};font-size:16px;line-height:1.3;font-weight:800;">${escape(title)}</p>${inner}</td></tr></table>`;
  const listTable = (items: string[], mark: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${list(items, mark)}</table>`;
  const button = (href: string, text: string, outline: boolean) => outline
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 12px;border-collapse:separate;"><tr><td align="center" bgcolor="${B.white}" style="border:2px solid ${B.blue};border-radius:12px;"><a href="${escape(href)}" style="display:inline-block;padding:13px 26px;${FH}color:${B.blue};font-size:16px;font-weight:800;text-decoration:none;">${escape(text)}</a></td></tr></table>`
    : `<div style="margin:0 0 12px;text-align:center;">${campaignButton(href, text, 420)}</div>`;
  const footer = `<p style="margin:0 0 6px;${F}color:${B.navy};font-size:14px;font-weight:800;text-align:center;">Home Insulation Victoria</p><p style="margin:0 0 8px;${F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.${f.reference ? ` Reference ${escape(f.reference)}.` : ""}</p><p style="margin:0;${F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;"><a href="${PRIVACY_URL}" style="color:${B.blue};text-decoration:underline;">Privacy</a>${f.referralUrl ? `&nbsp;·&nbsp;<a href="${escape(f.referralUrl)}" style="color:${B.blue};text-decoration:underline;">Refer a friend</a>` : ""}&nbsp;·&nbsp;${UNSUBSCRIBE_LINK_SLOT}</p>`;
  const content = `<tr><td class="lx-pad" align="center" style="padding:26px 28px 6px;"><img class="hiv-logo" src="${escape(CUSTOMER_BRAND.logoUrl)}" width="150" alt="Home Insulation Victoria" style="display:block;width:150px;max-width:150px;height:auto;border:0;"></td></tr>
<tr><td class="lx-pad" style="padding:14px 28px 0;"><h1 class="hiv-hero-title lx-h1" style="margin:0 0 14px;${FH}color:${B.navy};font-size:30px;line-height:36px;mso-line-height-rule:exactly;font-weight:800;">Save your spot for a free Ready Check</h1>${p(greeting)}${intro.map((t) => p(t)).join("")}</td></tr>
<tr><td class="lx-pad" style="padding:4px 28px 0;">${box("Your preliminary estimate", table, "#F2F5FB")}${box("What’s included", listTable(SAVE_SPOT_INCLUDES, "✓"), "#EEF8F2")}${box("Not included", listTable(exclusions, "•") + p(SAVE_SPOT_FINAL_PRICE, "margin:10px 0 0;font-size:13.5px;font-weight:700;"), "#F2F5FB")}</td></tr>
<tr><td class="lx-pad" style="padding:4px 28px 0;">${p(demand)}${linkNotes.map((t) => p(t, "font-size:14px;")).join("")}</td></tr>
<tr><td class="lx-pad" align="center" style="padding:6px 28px 4px;">${button(f.originalSaveUrl, BUTTON_ORIGINAL, false)}${button(f.calculatorUrl, BUTTON_CALCULATOR, true)}</td></tr>
<tr><td class="lx-pad" style="padding:6px 28px 0;">${p(SAVE_SPOT_FOOTER, "text-align:center;font-size:14px;")}</td></tr>
<tr><td class="lx-pad lx-footer" style="padding:18px 28px 26px;border-top:1px solid #E3E8F2;">${footer}</td></tr>`;
  const html = `<!doctype html><html lang="en-AU" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>${escape(subject)}</title><!--[if mso]><style type="text/css">body,table,td,p,a,span,h1{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]--></head><body lang="en-AU" style="margin:0;padding:0;background-color:${B.offWhite};">${preheader(previewText)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${B.offWhite}" style="width:100%;border-collapse:collapse;background-color:${B.offWhite};"><tr><td align="center" style="padding:20px 0 36px;"><!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]--><table class="hiv-main" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${B.white}" style="width:100%;max-width:640px;border-collapse:separate;background-color:${B.white};border-radius:24px;">${TEST_BANNER_SLOT}${content}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;

  const pad = (s: string, n: number) => s + " ".repeat(Math.max(1, n - s.length));
  const plain = [
    greeting, "", ...intro.flatMap((t) => [t, ""]),
    "YOUR PRELIMINARY ESTIMATE", `Property: ${f.address}`, `Ceiling area: ${areaLabel}`,
    ...lines.map((l) => `${pad(l.label, 44)}${l.kind === "less" ? "−" : ""}${l.amount === 0 && l.kind === "item" ? "$0" : moneyC(l.amount)}`),
    "All prices include GST.", "",
    "WHAT’S INCLUDED", ...SAVE_SPOT_INCLUDES.map((t) => `✓ ${t}`), "",
    "NOT INCLUDED", ...exclusions.map((t) => `• ${t}`), SAVE_SPOT_FINAL_PRICE, "",
    demand, "", ...linkNotes.flatMap((t) => [t, ""]),
    `${BUTTON_ORIGINAL}: ${f.originalSaveUrl}`, `${BUTTON_CALCULATOR}: ${f.calculatorUrl}`, "",
    SAVE_SPOT_FOOTER, "",
    "Home Insulation Victoria", "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.", ...(f.reference ? [`Reference ${f.reference}`] : []),
    `Privacy: ${PRIVACY_URL}`, ...(f.referralUrl ? [`Refer a friend: ${f.referralUrl}`] : []),
  ].join("\n");
  return withUnsubscribe({ subject, previewText, html, plainText: plain }, f.unsubscribeUrl);
}

// ---------- Owner's choice on the personal calculator ----------
export type SpotChoice = "original" | "updated";
/** The original offered estimate is usable only when it is the current stored estimate and (if assumed) still the
 *  configured assumption with the owner's size unknown. Reviewed-under-R2 homes may use the assumption too. */
export function originalEstimateBlocker(x: { estimate: { area_m2: number | string | null; area_source: string | null; insulation_declared: string | null; hasPrice: boolean } | null; ownerAreaKnown: boolean; reviewedUnderR2: boolean }): string | null {
  const e = x.estimate;
  if (!e || !e.hasPrice) return "We couldn’t find the original estimate from your email. Please use the calculator or contact us and we’ll help.";
  if (e.area_source !== "typical_default") return null;
  if (x.ownerAreaKnown) return "Your ceiling size has changed since the original estimate. Please use the calculator to save your spot with your size.";
  if (Number(e.area_m2) !== DEFAULT_ESTIMATED_AREA_M2) return "We couldn’t confirm the original estimate. Please contact us and we’ll help.";
  if (e.insulation_declared === "none") return null;
  if (e.insulation_declared === "present" && x.reviewedUnderR2) return null;
  return "We couldn’t confirm the original estimate. Please contact us and we’ll help.";
}
/** The calculator never changes recorded insulation facts: the server uses the original estimate's insulation. */
export function calculatorInsulation(originalInsulation: string | null): "none" | "present" | "unknown" {
  return originalInsulation === "none" || originalInsulation === "present" ? originalInsulation : "unknown";
}
export const SPOT_SAVED_HEADING = "Your spot has been saved";
export const SPOT_SAVED_BODY = "You’re now in our queue for a free Ready Check. We’ll contact you when installer availability is confirmed in your area. There’s nothing to pay now, and you’re under no obligation to proceed. Your eligibility, ceiling area and final price will be confirmed before you decide to go ahead.";
