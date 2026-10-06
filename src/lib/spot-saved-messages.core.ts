// Jo-approved "Spot saved" confirmation (text + email), sent once when an owner first saves their spot.
// PURE: no I/O. No phone number or "call us" anywhere.
import { CUSTOMER_BRAND } from "./customer-quote-system";

const LOGO_GREEN = "#00BF63";
const BLUE = "#3C51C4";
const INK = CUSTOMER_BRAND.colors.navy;
const SITE = "https://homeinsulationvictoria.com.au";
const F = "font-family:'Figtree',Arial,Helvetica,sans-serif;";
const FH = "font-family:'Outfit','Figtree',Arial,Helvetica,sans-serif;";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const wholeDollars = (n: number) => `$${Math.floor(n).toLocaleString("en-AU")}`;

export type SpotSavedInput = { firstName: string | null; rebate: number; suburb: string | null; shortAddress: string | null; myJobUrl: string; optOutUrl: string };

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
  const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;padding:0;background:#ffffff;${F}color:${INK};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;"><tr><td style="padding:0 0 24px;"><img src="${CUSTOMER_BRAND.logoUrl}" alt="Home Insulation Victoria" width="142" style="display:block;width:142px;height:auto;border:0;"></td></tr><tr><td>`
    + `<p style="margin:0 0 10px;${F}color:${LOGO_GREEN};font-size:11px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;">You're on the list</p>`
    + `<h1 style="margin:0 0 14px;${FH}color:${INK};font-size:32px;line-height:37px;font-weight:800;">Spot saved${name ? `, ${esc(name)}` : ""}. Your <span style="color:${LOGO_GREEN};">${esc(rebate)}</span> rebate is waiting.</h1>`
    + p(`Nice work. You're in line for a free Ready Check${esc(where)}.`)
    + p("Heads up: the waiting list is huge.", "font-weight:800;margin-bottom:6px;")
    + p(esc(SPOT_SAVED_WAIT_TEXT))
    + p("Your spot is held. The moment an installer is free near you, we'll text you to pick a time. Nothing to do until then.")
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${LOGO_GREEN}" style="border-radius:12px;"><a href="${esc(i.myJobUrl)}" style="display:block;padding:15px 18px;${F}color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;">See my job →</a></td></tr></table>`
    + `<p style="margin:10px 0 28px;${F}color:#5A6785;font-size:13px;text-align:center;">No payment · no obligation</p>`
    + `<p style="margin:0;padding-top:18px;border-top:1px solid #E4E9F5;${F}color:#5A6785;font-size:12px;line-height:1.6;text-align:center;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.<br><a href="${SITE}/privacy" style="color:${BLUE};">Privacy</a> · <a href="${esc(i.optOutUrl)}" style="color:${BLUE};">Remove my enquiry</a></p>`
    + `</td></tr></table></td></tr></table></body></html>`;
  const text = [subject, "", "YOU'RE ON THE LIST", `Spot saved${name ? `, ${name}` : ""}. Your ${rebate} rebate is waiting.`, `Nice work. You're in line for a free Ready Check${where}.`, "", "Heads up: the waiting list is huge.", SPOT_SAVED_WAIT_TEXT, "", "Your spot is held. The moment an installer is free near you, we'll text you to pick a time. Nothing to do until then.", "", `See my job: ${i.myJobUrl}`, "No payment · no obligation", "", "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.", `Privacy: ${SITE}/privacy`, `Remove my enquiry: ${i.optOutUrl}`].join("\n");
  return { subject, html, text };
}
