// Installer-led jobs: the installer brings their own customer; HI VIC is the AP and invoices the
// owner with co-branding. Pure rules only.
import { FORMS } from "./mitti-forms.core";

export const HIVIC_PIESA_INC_GST = 349;
export type ElectricianChoice = "installer_own" | "hivic_matched" | "installer_own_hivic_books";

/** PIESA owner charge: $349 with a HI VIC electrician, otherwise the installer's REC's agreed onboarding price. Null = not agreed (fail closed). */
export function piesaChargeIncGst(choice: ElectricianChoice | null, ownRecPiesaIncGst: number | null): number | null {
  if (choice === "hivic_matched") return HIVIC_PIESA_INC_GST;
  if (choice === "installer_own" || choice === "installer_own_hivic_books") return ownRecPiesaIncGst != null && ownRecPiesaIncGst > 0 ? ownRecPiesaIncGst : null;
  return null;
}

export type OwnerPriceInput = { installerQuoteIncGst: number; piesaIncGst: number | null; rectificationIncGst: number; apFeeIncGst: number | null; veecDiscountIncGst: number };
/** Owner's co-branded invoice: installer quote + PIESA + rectification + AP fee − VEU discount; minimum $200 co-payment. */
export function installerLedOwnerPrice(i: OwnerPriceInput) {
  const blockers: string[] = [];
  if (!(i.installerQuoteIncGst > 0)) blockers.push("Installer quote amount is missing.");
  if (i.piesaIncGst == null) blockers.push("PIESA price not agreed for the chosen electrician.");
  if (i.apFeeIncGst == null) blockers.push("HI VIC AP fee for installer-led jobs is not set.");
  const total = Math.round((i.installerQuoteIncGst + (i.piesaIncGst ?? 0) + i.rectificationIncGst + (i.apFeeIncGst ?? 0)) * 100) / 100;
  const afterDiscount = Math.round((total - i.veecDiscountIncGst) * 100) / 100;
  if (afterDiscount < 200) blockers.push("Owner co-payment would be below the $200 minimum.");
  return { total, discount: i.veecDiscountIncGst, afterDiscount, referralFee: 0, blockers, ready: blockers.length === 0 };
}

export type SuppliedEvidence = {
  installerIdPhoto?: boolean; buildingClass?: string | null; builtLast5Years?: boolean | null; floorPlan?: boolean; icObservation?: boolean | null;
  areas: { name?: string | null; state?: "Uninsulated" | "Under-insulated" | null; depthPhoto?: boolean; rValue?: number | null; removal?: boolean | null; m2?: number | null; beforeVideo?: boolean }[];
};
export type Coverage = { status: "complete" | "partial" | "none"; missing: string[]; hardFail: string[] };

/** Maps what the installer already supplied onto the Ready Check list. Only HI VIC can accept a complete result. */
export function readyCheckCoverage(e: SuppliedEvidence): Coverage {
  const missing: string[] = []; const hardFail: string[] = [];
  let have = 0;
  const need = (ok: boolean, label: string) => { if (ok) have++; else missing.push(label); };
  need(!!e.installerIdPhoto, "Installer photo at front of premises with photo ID");
  need(!!e.buildingClass, "Building class");
  need(e.builtLast5Years != null, "Built in the last 5 years?");
  if (e.builtLast5Years === true) hardFail.push("Relevant ceiling built in the last 5 years – not eligible.");
  need(!!e.floorPlan, "Floor plan with dimensions");
  need(e.icObservation != null, "Luminaire IC/IC-4 observation");
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
  if (s.electrician !== "hivic_matched" && !s.electricianApproved) return "Your electrician must finish HI VIC onboarding before they can be assigned.";
  return "Book the PIESA with the electrician in portal chat.";
}

export const READY_CHECK_FIELD_COUNT = FORMS.ready_check.fields.length;
