/** Pure customer outcome email renderers: no data access, delivery, or side effects. */
export type CustomerOutcome = "likely" | "onsite" | "ineligible";
export type EstimateEmailInput = {
  estimateUrl: string;
  outcome?: "likely" | "onsite";
  estimatedTotal?: number | null;
  veuDiscount?: number | null;
  areaM2?: number | null;
  savingsPercent?: number | null;
  reasons?: string[] | null;
  apCount?: number | null;
  reference?: string | null;
  trackingClickUrl?: string | null;
  trackingPixelUrl?: string | null;
  referralUrl?: string | null;
};
export type IneligibleOutcomeEmailInput = {
  reasons?: string[] | null;
  referralUrl: string;
  resultUrl?: string | null;
  reference?: string | null | undefined;
  apCount?: number | null | undefined;
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

export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
const money = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
const number = (n: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(n);
const cleanReasons = (reasons: string[] | null | undefined) => (reasons ?? []).map((r) => r.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 6);
const p = (content: string, extra = "") => `<p style="margin:0;font-size:15px;line-height:1.65;color:${INK};${extra}">${content}</p>`;
const row = (content: string, padding = "0 28px 28px") => `<tr><td style="padding:${padding};">${content}</td></tr>`;
const heading = (content: string) => `<h2 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:${BLUE};font-weight:800;">${content}</h2>`;
const cta = (url: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" bgcolor="${GREEN}" style="background-color:${GREEN};border-radius:6px;"><a href="${escape(url)}" style="display:block;padding:17px 18px;color:#ffffff;text-decoration:none;font-size:15px;line-height:1.25;font-weight:800;">CONTINUE WITH HOME INSULATION VICTORIA</a></td></tr></table>`;

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
const REFERRAL_ORIGIN = "https://homeinsulationvictoria.com.au";
export function validReferralUrl(u: string | null | undefined): string | null {
  if (u == null) return null;
  const x = new URL(u);
  if (x.origin !== REFERRAL_ORIGIN || x.pathname !== "/homeowner" || x.hash || [...x.searchParams.keys()].join() !== "ref" || !/^[A-Za-z0-9_-]{43}$/.test(x.searchParams.get("ref") ?? "")) throw new Error("A Home Insulation Victoria referral link is required.");
  return x.toString();
}
export const pixelTag = (u: string | null) => (u ? `<img src="${escape(u)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;">` : "");

function logo() {
  return row(`<img src="${BASE}/email-preview/hi-vic-logo.png" alt="Home Insulation Victoria" width="220" height="94" style="display:block;width:220px;height:auto;max-width:100%;border:0;">`, "28px 28px 22px");
}

function includedCards() {
  const items: Array<[string, string]> = [
    ["Onsite measure", "Eligible ceiling area measured for the final quote."],
    ["Electrical safety assessment", "A PIESA completed through an appropriately licensed electrician and REC."],
    ["R5.0 insulation", "Supply and installation for the confirmed eligible area."],
    ["Vetted trade network", "Appropriately qualified providers coordinated for your project."],
    ["Compliance and evidence", "Required records, checks and installation evidence managed."],
    ["VEEC processing", "Accredited Person administration for the VEU pathway."],
  ];
  const pairs: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const cells = items.slice(i, i + 2).map(([title, copy]) => `<td width="50%" valign="top" style="padding:${i ? "8px 6px 0" : "0 6px 0"};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${OUTER};border-top:3px solid ${ACCENT};"><tr><td style="padding:15px 14px 17px;">${p(`<strong style="color:${BLUE};">${escape(title)}</strong><br>${escape(copy)}`, "font-size:13px;")}</td></tr></table></td>`).join("");
    pairs.push(`<tr>${cells}</tr>`);
  }
  return `${heading("Your managed insulation package includes")}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;table-layout:fixed;">${pairs.join("")}</table>`;
}

function trust(apCount?: number | null) {
  const ap = typeof apCount === "number" && Number.isInteger(apCount) && apCount > 0
    ? `Home Insulation Victoria is the approved Accredited Person, supported by ${apCount} currently verified team member${apCount === 1 ? "" : "s"}.`
    : "Home Insulation Victoria is the approved Accredited Person for this managed VEU pathway.";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${BLUE};"><tr><td style="padding:24px 22px;">` +
    `<h2 style="margin:0 0 12px;font-size:21px;line-height:1.3;color:#ffffff;font-weight:800;">One accountable pathway. Vetted, certified capability.</h2>` +
    p(escape(ap), "color:#ffffff;margin-bottom:10px;") +
    p("Electrical work is arranged through appropriately licensed electricians and Registered Electrical Contractors. Insulation providers are appropriately EEC-certified, with capacity reserved across our certified network for qualifying projects.", "color:#ffffff;") +
    `</td></tr></table>`;
}

function benefits() {
  return `${heading("Why ceiling insulation matters")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${PALE_GREEN};"><tr><td style="padding:18px 18px 8px;">${p(`<strong style="font-size:18px;color:${INK};">Warmer in winter</strong><br>Help retain warmth when temperatures fall.`)}</td></tr><tr><td style="padding:6px 18px;">${p(`<strong style="font-size:18px;color:${INK};">Cooler in summer</strong><br>Help slow heat entering through the ceiling.`)}</td></tr><tr><td style="padding:8px 18px 18px;">${p(`<strong style="font-size:18px;color:${INK};">Less heating and cooling demand</strong><br>A more comfortable home with less reliance on mechanical heating and cooling.`)}</td></tr></table>`;
}

function referral(url: string | null) {
  return url ? row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${PALE_GREEN};"><tr><td style="padding:21px 20px;">${heading("Know someone who could benefit?")}${p("Share Home Insulation Victoria with a friend or family member. They can complete their own eligibility check—no contact details are shared by you.")}<p style="margin:14px 0 0;"><a href="${escape(url)}" style="color:${BLUE};font-size:14px;font-weight:800;text-decoration:underline;">SHARE HOME INSULATION VICTORIA</a></p></td></tr></table>`) : "";
}

function footer(reference?: string | null, kind: "estimate" | "result" = "estimate") {
  const ref = reference?.trim() ? `<br>Reference: ${escape(reference.trim())}` : "";
  return row(`${p("Pleased to meet you. You'll be pleased to meet the savings.", "font-weight:700;margin-bottom:12px;")}${p("DC Construction Solutions Pty Ltd trading as Home Insulation Victoria", "font-size:12px;")}${p(`You are receiving this because you requested a Home Insulation Victoria ${kind === "result" ? "eligibility result" : "eligibility result or estimate"}.${ref}`, "font-size:12px;margin-top:7px;")}${p(`<a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact</a><br>A secure unsubscribe link appears directly below this footer.`, "font-size:12px;margin-top:7px;")}`, `20px 28px 26px;border-top:1px solid ${PALE_BLUE};`);
}

function shell(content: string, preview: string, pixel: string | null) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(preview)}</title></head><body style="margin:0;padding:0;background-color:${OUTER};font-family:'Open Sans',Arial,Helvetica,sans-serif;color:${INK};"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(preview)}</div><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${OUTER}" style="border-collapse:collapse;background-color:${OUTER};"><tr><td align="center" style="padding:24px 10px 38px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff" style="width:100%;max-width:640px;border-collapse:collapse;background-color:#ffffff;box-shadow:0 14px 34px rgba(82,200,117,.16);">${content}</table>${pixelTag(pixel)}</td></tr></table></body></html>`;
}

