/**
 * The real owner first-message renderers (Jo, 24 Oct 2026, decisions 66–69 and 73; applied under decision 137).
 *
 * PURE module: no database, no network, no email sending, no pricing calculation. Every outcome workflow asks the single
 * canonical selector (`selectJoTemplate`) which template applies, then renders through `renderJoOutcomeEmail`:
 *   T1/T2 (eligible, no insulation)                     → Save my spot          docs/templates/approved/O1-save-my-spot.html
 *   T3/T4 (reviewed below R2) and declared thin/patchy  → Save my spot, some    docs/templates/approved/O2-save-my-spot-some-insulation.html
 *   T5/T6 (insulation unconfirmed)                      → Insulation questions  docs/templates/approved/O2-save-my-spot-questions.html
 *   T7 (ineligible)                                     → Not eligible          docs/templates/approved/O6-not-eligible.html
 * Subjects, template ids, CTA sets, link binding and fail-closed rules are unchanged; only the body copy and
 * presentation now follow the approved designs through the shared `email-kit.core.ts`. T8 (the retired office
 * Ready Check invitation) keeps its earlier presentation.
 */
import {
  ctasForTemplate,
  INSULATION_QUESTIONS_CTA_LABEL,
  renderJoEstimateEmail,
  renderJoIneligibleEmail,
  renderJoReadyCheckInvitation,
  selectJoTemplate,
  type JoCta,
  type JoEstimateFigures,
  type JoRecipient,
  type JoRoutingInput,
  type JoTemplateId,
  type SavedPricingSnapshot,
} from "./jo-email-templates.core";
import {
  applyCampaignFonts,
  applyReadyCheckFee,
  campaignArtImg,
  campaignButton,
  escape,
  PRIVACY_URL,
  PUBLIC_CALCULATOR_URL,
  V2_THEME,
  type EstimateEmail,
} from "./estimate-email";
import { emailArtUrl } from "./email-art.core";
import { REMOVAL_UPTO_NOTE } from "./estimate-removal-upto.core";
import { CUSTOMER_BRAND } from "./customer-quote-system";
import { LOGO_PNG } from "./email-hero-assets";
import { REMOVE_ENQUIRY_HTML_SLOT, REMOVE_ENQUIRY_TEXT_SLOT } from "./emailsafety.core";
import * as K from "./email-kit.core";

/** Jo's footer link row, verbatim placeholders (T8 only; P1-S77: bound to real links, never shown as bracketed text). */
export const JO_FOOTER_LINKS_LINE = "[Contact us] · [Privacy] · [Remove my enquiry]";
export const JO_CONTACT_URL = "https://homeinsulationvictoria.com.au/contact";
/** T7 "Review my result" when the customer has no secure estimate link (ineligible jobs never keep one): the same
 *  public homeowner page the previous ineligible email used. */
export const JO_RESULT_FALLBACK_URL = "https://homeinsulationvictoria.com.au/homeowner";
/** T7 "Checking another property?" — the standalone calculator line always opens the PUBLIC calculator. */
const T7_CALCULATOR_LINE = "Open the calculator →";
/** Jo's sign-off line; it ends the last section card. */
const JO_SIGN_OFF = "Home Insulation Victoria";

/** The post-Gate-1 official outcomes this wiring understands. */
export type JoOutcome =
  | "likely_eligible"
  | "needs_onsite_confirmation"
  | "does_not_appear_eligible";

/** Normalised declared insulation, matching the repo's `insulationDeclared` / `saved_insulation` values. */
export type JoInsulation = "none" | "present" | "unknown";

/** The Office desk-check verdict stored in lead_campaign_responses.desk_check_status. */
export type JoDeskCheck = "looks_eligible" | "not_eligible" | "needs_onsite_check";

/** Everything the selector needs, and nothing it must guess. */
export type JoOutcomeFacts = {
  outcome: JoOutcome | null;
  insulation: JoInsulation | null;
  /** true only for a declared/measured ceiling size; the typical-home default is NOT a known size. */
  ceilingSizeKnown: boolean;
  /** Null/absent = NOT reviewed, which is what keeps templates 3/4 shut. */
  deskCheckStatus?: JoDeskCheck | null;
  /** Jo 22 Oct 2026: owner's website answers said existing insulation is thin or patchy (declared, not reviewed). */
  declaredThinPatchy?: boolean;
  /** Jo 23 Oct 08:14 UTC: owner described existing insulation that is not thin/loose fill. */
  declaredExisting?: boolean;
};

export const JO_OUTCOME_TEMPLATE_LABEL: Record<Exclude<JoTemplateId, "ready_check_invitation">, string> = {
  eligible_no_insulation_size_unknown: "Eligible — no insulation, size unknown",
  eligible_no_insulation_size_known: "Eligible — no insulation, size known",
  eligible_below_r2_reviewed_size_unknown: "Below R2 reviewed — size unknown",
  eligible_below_r2_reviewed_size_known: "Below R2 reviewed — size known",
  potentially_eligible_unknown_size_unknown: "Potentially eligible — size unknown",
  potentially_eligible_unknown_size_known: "Potentially eligible — size known",
  ineligible: "Ineligible",
};

/**
 * Translate the job's facts into the routing input `selectJoTemplate` expects.
 *
 * Outcome vocabulary mapping (this repo -> Jo):
 *   likely_eligible            -> "likely_eligible"
 *   needs_onsite_confirmation  -> "needs_onsite_confirmation"
 *   does_not_appear_eligible   -> "ineligible"
 * Unknown insulation is never presented as "present"; a missing size is never presented as known.
 */
