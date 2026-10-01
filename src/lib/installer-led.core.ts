// Installer-led jobs: the installer brings their own customer; Home Insulation Victoria is the AP and invoices the
// owner with co-branding. Pure rules only.
import { FORMS, type QuotedPrice } from "./mitti-forms.core";

export const HIVIC_PIESA_INC_GST = 349;
export type ElectricianChoice = "installer_own" | "hivic_matched" | "installer_own_hivic_books";

/** Owner charge is the standard $349 for every approved electrician choice; an own REC's agreed rate is an internal supplier cost only. */
export function piesaChargeIncGst(choice: ElectricianChoice | null, _ownRecPiesaIncGst: number | null): number | null {
  if (choice === "hivic_matched" || choice === "installer_own" || choice === "installer_own_hivic_books") return HIVIC_PIESA_INC_GST;
  return null;
}

export type OwnerPriceInput = { installerQuoteIncGst: number; piesaIncGst: number | null; rectificationIncGst: number; apFeeIncGst: number | null; veecDiscountIncGst: number };
/** Owner's co-branded invoice: installer quote + PIESA + rectification + AP fee − VEU discount; minimum $200 co-payment. */
export function installerLedOwnerPrice(i: OwnerPriceInput) {
  const blockers: string[] = [];
  if (!(i.installerQuoteIncGst > 0)) blockers.push("Installer quote amount is missing.");
  if (i.piesaIncGst == null) blockers.push("PIESA price not agreed for the chosen electrician.");
  if (i.apFeeIncGst == null) blockers.push("Home Insulation Victoria AP fee for installer-led jobs is not set.");
  const total = Math.round((i.installerQuoteIncGst + (i.piesaIncGst ?? 0) + i.rectificationIncGst + (i.apFeeIncGst ?? 0)) * 100) / 100;
  const afterDiscount = Math.round((total - i.veecDiscountIncGst) * 100) / 100;
  if (afterDiscount < 200) blockers.push("Owner co-payment would be below the $200 minimum.");
  return { total, discount: i.veecDiscountIncGst, afterDiscount, referralFee: 0, blockers, ready: blockers.length === 0 };
}

/**
 * Builds the owner's co-branded price from the installer's validated quoted price (Form A1 sync).
 * The quoted price must already have passed validateQuotedPrice — unvalidated or mismatched
 * figures never reach the owner quote; they go to office review instead.
 */
export function ownerPriceFromQuoted(
  price: QuotedPrice,
  fees: { piesaIncGst: number | null; rectificationIncGst: number; apFeeIncGst: number | null; veecDiscountIncGst: number },
) {
  return installerLedOwnerPrice({ installerQuoteIncGst: price.totalIncGst, ...fees });
}

export type SuppliedEvidence = {
  installerIdPhoto?: boolean; buildingClass?: string | null; builtLast5Years?: boolean | null; floorPlan?: boolean; icObservation?: boolean | null;
  areas: { name?: string | null; state?: "Uninsulated" | "Under-insulated" | null; depthPhoto?: boolean; rValue?: number | null; removal?: boolean | null; m2?: number | null; beforeVideo?: boolean }[];
};
export type Coverage = { status: "complete" | "partial" | "none"; missing: string[]; hardFail: string[] };

/** Maps what the installer already supplied onto the Ready Check list. Only Home Insulation Victoria can accept a complete result. */
export function readyCheckCoverage(e: SuppliedEvidence): Coverage {
  const missing: string[] = []; const hardFail: string[] = [];
  let have = 0;
  const need = (ok: boolean, label: string) => { if (ok) have++; else missing.push(label); };
  need(!!e.installerIdPhoto, "Installer photo at front of premises with photo ID");
  need(!!e.buildingClass, "Building class");
  need(e.builtLast5Years != null, "Built in the last 5 years?");
  if (e.builtLast5Years === true) hardFail.push("Relevant ceiling built in the last 5 years – not eligible.");
  need(!!e.floorPlan, "Floor plan with dimensions");
  need(e.icObservation != null, "Recessed downlights check");
  if (e.areas.length === 0) missing.push("At least one measured area");
  e.areas.forEach((a, i) => {
    const n = a.name?.trim() || `Area ${i + 1}`;
    need(!!a.name?.trim(), `${n}: area name`);
    need(!!a.state, `${n}: uninsulated or under-insulated`);
    need(!!(a.m2 && a.m2 > 0 && a.m2 <= 5000), `${n}: measured m²`);
    need(!!a.beforeVideo, `${n}: 360° before video`);
    if (a.state === "Under-insulated") {
      need(!!a.depthPhoto, `${n}: depth photo with vertical ruler`);
      need(a.rValue != null && Number.isFinite(a.rValue), `${n}: estimated existing R-value`);
      need(a.removal != null, `${n}: removal required?`);
      if (a.rValue != null && a.rValue >= 2) hardFail.push(`${n}: existing R-value is R2.0 or more – not eligible.`);
    }
  });
  const status = missing.length === 0 ? "complete" : have === 0 ? "none" : "partial";
  return { status, missing, hardFail };
}

