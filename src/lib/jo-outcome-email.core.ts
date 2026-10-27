/**
 * The real owner first-message renderers (Jo, 24 Oct 2026, decisions 66–69 and 73; applied under decision 137).
 *
 * PURE module: no database, no network, no email sending, no pricing calculation. Every outcome workflow asks the single
 * canonical selector (`selectJoTemplate`) which template applies, then renders through `renderJoOutcomeEmail`:
 *   T1/T2 (eligible, no insulation)                     → Save my spot          docs/templates/mjml/owner_O1.mjml
 *   T3/T4 (reviewed below R2) and declared thin/patchy  → Save my spot, some    docs/templates/mjml/owner_O2-some.mjml
 *   new website enquirer, "don't know" (decision 392)   → Save my spot, some    docs/templates/mjml/owner_O2-dont-know.mjml
 *   T5/T6 (insulation unconfirmed)                      → Insulation questions  docs/templates/mjml/owner_O2-questions.mjml
 *   T7 (ineligible)                                     → Not eligible          docs/templates/mjml/owner_O6.mjml
 * Template ids, CTA sets, link binding and fail-closed rules are unchanged; the body follows the approved MJML designs
 * (docs/templates/mjml/owner_O1, owner_O2-*, owner_O6; Jo 27 Oct 2026) through `mjEmail` (mail-mjml.core.ts). T8 (the office Ready Check
 * invitation) was retired on 24 Oct 2026 and has no renderer any more; earlier sends stay in job history.
 */
import {
  ctasForTemplate,
  INSULATION_QUESTIONS_CTA_LABEL,
  renderJoEstimateEmail,
  renderJoIneligibleEmail,
  selectJoTemplate,
  subjectForTemplate,
  type JoCta,
  type JoEstimateFigures,
  type JoRecipient,
  type JoRoutingInput,
  type JoTemplateId,
} from "./jo-email-templates.core";
import {
  applyReadyCheckFee,
  PUBLIC_CALCULATOR_URL,
  type EstimateEmail,
} from "./estimate-email";
import { REMOVE_ENQUIRY_TEXT_SLOT } from "./emailsafety.core";
import * as K from "./email-kit.core";
import { mjEmail, plusRow, tickRow } from "./mail-mjml.core";

/** T7 "Review my result" when the customer has no secure estimate link (ineligible jobs never keep one): the same
 *  public homeowner page the previous ineligible email used. */
export const JO_RESULT_FALLBACK_URL = "https://homeinsulationvictoria.com.au/homeowner";
/** T7 "Checking another property?" — the standalone calculator line always opens the PUBLIC calculator. */
const T7_CALCULATOR_LINE = "Open the calculator →";

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
  /** Decision 392 (Jo 25 Oct 2026): with declaredExisting, the owner ticked "don't know" on the website and has not
   *  described their insulation since; the same O2 Save my spot email uses the "don't know" intro and basis line. */
  declaredUnknown?: boolean;
};