export function joRoutingInputFor(facts: JoOutcomeFacts): JoRoutingInput {
  const outcome =
    facts.outcome === "does_not_appear_eligible"
      ? "ineligible"
      : facts.outcome === "needs_onsite_confirmation"
        ? "needs_onsite_confirmation"
        : facts.outcome === "likely_eligible"
          ? "likely_eligible"
          : null;
  return {
    outcome,
    insulation: facts.insulation === "none" || facts.insulation === "present" ? facts.insulation : "unknown",
    ceilingSizeKnown: facts.ceilingSizeKnown === true,
    declaredThinPatchy: facts.declaredThinPatchy === true,
    declaredExisting: facts.declaredExisting === true,
    // Explicitly absent when not a real "looks_eligible" verdict: unreviewed is never treated as reviewed.
    ...(facts.deskCheckStatus === "looks_eligible" ? { deskCheckStatus: "looks_eligible" as const } : {}),
  };
}

/**
 * The canonical selection used by every wired outcome workflow. null = no Jo customer email applies.
 *
 * Template 8 is deliberately excluded here: a Ready Check invitation is an explicit Office action with
 * its own orchestration, never a side effect of an outcome email.
 */
export function selectJoOutcomeTemplate(facts: JoOutcomeFacts): Exclude<JoTemplateId, "ready_check_invitation"> | null {
  const id = selectJoTemplate(joRoutingInputFor(facts));
  if (!id || id === "ready_check_invitation") return null;
  return id;
}

// ---------------------------------------------------------------------------
// CTA / link binding into Jo's placeholders
// ---------------------------------------------------------------------------

/** The real URLs that fill Jo's placeholders. Each is the EXISTING authorised destination. */
export type JoOutcomeLinks = {
  /** T1–T4: the existing Save-my-spot campaign page for this customer. */
  saveMySpotUrl: string;
  /** T5/T6: the existing media-upload page for this customer (never Save-my-spot). */
  uploadMediaUrl: string;
  /** T7: the existing result page for this customer. */
  reviewResultUrl: string;
  /** The customer's own estimate page, used for "Open the calculator →". */
  calculatorUrl: string;
};

export type JoOutcomeEmailInput = JoOutcomeFacts & {
  recipient: JoRecipient;
  /** Templates 1–6 only; ignored for T7. */
  figures?: JoEstimateFigures;
  /** T7 only: the ineligibility reasons shown to the customer. */
  reason?: string | null;
  links: JoOutcomeLinks;
  /**
   * Preview-only safe artwork source. When set (Office Templates preview), the header renders this
   * image — which draws the SAME campaign artwork as a real send — without needing a real customer
   * estimate token. The live send path never sets this, so it is unaffected.
   */
  previewArtSrc?: string | null;
  /** Historical input only: Ready Check is free and Jo's copy stays untouched. */
  readyCheckFeeIncGst?: number | null;
  /** "current" = new-version cohort: adds the ex/inc GST supply rate wording. */
  pricingCohort?: "pre_cutover" | "legacy_saved_spot" | "current";
  installationRatePerM2?: number | null;
  /** Received-media acknowledgement (Office first reply and the automatic Group B initial for media already received). */
  mediaAlreadyReceived?: boolean;
  /** Jo 23 Oct 2026 "Tell us about your insulation" campaign (T5/T6 variant, draft wording). */
  insulationQuestions?: boolean;
};

export type JoWiredEmail = EstimateEmail & {
  templateId: Exclude<JoTemplateId, "ready_check_invitation">;
  ctas: JoCta[];
};

/** Sentinel wrapping a substituted CTA so the block renderer can turn it into a button/link. */
const S = "\u0001";
const ctaToken = (kind: "cta" | "link", href: string, label: string) => `${S}${kind}|${href}|${label}${S}`;
/** A whole line that is exactly one token, and a token embedded inside a sentence. */
const TOKEN_LINE = new RegExp(`^\\u0001(cta|link)\\|([^|]+)\\|(.+)\\u0001$`);
const TOKEN_INLINE = new RegExp(`\\u0001(cta|link)\\|([^|]+)\\|(.+?)\\u0001`);

/** Jo's placeholder per CTA, in the exact wording of her copy. */
const PLACEHOLDER: Record<JoCta, string> = {
  save_my_spot: "[Save my spot →]",
  upload_media: "[Tell us about your insulation]",
  review_result: "[Review my result →]",
  book_ready_check: "[Book my Ready Check →]",
};
const CALCULATOR_LINE = "Want to explore a different ceiling size? Open the calculator →";

/**
 * Bind Jo's placeholders to the real, authorised URLs for this customer.
 * A CTA whose URL is missing is left unsubstituted so the renderer can throw rather than send a dead button.
 */
function bindLinks(body: string, links: JoOutcomeLinks, ctas: JoCta[]): string {
  let out = body;
  for (const cta of ctas) {
    const url =
      cta === "save_my_spot" ? links.saveMySpotUrl
        : cta === "upload_media" ? links.uploadMediaUrl
          : cta === "review_result" ? links.reviewResultUrl
            : null;
    if (!url) continue;
    const label = PLACEHOLDER[cta].slice(1, -1);
    out = out.split(PLACEHOLDER[cta]).join(ctaToken("cta", url, label));
  }
  // T7: the standalone "Open the calculator →" line is for ANOTHER property, so it opens the public calculator.
  out = out.split("\n").map((l) => (l.trim() === T7_CALCULATOR_LINE ? ctaToken("link", PUBLIC_CALCULATOR_URL, T7_CALCULATOR_LINE) : l)).join("\n");
  // T1–T6 leave the calculator as plain sentence text; T8 already carries its own link.
  if (out.includes(CALCULATOR_LINE) && links.calculatorUrl) {
    out = out.split(CALCULATOR_LINE).join(
      `Want to explore a different ceiling size? ${ctaToken("link", links.calculatorUrl, "Open the calculator →")}`,
    );
  }
  return out;
}

