import { AMOUNT_LH, HEADER_ART_W, HEADING_ART, amountArtWidth, emailArtUrl } from "./email-art.core";
import { READY_CHECK_FEE, effectiveReadyCheckFee } from "./readycheck.core";
/** Pure customer outcome email renderers: no data access, delivery, or side effects. */
import { CUSTOMER_BRAND, CUSTOMER_WHAT_COULD_CHANGE } from "./customer-quote-system";
import { isWellFormedToken } from "./estimatelink.core";
import { EXISTING_PRELIMINARY, REMOVAL_BUDGET_EMAIL_NOTE, removalNote, type EstimateRemoval } from "./estimate-removal.core";

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
/** Verified live brand logo (HTTP 200 image/png) used in every customer email. */
const LOGO_URL = CUSTOMER_BRAND.logoUrl;
const SITE = "https://homeinsulationvictoria.com.au";
/** Privacy page lives on the estimate site (Jo, 6 Oct 2026) — every customer email footer links here. */
export const PRIVACY_URL = `${BASE}/privacy`;
const BLUE = CUSTOMER_BRAND.colors.blue;
const GREEN = CUSTOMER_BRAND.colors.green;
const INK = CUSTOMER_BRAND.colors.navy;
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

/** Hidden inbox preview text. Wrapped in a non-MSO conditional so Outlook desktop never receives it. */
export function preheader(preview: string) {
  return `<!--[if !mso]><!--><div style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escape(preview)}</div><!--<![endif]-->`;
}
/** Manual QA marker: test-only banners are injected here, inside the visible 640px body before the logo row. Renders nothing. */
export const TEST_BANNER_SLOT = "<!-- HIV_TEST_BANNER_SLOT -->";


function readyCheckFeeOf(input: Pick<EstimateEmailInput, "readyCheckFeeIncGst">): number {
  return effectiveReadyCheckFee(input.readyCheckFeeIncGst ?? READY_CHECK_FEE);
}

/** Compatibility export: preserve the approved free-check email without changing any wording. */
export function applyReadyCheckFee(mail: EstimateEmail, input: Pick<EstimateEmailInput, "readyCheckFeeIncGst" | "installationRatePerM2" | "pricingCohort">, _saveSpot: boolean): EstimateEmail {
  readyCheckFeeOf(input);
  return mail;
}

// ---------------------------------------------------------------------------
// Current approved eligible-outcome email system.
// ---------------------------------------------------------------------------

/** Clean public calculator (no customer data in the URL). */
export const PUBLIC_CALCULATOR_URL = "https://estimate.homeinsulationvictoria.com.au/";
const TEXT_GREEN = "#067A45";
const MIST = "#F3F6FF";
const MINT = "#EDFAF2";
const BLUSH = "#FDF2F6";
const LINE = "#E4E9F5";
const FIGTREE = "'Figtree',Arial,Helvetica,sans-serif";
const OUTFIT = "'Outfit','Figtree',Arial,Helvetica,sans-serif";
const F = `font-family:${FIGTREE};`;
const FH = `font-family:${OUTFIT};`;
const v2Button = (href: string, text: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td align="center" bgcolor="${GREEN}" style="background-color:${GREEN};border:0;border-radius:12px;mso-padding-alt:15px 18px;box-shadow:0 10px 24px -12px rgba(7,191,97,.55);"><a class="lx-button" href="${escape(href)}" style="display:block;padding:15px 18px;${F}color:${WHITE};font-size:16px;line-height:20px;font-weight:800;text-decoration:none;border-radius:12px;">${text}</a></td></tr></table>`;
/** Campaign + spot-saved only (Jo, 6 Oct): web fonts are blocked in Outlook/Gmail, so every element carries an inline
 * fallback stack close to Outfit/Figtree. The locked likely-eligible/needs-onsite emails are NOT passed through this. */
export const CAMPAIGN_HEADING_STACK = "'Outfit','Avenir Next','Avenir','Century Gothic','Segoe UI',Helvetica,Arial,sans-serif";
/** Campaign + spot-saved button: the shared bulletproof button plus an Outlook desktop VML fallback (Jo, 6 Oct v6). */
export function campaignButton(href: string, text: string, vmlWidth = 520) {
  const t = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escape(href)}" style="height:50px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="24%" stroke="f" fillcolor="${GREEN}"><w:anchorlock/><center style="color:#FFFFFF;font-family:${CAMPAIGN_HEADING_STACK.replace(/'/g, "")};font-size:16px;font-weight:bold;">${t}</center></v:roundrect><![endif]--><!--[if !mso]><!-->${v2Button(href, text)}<!--<![endif]-->`;
}
