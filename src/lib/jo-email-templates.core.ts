/**
 * P1-R3-COM-08 — Jo Lowe's eight approved email templates (pure renderers + deterministic routing).
 *
 * Source of truth for copy (verbatim):
 *   docs/phase1/communications/P1-JO-EMAIL-TEMPLATES-2026-10-15.md  (Jo Lowe, 15 Oct 2026)
 * Owner decisions resolved in P1-R3-COM-08 brief:
 *   - $15/m² removal allowance is INFORMATIONAL only; it is NEVER silently added to the quoted total.
 *   - Below-R2 templates (3/4) REQUIRE a verified desk-check review outcome; unknown insulation is never treated as below R2.
 *   - Template 8 uses the SAVED pricing snapshot and a PERSONAL estimate link — never the public calculator / current rates.
 *
 * This module is PURE: no network, no database, no email sending. It only renders strings and selects a template.
 * Real sending remains gated elsewhere by customer_comms_enabled && save_my_spot_real_send_enabled (COM-04 fail-closed).
 */

import { REMOVAL_BUDGET_EMAIL_NOTE } from "./estimate-removal.core";
import { REMOVAL_UPTO_NOTE, removalUpToLine } from "./estimate-removal-upto.core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JoTemplateId =
  | "eligible_no_insulation_size_unknown"      // 1
  | "eligible_no_insulation_size_known"        // 2
  | "eligible_below_r2_reviewed_size_unknown"  // 3
  | "eligible_below_r2_reviewed_size_known"    // 4
  | "potentially_eligible_unknown_size_unknown"// 5
  | "potentially_eligible_unknown_size_known"  // 6
  | "ineligible"                               // 7
  | "ready_check_invitation";                  // 8

export type JoCta = "save_my_spot" | "upload_media" | "review_result" | "book_ready_check";

export const DEFAULT_ASSUMED_AREA_M2 = 150;

/** Inputs for the selector. Mirrors fields already produced by the Gate-1 / launch-campaign pipeline. */
export type JoRoutingInput = {
  /** "likely_eligible" | "needs_onsite_confirmation" | "ineligible" | other */
  outcome: string | null;
  /** normalised declared insulation: "none" | "present" | "unknown" | null */
  insulation: "none" | "present" | "unknown" | null;
  /** true when the homeowner supplied a usable ceiling area (area_source === "declared") */
  ceilingSizeKnown: boolean;
  /**
   * Desk-check review outcome for below-R2 scenarios. Only "looks_eligible" (set by a human review of
   * uploaded photos/video) unlocks templates 3/4. null/undefined/anything else => NOT reviewed.
   */
  deskCheckStatus?: "looks_eligible" | "not_eligible" | "needs_onsite_check" | null;
  /** true when this homeowner previously saved their spot and is now being invited to Ready Check */
  readyCheckInvitation?: boolean;
  /** true when a readable saved-pricing snapshot exists (required for template 8; fail closed otherwise) */
  savedSnapshotAvailable?: boolean;
  /**
   * Jo 22 Oct 2026: the owner's website answers said their existing insulation is thin or only patchy
   * (declared, never photo-reviewed). Uses the eligible Save my spot email (templates 1/2) with the
   * approved thin/patchy wording. Absent/false keeps every existing rule untouched.
   */
  declaredThinPatchy?: boolean;
  declaredExisting?: boolean;
};

/** Money/line-item inputs. For templates 1–6 these are live calculated values; for template 8 they are the saved snapshot. */
export type JoEstimateFigures = {
  veuRebate: number;
  customerTotal: number;     // after rebate, inc GST
  totalBeforeRebate: number; // gross, inc GST
  installation: number;      // inc GST
  piesaFee: number;          // inc GST
  apFee: number;             // inc GST
  ceilingAreaM2: number;     // 150 when assumed
  areaEstimated: boolean;    // true => "estimated, not measured"; false => "based on the size you provided"
  /** Jo 22 Oct: informational "up to" removal (existing insulation only); never part of any total. */
  removalUpTo?: number | null;
};

