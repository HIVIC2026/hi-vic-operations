// Decision 222 (Jo 24 Oct 2026): the LEAN Mitti Ready Check templates (A1 installer-supplied customer, A2 our lead),
// per docs/MITTI_READY_CHECK_LIVE_AUDIT_2026-10-24.md §6 with Jo's one change (question 17 = Length (m) + Width (m)).
// Every wording the portal READS by label lives here, so the build sheet (mitti-forms.core.ts), the readers
// (mitti.core.ts, ready-check-answers.core.ts, ready-check-complete.core.ts, area-diagram.core.ts) and the ChatGPT
// build prompt (docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md, drift-tested) can never disagree. Pure: no I/O.
import { APPROVED_PRODUCTS } from "./insulation-product.core";

// The two Mitti template names (A1 installer-supplied customer, A2 our lead) are stated in the build prompt only; the
// portal identifies a template by its ID (workflow_settings), never by name.

/** Question wording, exactly as the lean forms show it and as the portal reads it. */
export const LEAN_Q = {
  // Page 1 — Job (prefilled)
  jobNumber: "Portal Job Number",
  siteAddress: "Site address",
  ownerName: "Homeowner name",
  ownerPhone: "Homeowner phone",
  ownerEmail: "Homeowner email",
  propertyType: "Property type",
  // Page 2 — Before you go up
  contactPermission: "Homeowner agrees to be contacted by Home Insulation Victoria",
  lifeSupport: "Life support equipment at property?",
  builtLast5: "Was the ceiling or roof built or replaced in the last 5 years?",
  premisesType: "Who lives at the property?",
  // Page 3 — Roof and access
  roofType: "What type of roof does the home have?",
  access: "How would you rate the ceiling access?",
  // Decision 290 (Jo 25 Oct 2026, corrected): "Is there a difficult access charge?" / "Difficult access fee ($ inc GST)"
  // are DELETED from A1 and A2 — the access rating, the access photo and the issues note are the flag; the boss (A1)
  // or the office (A2) decides any fee. The old labels live in LEAN_REMOVE so legacy readers and the delete prompt agree.
  accessPhoto: "Upload a clear photo of the ceiling access point",
  // Page 4 — Ceiling areas (ONE repeating group "Add a ceiling area")
  areaName: "Which part of the home does this ceiling area cover?",
  lengthM: "Length (m)",
  widthM: "Width (m)",
  /** Old forms only (22–24 Oct): the single m² entry. Still read as the fallback when no Length/Width. */
  measuredM2: "Enter the measured ceiling area (m²)",
  measuredHow: "How was this ceiling area measured?",
  measuredHowOther: "Tell us how you measured it",
  existing: "Is there existing insulation in this ceiling area?",
  existingType: "What type of existing insulation is installed? Select all that apply",
  rValue: "What is the determined R value of the existing ceiling insulation?",
  depthPhoto: "Upload a photo clearly showing the measured insulation depth",
  existingAction: "What is required for the existing insulation?",
  /** Decision 375 (Jo 25 Oct 2026): official PIISA Part 6 "average height of the existing insulation" (mm), per area, asked
   *  only when the area's existing insulation is Top up / Not sure (not when it is removed). Forms built before then lack it. */
  existingDepthMm: "Average depth of the existing insulation (mm)",
  removeM2: "How much existing insulation needs to be removed? (m²)",
  // Decision 359 (Jo 25 Oct 2026): the official PIISA Part 6 facts, asked per area only when existing insulation is present
  // (added to live A1/A2 by docs/MITTI_READY_CHECK_PART6_PROMPT.md; forms built before then simply lack them).
  /** Only when the area's existing insulation is "Top up". */
  existingSuitable: "Is the existing insulation in good enough condition to lay new insulation over?",
  existingConductive: "Is the existing insulation foil-backed, metallic or electrically conductive?",
  existingConductivePhoto: "Photo showing whether it is foil-backed or conductive",
  /** Only when the area's existing insulation is "Top up". */
  existingKeepReason: "Why is the existing insulation being kept?",
  /** Decision 264: the before video the rebate needs (replaces the optional overview photo); per area, before install. */
  beforeVideo: "Slow 360° video of this ceiling area, lit, saying its name",
  downlights: "Are there recessed downlights in this ceiling area?",
  downlightsCount: "How many recessed downlights?",
  issues: "Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards",
  /** Mitti cannot require a note on a media item, so the hazard description is its own required text question (Jo 24 Oct). */
  issueNote: "What is the issue, and where is it in this area?",
  issuePhoto: "Describe the issue and add a photo",
  // Page 5 — Product and result
  product: "What insulation product will you be using on this job?",
  outcome: "Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?",
  failReasons: "Why did the property fail the ready check? Select all that apply",
  noPricingTick: "I confirm I have not discussed or agreed pricing with the homeowner during this Ready Check. All quotes and pricing come from Home Insulation Victoria.",
  // OLD A1 forms only (decision 278, Jo 25 Oct 2026): the "Your quote to the homeowner" page is deleted from A1 — the
  // business owner enters the price in the portal. The readers keep these labels so forms built before 25 Oct still parse.
  included: "What’s included in your quote?",
  includedOther: "What else is included?",
  totalPrice: "Total quoted price (inc GST)",
  electrician: "Who is doing the electrical safety check?",
  electricianName: "Electrician name",
  electricianLicence: "Electrician licence number",
  electricianPrice: "Electrician price (inc GST)",
  // Page 7 — Sign
  signatureA1: "I confirm the information, measurements, photos and quote provided in this Ready Check are accurate to the best of my knowledge.",
  signatureA2: "I confirm the information, measurements and photos provided in this Ready Check are accurate to the best of my knowledge.",
} as const;

