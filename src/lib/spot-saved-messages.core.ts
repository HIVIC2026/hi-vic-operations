// "Spot saved" confirmation (text + email), sent once when an owner first saves their spot.
// Wording APPROVED by Jo Lowe, 7 Oct 2026: "Smart move, {FirstName}. Your spot is saved." heading with
// "Your {rebate} rebate is waiting." directly under it, the demand/capacity paragraphs, and the
// "Have a friend who needs a spot saved?" referral card. Do not change without Jo's approval.
// PURE: no I/O. No phone number or "call us" anywhere.
import { CUSTOMER_BRAND } from "./customer-quote-system";
import { applyCampaignFonts, campaignArtImg, campaignButton, PRIVACY_URL, V2_THEME } from "./estimate-email";
import { emailArtUrl } from "./email-art.core";
import { dedupeAddress, shortAddress } from "./address";
import { EXISTING_PRELIMINARY, REMOVAL_BUDGET_EMAIL_NOTE, removalNote, type EstimateRemoval } from "./estimate-removal.core";

/** Jo 23 Oct 2026: shown to everyone in both Spot saved confirmations. */
export const SPOT_SAVED_NOT_INCLUDED = "Not included: if the electrical safety check finds anything that needs fixing, that work is extra and will be quoted separately.";

const LOGO_GREEN = "#00BF63";
const BLUE = "#3C51C4";
const INK = CUSTOMER_BRAND.colors.navy;
const SITE = "https://homeinsulationvictoria.com.au";
const F = "font-family:'Figtree',Arial,Helvetica,sans-serif;";
const FH = "font-family:'Outfit','Figtree',Arial,Helvetica,sans-serif;";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const wholeDollars = (n: number) => `$${Math.floor(n).toLocaleString("en-AU")}`;

export type SpotSavedInput = { firstName: string | null; rebate: number; suburb: string | null; shortAddress: string | null; myJobUrl: string; optOutUrl: string;
  /** Owner's referral link to the public eligibility checker (Jo, 7 Oct): shown as a "Send to a friend" card. */
  referralUrl?: string | null;
  /** Saved-spot snapshot: when present the email shows the same itemised breakdown as the likely-eligible email. */
  estimate?: { gross: number; customer: number; areaM2: number; address: string | null; calculatorUrl: string } | null;
  /** Removal fact from the owner's saved estimate (removalFromScenario), same as Save my spot. Excluded = nothing shown. */
  removal?: EstimateRemoval | null };

// Jo's "smart move" wording (7 Oct) replaces the old "waiting list is huge" message.
export const SPOT_SAVED_BATCH_TEXT = "Demand is high and installer capacity is limited, so we're approving homes in batches, in the order spots were saved. You've locked in your place, so there's nothing more you need to do.";
export const spotSavedTeamText = (suburb: string | null) => `We're teaming up with more installers and electricians across Victoria, and we'll text you as soon as one is free ${suburb?.trim() ? `in ${suburb.trim()}` : "near you"} to book your free Ready Check.`;

/** "12 Smith St, Ballarat VIC 3350" -> { short: "12 Smith St, Ballarat", suburb: "Ballarat" } */
export function addressBits(addressLine: string | null, suburb: string | null) {
  const sub = suburb?.trim() || null;
  const line = addressLine?.trim() || null;
  return { suburb: sub, short: shortAddress(line, sub) };
}

export function renderSpotSavedSms(i: SpotSavedInput) {
  const name = i.firstName?.trim() ? `, ${i.firstName.trim()}` : "";
  const where = i.suburb?.trim() ? ` in ${i.suburb.trim()}` : "";
  return `Spot saved${name}! 🎉 Smart move: your ${wholeDollars(i.rebate)} rebate is waiting. Demand is high and capacity is limited, but your place in line is locked in. We'll text you as soon as an installer is free${where}. Your job: ${i.myJobUrl} – Home Insulation Victoria`;
}