export type JoRecipient = {
  firstName: string;
  propertyAddress: string;
  enquiryReference: string;
};

/** Immutable, read-only saved-pricing snapshot used by Template 8. No field here is ever written back. */
export type SavedPricingSnapshot = Readonly<JoEstimateFigures> & {
  readonly savedAt: string;
  readonly personalEstimateUrl: string; // customer-specific link, saved pricing preserved
  /**
   * COM-09 (DEP-2): customer-specific URL for the EXISTING Ready Check booking workflow.
   * Optional so COM-08 snapshots (which predate the binding) still render; when present the
   * "Book my Ready Check" CTA becomes a real link. Opening it never auto-books — the customer
   * must still view the estimate and explicitly accept + pick times.
   */
  readonly readyCheckBookingUrl?: string;
};

export type JoRenderResult = { templateId: JoTemplateId; subject: string; body: string; ctas: JoCta[] };

// ---------------------------------------------------------------------------
// Deterministic routing (Section 7 of the brief)
// ---------------------------------------------------------------------------

/**
 * Pick exactly one of the eight templates. Returns null when no customer email applies
 * (e.g. required review gate not satisfied, or a Ready Check invitation with no readable snapshot — fail closed).
 */
export function selectJoTemplate(input: JoRoutingInput): JoTemplateId | null {
  // Template 8 — Ready Check invitation takes precedence, but only with a readable saved snapshot.
  if (input.readyCheckInvitation) {
    return input.savedSnapshotAvailable ? "ready_check_invitation" : null;
  }

  if (input.outcome === "ineligible") return "ineligible";

  const eligible = input.outcome === "likely_eligible";
  const potentially = input.outcome === "needs_onsite_confirmation";

  // Below-R2 (templates 3/4): ONLY when eligible, insulation present, AND a human review said "looks_eligible".
  // Unknown insulation must never be treated as confirmed below R2.
  const reviewedBelowR2 =
    eligible && input.insulation === "present" && input.deskCheckStatus === "looks_eligible";
  if (reviewedBelowR2) {
    return input.ceilingSizeKnown
      ? "eligible_below_r2_reviewed_size_known"
      : "eligible_below_r2_reviewed_size_unknown";
  }

  // Eligible, no existing insulation (templates 1/2).
  if (eligible && input.insulation === "none") {
    return input.ceilingSizeKnown
      ? "eligible_no_insulation_size_known"
      : "eligible_no_insulation_size_unknown";
  }

  // Jo 22 Oct 2026: declared thin/patchy existing insulation (no photo review) uses the eligible Save my
  // spot email (templates 1/2) with the approved thin/patchy wording. Only ever set from the owner's
  // website follow-up answers; a recorded Office review takes precedence and never reaches this branch.
  if (eligible && input.insulation === "present" && (input.declaredThinPatchy || input.declaredExisting)) {
    return input.ceilingSizeKnown
      ? "eligible_no_insulation_size_known"
      : "eligible_no_insulation_size_unknown";
  }

  // Potentially eligible, unknown/present-but-unreviewed insulation (templates 5/6 — upload request, no Save-My-Spot).
  if (potentially || (eligible && (input.insulation === "unknown" || input.insulation === "present"))) {
    return input.ceilingSizeKnown
      ? "potentially_eligible_unknown_size_known"
      : "potentially_eligible_unknown_size_unknown";
  }

  return null;
}

/** CTA set for a template. Group B (potentially eligible) gets upload, never Save-My-Spot. */
export function ctasForTemplate(id: JoTemplateId): JoCta[] {
  switch (id) {
    case "eligible_no_insulation_size_unknown":
    case "eligible_no_insulation_size_known":
    case "eligible_below_r2_reviewed_size_unknown":
    case "eligible_below_r2_reviewed_size_known":
      return ["save_my_spot"];
    case "potentially_eligible_unknown_size_unknown":
    case "potentially_eligible_unknown_size_known":
      return ["upload_media"];
    case "ineligible":
      return ["review_result"];
    case "ready_check_invitation":
      return ["book_ready_check"];
  }
}