/** Earlier wordings the readers still accept (22–24 Oct live forms, 7–23 Oct spec labels, in-progress audits). */
export const LEAN_ALIASES: Partial<Record<keyof typeof LEAN_Q, readonly string[]>> = {
  siteAddress: ["Site address (please edit street number if incorrect address shows)", "Property Address"],
  ownerName: ["Owner name"],
  ownerPhone: ["Owner phone", "Owner mobile", "Homeowner mobile"],
  ownerEmail: ["Owner email"],
  lifeSupport: ["Office life support result"],
  roofType: ["Roof type"],
  access: ["How easy is the ceiling access?"],
  accessPhoto: ["Photo of the ceiling access point"],
  areaName: ["Where is this area?"],
  measuredM2: ["Measured area m2"],
  measuredHow: ["How was the ceiling measured?"],
  measuredHowOther: ["Explain the method"],
  existing: ["Is there existing insulation?"],
  existingType: ["Insulation type (tick all that apply)"],
  depthPhoto: ["Photo with tape measure showing depth"],
  /** Decision 375: the 22–25 Oct live forms still ask the old free-text depth (LEAN_REMOVE.depthMm, every area with existing
   *  insulation, any action) — read as the same fact; a non-number there is simply not recorded. */
  existingDepthMm: ["What is the measured insulation depth (mm)?"],
  existingAction: ["What needs to happen to it?"],
  removeM2: ["Area to remove (m2)"],
  beforeVideo: ["Upload an overview photo of this ceiling area", "Photo of the empty ceiling space"],
  downlights: ["Recessed downlights in this area?"],
  downlightsCount: ["How many?"],
  issues: ["Are there any issues that could affect the insulation installation?", "Hazards in this area?"],
  /** 24 Oct live forms asked a text "Please explain" (no photo): read as the hazard description, never as photo evidence. */
  issueNote: ["Please explain"],
  /** The 7 Oct spec said "Describe them and add a photo". */
  issuePhoto: ["Describe them and add a photo"],
  product: ["Insulation product"],
  included: ["What's included in your quote?", "What's included in your price (tick all that apply)"],
  signatureA1: [LEAN_Q.signatureA2],
  signatureA2: [LEAN_Q.signatureA1],
};