function missingCta(ctas: JoCta[], body: string): JoCta | null {
  for (const cta of ctas) {
    if (body.includes(PLACEHOLDER[cta])) return cta;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Jo copy -> the existing approved email shell
// ---------------------------------------------------------------------------

const MIST = "#F3F6FF";
const LINE = "#E4E9F5";
const INK = "#22376B";
const F = "font-family:'Figtree',Arial,Helvetica,sans-serif;";
const FH = "font-family:'Outfit','Figtree',Arial,Helvetica,sans-serif;";

const inline = (s: string) =>
  escape(s)
    // Inline link/button tokens have already been emitted as raw HTML by the block renderer.
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/** Convert Jo's markdown subset (### headings, |tables|, **bold**, CTA tokens) to HTML blocks. */
function joBodyToHtml(body: string): string {
  const lines = body.split("\n");
  const blocks: string[] = [];
  let i = 0;
  // Presentation only: the short line directly after "Hi {name}," is the template's headline.
  // The copy is untouched; long T7 sentences stay body text.
  let heroNext = false;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim();
      i++;
      // P1-S77: Jo separates a heading from its content with a blank line, so the section's content (table,
      // paragraphs, CTA) is collected up to the next heading or the sign-off — the card is never an empty box.
      const content: string[] = [];
      while (i < lines.length && !lines[i]!.startsWith("### ") && lines[i]!.trim() !== JO_SIGN_OFF && lines[i]!.trim() !== JO_FOOTER_LINKS_LINE) {
        if (lines[i]!.trim()) content.push(lines[i]!);
        i++;
      }
      // Approved Save my spot look (presentation only, Jo's words unchanged): the quote section becomes the
      // rebate box + big price + ticked "What this includes" card; action sections use the pink card.
      if (/preliminary quote$/i.test(heading)) {
        let includes: string[] | null = null;
        if (i < lines.length && lines[i]!.startsWith("### What this includes")) {
          i++;
          includes = [];
          while (i < lines.length && !lines[i]!.startsWith("### ") && lines[i]!.trim() !== JO_SIGN_OFF) {
            if (lines[i]!.trim()) includes.push(lines[i]!);
            i++;
          }
        }
        blocks.push(quoteCardHtml(content, includes));
        continue;
      }
      if (heading === "What this includes") {
        blocks.push(quoteCardHtml([], content));
        continue;
      }
      const action = content.some((l) => TOKEN_LINE.exec(l)?.[1] === "cta");
      blocks.push(sectionCardHtml(heading, content, action));
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) rows.push(lines[i++]!);
      blocks.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MIST}" style="width:100%;border-collapse:separate;background-color:${MIST};border-radius:16px;"><tr><td style="padding:17px 18px;${F}">${tableHtml(rows)}</td></tr></table>`);
      continue;
    }
    const greeting = /^Hi\b.*,$/.test(line.trim());
    if (heroNext) {
      heroNext = false;
      if (!greeting && line.trim().length <= 70) {
        blocks.push(heroHtml(line));
        i++;
        continue;
      }
    }
    blocks.push(paragraphHtml(line));
    if (greeting) heroNext = true;
    i++;
  }
  return blocks.join("");
}

// ---------------------------------------------------------------------------
// Shared Spot-Saved visual system
// ---------------------------------------------------------------------------
//
// Jo's T1–T8 keep her approved COPY verbatim; only the presentation is shared with the existing
// Spot Saved email: the same 640px rounded shell, logo header, Outfit/Figtree stacks, green
// button, white footer row and mobile rules. No Spot Saved confirmation wording is added.

/** Footer entity line, exactly as Jo's approved footer already states it. */
const JO_ENTITY = "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria";

/**
 * Header: the SAME composition the existing Spot Saved email uses — the per-owner campaign art
 * image (logo + caps line + headline drawn into one image) rendered by `campaignArtImg`.
 *
 * We deliberately do NOT use the `V2_THEME.header` logo+badge arrangement Jo rejected.
 *
 * The art endpoint only draws a rebate headline when the job has a current estimate, so the
 * ineligible template (no estimate / no rebate) falls back to the identical logo on its own.
 */
const JO_LOGO_HEADER = `<tr><td class="lx-pad" style="padding:22px 36px 2px;"><img class="lx-logo hiv-logo" src="data:image/png;base64,${LOGO_PNG}" alt="Home Insulation Victoria" width="142" height="61" style="display:block;width:142px;height:auto;max-width:100%;border:0;"></td></tr>`;

/** The origin + estimate token from a customer estimate URL (`/estimate/{token}` or `/my-estimate/{token}`). */
function originAndToken(url: string | null | undefined): { origin: string; token: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const at = parts.findIndex((p) => p === "estimate" || p === "my-estimate");
    const token = at >= 0 ? parts[at + 1] : undefined;
    return token ? { origin: u.origin, token } : null;
  } catch {
    return null;
  }
}

/** Spot Saved's header art row for this customer, or the plain logo when no rebate art applies.
 *  `previewArtSrc` (Office preview only) lets the same artwork render without a real token. */
function joHeader(url: string | null | undefined, kind: "headline" | "spot", alt: string, previewArtSrc?: string | null): string {
  if (previewArtSrc) return campaignArtImg(previewArtSrc, alt);
  const ot = originAndToken(url);
  return ot ? campaignArtImg(emailArtUrl(ot.origin, ot.token, kind), alt) : JO_LOGO_HEADER;
}

/** Jo's first heading, verbatim, as the header image's accessible/fallback text. */
function firstHeadline(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line === JO_SIGN_OFF || line === JO_FOOTER_LINKS_LINE) continue;
    if (line.startsWith("### ")) return line.slice(4).trim();
    const plain = line.replace(new RegExp(TOKEN_INLINE.source, "g"), "$3").replace(/\*\*/g, "").trim();
    if (plain) return plain;
  }
  return "Home Insulation Victoria";
}

/**
 * Jo's body ends with the approved sign-off block (entity, reference, footer links). Split it out so
 * the identical words render once, inside the branded footer row — never duplicated in the body.
 */
function splitJoFooter(body: string): { content: string; reference: string | null } {
  const marker = `\n\n${JO_SIGN_OFF}\n\n`;
  const at = body.lastIndexOf(marker);
  if (at < 0) return { content: body, reference: null };
  const tail = body.slice(at + marker.length).split("\n");
  const refLine = tail.find((l) => l.startsWith("Reference: "));
  return {
    content: body.slice(0, at),
    reference: refLine ? refLine.slice("Reference: ".length).trim() : null,
  };
}