// ---------------------------------------------------------------------------
// Shared rendering helpers
// ---------------------------------------------------------------------------

const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

function footer(ref: string): string {
  return [
    "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria",
    `Reference: ${ref}`,
    "[Contact us] · [Privacy] · [Remove my enquiry]",
  ].join("\n");
}

function ceilingLine(f: JoEstimateFigures): string {
  return f.areaEstimated
    ? `Ceiling size: ${f.ceilingAreaM2} m² — estimated, not measured`
    : `Ceiling size: ${f.ceilingAreaM2} m² — based on the size you provided`;
}

function includesTable(withExistingAssessment: boolean, f: JoEstimateFigures): string {
  const readyCheck = withExistingAssessment
    ? "Ready Check — ceiling measurement, existing-insulation assessment, eligibility and job scope"
    : "Ready Check — ceiling measurement, eligibility and job scope";
  return [
    "### What this includes",
    "",
    "| Item | Including GST |",
    "|---|---|",
    `| ${readyCheck} | Free |`,
    `| R5.0 ceiling insulation — supply and installation by a certified installer | ${money(f.installation)} |`,
    `| Pre Insulation Electrical Safety Assessment (PIESA) | ${money(f.piesaFee)} |`,
    `| Accredited Person management — compliance, paperwork and your VEU claim | ${money(f.apFee)} |`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The eight renderers (Jo's verbatim copy; placeholders filled from verified data)
// ---------------------------------------------------------------------------

/** Jo's approved thin/patchy sentence (22 Oct 2026), verbatim. Replaces the "no existing insulation" price
 *  assumption in the eligible Save my spot email when the owner's website answers said thin or patchy.
 *  It must never be paired with "we've reviewed your photos" or "assumes there is no existing insulation". */
/** DRAFT (Jo 23 Oct 08:14 UTC, awaiting Jo's wording approval): standard existing-insulation Save my spot line. */
export const EXISTING_SAVE_SPOT_LINE = "You told us there is some existing insulation in your ceiling. Your free Ready Check checks what’s there and confirms whether you qualify before anything goes ahead.";
export const THIN_PATCHY_SAVE_SPOT_LINE = "You told us your existing insulation is thin or only covers part of the ceiling, so you look likely to qualify for the rebate. Your free Ready Check confirms this on site before anything goes ahead.";

function renderEligibleNoInsulation(r: JoRecipient, f: JoEstimateFigures, thinPatchy = false, declaredExisting = false): string {
  const declaredThinPatchy = thinPatchy || declaredExisting;
  const assumedNote = f.areaEstimated
    ? "You didn’t provide a ceiling size, so we’ve used 150 m² for this preliminary quote. Your final price will depend on the measured ceiling area."
    : "We’ll confirm the ceiling measurements at your free Ready Check.";
  const removalBox = declaredThinPatchy && f.removalUpTo != null && f.removalUpTo > 0;
  const changePrice = removalBox
    ? "Final measurements, ceiling access and any electrical fixes may affect the price. Electrical fixes are excluded."
    : "Final measurements, ceiling access and any electrical fixes may affect the price. Insulation removal and electrical fixes are excluded.";
  return [
    `Hi ${r.firstName},`, "",
    "How much could you save on ceiling insulation?", "",
    "Good news—based on what you’ve told us, your home looks likely to qualify for a VEU ceiling insulation rebate.", "",
    "A more comfortable home could be closer than you think. We’ll coordinate the installer, Pre Insulation Electrical Safety Assessment (PIESA) and rebate paperwork.", "",
    "### Your preliminary quote", "",
    `**You could save ${money(f.veuRebate)}**`, "",
    `Your estimated cost after rebate: ${money(f.customerTotal)} including GST`,
    `Before rebate: ${money(f.totalBeforeRebate)} including GST`, "",
    ...(removalBox ? [removalUpToLine(f.removalUpTo!, f.ceilingAreaM2), REMOVAL_UPTO_NOTE, ""] : []),
    `Property: ${r.propertyAddress}`,
    ceilingLine(f), "",
    assumedNote, "",
    "Want to explore a different ceiling size? Open the calculator →", "",
    includesTable(declaredThinPatchy, f), "",
    "### Save your spot", "",
    "We’ve been inundated with requests from owners across Victoria. With limited availability of suitably qualified installers, we’re opening Ready Check bookings in batches.", "",
    "Save your spot to join the queue, and we’ll be in touch as soon as an installer is available in your area.", "",
    "[Save my spot →]", "",
    "We’ll contact you to arrange your free Ready Check. No payment is required to save your spot, and there’s no obligation to proceed with installation.", "",
    "### What could change this price?", "",
    ...(declaredThinPatchy
      ? [declaredExisting ? EXISTING_SAVE_SPOT_LINE : THIN_PATCHY_SAVE_SPOT_LINE, changePrice]
      : ["This quote is based on the information you supplied and assumes there is no existing ceiling insulation. Final measurements, ceiling access and any electrical fixes may affect the price. Insulation removal and electrical fixes are excluded."]),
    "",
    "We’ll confirm eligibility and your final quote, including any additional costs, for your approval before you commit.", "",
    "Home Insulation Victoria", "", footer(r.enquiryReference),
  ].join("\n");
}

function renderBelowR2Reviewed(r: JoRecipient, f: JoEstimateFigures): string {
  const assumedNote = f.areaEstimated
    ? "You didn’t provide a ceiling size, so we’ve used 150 m² for this preliminary quote. Your final price will depend on the measured ceiling area."
    : "We’ll confirm the ceiling measurements at your free Ready Check.";
  return [
    `Hi ${r.firstName},`, "",
    "How much could you save on ceiling insulation?", "",
    "Thanks for sending through your photos or video. We’ve reviewed them and, based on what is visible, your existing insulation appears potentially suitable for the VEU upgrade. Your free Ready Check will confirm the existing insulation and final eligibility.", "",
    "We’ll coordinate the installer, Pre Insulation Electrical Safety Assessment (PIESA) and rebate paperwork.", "",
    "### Your preliminary quote", "",
    `**You could save ${money(f.veuRebate)}**`, "",
    `Your estimated cost after rebate: ${money(f.customerTotal)} including GST`,
    `Before rebate: ${money(f.totalBeforeRebate)} including GST`, "",
    ...(f.removalUpTo != null && f.removalUpTo > 0 ? [removalUpToLine(f.removalUpTo, f.ceilingAreaM2), REMOVAL_UPTO_NOTE, ""] : []),
    `Property: ${r.propertyAddress}`,
    ceilingLine(f), "",
    assumedNote, "",
    "Want to explore a different ceiling size? Open the calculator →", "",
    includesTable(true, f), "",
    // Jo 22 Oct: when the "up to" removal box shows, the old removal section is dropped so nothing repeats.
    ...(f.removalUpTo != null && f.removalUpTo > 0 ? [] : [
    "### Will your existing insulation need to be removed?", "",
    "Some existing insulation may be able to stay, while other areas may need removal. We’ll assess this at your free Ready Check.", "",
    // Removal allowance = informational only; NOT added to the quoted total above.
    "Please budget $15 per m² including GST for the areas that need removal only. Removal is not included in this preliminary quote. We’ll confirm the area and cost for your approval before any removal proceeds.", ""]),
    "### Save your spot", "",
    "We’ve been inundated with requests from owners across Victoria and are opening Ready Check bookings in batches as suitably qualified installers become available.", "",
    "[Save my spot →]", "",
    "We’ll be in touch to arrange your free Ready Check when an installer is available in your area. No payment required. No obligation to proceed with installation.", "",
    "### What could change this price?", "",
    "Your Ready Check will confirm eligibility, ceiling measurements, existing insulation and access. electrical fixes are also excluded and will be quoted separately if required. Any changes will be explained and quoted for your approval.", "",
    "Home Insulation Victoria", "", footer(r.enquiryReference),
  ].join("\n");
}

/** Jo 23 Oct 2026 (DRAFT, awaiting Jo's final wording): "Tell us about your insulation" campaign variant of T5/T6 —
 *  same price box plus the "up to" removal line, one button to the three tap questions. */
export function questionsHeadline(firstName: string, veuRebate?: number | null): string {
  return typeof veuRebate === "number" && Number.isFinite(veuRebate) && veuRebate > 0
    ? `${firstName}, you could save ${money(veuRebate)} on ceiling insulation`
    : `${firstName}, you could save on ceiling insulation`;
}
export const INSULATION_QUESTIONS_CTA_LABEL = "Answer 3 questions & save my spot";
function renderPotentiallyEligible(r: JoRecipient, f: JoEstimateFigures, questions = false): string {
  const removalBox = questions && f.removalUpTo != null && f.removalUpTo > 0;
  const assumedNote = f.areaEstimated
    ? "You didn’t provide a ceiling size, so we’ve used 150 m² for this preliminary quote. These figures assume the property qualifies; eligibility and the measured ceiling area still need to be confirmed."
    : "These figures assume the property qualifies. We’ll confirm eligibility and the ceiling measurements at your free Ready Check.";
  return [
    `Hi ${r.firstName},`, "",
    // Jo 23 Oct 08:40 UTC: the campaign leads with THEIR rebate, same headline as Save my spot.
    questions ? questionsHeadline(r.firstName, f.veuRebate).replace(`${r.firstName}, you`, "You") : "Your home could qualify—there’s just a little more to check.", "",
    "Based on what you’ve told us, your home could qualify for a VEU ceiling insulation rebate. Before we can move your enquiry into the eligible queue, we need to check whether there is any existing insulation and what’s installed.", "",
    "In the meantime, here’s your preliminary quote to help you decide whether you’d like to take the next step.", "",
    "### Your preliminary quote", "",
    `**Potential VEU rebate: ${money(f.veuRebate)}**`, "",
    `Estimated cost if eligible: ${money(f.customerTotal)} including GST`,
    `Before rebate: ${money(f.totalBeforeRebate)} including GST`, "",
    ...(removalBox ? [removalUpToLine(f.removalUpTo!, f.ceilingAreaM2), REMOVAL_UPTO_NOTE, ""] : []),
    `Property: ${r.propertyAddress}`,
    ceilingLine(f), "",
    assumedNote, "",
    "Want to explore a different ceiling size? Open the calculator →", "",
    includesTable(true, f), "",
    ...(questions ? [
    // Jo 23 Oct 08:36 UTC final design: one sentence, one button.
    "### Save your spot", "",
    "To get your free Ready Check, answer 3 quick questions and save your spot.", "",
    "[Tell us about your insulation]", "",
    "Only take photos or video if you can do so safely, and don’t enter the roof space.", "",
    "### What could change this price?", "",
    removalBox ? "Final eligibility, measurements, access and any electrical fixes may affect the price. Electrical fixes are excluded. Any additional costs will be confirmed for your approval before you commit." : "If insulation is present, some may be able to stay and some may need removal. Allow $15 per m² including GST for the areas requiring removal only, assessed at your free Ready Check. Removal and electrical fixes are excluded.", "",
    "Home Insulation Victoria", "", footer(r.enquiryReference),
    ] : [
    "### Help us move your enquiry forward", "",
    "Demand is high, and we’re progressing homes with preliminary eligibility confirmed first.", "",
    "Tell us about your existing insulation: answer three quick tap questions — no typing. Got photos or a short video? You can add them too.", "",
    "[Tell us about your insulation]", "",
    "Only take photos or video if you can do so safely, and don’t enter the roof space. If you’re unable to obtain them safely, reply and let us know.", "",
    "### What could change this price?", "",
    "If insulation is present, some may be able to stay and some may need removal. Allow $15 per m² including GST for the areas requiring removal only, assessed at your free Ready Check.", "",
    "Removal and electrical fixes are excluded. Final eligibility, measurements, access and any additional costs will be confirmed for your approval before you commit.", "",
    "Home Insulation Victoria", "", footer(r.enquiryReference),
    ]),
  ].join("\n");
}

function renderIneligible(r: JoRecipient, reason: string): string {
  return [
    `Hi ${r.firstName},`, "",
    `Thank you for enquiring about ceiling insulation for ${r.propertyAddress}.`, "",
    "Based on the information provided, your property doesn’t appear eligible for a VEU ceiling insulation rebate at this stage.", "",
    "### Why your property doesn’t appear eligible", "",
    reason.trim(), "",
    "### Something doesn’t look right?", "",
    "This assessment is based on the details you supplied. If anything is incorrect, or you have information or photos that may change the outcome, please reply so we can review it.", "",
    "[Review my result →]", "",
    "Checking another property? You can use our calculator to explore an indicative price and potential rebate by entering its address, ceiling size and insulation details.", "",
    "Open the calculator →", "",
    "We understand this may not be the outcome you were hoping for. Please get in touch if you have any questions about your result.", "",
    "Home Insulation Victoria", "", footer(r.enquiryReference),
  ].join("\n");
}

function renderReadyCheckInvitation(r: JoRecipient, snap: SavedPricingSnapshot): string {
  const sizeLine = snap.areaEstimated
    ? `Ceiling size used in your quote: ${snap.ceilingAreaM2} m² — estimated`
    : `Ceiling size used in your quote: ${snap.ceilingAreaM2} m²`;
  // COM-09 (DEP-2): bind the "Book my Ready Check" CTA to the customer's own existing booking workflow when a
  // URL is supplied. Opening the link does not book; the customer still confirms on that page.
  const bookCta = snap.readyCheckBookingUrl
    ? `[Book my Ready Check →](${snap.readyCheckBookingUrl})`
    : `[Book my Ready Check →]`;
  return [
    `Hi ${r.firstName},`, "",
    "You saved your spot. Now it’s your turn!", "",
    "Thank you for your patience. We now have availability for a free Ready Check in your area and would love to get yours organised.", "",
    "We’ve included your saved preliminary quote below so you can review it before taking the next step.", "",
    "### Your saved preliminary quote", "",
    `**You could save ${money(snap.veuRebate)}**`, "",
    `Your estimated cost after rebate: ${money(snap.customerTotal)} including GST`,
    `Before rebate: ${money(snap.totalBeforeRebate)} including GST`, "",
    `Property: ${r.propertyAddress}`,
    sizeLine, "",
    "We’ve retained the pricing from your saved preliminary quote. Your Ready Check will confirm the measurements and work required.", "",
    // Personal estimate link preserving saved pricing — never the public calculator.
    `Want to explore a different ceiling size? [Open the calculator →](${snap.personalEstimateUrl})`, "",
    includesTable(true, snap), "",
    "### Book your free Ready Check", "",
    "Your installer will measure the ceiling, assess any existing insulation, check access and confirm the job scope so we can finalise your quote.", "",
    bookCta, "",
    "Confirm your request on the next page. An installer from our panel will then contact you to arrange a suitable time.", "",
    "No payment required. No obligation to proceed with installation.", "",
    "### What could change this price?", "",
    "The final total will depend on the measured ceiling area and confirmed scope. If existing insulation is present, some may be able to stay. Where removal is required, allow $15 per m² including GST for the affected areas only.", "",
    "Removal and electrical fixes are excluded unless expressly included in your saved quote. Any additional work will be explained and quoted for your approval before it proceeds.", "",
    "We look forward to helping you take the next step towards a more comfortable home.", "",
    "Home Insulation Victoria", "", footer(r.enquiryReference),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public render entry points
// ---------------------------------------------------------------------------

/** Subjects, verbatim from Jo's copy. */
export function subjectForTemplate(id: JoTemplateId, firstName: string, veuRebate?: number | null): string {
  switch (id) {
    case "eligible_no_insulation_size_unknown":
    case "eligible_no_insulation_size_known":
      // Jo: "[name], you could save $[VEU rebate] on ceiling insulation" — the placeholder is the real rebate.
      // Without a usable rebate figure the amount is omitted rather than invented.
      return typeof veuRebate === "number" && Number.isFinite(veuRebate) && veuRebate > 0
        ? `${firstName}, you could save ${money(veuRebate)} on ceiling insulation`
        : `${firstName}, you could save on ceiling insulation`;
    case "eligible_below_r2_reviewed_size_unknown":
    case "eligible_below_r2_reviewed_size_known":
      return `${firstName}, your insulation looks eligible—save your spot`;
    case "potentially_eligible_unknown_size_unknown":
    case "potentially_eligible_unknown_size_known":
      return `${firstName}, your preliminary quote is ready—let’s check your insulation`;
    case "ineligible":
      return "Your ceiling insulation eligibility result";
    case "ready_check_invitation":
      return `Great news, ${firstName}—it’s your turn to book your free Ready Check!`;
  }
}

/**
 * Render templates 1–6 (eligible / below-R2 reviewed / potentially eligible) from live figures.
 * The caller must have already resolved the template id via selectJoTemplate().
 */
export function renderJoEstimateEmail(
  id: Exclude<JoTemplateId, "ineligible" | "ready_check_invitation">,
  recipient: JoRecipient,
  figures: JoEstimateFigures,
  opts: { declaredThinPatchy?: boolean; declaredExisting?: boolean; insulationQuestions?: boolean } = {},
): JoRenderResult {
  let body: string;
  switch (id) {
    case "eligible_no_insulation_size_unknown":
    case "eligible_no_insulation_size_known":
      body = renderEligibleNoInsulation(recipient, figures, opts.declaredThinPatchy === true, opts.declaredExisting === true);
      break;
    case "eligible_below_r2_reviewed_size_unknown":
    case "eligible_below_r2_reviewed_size_known":
      body = renderBelowR2Reviewed(recipient, figures);
      break;
    case "potentially_eligible_unknown_size_unknown":
    case "potentially_eligible_unknown_size_known":
      body = renderPotentiallyEligible(recipient, figures, opts.insulationQuestions === true);
      break;
  }
  const subject = opts.insulationQuestions === true ? questionsHeadline(recipient.firstName, figures.veuRebate) : subjectForTemplate(id, recipient.firstName, figures.veuRebate);
  return { templateId: id, subject, body, ctas: ctasForTemplate(id) };
}

export function renderJoIneligibleEmail(recipient: JoRecipient, reason: string): JoRenderResult {
  return {
    templateId: "ineligible",
    subject: subjectForTemplate("ineligible", recipient.firstName),
    body: renderIneligible(recipient, reason),
    ctas: ctasForTemplate("ineligible"),
  };
}

/**
 * Render Template 8 from an immutable saved snapshot. This function NEVER recalculates with current rates;
 * it reads only the frozen snapshot and the customer-specific personal estimate link.
 */
export function renderJoReadyCheckInvitation(recipient: JoRecipient, snapshot: SavedPricingSnapshot): JoRenderResult {
  if (!snapshot || snapshot.personalEstimateUrl.length === 0) {
    throw new Error("Ready Check invitation requires a readable saved snapshot with a personal estimate link.");
  }
  return {
    templateId: "ready_check_invitation",
    subject: subjectForTemplate("ready_check_invitation", recipient.firstName),
    body: renderReadyCheckInvitation(recipient, snapshot),
    ctas: ctasForTemplate("ready_check_invitation"),
  };
}

// Re-export the Jo-approved removal note so senders never re-author it.
export { REMOVAL_BUDGET_EMAIL_NOTE };