export const YES_NO = ["Yes", "No"] as const;
export const PROPERTY_TYPE_OPTIONS = ["House", "Townhouse", "Unit or apartment"] as const;
/** Activity Guide Appendix C premises type (VEEC claim). */
export const PREMISES_TYPE_OPTIONS = ["Owner lives here", "Private rental – tenant lives here", "Public housing", "Community housing"] as const;
export type PremisesTypeCode = "owner_occupied" | "private_rental" | "public_housing" | "community_housing";
export const ROOF_OPTIONS = ["Tiles", "Metal sheet", "Other"] as const;
export const NO_SAFE_ACCESS = "No safe access";
export const ACCESS_OPTIONS = ["Easy", "Standard", "Difficult", NO_SAFE_ACCESS] as const;
export const MEASURED_HOW_OPTIONS = ["Laser measure", "Tape measure", "Floor plan", "Other"] as const;
export const EXISTING_TYPE_OPTIONS = ["Batts", "Loose fill", "Other"] as const;
export const R_BELOW = "Below R2.0";
export const R_AT_OR_ABOVE = "R2.0 or above";
/** 22–24 Oct wording of the second option; still read as the R2-or-above stop on in-progress forms. */
export const R_ABOVE_LEGACY = "Above R2.0";
export const R_VALUE_OPTIONS = [R_BELOW, R_AT_OR_ABOVE] as const;
export const EXISTING_ACTION_OPTIONS = ["Remove", "Top up", "Not sure"] as const;
export const PRODUCT_OPTIONS = APPROVED_PRODUCTS.map((p) => p.option);
export const OUTCOME_PASSED = "Yes - Ready Check passed";
export const OUTCOME_FAILED = "No - Ready Check failed";
export const OUTCOME_OPTIONS = [OUTCOME_PASSED, OUTCOME_FAILED] as const;
export const FAIL_REASON_OPTIONS = ["Existing insulation is R2.0 or above", "Ceiling or roof built or replaced in the last 5 years", "No safe access to the ceiling", "Homeowner does not want to proceed", "Homeowner has not agreed to be contacted", "Other – explain in a note"] as const;
export const INCLUDED_OPTIONS = ["Ceiling insulation - supply & install", "Removal of existing insulation", "Other"] as const;
export const ELECTRICIAN_OPTIONS = ["Home Insulation Victoria electrician", "My usual electrician", "A different electrician"] as const;
export const AREA_GROUP_BUTTON = "Add a ceiling area";

/** Help texts shown under a question (never read by the portal). */
export const LEAN_HELP = {
  contactPermission: `If No, stop here and answer "${OUTCOME_FAILED}" on the last page.`,
  lifeSupport: "Pre-filled from what the owner told us. Change it if you learn otherwise; the office will call before anything goes out.",
  access: `No safe access: take the access photo, then go to the last page and answer "${OUTCOME_FAILED}".`,
  areaName: "Name it the way it will be named on install day, e.g. Main house, Rear extension, Garage.",
  dimensions: "Measure the longest length and width of this ceiling area. Split an L-shaped ceiling into two areas. The portal works out the m² and draws the diagram.",
  rValue: `R2.0 exactly counts as "${R_AT_OR_ABOVE}". Typical old 50–70 mm batts or thin loose fill are ${R_BELOW}.`,
  beforeVideo: "This is the before video the rebate needs. Show any existing insulation.",
  outcome: "The portal also applies the eligibility rules from your answers above.",
} as const;

/** Decision 278: the A1 quote page ("Your quote to the homeowner") and its seven questions, deleted from the A1 template.
 *  Named here so the delete prompt (docs/MITTI_READY_CHECK_PRICE_PROMPT.md) and the build prompt can never disagree. */
