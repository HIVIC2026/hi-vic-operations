import { READY_CHECK_FEE, effectiveReadyCheckFee } from "./readycheck.core";
/** Shared customer email helpers (links, tracking, button, Ready Check fee). Pure: no data access or delivery. */
import { CUSTOMER_BRAND } from "./customer-quote-system";
import type { EstimateRemoval } from "./estimate-removal.core";

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
export type EstimateEmail = { subject: string; previewText: string; html: string; plainText: string };

const BASE = "https://estimate.homeinsulationvictoria.com.au";
const SITE = "https://homeinsulationvictoria.com.au";
/** Privacy page lives on the estimate site (Jo, 6 Oct 2026) — every customer email footer links here. */
export const PRIVACY_URL = `${BASE}/privacy`;
const GREEN = CUSTOMER_BRAND.colors.green;
const WHITE = CUSTOMER_BRAND.colors.white;

export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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

function readyCheckFeeOf(input: Pick<EstimateEmailInput, "readyCheckFeeIncGst">): number {
  return effectiveReadyCheckFee(input.readyCheckFeeIncGst ?? READY_CHECK_FEE);
}

/** Compatibility export: preserve the approved free-check email without changing any wording. */
export function applyReadyCheckFee(mail: EstimateEmail, input: Pick<EstimateEmailInput, "readyCheckFeeIncGst" | "installationRatePerM2" | "pricingCohort">, _saveSpot: boolean): EstimateEmail {
  readyCheckFeeOf(input);
  return mail;
}

/** Clean public calculator (no customer data in the URL). */
export const PUBLIC_CALCULATOR_URL = "https://estimate.homeinsulationvictoria.com.au/";
const FIGTREE = "'Figtree',Arial,Helvetica,sans-serif";
const F = `font-family:${FIGTREE};`;
const v2Button = (href: string, text: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td align="center" bgcolor="${GREEN}" style="background-color:${GREEN};border:0;border-radius:12px;mso-padding-alt:15px 18px;box-shadow:0 10px 24px -12px rgba(7,191,97,.55);"><a class="lx-button" href="${escape(href)}" style="display:block;padding:15px 18px;${F}color:${WHITE};font-size:16px;line-height:20px;font-weight:800;text-decoration:none;border-radius:12px;">${text}</a></td></tr></table>`;
/** Campaign + spot-saved only (Jo, 6 Oct): web fonts are blocked in Outlook/Gmail, so every element carries an inline
 * fallback stack close to Outfit/Figtree. The locked likely-eligible/needs-onsite emails are NOT passed through this. */
export const CAMPAIGN_HEADING_STACK = "'Outfit','Avenir Next','Avenir','Century Gothic','Segoe UI',Helvetica,Arial,sans-serif";
/** Campaign + spot-saved button: the shared bulletproof button plus an Outlook desktop VML fallback (Jo, 6 Oct v6). */
export function campaignButton(href: string, text: string, vmlWidth = 520) {
  const t = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escape(href)}" style="height:50px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="24%" stroke="f" fillcolor="${GREEN}"><w:anchorlock/><center style="color:#FFFFFF;font-family:${CAMPAIGN_HEADING_STACK.replace(/'/g, "")};font-size:16px;font-weight:bold;">${t}</center></v:roundrect><![endif]--><!--[if !mso]><!-->${v2Button(href, text)}<!--<![endif]-->`;
}
