/** Pure customer outcome email renderers: no data access, delivery, or side effects. */
export type CustomerOutcome = "likely" | "onsite" | "ineligible";
export type EstimateEmailInput = {
  estimateUrl: string; outcome?: "likely" | "onsite"; estimatedTotal?: number | null;
  veuDiscount?: number | null; areaM2?: number | null; savingsPercent?: number | null;
  reasons?: string[] | null; apCount?: number | null; reference?: string | null;
  firstName?: string | null; address?: string | null;
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
function shell(content: string, preview: string, pixel: string | null) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(preview)}</title></head><body style="margin:0;padding:0;background-color:${OUTER};font-family:'Open Sans',Arial,Helvetica,sans-serif;color:${INK};"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(preview)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER}" style="width:100%;border-collapse:collapse;background-color:${OUTER};"><tr><td align="center" style="padding:18px 8px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;max-width:640px;border-collapse:collapse;background-color:${WHITE};">${content}</table>${pixelTag(pixel)}</td></tr></table></body></html>`;
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
function trust(apCount?: number | null, compact = false) {
  const verified = typeof apCount === "number" && Number.isInteger(apCount) && apCount > 0;
  const ap = verified ? `${apCount} currently verified team member${apCount === 1 ? "" : "s"}. Home Insulation Victoria is the approved Accredited Person.` : "Home Insulation Victoria is the approved Accredited Person.";
  const blocks: Array<[string, string]> = [
    ["ACCREDITED PERSON", ap],
    ["VETTED TRADE NETWORK", "Electrical work through appropriately licensed electricians and Registered Electrical Contractors; insulation providers appropriately EEC-certified."],
    ["RESERVED CAPACITY", "Capacity reserved across our certified network for qualifying projects."],
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
  return section(offset(card(`${label("PASS IT ON", GREEN)}${title("KNOW SOMEONE WITH A<br>FREEZING HOUSE? <span style="color:#07BF61;">✳</span>", BLUE, 24)}<p style="margin:0 0 18px;color:${INK};font-size:17px;line-height:1.3;font-weight:800;">DON'T KEEP THE DISCOUNT TO YOURSELF.</p>${body("Share Home Insulation Victoria. They can check their own eligibility; you don't have to share anyone's details.")}<p style="margin:17px 0 0;"><a href="${escape(url)}" style="color:${BLUE};font-size:14px;font-weight:800;text-decoration:underline;">REFER A FRIEND →</a></p>`, PALE_GREEN)), "0 28px 34px");
}
function footer(reference?: string | null, kind: "estimate" | "result" = "estimate") {
  const ref = reference?.trim() ? `<br>Reference: ${escape(reference.trim())}` : "";
  return section(`<p style="margin:0 0 12px;color:${BLUE};font-size:14px;font-weight:800;">Home Insulation Victoria</p><p style="margin:0 0 16px;color:${INK};font-size:13px;line-height:1.5;">Pleased to meet you. You'll be pleased to meet the savings.</p><p style="margin:0;color:${INK};font-size:11px;line-height:1.7;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria<br>You are receiving this because you requested a Home Insulation Victoria ${kind === "result" ? "eligibility result" : "eligibility result or estimate"}.${ref}<br><a href="${SITE}/privacy" style="color:${BLUE};text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${SITE}/contact" style="color:${BLUE};text-decoration:underline;">Contact</a><br>A secure unsubscribe link appears directly below this footer.</p>`, `23px 28px 28px;border-top:1px solid ${PALE_BLUE};`);
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
  const intro = `${label("YOUR PRELIMINARY VEU INSULATION ESTIMATE", GREEN)}<h1 style="margin:0 0 10px;color:${BLUE};font-size:34px;line-height:1.07;font-weight:800;letter-spacing:-.5px;">${onsite ? "YOUR PRELIMINARY ESTIMATE IS READY <span style="color:#07BF61;">✳</span>" : `GOOD NEWS${name ? `, ${escape(name)}` : ""}! <span style="color:#07BF61;">✳</span>`}</h1><p style="margin:0 0 12px;color:${INK};font-size:17px;line-height:1.3;font-weight:800;">${onsite ? "YOU COULD STILL QUALIFY — WE JUST NEED TO CONFIRM A FEW THINGS." : "YOUR HOME LOOKS LIKELY TO QUALIFY."}</p>${address ? `<p style="display:inline-block;margin:0 0 12px;padding:7px 12px;border-radius:20px;background-color:${PALE_BLUE};color:${BLUE};font-size:12px;line-height:1.4;font-weight:700;">${escape(address)}</p>` : ""}${body(statusCopy)}`;
  const quote = `${label("YOUR PRELIMINARY QUOTE")}${body("ESTIMATED INSULATION PACKAGE")}<p style="margin:3px 0 16px;color:${INK};font-size:21px;font-weight:700;text-decoration:line-through;">${escape(money(packagePrice))}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-top:1px solid ${PALE_BLUE};border-bottom:1px solid ${PALE_BLUE};"><tr><td style="padding:16px 0;">${label("ESTIMATED VEU DISCOUNT", GREEN)}<p style="margin:0;color:${GREEN};font-size:52px;line-height:1;font-weight:800;">${escape(money(discount))}</p></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:17px 0 0;">${label("YOUR ESTIMATED PRICE")}<p style="margin:0;color:${BLUE};font-size:48px;line-height:1;font-weight:800;">${escape(money(customer))}</p></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td valign="middle" style="padding-top:17px;color:${INK};font-size:12px;line-height:1.5;">Based on ${escape(number(area))} m² estimated ceiling area</td>${savingsPercent ? `<td align="right" valign="middle" style="padding-top:17px;"><span style="display:inline-block;padding:7px 9px;background-color:${PALE_GREEN};border-radius:14px;color:${GREEN};font-size:12px;font-weight:800;">${savingsPercent}% reduction</span></td>` : ""}</tr></table><p style="margin:18px 0 0;color:${INK};font-size:11px;line-height:1.5;">Indicative only. Final eligible area, VEU discount and price are confirmed after the onsite assessment.</p>`;
  const reasonCard = onsite ? section(card(`${label("ONSITE CONFIRMATION", BLUE)}${title("What we need to confirm", BLUE, 23)}${reasons.length ? reasons.map((r) => `<p style="margin:0 0 10px;color:${INK};font-size:14px;line-height:1.5;"><span style="color:${GREEN};font-weight:800;">✓</span> ${escape(r)}</p>`).join("") : body("We’ll confirm the relevant onsite details, including existing insulation, access and electrical safety.")}<p style="margin:13px 0 0;color:${BLUE};font-size:13px;font-weight:800;">YOUR ANSWERS HAVEN'T RULED YOU OUT.</p>`, PALE_BLUE), "0 28px 32px") : "";
  const next = card(`${label("YOUR NEXT STEP", GREEN)}${title("MEASURE + ELECTRICAL<br>SAFETY ASSESSMENT", BLUE, 25)}${body("One onsite visit confirms the eligible ceiling area, existing insulation and any removal needs, roof access, electrical safety, final VEU discount and final customer price.")}<p style="margin:12px 0 18px;color:${INK};font-size:13px;line-height:1.6;">✓ Ceiling area &amp; access &nbsp; ✓ Insulation &amp; removal<br>✓ Electrical safety &nbsp; ✓ Final price</p>${cta(target)}<p style="margin:11px 0 0;color:${INK};font-size:12px;line-height:1.5;">Capacity is reserved across our certified network for qualifying projects.</p>`, PALE_GREEN, GREEN);
  const html = shell(`${logo()}${section(intro, "0 28px 22px")}${section(offset(card(quote)), "0 28px 22px")}${section(cta(target), "0 28px 32px")}${reasonCard}${section(packageSection())}${section(trust(input.apCount))}${section(benefits(discount))}${section(next)}${referral(referralUrl)}${footer(input.reference)}`, previewText, pixel);
  const plainReasons = onsite ? `\n\nWHAT WE NEED TO CONFIRM\n${reasons.length ? reasons.map((r) => `• ${r}`).join("\n") : "We’ll confirm existing insulation, access and electrical safety onsite."}\nYOUR ANSWERS HAVEN'T RULED YOU OUT.` : "";
  const plainText = `${subject}\n\n${onsite ? "YOUR PRELIMINARY ESTIMATE IS READY" : `GOOD NEWS${name ? `, ${name}` : ""}! 👋 YOUR HOME LOOKS LIKELY TO QUALIFY.`}${address ? `\n${address}` : ""}\n${statusCopy}\n\nYOUR PRELIMINARY QUOTE\nEstimated insulation package: ${money(packagePrice)}\nEstimated VEU discount: ${money(discount)}\nYour estimated price: ${money(customer)}\nBased on ${number(area)} m²${savingsPercent ? `\n${savingsPercent}% reduction from package price` : ""}\nIndicative only. Final eligible area, VEU discount and price are confirmed after the onsite assessment.\n\nCONTINUE WITH HOME INSULATION VICTORIA: ${target}${plainReasons}\n\nTHIS ISN'T JUST AN INSULATION QUOTE.\nEligibility, onsite measure, electrical safety assessment, R5.0 insulation, compliance and evidence, VEEC processing.\n\nYOU'RE IN THE RIGHT HANDS.\nHome Insulation Victoria is the approved Accredited Person${typeof input.apCount === "number" && Number.isInteger(input.apCount) && input.apCount > 0 ? `, supported by ${input.apCount} currently verified team members` : ""}. Electrical work through appropriately licensed electricians and Registered Electrical Contractors; insulation providers appropriately EEC-certified. Capacity reserved across our certified network for qualifying projects.\n\nWARMER IN WINTER. COOLER IN SUMMER. LESS HEATING & COOLING DEMAND.\nThe VEU program could contribute ${money(discount)} (estimated, subject to onsite confirmation).\n\nYOUR NEXT STEP\nOnsite Measure + Electrical Safety Assessment confirms eligible ceiling area, existing insulation and removal needs, roof access, electrical safety, final VEU discount and final customer price.\nCONTINUE WITH HOME INSULATION VICTORIA: ${target}${referralUrl ? `\n\nREFER A FRIEND: ${referralUrl}` : ""}\n\nPleased to meet you. You'll be pleased to meet the savings.\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria\nYou are receiving this because you requested a Home Insulation Victoria eligibility result or estimate.${input.reference ? `\nReference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy\nContact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
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
  const html = shell(`${logo()}${section(`${label("YOUR ELIGIBILITY RESULT", GREEN)}<h1 style="margin:0;color:${BLUE};font-size:33px;line-height:1.12;font-weight:800;">THIS PROPERTY DOES NOT APPEAR ELIGIBLE.</h1>`, "0 28px 23px")}${section(offset(card(`${label("YOUR PRELIMINARY RESULT")}${title("Why we reached this result", BLUE, 23)}${reasonList}<p style="margin:13px 0 0;color:${INK};font-size:13px;line-height:1.55;">Based on the information provided, we can’t present a VEU discount or preliminary quote for this property. This is a preliminary result, not a guarantee or final determination.</p>`, PALE_BLUE)), "0 28px 25px")}${section(`${cta(resultUrl, "REVIEW MY RESULT →")}<p style="margin:10px 0 0;text-align:center;color:${INK};font-size:12px;line-height:1.5;">Review the pathway or submit updated information if your property details have changed.</p>`, "0 28px 34px")}${referral(referralUrl)}${section(trust(input.apCount, true))}${section(`${label("WHY INSULATION MATTERS")}${title("COMFORT THROUGH THE SEASONS.", BLUE, 23)}${body("Warmer in winter. Cooler in summer. Less heating and cooling demand. A more comfortable home year-round.")}`)}${footer(input.reference, "result")}`, previewText, null);
  const plainText = `${subject}\n\nKNOW SOMEONE WITH A FREEZING HOUSE? Share Home Insulation Victoria with a friend.\n\nYOUR ELIGIBILITY RESULT\nThis property does not appear eligible.\nBased on the information provided, we can’t present a VEU discount or preliminary quote for this property. This is a preliminary result, not a guarantee or final determination.\n\nWHY WE REACHED THIS RESULT\n${reasons.length ? reasons.map((r) => `• ${r}`).join("\n") : "Based on the information provided, this property does not meet the preliminary requirements for this VEU ceiling-insulation offer."}\n\nREVIEW MY RESULT: ${resultUrl}\n\nREFER A FRIEND: ${referralUrl}\n\nHome Insulation Victoria is the approved Accredited Person for this managed VEU pathway. Our vetted network includes appropriately licensed electricians and Registered Electrical Contractors, and appropriately EEC-certified insulation providers.\n\nWarmer in winter. Cooler in summer. Less heating and cooling demand.\n\nPleased to meet you. You'll be pleased to meet the savings.\nDC Construction Solutions Pty Ltd trading as Home Insulation Victoria\nYou are receiving this because you requested a Home Insulation Victoria eligibility result.${input.reference ? `\nReference: ${input.reference}` : ""}\nPrivacy: ${SITE}/privacy\nContact: ${SITE}/contact\nA secure unsubscribe link appears below.`;
  return { subject, previewText, html, plainText };
}