/** Branded footer row: Jo's existing entity, links and reference, styled like Spot Saved. */
function joFooterHtml(reference: string | null): string {
  const a = (href: string, label: string) =>
    `<a href="${escape(href)}" style="color:#3C51C4;text-decoration:underline;">${escape(label)}</a>`;
  return [
    `<p style="margin:0 0 5px;${FH}color:${INK};font-size:14px;line-height:1.4;font-weight:800;text-align:center;">${escape(JO_SIGN_OFF)}</p>`,
    `<p style="margin:0 0 9px;${F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;">${escape(JO_ENTITY)}</p>`,
    `<p style="margin:0;${F}color:${INK};font-size:12px;line-height:1.6;text-align:center;">${a(JO_CONTACT_URL, "Contact us")} · ${a(PRIVACY_URL, "Privacy")} · ${REMOVE_ENQUIRY_HTML_SLOT}</p>`,
    reference
      ? `<p style="margin:7px 0 0;${F}color:#5A6785;font-size:10.5px;line-height:1.4;text-align:center;">Reference: ${escape(reference)}</p>`
      : "",
  ].join("");
}

/** Wrap rendered content in the same shell the Spot Saved email uses. `pixel` stays null (unchanged). */
function joShell(header: string, subject: string, content: string, reference: string | null): string {
  const body = `<tr><td class="lx-pad" style="padding:10px 36px 26px;${F}">${content}</td></tr>`;
  return applyCampaignFonts(
    V2_THEME.shell(`${header}${body}${V2_THEME.footerRow(joFooterHtml(reference))}`, subject, null),
  );
}

/** The short line after the greeting, styled as the template headline (copy unchanged). */
function heroHtml(line: string): string {
  return `<p class="lx-h1" style="margin:0 0 12px;${FH}color:${INK};font-size:26px;line-height:1.25;font-weight:800;">${inline(line)}</p>`;
}

/** A CTA token line becomes the shared approved button; anything else is a paragraph. */
function paragraphHtml(line: string): string {
  const whole = TOKEN_LINE.exec(line);
  if (whole) {
    const [, kind, href, label] = whole;
    if (kind === "cta") return `<div style="padding:6px 0;">${campaignButton(href!, label!)}</div>`;
    return `<p style="margin:0;${F}color:${INK};font-size:14px;line-height:1.55;text-align:center;"><a href="${escape(href!)}" style="color:#2F6BFF;font-weight:800;text-decoration:underline;">${escape(label!)}</a></p>`;
  }
  // A sentence that also carries an inline calculator link.
  const m = new RegExp(`^(.*?)${TOKEN_INLINE.source}`).exec(line);
  if (m) {
    return `<p style="margin:0;${F}color:${INK};font-size:14px;line-height:1.55;text-align:center;">${inline(m[1]!)} <a href="${escape(m[3]!)}" style="color:#2F6BFF;font-weight:800;text-decoration:underline;">${escape(m[4]!)}</a></p>`;
  }
  // The headline saving figure gets the branded amount treatment (same copy, different presentation).
  if (/^\*\*(You could save|Potential VEU rebate):? .+\*\*$/.test(line)) {
    return `<p style="margin:4px 0 8px;${FH}color:${INK};font-size:24px;line-height:1.25;font-weight:800;">${inline(line)}</p>`;
  }
  return `<p style="margin:0 0 8px;${F}color:${INK};font-size:15px;line-height:1.6;">${inline(line)}</p>`;
}

