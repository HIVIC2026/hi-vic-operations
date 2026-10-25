/**
 * The real owner first-message renderers (Jo, 24 Oct 2026, decisions 66–69 and 73; applied under decision 137).
 *
 * PURE module: no database, no network, no email sending, no pricing calculation. Every outcome workflow asks the single
 * canonical selector (`selectJoTemplate`) which template applies, then renders through `renderJoOutcomeEmail`:
 *   T1/T2 (eligible, no insulation)                     → Save my spot          docs/templates/owner/O1-save-my-spot.html
 *   T3/T4 (reviewed below R2) and declared thin/patchy  → Save my spot, some    docs/templates/owner/O2-save-my-spot-some-insulation.html
 *   new website enquirer, "don't know" (decision 392)   → Save my spot, some    docs/templates/owner/O2-save-my-spot-dont-know.html
 *   T5/T6 (insulation unconfirmed)                      → Insulation questions  docs/templates/owner/O2-save-my-spot-questions.html
 *   T7 (ineligible)                                     → Not eligible          docs/templates/owner/O6-not-eligible.html
 * Subjects, template ids, CTA sets, link binding and fail-closed rules are unchanged; only the body copy and
 * presentation now follow the approved designs through the shared `email-kit.core.ts`. T8 (the office Ready Check
 * invitation) was retired on 24 Oct 2026 and has no renderer any more; earlier sends stay in job history.
 */
import {
  ctasForTemplate,
  INSULATION_QUESTIONS_CTA_LABEL,
  renderJoEstimateEmail,
  renderJoIneligibleEmail,
  selectJoTemplate,
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
  const dontKnow = variant === "some" && !reviewed && input.declaredUnknown === true && input.declaredExisting === true && input.insulation === "unknown";
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

/** "Based on what you told us: 137 m² ceiling, no existing insulation." — a typical-size estimate is never called the owner's size.
 *  Decision 392: "unknown" (owner ticked don't know) → "existing insulation not known yet". */
export function basisLine(f: JoEstimateFigures, someInsulation: boolean | "unknown"): string {
  const ins = someInsulation === "unknown" ? "existing insulation not known yet" : someInsulation ? "with some existing insulation" : "no existing insulation";
  return f.areaEstimated
    ? `Based on a typical ${K.m2(f.ceilingAreaM2)} ceiling (an estimate, not your actual size), ${ins}.`
    : `Based on what you told us: ${K.m2(f.ceilingAreaM2)} ceiling, ${ins}.`;
}

const O1_INTRO = "This is the Victorian Government's Energy Upgrades (VEU) rebate, taken straight off your price. To claim it, you need a certified installer, a licensed electrician and an accredited provider. We bring them all together and organise the whole job for you.";
const O2_INTRO = "You told us there's some insulation in your ceiling already. If it's thin or patchy (below R2.0), you can still get the Victorian Government's Energy Upgrades (VEU) rebate. We bring together the certified installer, licensed electrician and accredited provider you need, and organise the whole job.";
/** Decision 392 (Jo 25 Oct 2026): a new website enquirer who ticked "don't know" gets the O2 Save my spot email with this
 *  intro — never "You told us there's some insulation". Spot-only (decision 388). */
export const O2_DONT_KNOW_INTRO = "You weren't sure if there's insulation in your ceiling. If there's none, or it's thin or patchy (below R2.0), you can still get the Victorian Government's Energy Upgrades (VEU) rebate. We bring together the certified installer, licensed electrician and accredited provider you need, and organise the whole job.";
// Decision 388 (Jo 25 Oct 2026: "we are saving spots, not offering Ready Checks"): spot-only wording, awaiting Jo's
// approval in docs/decision-388-spot-only-wording.md. No Ready Check, installer visit, times, measuring or quote timing.
const O1_SAVE = "Thousands of Victorians have registered, and spots are released in the order they were saved. Saving your spot is free, with no obligation. We'll be in touch when your spot is released.";
const O2_SAVE = O1_SAVE;
const O2Q_SAVE = "Thousands of Victorians have registered, and spots are released in the order they were saved. Tell us about your insulation and your spot is saved straight away. Just tap, no typing.";
const O2Q_PHOTOS = "Got photos or a video? You can add them too, only if it's safe. Please don't climb into the roof space.";
const RECEIVED_ACK = "Thank you for sending your photos or video. We already have your media — you do not need to upload it again. Our Office will review it and contact you about the next step. If you want or need to add more evidence, you can optionally add multiple photos and/or videos using the link below.";
const RECEIVED_SAFETY = "Only take photos or video if you can do so safely, and don’t enter the roof space.";
const O2_CLOSING = "If your existing insulation is already R2.0 or above, the rebate isn't available and we'll let you know. You'll know the exact price before you agree to anything.";
const O1_CLOSING = K.INCLUDED_CLOSING;
export const QUESTIONS = [
  { title: "What type is it?", detail: "Loose fill or batts" },
  { title: "About how thick is it?", detail: "Less than a finger, a hand's width, or thicker" },
  { title: "When was your home built?", detail: "Pick a decade" },
];

function renderSaveMySpot(input: JoOutcomeEmailInput, f: JoEstimateFigures, variant: SaveSpotVariant, subject: string, dontKnow = false): EstimateEmail {
  const first = input.recipient.firstName;
  const some = variant !== "none";
  const rebate = K.whole(f.veuRebate), price = K.whole(f.customerTotal), full = K.whole(f.totalBeforeRebate);
  const headline = some ? `${first}, you may qualify for ${rebate} off ceiling insulation` : `${first}, you could save ${rebate} on ceiling insulation`;
  const basis = basisLine(f, dontKnow ? "unknown" : some);
  const intro = dontKnow ? O2_DONT_KNOW_INTRO : some ? O2_INTRO : O1_INTRO;
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
    K.p(intro),
    K.priceBox({ rebateLabel: some ? "Your potential VEU rebate" : "Your estimated VEU rebate", rebate: f.veuRebate, priceLabel: some ? "Your cost if eligible" : "You pay after the rebate", price, fullPrice: full, basis, calculator: calc }),
    some ? K.existingInsulationCard({ areaM2: f.ceilingAreaM2, ratePerM2: removal.ratePerM2, upTo: removal.upTo }) : "",
    action,
    K.spacer(8),
    K.includedAndNotIncluded({ price: f.customerTotal, rebate: f.veuRebate, someInsulation: some, closing: some ? O2_CLOSING : O1_CLOSING, seeEstimate: input.links.reviewResultUrl || null }),
  ].join("\n");
  const html = K.emailShell({ body, previewText: subject, unsubscribe: "slot" });
  const plainText = K.plainText([
    headline, "",
    intro, "",
    some ? "YOUR POTENTIAL VEU REBATE" : "YOUR ESTIMATED VEU REBATE",
    `You save ${rebate}`,
    `${some ? "Your cost if eligible" : "You pay after the rebate"}: ${price} incl. GST (full price before rebate ${full})`,
    basis,
    calc ? `Try a different ceiling size: ${calc.href}` : null, "",
    ...(some ? ["YOUR EXISTING INSULATION", "Good news: it may be able to stay.", "✓ If it can stay: $0. New batts go straight over the top.", `+ If some needs removing: $${removal.ratePerM2}/m², only the areas that need it. Up to ${K.whole(removal.upTo)} for your ${K.m2(f.ceilingAreaM2)} ceiling.`, "Prices incl. GST. You'll know the exact cost before you agree to anything.", ""] : []),
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