export function renderSpotSavedEmail(i: SpotSavedInput) {
  const rebate = wholeDollars(i.rebate);
  const name = i.firstName?.trim() || null;
  const subject = `Spot saved. Your ${rebate} rebate is waiting`;
  const p = (t: string, extra = "") => `<p style="margin:0 0 14px;${F}color:${INK};font-size:15px;line-height:1.6;${extra}">${t}</p>`;
  const T = V2_THEME, { INK: NAVY } = T.colors;
  const row = (inner: string, pad: string) => `<tr><td class="lx-pad" style="padding:${pad};${T.F}">${inner}</td></tr>`;
  const est = i.estimate && i.estimate.gross > 0 ? i.estimate : null;
  const assessment = 349, apFee = 349, veecValue = 70;
  const veecs = Math.round(i.rebate / veecValue);
  const removal = i.removal && i.removal.kind !== "excluded" ? i.removal : null;
  const removalAmt = removal?.kind === "included" ? removal.amount : 0;
  const savings = est ? T.savings({ address: dedupeAddress(est.address), area: est.areaM2, discount: i.rebate, customer: est.customer, gross: est.gross, rebateLabel: "Your estimated VEU rebate", costLabel: "Your estimated cost after rebate", qualifier: "Estimate only. Eligibility, measurements and final pricing confirmed after assessment.", hasBreakdown: true, installation: est.gross - assessment - apFee - removalAmt, assessment, apFee, calculatorUrl: est.calculatorUrl, ...(removal ? { removal } : {}), ...(Math.abs(veecs * veecValue - i.rebate) < 0.01 ? { totals: { veecs, veecValue } } : {}) }).html : "";
  // v6 (Jo, 6 Oct): logo, pill, caps line and headline are one per-owner image; alt carries the headline.
  const headlinePlain = `Spot saved${name ? `, ${name}` : ""}. Your ${rebate} rebate is waiting.`;
  const jobUrl = new URL(i.myJobUrl); const token = jobUrl.pathname.split("/")[2] ?? "";
  const art = campaignArtImg(emailArtUrl(jobUrl.origin, token, "spot"), headlinePlain);
  const smartMove = `Smart move${name ? `, ${esc(name)}` : ""}. Your spot is saved.`;
  const rebateLine = `Your ${rebate} rebate is waiting.`;
  const hero = ""
    + p(smartMove, "font-weight:800;margin-bottom:2px;")
    + p(rebateLine, "font-weight:700;margin-bottom:10px;")
    + p(esc(SPOT_SAVED_BATCH_TEXT))
    + p(esc(spotSavedTeamText(i.suburb)))
    + campaignButton(i.myJobUrl, "See my job →")
    + `<p style="margin:10px 0 0;${T.F}font-size:13px;line-height:1.5;text-align:center;color:${NAVY};">No payment · no obligation</p>`;
  // Referral card (Jo, 7 Oct): near the bottom, only when the owner's tracked referral link exists. Text message stays unchanged.
  const referral = i.referralUrl
    ? row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF3E8;border-radius:14px;"><tr><td style="padding:18px 20px;">`
      + `<p style="margin:0 0 4px;${FH}color:${INK};font-size:17px;line-height:1.3;font-weight:800;">Have a friend who needs a spot saved?</p>`
      + `<p style="margin:0 0 12px;${F}color:${INK};font-size:14px;line-height:1.5;">Send them our free eligibility checker. It takes a minute.</p>`
      + campaignButton(i.referralUrl, "Send to a friend →")
      + `</td></tr></table>`, "0 36px 22px")
    : "";
  const link = (href: string, t: string) => `<a href="${esc(href)}" style="color:${BLUE};text-decoration:underline;">${t}</a>`;
  const footer = `<p style="margin:0 0 5px;${T.F}color:${NAVY};font-size:14px;line-height:1.4;font-weight:800;text-align:center;">Home Insulation Victoria</p><p style="margin:0 0 9px;${T.F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.</p><p style="margin:0;${T.F}font-size:12px;line-height:1.5;text-align:center;">${link(`${PRIVACY_URL}`, "Privacy")}&nbsp;·&nbsp;${link(i.myJobUrl, "See my job")}&nbsp;·&nbsp;${link(i.optOutUrl, "Remove my enquiry")}</p>`;
  const removalAlone = !est && removal ? p(esc(REMOVAL_BUDGET_EMAIL_NOTE), "font-weight:700;") : "";
  const notIncluded = p(esc(SPOT_SAVED_NOT_INCLUDED));
  const html = T.shell(`${art}${row(hero, "0 36px 24px")}${est ? row(savings, "0 28px 22px") : ""}${row(removalAlone + notIncluded, "0 36px 22px")}${referral}${T.footerRow(footer)}`, subject, null);
  void LOGO_GREEN; void CUSTOMER_BRAND;
  const text = [subject, "", "YOU'RE ON THE LIST", `Spot saved${name ? `, ${name}` : ""}. Your ${rebate} rebate is waiting.`, smartMove.replace(/<[^>]+>/g, ""), rebateLine, "", SPOT_SAVED_BATCH_TEXT, "", spotSavedTeamText(i.suburb), "", `See my job: ${i.myJobUrl}`, "No payment · no obligation", ...(est ? ["", `Price before discount: $${est.gross.toLocaleString("en-AU")}`, `VEU discount (${veecs} VEECs × $70): −${rebate}`, `You pay about: $${est.customer.toLocaleString("en-AU")}`, ...(removal?.kind === "included" ? [`Removal of existing insulation: $${removal.amount.toLocaleString("en-AU", { maximumFractionDigits: 2 })} inc GST (${removal.areaM2.toLocaleString("en-AU")} m² included in this estimate; scope confirmed at your free Ready Check.)`] : []), ...(removal ? [removalNote(removal), EXISTING_PRELIMINARY] : []), `Try a different size: ${est.calculatorUrl}`] : removal ? ["", REMOVAL_BUDGET_EMAIL_NOTE] : []), "", SPOT_SAVED_NOT_INCLUDED, ...(i.referralUrl ? ["", "HAVE A FRIEND WHO NEEDS A SPOT SAVED?", "Send them our free eligibility checker. It takes a minute.", `Send to a friend: ${i.referralUrl}`] : []), "", "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.", `Privacy: ${PRIVACY_URL}`, `Remove my enquiry: ${i.optOutUrl}`].join("\n");
  return { subject, html: applyCampaignFonts(html), text };
}