// --- Approved Save my spot presentation (same look as the locked Save your spot email) ---------------
const BRAND_GREEN = CUSTOMER_BRAND.colors.green;
const BRAND_BLUE = CUSTOMER_BRAND.colors.blue;
const MINT = "#EDFAF2";
const BLUSH = "#FDF2F6";
const WHITE = "#FFFFFF";
const CAPS = `${F}color:${INK};font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;`;
const card = (bg: string, inner: string, radius = 20) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="width:100%;border-collapse:separate;background-color:${bg};border-radius:${radius}px;"><tr><td class="lx-result-pad" style="padding:22px 20px;${F}">${inner}</td></tr></table>`;
const spacer = `<div style="height:16px;line-height:16px;font-size:1px;">&nbsp;</div>`;

/** A titled section card; action sections (with a main button) use the pink Save your spot card. */
function sectionCardHtml(heading: string, content: string[], action: boolean): string {
  const inner: string[] = [`<p style="margin:0 0 12px;${FH}color:${INK};font-size:22px;line-height:1.25;font-weight:800;">${escape(heading)}</p>`];
  for (let k = 0; k < content.length; k++) {
    const l = content[k]!;
    if (l.startsWith("|")) {
      const rows: string[] = [];
      while (k < content.length && content[k]!.startsWith("|")) rows.push(content[k++]!);
      k--;
      inner.push(tableHtml(rows));
      continue;
    }
    inner.push(paragraphHtml(l));
  }
  return `${spacer}${card(action ? BLUSH : MIST, inner.join(""))}`;
}

const QUOTE_REBATE = /^\*\*(You could save|Potential VEU rebate):? (.+)\*\*$/;
const QUOTE_COST = /^(Your estimated cost after rebate|Estimated cost if eligible|Your estimated cost): (\$[\d,]+) including GST$/;
const QUOTE_BEFORE = /^Before rebate: (\$[\d,]+) including GST$/;
const QUOTE_FACT = /^(Property|Ceiling size): (.+)$/;
const QUOTE_REMOVAL = /^Removal of old insulation, only if needed: \$0 – \$[\d,]+$/;
const QUOTE_RANGE = /^Your price: \$[\d,]+ – \$[\d,]+$/;

/** Jo's "Your preliminary quote" + "What this includes" in the approved rebate box / price / ticked list layout. */
function quoteCardHtml(content: string[], includes: string[] | null): string {
  let rebate = "";
  let cost = "";
  const facts: string[] = [];
  const rest: string[] = [];
  let before: string | null = null;
  let costLabel = "";
  let removalLine: string | null = null;
  let removalNoteSeen = false;
  let rangeLine: string | null = null;
  for (const l of content) {
    const r = QUOTE_REBATE.exec(l);
    if (r) {
      const label = r[1] === "You could save" ? "Your estimated VEU rebate" : r[1]!;
      const big = r[1] === "You could save" ? `You could save ${r[2]}` : r[2]!;
      rebate = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MINT}" style="width:100%;border-collapse:separate;background-color:${MINT};border:2px solid ${BRAND_GREEN};border-radius:18px;"><tr><td align="center" style="padding:18px 12px;${F}"><p style="margin:0;${CAPS}">${escape(label)}</p><p class="lx-saving" style="margin:5px 0 0;${FH}color:${BRAND_GREEN};font-size:38px;line-height:42px;mso-line-height-rule:exactly;font-weight:800;">${escape(big)}</p></td></tr></table>`;
      continue;
    }
    const c = QUOTE_COST.exec(l);
    if (c) { costLabel = c[1]!; cost = c[2]!; continue; }
    const b = QUOTE_BEFORE.exec(l);
    if (b) { before = b[1]!; continue; }
    if (QUOTE_REMOVAL.test(l)) { removalLine = l; continue; }
    if (l === REMOVAL_UPTO_NOTE) { removalNoteSeen = true; continue; }
    if (QUOTE_RANGE.test(l)) { rangeLine = l; continue; }
    const f = QUOTE_FACT.exec(l);
    if (f) {
      const label = f[1] === "Ceiling size" ? "Ceiling" : f[1]!;
      facts.push(`<tr><td valign="top" style="padding:4px 0;${F}color:${INK};font-size:13px;">${escape(label)}</td><td align="right" style="padding:4px 0 4px 12px;${F}color:${INK};font-size:13px;font-weight:800;">${escape(f[2]!)}</td></tr>`);
      continue;
    }
    rest.push(l);
  }
  const removalBox = removalLine
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BLUSH}" style="width:100%;margin:0 0 12px;border-collapse:separate;background-color:${BLUSH};border:1px solid ${LINE};border-radius:14px;"><tr><td style="padding:12px 16px;${F}"><p style="margin:0;${F}color:${INK};font-size:14px;line-height:1.4;font-weight:600;">${escape(removalLine)}</p>${removalNoteSeen ? `<p style="margin:6px 0 0;${F}color:${INK};font-size:13px;line-height:1.5;">${escape(REMOVAL_UPTO_NOTE)}</p>` : ""}${rangeLine ? `<p style="margin:8px 0 0;${F}color:${INK};font-size:15px;line-height:1.4;font-weight:800;">${escape(rangeLine)}</p>` : ""}</td></tr></table>`
    : "";
  const price = cost
    ? `<div style="text-align:center;padding:18px 0 12px;"><p style="margin:0;${CAPS}">${escape(costLabel)}</p><p class="lx-cost" style="margin:5px 0 0;${FH}color:${BRAND_BLUE};font-size:46px;line-height:50px;mso-line-height-rule:exactly;font-weight:800;">${escape(cost)}</p><p style="margin:4px 0 0;${F}color:${INK};font-size:12px;line-height:1.4;font-weight:700;">incl. GST${before ? ` · before rebate ${escape(before)}` : ""}</p></div>${removalBox}`
    : "";
  const factTable = facts.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid ${LINE};">${facts.join("")}</table>`
    : "";
  const notes = rest.map((l) => {
    const p = paragraphHtml(l);
    return p.replace("margin:0 0 8px;", "margin:12px 0 0;").replace("font-size:15px;", "font-size:14px;");
  }).join("");
  const tick = `<span aria-hidden="true" style="white-space:nowrap;color:${BRAND_GREEN};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1;">✓&nbsp;</span>`;
  let itemised = "";
  if (includes) {
    const cells = (r: string) => r.split("|").slice(1, -1).map((x) => x.trim());
    const rows = includes.filter((l) => l.startsWith("|")).slice(2).map(cells);
    const items = rows.map(([item = "", amount = ""], idx) => {
      const [title, ...desc] = item.split(" — ");
      const top = idx === 0 ? "" : `border-top:1px solid ${LINE};`;
      const amt = /^free$/i.test(amount) ? `<span style="color:${BRAND_GREEN};font-weight:800;">FREE</span>` : escape(amount);
      const description = desc.length ? desc.join(" — ") : "";
      return `<tr><td valign="top" style="padding:8px 12px ${description ? "2px" : "8px"} 0;${top}${F}color:${INK};font-size:14px;line-height:1.45;">${tick}<strong style="font-size:14px;">${escape(title!)}</strong></td><td class="lx-row-amt" width="96" align="right" valign="top" style="width:96px;padding:8px 0 2px;${top}${F}color:${INK};font-size:14px;line-height:1.45;font-weight:700;white-space:nowrap;">${amt}</td></tr>${description ? `<tr><td colspan="2" style="padding:0 0 8px;${F}color:${INK};font-size:12.5px;line-height:1.45;">${escape(description.charAt(0).toUpperCase() + description.slice(1))}</td></tr>` : ""}`;
    }).join("");
    itemised = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;margin-top:14px;border-collapse:separate;background-color:${WHITE};border-radius:14px;"><tr><td style="padding:15px 16px;${F}"><p style="margin:0 0 6px;${FH}color:${INK};font-size:14px;line-height:1.3;font-weight:800;">What this includes</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${items}</table></td></tr></table>`;
  }
  return `${spacer}${card(MIST, `${rebate}${price}${factTable}${notes}${itemised}`, 22)}`;
}