export function renderEstimateEmail(input: EstimateEmailInput): EstimateEmail {
  const outcome = input.outcome ?? "likely";
  const link = validEstimateUrl(input.estimateUrl);
  const target = validTrackingUrl(input.trackingClickUrl, "click") ?? link.toString();
  const pixel = validTrackingUrl(input.trackingPixelUrl, "pixel");
  const referralUrl = validReferralUrl(input.referralUrl);
  const values = [input.estimatedTotal, input.veuDiscount, input.areaM2];
  if (!values.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) throw new Error("Outcome emails require positive estimate total, VEU discount and ceiling area values.");
  const customer = input.estimatedTotal as number;
  const discount = input.veuDiscount as number;
  const area = input.areaM2 as number;
  const packagePrice = customer + discount;
  const computedPercent = packagePrice > 0 ? Math.round((discount / packagePrice) * 100) : null;
  const savingsPercent = typeof input.savingsPercent === "number" && Number.isFinite(input.savingsPercent) && input.savingsPercent > 0 ? Math.round(input.savingsPercent) : computedPercent;
  const onsite = outcome === "onsite";
  const subject = onsite ? "Good news — your preliminary Home Insulation Victoria quote is ready" : "Good news — your home looks likely to qualify for a VEU insulation discount";
  const previewText = `${money(discount)} estimated VEU discount and an estimated customer price of ${money(customer)}.`;
  const reasons = cleanReasons(input.reasons);
  const statusCopy = onsite
    ? "Your property remains a positive candidate for the VEU pathway. A few details need onsite confirmation before eligibility and final pricing can be confirmed."
    : "Based on your answers and our initial checks, your property looks likely to qualify for the VEU ceiling-insulation pathway, subject to onsite confirmation.";
  const reasonCard = onsite ? row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALE_BLUE}" style="border-collapse:collapse;background-color:${PALE_BLUE};"><tr><td style="padding:21px 20px;">${heading("What we need to confirm")}${reasons.length ? reasons.map((reason) => p(`<span style="color:${GREEN};font-weight:800;">✓</span> ${escape(reason)}`, "margin-top:8px;")).join("") : p("We’ll confirm the relevant onsite details, including existing insulation, access and electrical safety.")}</td></tr></table>`) : "";
  const hero = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:collapse;border:2px solid ${BLUE};"><tr><td style="padding:24px 22px 10px;text-align:center;"><p style="margin:0 0 6px;color:${BLUE};font-size:12px;font-weight:800;letter-spacing:1px;">YOUR PRELIMINARY QUOTE</p><p style="margin:0;color:${GREEN};font-size:42px;line-height:1.08;font-weight:800;">${escape(money(discount))}</p><p style="margin:4px 0 18px;color:${INK};font-size:14px;font-weight:700;">estimated VEU discount</p></td></tr><tr><td style="padding:0 22px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td width="50%" valign="top" style="padding:12px;border-top:1px solid ${PALE_BLUE};"><p style="margin:0;color:${INK};font-size:12px;line-height:1.4;">Package before discount</p><p style="margin:4px 0 0;color:${INK};font-size:20px;font-weight:700;">${escape(money(packagePrice))}</p></td><td width="50%" valign="top" style="padding:12px;border-top:1px solid ${PALE_BLUE};border-left:1px solid ${PALE_BLUE};"><p style="margin:0;color:${INK};font-size:12px;line-height:1.4;">Estimated ceiling area</p><p style="margin:4px 0 0;color:${INK};font-size:20px;font-weight:700;">${escape(number(area))} m²</p></td></tr></table><p style="margin:17px 0 4px;text-align:center;color:${INK};font-size:13px;font-weight:700;">ESTIMATED CUSTOMER PRICE</p><p style="margin:0;text-align:center;color:${BLUE};font-size:42px;line-height:1.08;font-weight:800;">${escape(money(customer))}</p>${savingsPercent ? `<p style="margin:7px 0 0;text-align:center;color:${GREEN};font-size:14px;font-weight:800;">Estimated ${savingsPercent}% reduction from the package price</p>` : ""}<p style="margin:16px 0 0;text-align:center;color:${INK};font-size:11px;line-height:1.55;">Indicative only. Final eligible area, VEU discount and price are confirmed after the onsite assessment.</p></td></tr></table>`;
  const next = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALE_BLUE}" style="border-collapse:collapse;background-color:${PALE_BLUE};"><tr><td style="padding:23px 20px;"><p style="margin:0 0 7px;color:${GREEN};font-size:12px;font-weight:800;letter-spacing:1px;">YOUR NEXT STEP</p><h2 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:${BLUE};font-weight:800;">Onsite Measure + Electrical Safety Assessment</h2>${p("This confirms the eligible ceiling area, existing insulation and any removal needs, roof access, electrical safety, final VEU discount and final customer price.")}</td></tr></table>`;
  const lowerCta = `<p style="margin:0 0 5px;text-align:center;color:${GREEN};font-size:30px;line-height:1.15;font-weight:800;">${escape(money(discount))}</p><p style="margin:0 0 16px;text-align:center;color:${INK};font-size:13px;font-weight:700;">your personalised estimated VEU discount</p>${cta(target)}${p("Your secure result link is personal to your property.", "margin-top:10px;font-size:12px;text-align:center;")}`;
  const html = shell(`${logo()}${row(`<p style="margin:0 0 7px;color:${GREEN};font-size:12px;font-weight:800;letter-spacing:1px;">${onsite ? "POSITIVE START — ONSITE CONFIRMATION NEEDED" : "GOOD NEWS"}</p><h1 style="margin:0 0 13px;font-size:29px;line-height:1.2;color:${INK};font-weight:800;">${onsite ? "Your preliminary quote is ready." : "Your home looks likely to qualify."}</h1>${p(statusCopy)}`, "0 28px 22px")}${row(hero, "0 28px 28px")}${reasonCard}${row(next)}${row(includedCards())}${row(trust(input.apCount))}${row(benefits())}${row(lowerCta)}${referral(referralUrl)}${footer(input.reference)}`, previewText, pixel);
  const plainReasons = onsite ? `\n\nWHAT WE NEED TO CONFIRM\n${reasons.length ? reasons.map((r) => `• ${r}`).join("\n") : "We’ll confirm existing insulation, access and electrical safety onsite."}` : "";
  const plainText = `${subject}\n\n${onsite ? "POSITIVE START — ONSITE CONFIRMATION NEEDED\nYour preliminary quote is ready." : "GOOD NEWS\nYour home looks likely to qualify."}\n${statusCopy}\n\nYOUR PRELIMINARY QUOTE\nEstimated VEU discount: ${money(discount)}\nPackage before discount: ${money(packagePrice)}\nEstimated customer price: ${money(customer)}\nEstimated ceiling area: ${number(area)} m²${savingsPercent ? `\nEstimated saving from package price: ${savingsPercent}%` : ""}\nIndicative only. Final eligible area, VEU discount and price are confirmed after the onsite assessment.${plainReasons}\n\nYOUR NEXT STEP\nOnsite Measure + Electrical Safety Assessment\nThis confirms the eligible ceiling area, existing insulation and any removal needs, roof access, electrical safety, final VEU discount and final customer price.\n\nYOUR MANAGED INSULATION PACKAGE INCLUDES\n• Onsite measure\n• Electrical safety assessment\n• R5.0 insulation\n• Vetted trade network\n• Compliance and evidence\n• VEEC processing\n\nONE ACCOUNTABLE PATHWAY\n${typeof input.apCount === "number" && input.apCount > 0 ? `Home Insulation Victoria is the approved Accredited Person, supported by ${Math.floor(input.apCount)} currently verified team members.` : "Home Insulation Victoria is the approved Accredited Person for this managed VEU pathway."}\nElectrical work is arranged through appropriately licensed electricians and Registered Electrical Contractors. Insulation providers are appropriately EEC-certified, with capacity reserved across our certified network for qualifying projects.\n\nWHY CEILING INSULATION MATTERS\nWarmer in winter. Cooler in summer. Less heating and cooling demand. Better year-round comfort.\n\n${money(discount)} — your personalised estimated VEU discount\nCONTINUE WITH HOME INSULATION VICTORIA: ${target}${referralUrl ? `\n\nSHARE HOME INSULATION VICTORIA: ${referralUrl}` : ""}\n\nPleased to meet you. You'll be pleased to meet the savings.\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria\nYou are receiving this because you requested a Home Insulation Victoria eligibility result or estimate.${input.reference ? `\nReference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy\nContact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}

