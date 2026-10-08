// Installer-led jobs: the installer brings their own customer; Home Insulation Victoria is the AP and invoices the
// owner with co-branding. Pure rules only.
import { FORMS, validateQuotedPrice, type QuotedPrice } from "./mitti-forms.core";
import { MIN_CUSTOMER_CONTRIBUTION_INC_GST, applyDiscountRules, discountNotes } from "./estimate.core";

export type ElectricianChoice = "installer_own" | "hivic_matched" | "installer_own_hivic_books";

/**
 * Owner PIESA charge on Home Insulation Victoria's quote. HIV-arranged electrician (hivic_matched / hivic_organise /
 * installer_own_hivic_books) = standard settings price. Installer's OWN electrician (installer_own / preferred /
 * nominated) invoices the owner directly (Jo, 9 Oct 2026 — provisional arrangement pending regulator confirmation):
 * HIV's PIESA fee is EXCLUDED (0, no line), never a blocker. Undecided = null (quote held).
 */
export function piesaChargeIncGst(choice: ElectricianChoice | string | null, standardPiesaIncGst: number | null): number | null {
  if (isDirectBilledElectrician(choice)) return 0;
  if (!(standardPiesaIncGst != null && standardPiesaIncGst > 0)) return null;
  if (choice === "hivic_matched" || choice === "hivic_organise" || choice === "installer_own_hivic_books") return standardPiesaIncGst;
  return null;
}
export const isDirectBilledElectrician = (choice: string | null | undefined) => choice === "installer_own" || choice === "preferred" || choice === "nominated";

export type OwnerPriceInput = { installerQuoteIncGst: number; piesaIncGst: number | null; rectificationIncGst: number; apFeeIncGst: number | null; veecDiscountIncGst: number };
/** Owner's co-branded invoice: installer quote + PIESA + rectification + AP fee − VEU discount. The discount is reduced if needed so the owner always pays at least the $200 minimum contribution (official VEU rule). */
export function installerLedOwnerPrice(i: OwnerPriceInput) {
  const blockers: string[] = [];
  if (!(i.installerQuoteIncGst > 0)) blockers.push("Installer quote amount is missing.");
  if (i.piesaIncGst == null) blockers.push("PIESA price not agreed for the chosen electrician.");
  if (i.apFeeIncGst == null) blockers.push("Home Insulation Victoria AP fee for installer-led jobs is not set.");
  const total = Math.round((i.installerQuoteIncGst + (i.piesaIncGst ?? 0) + i.rectificationIncGst + (i.apFeeIncGst ?? 0)) * 100) / 100;
  if (total < MIN_CUSTOMER_CONTRIBUTION_INC_GST) blockers.push(`Job total is below the $${MIN_CUSTOMER_CONTRIBUTION_INC_GST} minimum customer contribution.`);
  const discount = Math.round(Math.min(i.veecDiscountIncGst, Math.max(0, total - MIN_CUSTOMER_CONTRIBUTION_INC_GST)) * 100) / 100;
  const afterDiscount = Math.round((total - discount) * 100) / 100;
  return { total, discount, afterDiscount, reducedForMin: discount < i.veecDiscountIncGst, blockers, ready: blockers.length === 0 };
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
  areas: { name?: string | null; state?: "Uninsulated" | "Under-insulated" | null; depthPhoto?: boolean; rValue?: number | null; removal?: boolean | null; m2?: number | null; beforeVideo?: boolean; /** Jo 8 Oct 2026: installer tick box confirming existing insulation is below R2.0 and the home is eligible — replaces the depth photo + R-value when no photo is uploaded. */ belowR2Confirmed?: boolean }[];
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
      // Jo 8 Oct 2026: no depth photo is fine when the installer ticks the below-R2.0 / eligible confirmation.
      need(!!a.depthPhoto || !!a.belowR2Confirmed, `${n}: depth photo with vertical ruler`);
      need(!!a.belowR2Confirmed || (a.rValue != null && Number.isFinite(a.rValue)), `${n}: estimated existing R-value`);
      need(a.removal != null, `${n}: removal required?`);
      if (a.rValue != null && a.rValue >= 2) hardFail.push(`${n}: existing R-value is R2.0 or more – not eligible.`);
    }
  });
  const status = missing.length === 0 ? "complete" : have === 0 ? "none" : "partial";
  return { status, missing, hardFail };
}

/**
 * C02 (Jo, 2 Oct 2026): Ready Check items the installer didn't supply are collected with the PIISA on
 * installation day — except answers that decide eligibility or price, which must be settled first,
 * because the PIISA is signed on the day and can't reopen eligibility. Pure: nothing is stored and
 * the office still reviews; the split never lets a job progress by itself.
 */
const BEFORE_QUOTE_MARKERS = ["built in the last 5 years", "at least one measured area", "area name", "uninsulated or under-insulated", "measured m", "existing r-value", "removal required"];
export type CarryOver = { beforeQuote: string[]; atPiisa: string[] };