function tableHtml(rows: string[]): string {
  const cells = (r: string) => r.split("|").slice(1, -1).map((c) => c.trim());
  if (!rows.length) return "";
  const header = cells(rows[0]!);
  // rows[1] is Jo's "|---|" separator.
  const body = rows.slice(2);
  const head = `<tr>${header.map((h, idx) => `<th align="${idx === 0 ? "left" : "right"}" style="padding:6px 0;${F}color:${INK};font-size:13px;font-weight:800;border-bottom:1px solid ${LINE};">${escape(h)}</th>`).join("")}</tr>`;
  const trs = body.map((r) => {
    const c = cells(r);
    return `<tr>${c.map((v, idx) => `<td align="${idx === 0 ? "left" : "right"}" style="padding:7px 0;${F}color:${INK};font-size:14px;line-height:1.45;${idx === 0 ? "" : "font-weight:700;white-space:nowrap;"}">${escape(v)}</td>`).join("")}</tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${head}${trs}</table>`;
}

/**
 * Render the Jo-approved email for this outcome.
 *
 * Returns null (fail closed) when no Jo template applies, so the caller can keep its existing
 * behaviour instead of sending an email Jo has not approved. Throws when a required CTA URL or
 * a complete pricing figure is missing — a half-built email is never delivered.
 */
export function renderJoOutcomeEmail(input: JoOutcomeEmailInput): JoWiredEmail | null {
  const id = selectJoOutcomeTemplate(input);
  if (!id) return null;

  if (id === "ineligible") {
    const rendered = renderJoIneligibleEmail(input.recipient, (input.reason ?? "").trim() || INELIGIBLE_FALLBACK_REASON);
    const body = bindLinks(rendered.body, input.links, rendered.ctas);
    const missing = missingCta(rendered.ctas, body);
    if (missing) throw new Error(`The ${missing} link is missing for this customer; nothing was prepared.`);
    return finish(id, rendered.ctas, input, renderNotEligible(input, rendered.subject));
  }

  if (!input.figures) throw new Error("Templates 1–6 require the job's estimate figures; none were supplied.");
  const questions = input.insulationQuestions === true;
  const unconfirmed = id === "potentially_eligible_unknown_size_unknown" || id === "potentially_eligible_unknown_size_known";
  if (questions && !unconfirmed) throw new Error("The insulation questions email only applies to unconfirmed insulation.");
  const received = input.mediaAlreadyReceived === true;
  if (received && !unconfirmed) throw new Error("Received-media acknowledgement requires an unreviewed insulation estimate.");
  // Subject + CTA set come from the existing template rules (unchanged); the missing-link check still fails closed.
  const rendered = renderJoEstimateEmail(id, input.recipient, input.figures, { declaredThinPatchy: input.declaredThinPatchy === true, declaredExisting: input.declaredExisting === true, insulationQuestions: questions });
  const ctas = rendered.ctas;
  const missing = missingCta(ctas, bindLinks(rendered.body, input.links, ctas));
  if (missing) throw new Error(`The ${missing} link is missing for this customer; nothing was prepared.`);
  const someInsulation = id === "eligible_below_r2_reviewed_size_unknown" || id === "eligible_below_r2_reviewed_size_known" || input.declaredThinPatchy === true || input.declaredExisting === true;
  const variant: SaveSpotVariant = unconfirmed ? (received ? "received" : "questions") : someInsulation ? "some" : "none";
  return finish(id, ctas, input, renderSaveMySpot(input, input.figures, variant, rendered.subject));
}

function finish(id: Exclude<JoTemplateId, "ready_check_invitation">, ctas: JoCta[], input: JoOutcomeEmailInput, mail: EstimateEmail): JoWiredEmail {
  const withFee = applyReadyCheckFee(mail, {
    readyCheckFeeIncGst: input.readyCheckFeeIncGst ?? null,
    ...(input.pricingCohort ? { pricingCohort: input.pricingCohort } : {}),
    ...(input.installationRatePerM2 == null ? {} : { installationRatePerM2: input.installationRatePerM2 }),
  }, false);
  return { ...withFee, templateId: id, ctas };
}

// ---------------------------------------------------------------------------
// Approved designs (decisions 66–69, 73) through the shared kit
// ---------------------------------------------------------------------------
type SaveSpotVariant = "none" | "some" | "questions" | "received";

/** Decision 67: the removal card's rate and "up to" figure. The informational `removalUpTo` (current rate × area) wins;
 *  without it the approved $15/m² figure applies. Never part of any total. */
function removalCard(f: JoEstimateFigures): { ratePerM2: number; upTo: number } {
  const area = f.ceilingAreaM2 > 0 ? f.ceilingAreaM2 : 0;
  if (f.removalUpTo != null && f.removalUpTo > 0 && area > 0) return { ratePerM2: Math.round(f.removalUpTo / area), upTo: f.removalUpTo };
  return { ratePerM2: 15, upTo: 15 * area };
}

/** "Based on what you told us: 137 m² ceiling, no existing insulation." — a typical-size estimate is never called the owner's size. */
export function basisLine(f: JoEstimateFigures, someInsulation: boolean): string {
  const ins = someInsulation ? "with some existing insulation" : "no existing insulation";
  return f.areaEstimated
    ? `Based on a typical ${K.m2(f.ceilingAreaM2)} ceiling (estimated, not measured), ${ins}.`
    : `Based on what you told us: ${K.m2(f.ceilingAreaM2)} ceiling, ${ins}.`;
}

const O1_INTRO = "This is the Victorian Government's Energy Upgrades (VEU) rebate, taken straight off your price. To claim it, you need a certified installer, a licensed electrician and an accredited provider. We bring them all together and organise the whole job for you.";
const O2_INTRO = "You told us there's some insulation in your ceiling already. If it's thin or patchy (below R2.0), you can still get the Victorian Government's Energy Upgrades (VEU) rebate. We bring together the certified installer, licensed electrician and accredited provider you need, and organise the whole job.";
const O1_SAVE = "Certified installers are in high demand, so we book homes in the order people save their spot. When one is free near you, they'll offer you times for your free Ready Check. No payment, no obligation.";
const O2_SAVE = "Certified installers are in high demand, so we book homes in the order people save their spot. When one is free near you, they'll offer you times for your free Ready Check, where they'll also check your existing insulation. No payment, no obligation.";
const O2Q_SAVE = "Certified installers are in high demand, so we book homes in the order people save their spot. Tell us about your insulation and your spot is saved straight away. Just tap, no typing.";
const O2Q_PHOTOS = "Got photos or a video? You can add them too, only if it's safe. Please don't climb into the roof space.";
const RECEIVED_ACK = "Thank you for sending your photos or video. We already have your media — you do not need to upload it again. Our Office will review it and contact you about the next step. Final eligibility will be confirmed at your free Ready Check. If you want or need to add more evidence, you can optionally add multiple photos and/or videos using the link below.";
const RECEIVED_SAFETY = "Only take photos or video if you can do so safely, and don’t enter the roof space.";
const O2_CLOSING = "If your existing insulation is already R2.0 or above, the rebate isn't available and we'll let you know. We check all of this at your free Ready Check and tell you the exact price before you agree to anything.";
const O1_CLOSING = "We check these at your free Ready Check and tell you the exact price before you agree to anything.";
export const QUESTIONS = [
  { title: "What type is it?", detail: "Loose fill or batts" },
  { title: "About how thick is it?", detail: "Less than a finger, a hand's width, or thicker" },
  { title: "When was your home built?", detail: "Pick a decade" },
];

function renderSaveMySpot(input: JoOutcomeEmailInput, f: JoEstimateFigures, variant: SaveSpotVariant, subject: string): EstimateEmail {
  const first = input.recipient.firstName;
  const some = variant !== "none";
  const rebate = K.whole(f.veuRebate), price = K.whole(f.customerTotal), full = K.whole(f.totalBeforeRebate);
  const headline = some ? `${first}, you may qualify for ${rebate} off ceiling insulation` : `${first}, you could save ${rebate} on ceiling insulation`;
  const basis = basisLine(f, some);
  const calc = input.links.calculatorUrl ? { href: input.links.calculatorUrl, label: "Try a different ceiling size" } : null;
  const removal = removalCard(f);
  const saveUrl = input.links.saveMySpotUrl, answerUrl = input.links.uploadMediaUrl;
  const action = variant === "questions"
    ? `${K.sectionTitle("Save your spot: answer 3 quick questions", "22px 0 6px")}${K.p(O2Q_SAVE, "0 0 10px")}${K.questionList(QUESTIONS)}${K.button(answerUrl, INSULATION_QUESTIONS_CTA_LABEL)}${K.small(O2Q_PHOTOS, "8px 0 0", { center: true })}`
    : variant === "received"
      ? `${K.sectionTitle("Thanks for your photos or video", "22px 0 6px")}${K.p(RECEIVED_ACK, "0 0 4px")}${K.button(answerUrl, "Add more photos or video")}${K.small(RECEIVED_SAFETY, "8px 0 0", { center: true })}`
      : `${K.sectionTitle("Save your spot, it's free", "22px 0 6px")}${K.p(some ? O2_SAVE : O1_SAVE, "0 0 4px")}${K.button(saveUrl, "Save my free spot")}`;
  const body = [
    K.h1(headline),
    K.p(some ? O2_INTRO : O1_INTRO),
    K.priceBox({ rebateLabel: some ? "Your potential VEU rebate" : "Your estimated VEU rebate", rebate: f.veuRebate, priceLabel: some ? "Your cost if eligible" : "You pay after the rebate", price, fullPrice: full, basis, calculator: calc }),
    some ? K.existingInsulationCard({ areaM2: f.ceilingAreaM2, ratePerM2: removal.ratePerM2, upTo: removal.upTo }) : "",
    action,
    K.spacer(8),
    K.includedAndNotIncluded({ price: f.customerTotal, rebate: f.veuRebate, someInsulation: some, closing: some ? O2_CLOSING : O1_CLOSING, seeEstimate: input.links.reviewResultUrl || null }),
  ].join("\n");
  const html = K.emailShell({ body, previewText: subject, unsubscribe: "slot" });
  const plainText = K.plainText([
    headline, "",
    some ? O2_INTRO : O1_INTRO, "",
    some ? "YOUR POTENTIAL VEU REBATE" : "YOUR ESTIMATED VEU REBATE",
    `You save ${rebate}`,
    `${some ? "Your cost if eligible" : "You pay after the rebate"}: ${price} incl. GST (full price before rebate ${full})`,
    basis,
    calc ? `Try a different ceiling size: ${calc.href}` : null, "",
    ...(some ? ["YOUR EXISTING INSULATION", "Good news: it may be able to stay.", "✓ If it can stay: $0. New batts go straight over the top.", `+ If some needs removing: $${removal.ratePerM2}/m², only the areas that need it. Up to ${K.whole(removal.upTo)} for your ${K.m2(f.ceilingAreaM2)} ceiling.`, "Prices incl. GST. The installer checks this at your free Ready Check, and you'll know the exact cost before you agree to anything.", ""] : []),
    ...(variant === "questions"
      ? ["SAVE YOUR SPOT: ANSWER 3 QUICK QUESTIONS", O2Q_SAVE, ...QUESTIONS.map((q, n) => `${n + 1}. ${q.title} (${q.detail})`), `${INSULATION_QUESTIONS_CTA_LABEL}: ${answerUrl}`, O2Q_PHOTOS]
      : variant === "received"
        ? ["THANKS FOR YOUR PHOTOS OR VIDEO", RECEIVED_ACK, `Add more photos or video: ${answerUrl}`, RECEIVED_SAFETY]
        : ["SAVE YOUR SPOT, IT'S FREE", some ? O2_SAVE : O1_SAVE, `Save my free spot: ${saveUrl}`]),
    "",
    ...K.includedAndNotIncludedText({ price: f.customerTotal, rebate: f.veuRebate, someInsulation: some, closing: some ? O2_CLOSING : O1_CLOSING }),
    input.links.reviewResultUrl ? `See your full estimate: ${input.links.reviewResultUrl}` : null,
    "", `Reference: ${input.recipient.enquiryReference}`,
  ]) + `\nUnsubscribe: ${REMOVE_ENQUIRY_TEXT_SLOT}`;
  return { subject, previewText: subject, html, plainText };
}

const O6_INTRO = "Thanks for checking with us. Based on what you told us, your home doesn't qualify for the VEU ceiling insulation rebate at the moment. We'd rather tell you now than waste your time.";
const O6_RECHECK = "If any of your details were wrong, for example your ceiling size or the insulation you have, check your result and let us know. We'll take another look.";

/** Decision 73: "{First}, your ceiling insulation result" with the Why box, Review my result and the friend card. */
function renderNotEligible(input: JoOutcomeEmailInput, subject: string): EstimateEmail {
  const first = input.recipient.firstName;
  const reason = (input.reason ?? "").trim() || INELIGIBLE_FALLBACK_REASON;
  const headline = `${first}, your ceiling insulation result`;
  const body = [
    K.h1(headline),
    K.p(O6_INTRO),
    K.mistBox("Why", `<div style="font-size:15px;line-height:1.55;color:${K.KIT.NAVY};">${K.esc(reason)}</div>`),
    K.sectionTitle("Something doesn't look right?", "22px 0 6px"),
    K.p(O6_RECHECK, "0 0 4px"),
    K.button(input.links.reviewResultUrl, "Review my result"),
    // "Send to a friend" opens the public eligibility checker (no customer data in the link).
    K.friendCard(PUBLIC_CALCULATOR_URL, "eligibility"),
  ].join("\n");
  const html = K.emailShell({ body, previewText: subject, unsubscribe: "slot" });
  const plainText = K.plainText([
    headline, "", O6_INTRO, "", "WHY", reason, "", "SOMETHING DOESN'T LOOK RIGHT?", O6_RECHECK, `Review my result: ${input.links.reviewResultUrl}`, "",
    "Know someone thinking about insulation? They can check their own eligibility in about a minute.", `Send to a friend: ${PUBLIC_CALCULATOR_URL}`, "",
    `Reference: ${input.recipient.enquiryReference}`,
  ]) + `\nUnsubscribe: ${REMOVE_ENQUIRY_TEXT_SLOT}`;
  return { subject, previewText: subject, html, plainText };
}


export const INELIGIBLE_FALLBACK_REASON =
  "Based on the details provided, the property doesn’t meet the current requirements for a VEU ceiling insulation rebate.";

/**
 * P1-R3-S92 (GAP-2): wrap the EXISTING Template 8 renderer for delivery.
 *
 * The copy, the saved pricing and both CTAs all come from `renderJoReadyCheckInvitation()`. This function
 * only turns Jo's markdown links into the existing approved button/link markup — it never recalculates,
 * never substitutes the public calculator and never changes the personal-estimate or booking URLs.
 * The booking CTA keeps the customer on the EXISTING /estimate/{token} workflow, which never auto-books.
 */
export function renderJoReadyCheckInvitationEmail(recipient: JoRecipient, snapshot: SavedPricingSnapshot, previewArtSrc?: string | null): JoT8Email {
  const rendered = renderJoReadyCheckInvitation(recipient, snapshot);
  let body = rendered.body;
  // Jo leaves the two CTAs as markdown links carrying the customer's own URLs.
  body = body.replace(
    /\[Book my Ready Check →\]\(([^)]+)\)/g,
    (_m, href: string) => ctaToken("cta", href, "Book my Ready Check →"),
  );
  body = body.replace(
    /\[Open the calculator →\]\(([^)]+)\)/g,
    (_m, href: string) => ctaToken("link", href, "Open the calculator →"),
  );
  if (missingCta(rendered.ctas, body)) throw new Error("The Ready Check booking link is missing for this customer; nothing was prepared.");
  const { content, reference } = splitJoFooter(body);
  return {
    templateId: "ready_check_invitation",
    ctas: rendered.ctas,
    subject: rendered.subject,
    previewText: rendered.subject,
    html: joShell(
      joHeader(snapshot.personalEstimateUrl, "spot", firstHeadline(content), previewArtSrc),
      rendered.subject,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td style="${F}">${joBodyToHtml(content)}</td></tr></table>`,
      reference,
    ),
    plainText: plainTextOf(body),
  };
}

export type JoT8Email = EstimateEmail & { templateId: "ready_check_invitation"; ctas: JoCta[] };

function plainTextOf(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === JO_FOOTER_LINKS_LINE) { out.push(`Contact us: ${JO_CONTACT_URL} · Privacy: ${PRIVACY_URL} · Remove my enquiry: ${REMOVE_ENQUIRY_TEXT_SLOT}`); continue; }
    const whole = TOKEN_LINE.exec(line);
    if (whole) { out.push(`${whole[3]!}: ${whole[2]!}`); continue; }
    if (/^\|\s*-+[-\s|]*\|$/.test(line)) continue; // Jo's |---| separator
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      out.push(cells.join(" — "));
      continue;
    }
    const heading = line.startsWith("### ") ? line.slice(4).trim() : line;
    out.push(
      heading
        .replace(new RegExp(TOKEN_INLINE.source, "g"), (_m, _kind, href, label) => `${label}: ${href}`)
        .replace(/\*\*(.+?)\*\*/g, "$1"),
    );
  }
  return out.join("\n");
}

export { ctasForTemplate };

/**
 * P1-S77: the Office "Save my spot" copy variants are no longer a separate template set — each one IS one of
 * Jo's approved templates, rendered by renderJoOutcomeEmail(). This maps the variant chosen by the existing
 * Office rules (pickSaveSpotVariant) to the routing facts that select that Jo template.
 */
export function joFactsForSaveSpotVariant(
  variant: "no_insulation_owner_size" | "no_insulation_assumed_size" | "reviewed_under_r2",
  assumedArea: boolean,
): JoOutcomeFacts {
  if (variant === "reviewed_under_r2") {
    return { outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: !assumedArea, deskCheckStatus: "looks_eligible" };
  }
  return { outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: variant === "no_insulation_owner_size" };
}