export const A1_QUOTE_PAGE = "Your quote to the homeowner";
export const A1_QUOTE_QUESTIONS = [LEAN_Q.included, LEAN_Q.includedOther, LEAN_Q.totalPrice, LEAN_Q.electrician, LEAN_Q.electricianName, LEAN_Q.electricianLicence, LEAN_Q.electricianPrice] as const;

/** §6.5 — every live item the lean forms drop (exact live labels). The prompt tells ChatGPT not to carry these over. */
export const LEAN_REMOVE = {
  sketchA1: "Upload your area sketch or floor plan.",
  sketchA2: "Upload your area sketch or floor plan. Rough is fine. Mark this ceiling area and show the measurements used.",
  depthMm: "What is the measured insulation depth (mm)?",
  describeType: "Please describe the existing insulation type",
  pleaseExplain: "Please explain",
  howMany: "How many ceiling areas need to be measured separately?",
  areaHeading: (n: number) => `── Ceiling Area ${n} ──`,
  clickOnMe: "CLICK ON ME to add a ceiling area",
  propertyTypeOther: "What is the property type?",
  describeRoof: "Describe the roof type",
  explainDifficult: "Please explain why the access is difficult",
  explainNoSafe: "Please explain why there is no safe access",
  includedDifficultAccess: "Difficult access",
  /** Decision 290 (corrected, Jo 25 Oct 2026): the access charge pair is deleted from BOTH templates; old forms are still read. */
  accessCharge: "Is there a difficult access charge?",
  accessFee: "Difficult access fee ($ inc GST)",
} as const;
export const LEAN_REMOVE_COPIES = { a1: 22, a2: 21 } as const;

// ---------- pure readers shared by the label readers ----------
const t = (v: unknown) => String(v ?? "").trim();
/** "R2.0 or above" (lean) or "Above R2.0" (22–24 Oct): the existing insulation is NOT below R2.0 → ineligible. */
export const isR2OrAbove = (v: unknown): boolean => /^(above\s*r?\s*2(\.0)?|r?\s*2(\.0)?\s*or\s*above)$/i.test(t(v));
export const isBelowR2 = (v: unknown): boolean => /^below\s*r?\s*2(\.0)?$/i.test(t(v));
/** Either band answer (never a number, so never a "not a valid number" issue). */
export const isRValueBandAnswer = (v: unknown): boolean => isBelowR2(v) || isR2OrAbove(v);
export const isNoSafeAccess = (v: unknown): boolean => /^no safe access\b/i.test(t(v));

/** "Who lives at the property?" → Appendix C premises type code. Unknown wording → null, never guessed. */
export function premisesTypeCode(answer: unknown): PremisesTypeCode | null {
  const s = t(answer).toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (s === PREMISES_TYPE_OPTIONS[0].toLowerCase() || /^owner/.test(s)) return "owner_occupied";
  if (s === PREMISES_TYPE_OPTIONS[1].toLowerCase() || /^private rental|^rental|tenant/.test(s)) return "private_rental";
  if (s === PREMISES_TYPE_OPTIONS[2].toLowerCase() || /^public housing/.test(s)) return "public_housing";
  if (s === PREMISES_TYPE_OPTIONS[3].toLowerCase() || /^community housing/.test(s)) return "community_housing";
  return null;
}
/** Portal occupancy record ("owner_occupied" / "rental", as stored or with the underscore replaced) → the lean option to prefill. */
export function premisesTypeOption(occupancy: unknown): string | null {
  const s = t(occupancy).toLowerCase().replace(/_/g, " ");
  if (s === "owner occupied") return PREMISES_TYPE_OPTIONS[0];
  if (s === "rental" || s === "private rental") return PREMISES_TYPE_OPTIONS[1];
  if (s === "public housing") return PREMISES_TYPE_OPTIONS[2];
  if (s === "community housing") return PREMISES_TYPE_OPTIONS[3];
  return null;
}