/** Splits a Ready Check gap list without dropping anything. */
export function piisaCarryOver(missing: string[]): CarryOver {
  const beforeQuote: string[] = [], atPiisa: string[] = [];
  for (const label of missing) (BEFORE_QUOTE_MARKERS.some((k) => label.toLowerCase().includes(k)) ? beforeQuote : atPiisa).push(label);
  return { beforeQuote, atPiisa };
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
  if (s.coverage.status !== "complete") return s.coverage.status === "none" ? "Book your free Ready Check." : `Add the missing items: ${s.coverage.missing.slice(0, 3).join("; ")}${s.coverage.missing.length > 3 ? "…" : ""}`;
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

// ---------------- Automatic co-branded quote from the priced Ready Check (Form A1) ----------------

/** Normalized label match: punctuation/apostrophe differences between portal wording and Mitti wording are ignored. */
const nrm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pick = (entries: { label: string; value: string | null }[], labels: string[]) =>
  entries.find((e) => labels.some((l) => nrm(e.label) === nrm(l)))?.value ?? null;

/** Reads the installer's ticked inclusions + total from the A1 answers, then validates (fails closed). */
export function quotedPriceFromEntries(entries: { label: string; value: string | null }[], removalRequired: boolean | null) {
  const inc = pick(entries, ["What's included in your quote?", "What's included in your price (tick all that apply)"]);
  const total = pick(entries, ["Total quoted price (inc GST)", "Total quoted price $"]);
  const agreed = pick(entries, ["Price already agreed with the owner?"]);
  const n = total == null ? null : Number(String(total).replace(/[$,\s]/g, ""));
  return validateQuotedPrice({
    included: (inc ?? "").split(/[,;\n|]+/),
    otherDescription: pick(entries, ["What else is included?", "Describe the other item"]),
    totalIncGst: n,
    agreedWithOwner: agreed == null ? null : /^y/i.test(agreed.trim()) ? true : /^n/i.test(agreed.trim()) ? false : null,
    removalRequired,
  });
}

export type InstallerQuoteLine = { code: string; description: string; quantity: number; unit: string; unit_price_inc_gst: number; line_total_inc_gst: number; is_other: boolean; explanation: string | null; sort: number };
export type InstallerQuoteDraft = { ready: boolean; blockers: string[]; lines: InstallerQuoteLine[]; subtotal: number; discount: number; afterDiscount: number; discountNote: string | null };

/** Region's program maximum + $200 minimum for the discount. metropolitan null/unknown uses the lower metro cap. */
/** No maximum discount exists (Jo, 5 Oct 2026); only the minimum customer contribution applies. */
export type DiscountCaps = { metropolitan: boolean | null; minCopay: number };

/**
 * Owner quote for an installer-brought job: installer price (with ticked inclusions) + PIESA (settings) + AP fee − VEU discount.
 * Discount = `wholeVeecDiscount` (whole VEECs × VEEC value setting, computed by the caller) through `applyDiscountRules`
 * (the $200 minimum only — no maximum). No lead fee, no margin.
 */
export function buildInstallerQuoteDraft(i: {
  price: ReturnType<typeof quotedPriceFromEntries>; measuredM2: number | null; wholeVeec: { veecs: number; raw: number } | null;
  piesaIncGst: number | null; apFeeIncGst: number | null; caps: DiscountCaps;
}): InstallerQuoteDraft {
  const blockers = [...i.price.issues];
  if (!(i.measuredM2 && i.measuredM2 > 0)) blockers.push("Measured ceiling area is missing.");
  if (i.wholeVeec == null) blockers.push("VEU discount can't be worked out (postcode or VEEC value missing).");
  const p = i.price.price;
  const rawDiscount = i.wholeVeec?.raw ?? 0;
  const preTotal = Math.round(((p?.totalIncGst ?? 0) + (i.piesaIncGst ?? 0) + (i.apFeeIncGst ?? 0)) * 100) / 100;
  const rules = applyDiscountRules(rawDiscount, preTotal, i.caps.metropolitan, {
    minimum_customer_copayment_inc_gst: i.caps.minCopay,
  });
  const owner = installerLedOwnerPrice({ installerQuoteIncGst: p?.totalIncGst ?? 0, piesaIncGst: i.piesaIncGst, rectificationIncGst: 0, apFeeIncGst: i.apFeeIncGst, veecDiscountIncGst: rules.discount });
  for (const b of owner.blockers) if (!blockers.includes(b)) blockers.push(b);
  const lines: InstallerQuoteLine[] = [];
  if (p) {
    const inc = p.included.map((x) => (x === "Other" && p.otherDescription ? `Other: ${p.otherDescription}` : x));
    lines.push({ code: "INSTALLER_PRICE", description: `Insulation works by your installer — includes: ${inc.join(", ")}`, quantity: 1, unit: "flat", unit_price_inc_gst: p.totalIncGst, line_total_inc_gst: p.totalIncGst, is_other: false, explanation: inc.join("\n"), sort: 0 });
  }
  if (i.piesaIncGst != null && i.piesaIncGst > 0) lines.push({ code: "PIESA", description: "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", quantity: 1, unit: "flat", unit_price_inc_gst: i.piesaIncGst, line_total_inc_gst: i.piesaIncGst, is_other: false, explanation: null, sort: 1 });
  if (i.apFeeIncGst != null && i.apFeeIncGst > 0) lines.push({ code: "AP_FEE", description: "Home Insulation Victoria — Accredited Person fee", quantity: 1, unit: "flat", unit_price_inc_gst: i.apFeeIncGst, line_total_inc_gst: i.apFeeIncGst, is_other: false, explanation: null, sort: 2 });
  return { ready: blockers.length === 0, blockers, lines, subtotal: owner.total, discount: owner.discount, afterDiscount: owner.afterDiscount, discountNote: discountNotes(rules).join(" ") || null };
}
