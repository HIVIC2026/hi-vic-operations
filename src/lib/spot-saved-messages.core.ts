// Jo-approved "Spot saved" confirmation (text + email), sent once when an owner first saves their spot.
// PURE: no I/O. No phone number or "call us" anywhere.
import { CUSTOMER_BRAND } from "./customer-quote-system";
import { PRIVACY_URL, V2_THEME } from "./estimate-email";

const LOGO_GREEN = "#00BF63";
const BLUE = "#3C51C4";
const INK = CUSTOMER_BRAND.colors.navy;
const SITE = "https://homeinsulationvictoria.com.au";
const F = "font-family:'Figtree',Arial,Helvetica,sans-serif;";
const FH = "font-family:'Outfit','Figtree',Arial,Helvetica,sans-serif;";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const wholeDollars = (n: number) => `$${Math.floor(n).toLocaleString("en-AU")}`;

export type SpotSavedInput = { firstName: string | null; rebate: number; suburb: string | null; shortAddress: string | null; myJobUrl: string; optOutUrl: string;
  /** Saved-spot snapshot: when present the email shows the same itemised breakdown as the likely-eligible email. */
  estimate?: { gross: number; customer: number; areaM2: number; address: string | null; calculatorUrl: string } | null };

export const SPOT_SAVED_WAIT_TEXT = "Hundreds of homes have signed up since 1 October, and we book in order. It may be a while before it's your turn. We're teaming up with more installers and electricians across Victoria right now to get through it faster.";

/** "12 Smith St, Ballarat VIC 3350" -> { short: "12 Smith St, Ballarat", suburb: "Ballarat" } */
export function addressBits(addressLine: string | null, suburb: string | null) {
  const sub = suburb?.trim() || null;
  const line = addressLine?.trim() || null;
  return { suburb: sub, short: [line, sub].filter(Boolean).join(", ") || null };
}

export function renderSpotSavedSms(i: SpotSavedInput) {
  const name = i.firstName?.trim() ? `, ${i.firstName.trim()}` : "";
  return `Spot saved${name}! 🎉 Your ${wholeDollars(i.rebate)} rebate is waiting.

Heads up: the waiting list is huge and we book in order, so it may be a while. We're teaming up with more installers and electricians across Victoria to speed it up. Your spot is held. We'll text you the moment an installer's free in ${i.suburb ?? "your area"}.

Your job: ${i.myJobUrl}
– Home Insulation Victoria`;
}

export function renderSpotSavedEmail(i: SpotSavedInput) {
  const rebate = wholeDollars(i.rebate);
  const name = i.firstName?.trim() || null;
  const subject = `Spot saved. Your ${rebate} rebate is waiting`;
  const where = i.shortAddress ? ` at ${i.shortAddress}` : "";
  const p = (t: string, extra = "") => `<p style="margin:0 0 14px;${F}color:${INK};font-size:15px;line-height:1.6;${extra}">${t}</p>`;
  const T = V2_THEME, { GREEN, INK: NAVY, TEXT_GREEN } = T.colors;
  const row = (inner: string, pad: string) => `<tr><td class="lx-pad" style="padding:${pad};${T.F}">${inner}</td></tr>`;
  const est = i.estimate && i.estimate.gross > 0 ? i.estimate : null;
  const assessment = 349, apFee = 349, veecValue = 70;
  const veecs = Math.round(i.rebate / veecValue);
  const savings = est ? T.savings({ address: est.address, area: est.areaM2, discount: i.rebate, customer: est.customer, gross: est.gross, rebateLabel: "Your estimated VEU rebate", costLabel: "Your estimated cost after rebate", qualifier: "Estimate only. Eligibility, measurements and final pricing confirmed after assessment.", hasBreakdown: true, installation: est.gross - assessment - apFee, assessment, apFee, calculatorUrl: est.calculatorUrl, ...(Math.abs(veecs * veecValue - i.rebate) < 0.01 ? { totals: { veecs, veecValue } } : {}) }).html : "";
  const hero = `<p style="margin:0 0 8px;${T.F}color:${TEXT_GREEN};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">You're on the list</p>`
    + `<h1 class="lx-h1 hiv-hero-title" style="margin:0 0 14px;${T.FH}color:${NAVY};font-size:34px;line-height:39px;mso-line-height-rule:exactly;font-weight:800;letter-spacing:0;">Spot saved${name ? `, ${esc(name)}` : ""}. Your <span style="color:${GREEN};">${esc(rebate)}</span> rebate is waiting.</h1>`
    + p(`Nice work. You're in line for a free Ready Check${esc(where)}.`)
    + p("Heads up: the waiting list is huge.", "font-weight:800;margin-bottom:6px;")
    + p(esc(SPOT_SAVED_WAIT_TEXT))
    + p("Your spot is held. The moment an installer is free near you, we'll text you to pick a time. Nothing to do until then.")
    + T.button(i.myJobUrl, "See my job →")
    + `<p style="margin:10px 0 0;${T.F}font-size:13px;line-height:1.5;text-align:center;color:${NAVY};">No payment · no obligation</p>`;
  const link = (href: string, t: string) => `<a href="${esc(href)}" style="color:${BLUE};text-decoration:underline;">${t}</a>`;
  const footer = `<p style="margin:0 0 5px;${T.F}color:${NAVY};font-size:14px;line-height:1.4;font-weight:800;text-align:center;">Home Insulation Victoria</p><p style="margin:0 0 9px;${T.F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.</p><p style="margin:0;${T.F}font-size:12px;line-height:1.5;text-align:center;">${link(`${PRIVACY_URL}`, "Privacy")}&nbsp;·&nbsp;${link(i.myJobUrl, "See my job")}&nbsp;·&nbsp;${link(i.optOutUrl, "Remove my enquiry")}</p>`;
  const html = T.shell(`${row(T.header("Free estimate · no obligation", true), "22px 36px 18px")}${row(hero, "8px 36px 24px")}${est ? row(savings, "0 28px 22px") : ""}${T.footerRow(footer)}`, subject, null);
  void LOGO_GREEN; void CUSTOMER_BRAND;
  const text = [subject, "", "YOU'RE ON THE LIST", `Spot saved${name ? `, ${name}` : ""}. Your ${rebate} rebate is waiting.`, `Nice work. You're in line for a free Ready Check${where}.`, "", "Heads up: the waiting list is huge.", SPOT_SAVED_WAIT_TEXT, "", "Your spot is held. The moment an installer is free near you, we'll text you to pick a time. Nothing to do until then.", "", `See my job: ${i.myJobUrl}`, "No payment · no obligation", ...(est ? ["", `Price before discount: $${est.gross.toLocaleString("en-AU")}`, `VEU discount (${veecs} VEECs × $70): −${rebate}`, `You pay about: $${est.customer.toLocaleString("en-AU")}`, `Try a different size: ${est.calculatorUrl}`] : []), "", "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.", `Privacy: ${PRIVACY_URL}`, `Remove my enquiry: ${i.optOutUrl}`].join("\n");
  return { subject, html, text };
}