export function renderIneligibleOutcomeEmail(input: IneligibleOutcomeEmailInput): EstimateEmail {
  const referralUrl = validReferralUrl(input.referralUrl);
  if (!referralUrl) throw new Error("A Home Insulation Victoria referral link is required.");
  const reasons = cleanReasons(input.reasons);
  const resultUrl = input.resultUrl ?? `${SITE}/homeowner`;
  const parsedResultUrl = new URL(resultUrl);
  if (parsedResultUrl.origin !== SITE || parsedResultUrl.pathname !== "/homeowner") throw new Error("A Home Insulation Victoria result link is required.");
  const subject = "Your Home Insulation Victoria eligibility result";
  const previewText = "Your eligibility result and the options available from here.";
  const reasonList = reasons.length ? reasons.map((reason) => p(`<span style="color:${BLUE};font-weight:800;">•</span> ${escape(reason)}`, "margin-top:8px;")).join("") : p("Based on the information provided, this property does not meet the preliminary requirements for this VEU ceiling-insulation offer.");
  const html = shell(`${logo()}${row(`<p style="margin:0 0 7px;color:${BLUE};font-size:12px;font-weight:800;letter-spacing:1px;">YOUR ELIGIBILITY RESULT</p><h1 style="margin:0 0 13px;font-size:29px;line-height:1.2;color:${INK};font-weight:800;">This property does not appear eligible.</h1>${p("Based on the information provided, we can’t present a VEU discount or preliminary quote for this property. This is a preliminary result, not a guarantee or final determination.")}`, "0 28px 24px")}${row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALE_BLUE}" style="border-collapse:collapse;background-color:${PALE_BLUE};"><tr><td style="padding:21px 20px;">${heading("Why we reached this result")}${reasonList}</td></tr></table>`)}${row(`${cta(resultUrl)}${p("You can review the pathway and submit updated information if your property details have changed.", "margin-top:10px;font-size:12px;text-align:center;")}`)}${row(trust(input.apCount))}${row(benefits())}${row(includedCards())}${referral(referralUrl)}${footer(input.reference, "result")}`, previewText, null);
  const plainText = `${subject}\n\nYOUR ELIGIBILITY RESULT\nThis property does not appear eligible.\nBased on the information provided, we can’t present a VEU discount or preliminary quote for this property. This is a preliminary result, not a guarantee or final determination.\n\nWHY WE REACHED THIS RESULT\n${reasons.length ? reasons.map((r) => `• ${r}`).join("\n") : "Based on the information provided, this property does not meet the preliminary requirements for this VEU ceiling-insulation offer."}\n\nCONTINUE WITH HOME INSULATION VICTORIA: ${resultUrl}\n\nHome Insulation Victoria is the approved Accredited Person for this managed VEU pathway. Our vetted network includes appropriately licensed electricians and Registered Electrical Contractors, and appropriately EEC-certified insulation providers.\n\nWHY CEILING INSULATION MATTERS\nWarmer in winter. Cooler in summer. Less heating and cooling demand. Better year-round comfort.\n\nKnow someone who could benefit?\nSHARE HOME INSULATION VICTORIA: ${referralUrl}\n\nPleased to meet you. You'll be pleased to meet the savings.\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria\nYou are receiving this because you requested a Home Insulation Victoria eligibility result.${input.reference ? `\nReference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy\nContact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}