export type JourneyStep = "submit" | "eligibility" | "measure_up" | "electrician" | "piesa" | "quote" | "pre_install" | "install" | "completion" | "veecs";
export const JOURNEY: { key: JourneyStep; label: string }[] = [
  { key: "submit", label: "Job submitted" }, { key: "eligibility", label: "Eligibility" }, { key: "measure_up", label: "Measure-up" },
  { key: "electrician", label: "Electrician" }, { key: "piesa", label: "PIESA" }, { key: "quote", label: "Quote + e-sign" },
  { key: "pre_install", label: "Pre-install checks" }, { key: "install", label: "Install day" }, { key: "completion", label: "Completion sign-off" }, { key: "veecs", label: "VEECs" },
];

/** What the installer must do next, in plain words. */
export function installerNextAction(s: { eligible: boolean | null; coverage: Coverage; electrician: ElectricianChoice | null; electricianApproved: boolean }): string {
  if (s.eligible === false || s.coverage.hardFail.length) return "Not eligible – no further action. The owner will receive the result email once the office approves it.";
  if (s.eligible == null) return "Waiting for the owner to complete their eligibility questions.";
  if (s.coverage.status !== "complete") return s.coverage.status === "none" ? "Book your free Ready Check (Mitti form A)." : `Add the missing items: ${s.coverage.missing.slice(0, 3).join("; ")}${s.coverage.missing.length > 3 ? "…" : ""}`;
  if (!s.electrician) return "Choose an electrician: add your own or request one of ours.";
  if (s.electrician !== "hivic_matched" && !s.electricianApproved) return "Your electrician must finish Home Insulation Victoria onboarding before they can be assigned.";
  return "Book the PIESA with the electrician in portal chat.";
}

export const READY_CHECK_FIELD_COUNT = FORMS.ready_check.fields.length;

/** Where an installer-led job sits on the journey, from its pipeline stage. */
export function journeyStepFor(stage: string | null): JourneyStep {
  const s = stage ?? "new_enquiry";
  if (["new_enquiry", "eligibility_review", "preliminary_estimate_ready"].includes(s)) return "eligibility";
  if (s.startsWith("ready_check") || s === "measured_estimate_ready") return "measure_up";
  if (s === "awaiting_electrician") return "electrician";
  if (["assessment_booking", "assessment_booked", "piesa_and_install_window_pending", "piesa_scheduled", "piesa_complete", "rectification_required", "electrical_variation_pending"].includes(s)) return "piesa";
  if (["assessment_complete", "ready_for_installer_quotes", "awaiting_quote_acceptance", "measured_quote_accepted", "awaiting_owner_rectification_approval", "awaiting_deposit_payment"].includes(s)) return "quote";
  if (["rectification_scheduling", "rectification_booked", "installation_scheduling"].includes(s)) return "pre_install";
  if (s === "installation_booked") return "install";
  if (["evidence_outstanding", "ap_review"].includes(s)) return "completion";
  if (["ready_for_veec", "complete"].includes(s)) return "veecs";
  return "submit";
}

export type MeasurementRecord = {
  measured_area_m2: number | null; supplied_area_m2: number | null; insulation_present: boolean | null;
  existing_r_value: number | null; removal_required: boolean | null; raw_snapshot: Record<string, unknown> | null;
} | null;

/** Maps the plain property type to the NCC building class. Installers are never asked for "Class 1/Class 2" jargon. */
export function classFromPropertyType(t: string | null): string | null {
  const v = t?.trim().toLowerCase();
  if (!v) return null;
  if (v === "house" || v === "townhouse") return "Class 1";
  if (v.startsWith("unit")) return "Class 2 sole-occupancy unit";
  return null;
}

/** Builds SuppliedEvidence from stored records only. Anything not recorded counts as missing — never assumed. */
export function evidenceFromRecords(m: MeasurementRecord, evidenceCategories: string[], builtLast5Years: boolean | null): SuppliedEvidence {
  const snap = m?.raw_snapshot ?? {};
  const has = (c: string) => evidenceCategories.includes(c);
  const str = (k: string) => (typeof snap[k] === "string" && (snap[k] as string).trim()) || null;
  const bool = (k: string) => (typeof snap[k] === "boolean" ? (snap[k] as boolean) : null);
  const m2 = m?.measured_area_m2 ?? m?.supplied_area_m2 ?? null;
  return {
    installerIdPhoto: bool("installer_id_photo") === true,
    buildingClass: str("building_class") ?? classFromPropertyType(str("property_type")),
    builtLast5Years,
    floorPlan: bool("floor_plan") === true,
    icObservation: bool("ic_observation"),
    areas: m ? [{
      name: str("area_name") ?? "Main ceiling",
      state: m.insulation_present == null ? null : m.insulation_present ? "Under-insulated" : "Uninsulated",
      m2, rValue: m.existing_r_value, removal: m.removal_required,
      depthPhoto: has("existing_insulation_r_value"), beforeVideo: has("before_ceiling_space"),
    }] : [],
  };
}