export const JO_OUTCOME_TEMPLATE_LABEL: Record<JoTemplateId, string> = {
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
 */
export function selectJoOutcomeTemplate(facts: JoOutcomeFacts): JoTemplateId | null {
  const id = selectJoTemplate(joRoutingInputFor(facts));
  if (!id) return null;
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
  templateId: JoTemplateId;
  ctas: JoCta[];
};

/** Sentinel wrapping a substituted CTA so the block renderer can turn it into a button/link. */
const S = "\u0001";
const ctaToken = (kind: "cta" | "link", href: string, label: string) => `${S}${kind}|${href}|${label}${S}`;

/** Jo's placeholder per CTA, in the exact wording of her copy. */
const PLACEHOLDER: Record<JoCta, string> = {
  save_my_spot: "[Save my spot →]",
  upload_media: "[Tell us about your insulation]",
  review_result: "[Review my result →]",
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
  // T1–T6 leave the calculator as plain sentence text.
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
  // Decision 392: only an unreviewed owner-declared offer whose answer really is "don't know" gets the don't-know wording.
  const reviewed = id === "eligible_below_r2_reviewed_size_unknown" || id === "eligible_below_r2_reviewed_size_known";
  // The questions / received-media emails to an owner whose answer is "don't know" never say "You told us there's some insulation".
  const dontKnow = !reviewed && input.insulation === "unknown" && (variant === "questions" || variant === "received" || (variant === "some" && input.declaredUnknown === true && input.declaredExisting === true));
  return finish(id, ctas, input, renderSaveMySpot(input, input.figures, variant, rendered.subject, dontKnow));
}

function finish(id: JoTemplateId, ctas: JoCta[], input: JoOutcomeEmailInput, mail: EstimateEmail): JoWiredEmail {
  const withFee = applyReadyCheckFee(mail, {
    readyCheckFeeIncGst: input.readyCheckFeeIncGst ?? null,
    ...(input.pricingCohort ? { pricingCohort: input.pricingCohort } : {}),
    ...(input.installationRatePerM2 == null ? {} : { installationRatePerM2: input.installationRatePerM2 }),
  }, false);
  return { ...withFee, templateId: id, ctas };
}

// ---------------------------------------------------------------------------
// Approved designs (decisions 66–69, 73; MJML refresh docs/templates/mjml/owner_O1, O2-*, O6) through `mjEmail`
// ---------------------------------------------------------------------------
type SaveSpotVariant = "none" | "some" | "questions" | "received";

/** Decision 67: the removal card's rate and "up to" figure. The informational `removalUpTo` (current rate × area) wins;
 *  without it the approved $15/m² figure applies. Never part of any total. */
function removalCard(f: JoEstimateFigures): { ratePerM2: number; upTo: number } {
  const area = f.ceilingAreaM2 > 0 ? f.ceilingAreaM2 : 0;
  if (f.removalUpTo != null && f.removalUpTo > 0 && area > 0) return { ratePerM2: Math.round(f.removalUpTo / area), upTo: f.removalUpTo };
  return { ratePerM2: 15, upTo: 15 * area };
}

/** "Based on what you told us: 137 m² ceiling, no existing insulation." — a typical-size estimate is never called the owner's size.
 *  Decision 392: "unknown" (owner ticked don't know) → "existing insulation not known yet". */
export function basisLine(f: JoEstimateFigures, someInsulation: boolean | "unknown"): string {
  const ins = someInsulation === "unknown" ? "existing insulation not known yet" : someInsulation ? "with some existing insulation" : "no existing insulation";
  return f.areaEstimated
    ? `Based on a typical ${K.m2(f.ceilingAreaM2)} ceiling (an estimate, not your actual size), ${ins}.`
    : `Based on what you told us: ${K.m2(f.ceilingAreaM2)} ceiling, ${ins}.`;
}

const O1_INTRO = "That's the Victorian Energy Upgrades (VEU) rebate, taken straight off your price. To get it you need a certified installer, a licensed electrician and an Accredited Person. We bring them together and run the whole job for you.";
const O2_INTRO = "You told us there's some insulation in your ceiling already. If it's thin or patchy (below R2.0), you can still get the Victorian Energy Upgrades (VEU) rebate. You need a certified installer, a licensed electrician and an Accredited Person. We bring them together and run the whole job for you.";
/** Decision 392 (Jo 25 Oct 2026): a new website enquirer who ticked "don't know" gets the O2 Save my spot email with this
 *  intro — never "You told us there's some insulation". Spot-only (decision 388). */
export const O2_DONT_KNOW_INTRO = "You weren't sure if there's insulation in your ceiling. If there's none, or it's thin or patchy (below R2.0), you can still get the Victorian Energy Upgrades (VEU) rebate. You need a certified installer, a licensed electrician and an Accredited Person. We bring them together and run the whole job for you.";
// Decision 388 (Jo 25 Oct 2026: "we are saving spots, not offering Ready Checks"): spot-only wording. No Ready Check,
// installer visit, times, measuring or quote timing.
const O1_SAVE = "Thousands of Victorians have registered. Spots are released in the order they were saved. There's no cost and no obligation, and we'll be in touch when yours is released.";
const O2_SAVE = O1_SAVE;
const O2Q_SAVE = "Thousands of Victorians have registered. Spots are released in the order they were saved. Tell us about your insulation and your spot is saved straight away. Just tap, no typing.";
const O2Q_PHOTOS = "Got photos or a video? You can add them too, only if it's safe. Please don't climb into the roof space.";
const RECEIVED_ACK = "Thank you for sending your photos or video. We already have your media — you do not need to upload it again. Our Office will review it and contact you about the next step. If you want or need to add more evidence, you can optionally add multiple photos and/or videos using the link below.";
const RECEIVED_SAFETY = "Only take photos or video if you can do so safely, and don’t enter the roof space.";
const SAVE_TITLE = "Save your spot – it's free";
const O2_CLOSING = "If your existing insulation is already R2.0 or above, the rebate isn't available and we'll let you know. You'll see your exact price before you agree to anything.";
const O1_CLOSING = "You'll see your exact price before you agree to anything.";
export const QUESTIONS = [
  { title: "What type is it?", detail: "Loose fill or batts" },
  { title: "About how thick is it?", detail: "Less than a finger, a hand's width, or thicker" },
  { title: "When was your home built?", detail: "Pick a decade" },
];

/* Shared MJML sections (also used by the Save my spot reminders O66–O68 and Spot saved O10). */
const LINK = "color:#3C51C4;font-weight:700;";
const mjLink = (href: string, label: string) => `<a href="${K.esc(href)}" style="${LINK}">${label}</a>`;
const section = (inner: string, cls?: string) => `<mj-section><mj-column${cls ? ` mj-class="${cls}"` : ""}>${inner}</mj-column></mj-section>`;
/** Headline + intro paragraph. */
export const mjHeadline = (headline: string, intro: string) => section(`<mj-text mj-class="h1" css-class="email-heading">${K.esc(headline)}</mj-text><mj-text>${K.esc(intro)}</mj-text>`);
/** Section heading (h2) + paragraph, with optional button. */
export const mjSubSection = (title: string, text: string, button?: { href: string; label: string } | null) =>
  section(`<mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 6px">${K.esc(title)}</mj-text><mj-text>${K.esc(text)}</mj-text>${button ? `<mj-button href="${K.esc(button.href)}">${K.esc(button.label)}</mj-button>` : ""}`);
/** Small grey line at the end of the email; `html` = already-escaped markup. */
export const mjSmallEnd = (html: string, padding = "14px 12px 0") => section(`<mj-text mj-class="small" padding="${padding}">${html}</mj-text>`);
/** The mint rebate box and the blue price box (O1/O2, O66–O68). */
export function mjRebateAndPrice(i: { rebateLabel: string; rebate: number; priceLabel: string; price: number; fullPrice: number; basis: string; calculatorUrl: string | null }): string {
  const calc = i.calculatorUrl ? `<br />${mjLink(i.calculatorUrl, "Try a different ceiling size")}` : "";
  return section(`<mj-text mj-class="eyebrow center" padding="18px 12px 6px">${K.esc(i.rebateLabel)}</mj-text><mj-text mj-class="big-green" padding="0 12px 18px">You save ${K.esc(K.whole(i.rebate))}</mj-text>`, "panel-mint")
    + section(`<mj-text mj-class="eyebrow center" padding="18px 12px 6px">${K.esc(i.priceLabel)}</mj-text><mj-text mj-class="big-blue">${K.esc(K.whole(i.price))}</mj-text><mj-text mj-class="center" font-size="14px" line-height="20px" font-weight="700">incl. GST · full price <span class="strike">${K.esc(K.whole(i.fullPrice))}</span></mj-text><mj-text mj-class="small center" padding="0 16px 18px">${K.esc(i.basis)}${calc}</mj-text>`, "panel");
}
/** Plain-text twin of the two boxes. */
export const rebateAndPriceText = (i: { rebateLabel: string; rebate: number; priceLabel: string; price: number; fullPrice: number; basis: string; calculatorUrl: string | null }) => [
  i.rebateLabel.toUpperCase(), `You save ${K.whole(i.rebate)}`,
  `${i.priceLabel}: ${K.whole(i.price)} incl. GST (full price ${K.whole(i.fullPrice)})`,
  i.basis, i.calculatorUrl ? `Try a different ceiling size: ${i.calculatorUrl}` : null,
];

/** "What's included in $X" rows (Save my spot O1/O2 and Spot saved O10, all sent before the spot is released).
 *  Decision 388: no Ready Check row before release. */
export const includedRows = (rebate: number) => [
  { title: "Licensed electrician safety check", detail: "Done before any insulation goes in, to make sure wiring, downlights and cables are safe." },
  { title: "Premium R5.0 ceiling batts", detail: "VEU-approved and made to Australian Standard AS/NZS 4859.1." },
  { title: "Fitted by an EEC-certified installer", detail: "A Certified Insulation Installer, working to Australian Standard AS 3999." },
  { title: "We handle the rebate", detail: `As a VEU Accredited Person (${K.AP_NUMBER}), we do the paperwork. The ${K.whole(rebate)} comes straight off your price.` },
];
/** The two white cards: what's included, and what's not included (only if needed). */
export function mjIncludedCards(i: { price: number; rebate: number; someInsulation?: boolean }): string {
  const inc = includedRows(i.rebate);
  const not = K.notIncludedItems(i.someInsulation === true);
  return section(`<mj-text mj-class="h2" padding="18px 18px 10px">${K.esc(`What's included in ${K.whole(i.price)}`)}</mj-text><mj-table padding="0 18px 6px">${inc.map((r, n) => tickRow(K.esc(r.title), K.esc(r.detail), n === inc.length - 1)).join("")}</mj-table>`, "panel-card")
    + section(`<mj-text mj-class="h2" padding="18px 18px 10px">Not included – only if needed</mj-text><mj-table padding="0 18px 6px">${not.map((h) => plusRow(h)).join("")}</mj-table>`, "panel-card");
}
/** Plain-text twin of the two cards (closing line added by the caller). */
export const includedCardsText = (i: { price: number; rebate: number; someInsulation?: boolean }) => [
  `WHAT'S INCLUDED IN ${K.whole(i.price)}`, ...includedRows(i.rebate).map((r) => `✓ ${r.title}: ${r.detail}`), "",
  "NOT INCLUDED – ONLY IF NEEDED", ...K.notIncludedItems(i.someInsulation === true).map((h) => `+ ${K.stripTags(h)}`),
];
/** White card with a heading, one line and a blue arrow link (friend cards). */
export const mjLinkCard = (title: string, body: string, href: string, label: string) =>
  section(`<mj-text mj-class="h2" padding="18px 18px 2px">${K.esc(title)}</mj-text><mj-text padding="0 18px 6px">${K.esc(body)}</mj-text><mj-text padding="0 18px 16px">${mjLink(href, `${K.esc(label)} &rarr;`)}</mj-text>`, "panel-card");

/** Decision 67: "Your existing insulation" card ($0 if it can stay, $/m² if some needs removing). */
export function mjExistingInsulation(areaM2: number, ratePerM2: number, upTo: number): string {
  const td = (top: boolean) => (top ? "border-top:1px solid #E4E9F5;" : "");
  const row = (icon: string, title: string, detail: string, amount: string, color: string, top: boolean) =>
    `<tr><td width="32" valign="top" style="padding:12px 0;${td(top)}"><span class="${icon}">${icon === "tick" ? "&#10003;" : "+"}</span></td><td valign="top" style="padding:10px 0;${td(top)}"><strong>${title}</strong><br /><span class="muted">${detail}</span></td><td valign="top" align="right" style="padding:10px 0 10px 10px;white-space:nowrap;font-weight:700;color:${color};${td(top)}">${amount}</td></tr>`;
  return section(`<mj-text mj-class="h2" padding="18px 18px 2px">Your existing insulation</mj-text><mj-text padding="0 18px 10px">Good news: <strong>it may be able to stay.</strong></mj-text><mj-table padding="0 18px 4px">${row("tick", "If it can stay", "New batts go straight over the top.", "$0", "#057D40", false)}${row("plus", "If some needs removing", `Only the areas that need it. Up to ${K.esc(K.whole(upTo))} for your ${K.esc(K.m2(areaM2))} ceiling.`, `$${ratePerM2}/m²`, "#3C51C4", true)}</mj-table><mj-text mj-class="small" padding="0 18px 14px">Prices incl. GST. You'll know the exact cost before you agree to anything.</mj-text>`, "panel-card");
}

function renderSaveMySpot(input: JoOutcomeEmailInput, f: JoEstimateFigures, variant: SaveSpotVariant, rawSubject: string, dontKnow = false): EstimateEmail {
  const first = input.recipient.firstName;
  const some = variant !== "none";
  const rebate = K.whole(f.veuRebate), price = K.whole(f.customerTotal);
  const headline = some ? `${first}, you may qualify for ${rebate} off ceiling insulation` : `${first}, you could save ${rebate} on ceiling insulation`;
  // MJML refresh (Jo 27 Oct 2026): a "some insulation" email whose subject said "you could save" now matches its "may qualify" heading.
  const subject = some && rawSubject === subjectForTemplate("eligible_no_insulation_size_known", first, f.veuRebate) ? headline : rawSubject;
  const preview = variant === "questions" ? "Answer 3 quick questions about your insulation and your spot is saved straight away."
    : variant === "received" ? subject
      : !some ? `Your price could be ${price} after the government rebate. Saving your spot is free.`
        : dontKnow ? `If there's none, or it's thin or patchy, your price could be ${price} after the rebate.`
          : `If your existing insulation is thin or patchy, your price could be ${price} after the rebate.`;
  const basis = basisLine(f, dontKnow ? "unknown" : some);
  const intro = dontKnow ? O2_DONT_KNOW_INTRO : some ? O2_INTRO : O1_INTRO;
  const removal = removalCard(f);
  const saveUrl = input.links.saveMySpotUrl, answerUrl = input.links.uploadMediaUrl;
  const box = { rebateLabel: some ? "Your potential rebate" : "Your estimated rebate", rebate: f.veuRebate, priceLabel: some ? "Your cost if eligible" : "You pay after the rebate", price: f.customerTotal, fullPrice: f.totalBeforeRebate, basis, calculatorUrl: input.links.calculatorUrl || null };
  const closing = some ? O2_CLOSING : O1_CLOSING;
  const action = variant === "questions"
    ? section(`<mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 6px">Save your spot: answer 3 quick questions</mj-text><mj-text>${K.esc(O2Q_SAVE)}</mj-text>`)
      + section(`<mj-table padding="18px 18px 4px">${QUESTIONS.map((q, n) => `<tr><td width="34" valign="top" style="padding:1px 0 ${n === QUESTIONS.length - 1 ? 10 : 14}px;"><span class="num">${n + 1}</span></td><td style="padding:0 0 ${n === QUESTIONS.length - 1 ? 10 : 14}px;"><strong>${K.esc(q.title)}</strong><br /><span class="muted">${K.esc(q.detail)}</span></td></tr>`).join("")}</mj-table><mj-button href="${K.esc(answerUrl)}" padding="0 18px 12px">${K.esc(INSULATION_QUESTIONS_CTA_LABEL)}</mj-button><mj-text mj-class="small" padding="0 18px 16px">${K.esc(O2Q_PHOTOS)}</mj-text>`, "panel-card")
    : variant === "received"
      ? section(`<mj-text mj-class="h2" css-class="email-sub" padding="18px 12px 6px">Thanks for your photos or video</mj-text><mj-text>${K.esc(RECEIVED_ACK)}</mj-text><mj-button href="${K.esc(answerUrl)}">Add more photos or video</mj-button><mj-text mj-class="small center" padding="0 12px 0">${K.esc(RECEIVED_SAFETY)}</mj-text>`)
      : mjSubSection(SAVE_TITLE, some ? O2_SAVE : O1_SAVE, { href: saveUrl, label: "Save my free spot" });
  const body = [
    mjHeadline(headline, intro),
    mjRebateAndPrice(box),
    some ? mjExistingInsulation(f.ceilingAreaM2, removal.ratePerM2, removal.upTo) : "",
    action,
    mjIncludedCards({ price: f.customerTotal, rebate: f.veuRebate, someInsulation: some }),
    mjSmallEnd(`${K.esc(closing)}${input.links.reviewResultUrl ? ` ${mjLink(input.links.reviewResultUrl, "See your full estimate")}` : ""}`),
  ].join("\n");
  const html = mjEmail({ subject, preview, body, unsubscribe: "slot" });
  const plainText = K.plainText([
    headline, "",
    intro, "",
    ...rebateAndPriceText(box), "",
    ...(some ? ["YOUR EXISTING INSULATION", "Good news: it may be able to stay.", "✓ If it can stay: $0. New batts go straight over the top.", `+ If some needs removing: $${removal.ratePerM2}/m², only the areas that need it. Up to ${K.whole(removal.upTo)} for your ${K.m2(f.ceilingAreaM2)} ceiling.`, "Prices incl. GST. You'll know the exact cost before you agree to anything.", ""] : []),
    ...(variant === "questions"
      ? ["SAVE YOUR SPOT: ANSWER 3 QUICK QUESTIONS", O2Q_SAVE, ...QUESTIONS.map((q, n) => `${n + 1}. ${q.title} (${q.detail})`), `${INSULATION_QUESTIONS_CTA_LABEL}: ${answerUrl}`, O2Q_PHOTOS]
      : variant === "received"
        ? ["THANKS FOR YOUR PHOTOS OR VIDEO", RECEIVED_ACK, `Add more photos or video: ${answerUrl}`, RECEIVED_SAFETY]
        : [SAVE_TITLE.toUpperCase(), some ? O2_SAVE : O1_SAVE, `Save my free spot: ${saveUrl}`]),
    "",
    ...includedCardsText({ price: f.customerTotal, rebate: f.veuRebate, someInsulation: some }), "",
    closing,
    input.links.reviewResultUrl ? `See your full estimate: ${input.links.reviewResultUrl}` : null,
    "", `Reference: ${input.recipient.enquiryReference}`,
  ]) + `\nUnsubscribe: ${REMOVE_ENQUIRY_TEXT_SLOT}`;
  return { subject, previewText: preview, html, plainText };
}

const O6_INTRO = "Thanks for checking with us. Based on what you told us, your home doesn't qualify for the VEU ceiling insulation rebate at the moment. We'd rather tell you now than waste your time.";
const O6_RECHECK = "If any of your details were wrong, like your ceiling size or the insulation you have, check your result and let us know. We'll take another look.";
const O6_PREVIEW = "Based on what you told us, your home doesn't qualify right now. Here's why, and what to do if something's wrong.";
const FRIEND = { title: "Know someone thinking about insulation?", body: "They can check their own eligibility in about a minute." };

/** Decision 73: "{First}, your ceiling insulation result" with the Why box, Review my result and the friend card. */
function renderNotEligible(input: JoOutcomeEmailInput, subject: string): EstimateEmail {
  const first = input.recipient.firstName;
  const reason = (input.reason ?? "").trim() || INELIGIBLE_FALLBACK_REASON;
  const headline = `${first}, your ceiling insulation result`;
  const body = [
    mjHeadline(headline, O6_INTRO),
    section(`<mj-text mj-class="h2" padding="18px 18px 2px">Why</mj-text><mj-text padding="0 18px 16px">${K.esc(reason)}</mj-text>`, "panel"),
    mjSubSection("Something doesn't look right?", O6_RECHECK, { href: input.links.reviewResultUrl, label: "Review my result" }),
    // "Send to a friend" opens a new email to a friend with the public homeowner page link (Jo, 27 Oct) (no customer data in the link).
    mjLinkCard(FRIEND.title, FRIEND.body, K.friendShareHref(K.HOMEOWNER_PAGE_URL), "Send to a friend"),
  ].join("\n");
  const html = mjEmail({ subject, preview: O6_PREVIEW, body, unsubscribe: "slot" });
  const plainText = K.plainText([
    headline, "", O6_INTRO, "", "WHY", reason, "", "SOMETHING DOESN'T LOOK RIGHT?", O6_RECHECK, `Review my result: ${input.links.reviewResultUrl}`, "",
    `${FRIEND.title} ${FRIEND.body}`, `Send to a friend: ${K.HOMEOWNER_PAGE_URL}`, "",
    `Reference: ${input.recipient.enquiryReference}`,
  ]) + `\nUnsubscribe: ${REMOVE_ENQUIRY_TEXT_SLOT}`;
  return { subject, previewText: O6_PREVIEW, html, plainText };
}


export const INELIGIBLE_FALLBACK_REASON =
  "Based on the details provided, the property doesn’t meet the current requirements for a VEU ceiling insulation rebate.";

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
