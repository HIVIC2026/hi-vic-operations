/**
 * Home Insulation Ready Check — pure rules. No network, no Xero, no invoice/deposit logic.
 * Locked journey: preliminary estimate → free Ready Check (insulation installer) → automatic measured
 * quote with PRELIMINARY electrical allowance (no manual electrician review) → acceptance →
 * paired PIESA + install window → formal PIESA reconciliation against the same REC rate card.
 */

export const READY_CHECK_FEE = 0 as const;
export const READY_CHECK_COPY_VERSION = "ready-check-free-v2" as const;
export const READY_CHECK_NAME = "Home Insulation Ready Check" as const;
export const READY_CHECK_SHORT = "Ready Check" as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------- Payment (test mode) ----------------
export type ReadyCheckPaymentStatus = "accepted";
export type TestPaymentOutcome = "failure" | "success";

export type ReadyCheckAcceptanceState = {
  acceptanceId: string;
  estimateId: string;
  acceptedAt: string;
  paymentId: string | null;
  paymentStatus: ReadyCheckPaymentStatus;
  amountIncGst: number;
  estimatedRemainingBalanceIncGst: number;
  paidAt: string | null;
  stale: boolean;
};

/** The Ready Check is free, so the full estimated project amount remains. */
export function readyCheckRemaining(costAfterDiscountIncGst: number, feeIncGst: number = READY_CHECK_FEE): number {
  // The fee is collected once; the remaining balance never includes it again. Legacy/protected = 0.
  if (!Number.isFinite(feeIncGst) || feeIncGst < 0) throw new Error("Invalid Ready Check fee");
  return Math.max(0, round2(costAfterDiscountIncGst - feeIncGst));
}

export function acceptanceIsCurrent(acceptedEstimateId: string, currentEstimateId: string | null): boolean {
  return !!currentEstimateId && acceptedEstimateId === currentEstimateId;
}

/** Single post-acceptance target. Never PIESA, never an invoice/deposit. */
export const READY_CHECK_PAID_STAGE = "ready_check_ready_to_schedule" as const;
export const READY_CHECK_PAID_NEXT_ACTION = "Assign EEC Certified Insulation Installer and arrange Ready Check" as const;

export const READY_CHECK_BOOKING_SUCCESS = {
  heading: "YOUR READY CHECK IS BOOKING NEXT",
  received: "Your free Home Insulation Ready Check request has been received.",
  assignment: "An EEC Certified Insulation Installer from our partner network will be assigned to your job and will contact you to arrange a suitable time for your onsite Ready Check.",
  visit: "During the Ready Check they’ll measure your ceiling space and collect the site information we need to prepare your measured project estimate.",
  reassurance: "Home Insulation Victoria will keep the booking and job progress recorded in your project.",
} as const;

// ---------------- Stages ----------------
/** Ordered Ready Check pathway. There is deliberately NO electrician-review stage between ready_check_complete and measured_estimate_ready. */
export const READY_CHECK_STAGES = [
  "preliminary_estimate_ready",
  "ready_check_awaiting_acceptance",
  "ready_check_awaiting_payment",
  "ready_check_ready_to_schedule",
  "ready_check_scheduled",
  "ready_check_complete",
  "measured_estimate_ready",
  "measured_quote_accepted",
  "piesa_and_install_window_pending",
  "piesa_scheduled",
  "piesa_complete",
  "electrical_variation_pending",
] as const;
export type ReadyCheckStage = (typeof READY_CHECK_STAGES)[number];

// ---------------- Mitti-ready field model ----------------
/** Stable internal keys. Mitti field IDs are mapped later — never invented here. */
export type FieldKind = "text" | "number" | "integer" | "enum" | "boolean" | "datetime" | "evidence";
export type FieldDef = { key: string; section: "A" | "B" | "C" | "D"; label: string; kind: FieldKind; options?: readonly string[]; required?: boolean; mittiFieldId: null };

const f = (section: FieldDef["section"], key: string, label: string, kind: FieldKind, extra: Partial<FieldDef> = {}): FieldDef => ({ key, section, label, kind, mittiFieldId: null, ...extra });
const TRI = ["yes", "no", "uncertain"] as const;
const UNABLE = "unable_to_confirm";

export const READY_CHECK_FIELDS: readonly FieldDef[] = [
  // A. Attendance / evidence
  f("A", "attendance.installer_user_id", "Installer / assessor", "text", { required: true }),
  f("A", "attendance.installer_business_id", "Installer business", "text", { required: true }),
  f("A", "attendance.attended_at", "Attended at", "datetime", { required: true }),
  f("A", "attendance.geotag_photo", "Geotagged / timestamped attendance photo", "evidence", { required: true }),
  f("A", "attendance.ceiling_space_media", "Overall ceiling-space video/photos", "evidence", { required: true }),
  // B. Measurement / insulation
  f("B", "measure.eligible_area_m2", "Measured eligible ceiling area (m²)", "number", { required: true }),
  f("B", "measure.method", "Measurement method", "enum", { options: ["tape", "laser", "plan_verified_onsite", "other"], required: true }),
  f("B", "measure.evidence", "Measurement evidence", "evidence"),
  f("B", "measure.sections", "Floor/ceiling sections", "text"),
  f("B", "insulation.existing", "Existing insulation", "enum", { options: ["none", "present", "unknown"], required: true }),
  f("B", "insulation.type", "Insulation type", "text"),
  f("B", "insulation.depth_mm", "Observed depth (mm)", "number"),
  f("B", "insulation.r_value", "Observed R-value", "number"),
  f("B", "insulation.photos", "Insulation photo evidence", "evidence"),
  f("B", "removal.required", "Removal required", "enum", { options: TRI, required: true }),
  f("B", "removal.area_m2", "Estimated removal m²", "number"),
  f("B", "removal.reason", "Removal evidence / reason", "text"),
  // C. Access / install factors
  f("C", "access.manhole_size", "Manhole/access size", "text"),
  f("C", "access.manhole_photo", "Manhole photo", "evidence"),
  f("C", "access.level", "Access", "enum", { options: ["standard", "moderate", "difficult"], required: true }),
  f("C", "access.obstructions", "Obstructions", "text"),
  f("C", "access.low_clearance", "Low-clearance areas", "text"),
  f("C", "access.roof_config", "Roof/ceiling configuration affecting install", "text"),
  f("C", "access.notes", "Access notes", "text"),
  f("C", "access.evidence", "Access evidence", "evidence"),
  // D. OBJECTIVE preliminary electrical observations — no compliance conclusion
  f("D", "elec.downlight_count", "Downlights (count)", "integer", { required: true }),
  f("D", "elec.downlight_type", "Downlight observed type", "enum", { options: ["led", "halogen", "other", UNABLE], required: true }),
  f("D", "elec.downlight_photos", "Downlight label/photo evidence", "evidence"),
  f("D", "elec.exhaust_fan_count", "Exhaust fans (count)", "integer"),
  f("D", "elec.exhaust_fan_photos", "Exhaust fan photos", "evidence"),
  f("D", "elec.switchboard_photo", "Switchboard overview photo", "evidence"),
  f("D", "elec.switchboard_type", "Switchboard visible type", "enum", { options: ["modern_breakers", "ceramic_fuses_visible", "mixed", UNABLE] }),
  f("D", "elec.rcd_visible", "RCDs visible (observation only)", "enum", { options: ["present", "not_visible", UNABLE] }),
  f("D", "elec.solar_battery_present", "Solar/battery present", "boolean"),
  f("D", "elec.solar_cabling_in_ceiling", "Solar/battery cabling visible in ceiling", "enum", { options: TRI }),
  f("D", "elec.damaged_wiring_visible", "Obvious damaged/exposed wiring visible", "enum", { options: TRI }),
  f("D", "elec.unusual_condition", "Unusual electrical condition observed", "boolean"),
  f("D", "elec.unusual_condition_description", "Unusual condition description", "text"),
  f("D", "elec.other_photos", "Other electrical observation photos", "evidence"),
] as const;

export const ELECTRICAL_OBSERVATION_DISCLAIMER =
  "These are preliminary observations recorded by the insulation installer. They are not a PIESA and not a statement of electrical compliance.";

/** Keys that may never be written from a Ready Check (installer) — compliance belongs to the formal PIESA. */
export const FORBIDDEN_OBSERVATION_KEYS = /(piesa|pass|fail|complian|adequa|safe_to|certif)/i;

export type Observations = Record<string, string | number | boolean | null>;

/** Validates installer observations. Rejects any PIESA/compliance conclusion and malformed values. */
export function validateObservations(obs: Observations): string[] {
  const issues: string[] = [];
  const known = new Map(READY_CHECK_FIELDS.map((d) => [d.key, d]));
  for (const [key, value] of Object.entries(obs)) {
    if (FORBIDDEN_OBSERVATION_KEYS.test(key)) { issues.push(`${key}: installers cannot record PIESA or compliance conclusions`); continue; }
    const def = known.get(key);
    if (!def) { issues.push(`${key}: unknown field`); continue; }
    if (value == null) continue;
    if ((def.kind === "number" || def.kind === "integer") && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (def.kind === "integer" && !Number.isInteger(value)))) issues.push(`${key}: must be a non-negative ${def.kind}`);
    if (def.kind === "enum" && (typeof value !== "string" || !def.options?.includes(value))) issues.push(`${key}: invalid option`);
    if (def.kind === "boolean" && typeof value !== "boolean") issues.push(`${key}: must be yes/no`);
  }
  for (const def of READY_CHECK_FIELDS) if (def.required && def.kind !== "evidence" && obs[def.key] == null) issues.push(`${def.key}: required`);
  return issues;
}

// ---------------- REC rate card + allowance engine ----------------
export type RuleKind = "QUANTITY_RATE" | "FIXED_ALLOWANCE" | "CONSERVATIVE_ALLOWANCE" | "UNPRICEABLE_FLAG";
export type RateCardItem = {
  code: string;
  description: string;
  rule: RuleKind;
  unit: "each" | "fixed";
  rateIncGst: number | null; // null only for UNPRICEABLE_FLAG
  triggerKey: string;
  triggerValue: string | number | boolean | null; // null = any positive quantity
  quantitySource: string | null; // observation key used for QUANTITY_RATE
  conservativeQuantity?: number | null;
};
export type RateCard = { id: string; version: number; effectiveFrom: string; active: boolean; testOnly: boolean; items: RateCardItem[] };

export type AllowanceLine = { code: string; description: string; rule: RuleKind; quantity: number; unitRateIncGst: number; amountIncGst: number; sourceKey: string; sourceValue: unknown };
export type UnpriceableFlag = { code: string; description: string; sourceKey: string; sourceValue: unknown };
export type AllowanceSnapshot = {
  preliminary_only: true;
  rate_card_id: string;
  rate_card_version: number;
  ready_check_version: number;
  lines: AllowanceLine[];
  unpriceable: UnpriceableFlag[];
  preliminary_electrical_allowance_total: number;
};

export const UNPRICEABLE_COPY = "Additional electrical work may be required — unable to estimate from the preliminary observations.";
export const ALLOWANCE_COPY = "Based on the observable electrical items recorded during your Home Insulation Ready Check and Home Insulation Victoria’s agreed electrician rate card. Your mandatory PIESA is completed later by a licensed electrician and confirms the actual electrical safety requirements before installation.";

function triggered(item: RateCardItem, obs: Observations): boolean {
  const v = obs[item.triggerKey];
  if (item.triggerValue === null) return typeof v === "number" ? v > 0 : v === true;
  return v === item.triggerValue;
}

/** Deterministic: same observations + same rate-card version ⇒ identical snapshot. No approval state exists. */
export function computeElectricalAllowance(obs: Observations, card: RateCard, readyCheckVersion: number): AllowanceSnapshot {
  const lines: AllowanceLine[] = [];
  const unpriceable: UnpriceableFlag[] = [];
  const items = [...card.items].sort((a, b) => a.code.localeCompare(b.code));
  for (const item of items) {
    if (!triggered(item, obs)) continue;
    const sourceValue = obs[item.triggerKey];
    if (item.rule === "UNPRICEABLE_FLAG") { unpriceable.push({ code: item.code, description: item.description, sourceKey: item.triggerKey, sourceValue }); continue; }
    if (item.rateIncGst == null || !Number.isFinite(item.rateIncGst) || item.rateIncGst < 0) continue;
    let quantity = 1;
    if (item.rule === "QUANTITY_RATE") {
      const q = item.quantitySource ? obs[item.quantitySource] : null;
      if (typeof q !== "number" || !Number.isInteger(q) || q <= 0) continue;
      quantity = q;
    } else if (item.rule === "CONSERVATIVE_ALLOWANCE") {
      const cq = item.conservativeQuantity;
      if (cq != null) {
        if (!Number.isInteger(cq) || cq <= 0) continue;
        quantity = cq;
        if (item.quantitySource) {
          const q = obs[item.quantitySource];
          if (typeof q === "number" && Number.isInteger(q) && q > 0) quantity = q;
        }
      }
    }
    lines.push({ code: item.code, description: item.description, rule: item.rule, quantity, unitRateIncGst: item.rateIncGst, amountIncGst: round2(quantity * item.rateIncGst), sourceKey: item.quantitySource ?? item.triggerKey, sourceValue });
  }
  return {
    preliminary_only: true,
    rate_card_id: card.id,
    rate_card_version: card.version,
    ready_check_version: readyCheckVersion,
    lines,
    unpriceable,
    preliminary_electrical_allowance_total: round2(lines.reduce((s, l) => s + l.amountIncGst, 0)),
  };
}

/** Production has no agreed rates yet: a test-only card is refused outside test mode. */
export function usableRateCard(card: RateCard | null, testMode: boolean): RateCard | null {
  if (!card || !card.active) return null;
  if (card.testOnly && !testMode) return null;
  return card;
}

// ---------------- Measured quote ----------------
export type MeasuredQuoteInput = {
  insulation: number; removal: number; access: number; allowance: AllowanceSnapshot | null;
  piesa: number; ap: number; discount: number; readyCheckPaid: boolean;
};
export type MeasuredQuoteRow = { key: string; label: string; amount: number; kind: "line" | "total" | "discount" | "credit" | "final" | "paid" | "remaining" };

export const MEASURED_QUOTE_LABELS = {
  insulation: "R5.0 ceiling insulation — supply & install",
  removal: "Existing insulation removal",
  access: "Access adjustment",
  allowance: "Preliminary electrical allowance",
  piesa: "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)",
  apManagement: "Home Insulation Victoria — Accredited Person Management",
  projectTotal: "Estimated project total",
  discount: "Estimated VEU / VEEC discount",
  readyCheckCredit: "Home Insulation Ready Check — free",
  finalCost: "ESTIMATED COST AFTER DISCOUNT",
  alreadyPaid: "Ready Check cost",
  remaining: "Estimated remaining project balance",
} as const;

/** Canonical measured order. The free Ready Check never changes quote totals. */
export function measuredQuote(i: MeasuredQuoteInput): { rows: MeasuredQuoteRow[]; gross: number; costAfter: number; remaining: number; unpriceable: boolean } {
  const allowance = i.allowance?.preliminary_electrical_allowance_total ?? 0;
  const L = MEASURED_QUOTE_LABELS;
  const gross = round2(i.insulation + i.removal + i.access + allowance + i.piesa + i.ap);
  const costAfter = Math.max(0, round2(gross - i.discount));
  const rows: MeasuredQuoteRow[] = [
    { key: "insulation", label: L.insulation, amount: i.insulation, kind: "line" },
    ...(i.removal > 0 ? [{ key: "removal", label: L.removal, amount: i.removal, kind: "line" as const }] : []),
    ...(i.access > 0 ? [{ key: "access", label: L.access, amount: i.access, kind: "line" as const }] : []),
    ...(allowance > 0 ? [{ key: "allowance", label: L.allowance, amount: allowance, kind: "line" as const }] : []),
    { key: "piesa", label: L.piesa, amount: i.piesa, kind: "line" },
    { key: "apManagement", label: L.apManagement, amount: i.ap, kind: "line" },
    { key: "projectTotal", label: L.projectTotal, amount: gross, kind: "total" },
    { key: "discount", label: L.discount, amount: i.discount, kind: "discount" },
    { key: "finalCost", label: L.finalCost, amount: costAfter, kind: "final" },
    { key: "remaining", label: L.remaining, amount: costAfter, kind: "remaining" },
  ];
  return { rows, gross, costAfter, remaining: costAfter, unpriceable: (i.allowance?.unpriceable.length ?? 0) > 0 };
}

// ---------------- PIESA reconciliation ----------------
export type PiesaItem = { code: string; quantity: number; description?: string };
export type Reconciliation = {
  lines: AllowanceLine[];
  unmatched: PiesaItem[];
  actual_total: number;
  preliminary_total: number;
  variance: number;
  outcome: "same" | "lower" | "higher";
  requires_customer_approval: boolean;
  customer_adjustment: number;
};

/** Prices formal PIESA rectification items from the SAME rate card, compares with the preliminary snapshot. */
export function reconcilePiesa(items: PiesaItem[], card: RateCard, preliminary: AllowanceSnapshot): Reconciliation {
  const byCode = new Map(card.items.map((it) => [it.code, it]));
  const lines: AllowanceLine[] = [];
  const unmatched: PiesaItem[] = [];
  for (const it of [...items].sort((a, b) => a.code.localeCompare(b.code))) {
    const rc = byCode.get(it.code);
    if (!rc || rc.rateIncGst == null || !Number.isInteger(it.quantity) || it.quantity <= 0) { unmatched.push(it); continue; }
    lines.push({ code: rc.code, description: rc.description, rule: rc.rule, quantity: it.quantity, unitRateIncGst: rc.rateIncGst, amountIncGst: round2(it.quantity * rc.rateIncGst), sourceKey: "piesa", sourceValue: it.quantity });
  }
  const actual = round2(lines.reduce((s, l) => s + l.amountIncGst, 0));
  const variance = round2(actual - preliminary.preliminary_electrical_allowance_total);
  const outcome = variance === 0 ? "same" : variance < 0 ? "lower" : "higher";
  return {
    lines, unmatched, actual_total: actual, preliminary_total: preliminary.preliminary_electrical_allowance_total, variance, outcome,
    // Unmatched (non-rate-card) PIESA items also need customer approval before extra work.
    requires_customer_approval: outcome === "higher" || unmatched.length > 0,
    customer_adjustment: variance,
  };
}

// ---------------- 30-day PIESA/install window guard ----------------
export const PIESA_WINDOW_DAYS = 30;
export const PIESA_BUFFER = { minDays: 7, maxDays: 14 } as const;
const DAY = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DAY);

export type WindowInput = { planned_piesa_date: string | null; planned_install_date: string | null; piesa_completed_at: string | null; today: string };
export type WindowCheck = { install_deadline: string | null; hardWarning: string | null; bufferWarning: string | null; readyForPiesa: boolean; newPiesaRequired: boolean };

export function installDeadline(piesaCompletedAt: string): string {
  return new Date((toDay(piesaCompletedAt) + PIESA_WINDOW_DAYS) * DAY).toISOString().slice(0, 10);
}

export function checkPiesaWindow(w: WindowInput): WindowCheck {
  const deadline = w.piesa_completed_at ? installDeadline(w.piesa_completed_at) : null;
  let hardWarning: string | null = null;
  let bufferWarning: string | null = null;
  const newPiesaRequired = !!deadline && toDay(w.today) > toDay(deadline);
  if (deadline && w.planned_install_date && toDay(w.planned_install_date) > toDay(deadline)) hardWarning = `Planned installation is after the PIESA window (${deadline}). A new PIESA is required first.`;
  if (!deadline && w.planned_piesa_date && w.planned_install_date) {
    const gap = toDay(w.planned_install_date) - toDay(w.planned_piesa_date);
    if (gap > PIESA_WINDOW_DAYS) hardWarning = `Planned installation is ${gap} days after the planned PIESA — beyond the ${PIESA_WINDOW_DAYS}-day window.`;
    else if (gap < 0) hardWarning = "Planned PIESA must be before the planned installation.";
    else if (gap < PIESA_BUFFER.minDays || gap > PIESA_BUFFER.maxDays) bufferWarning = `Target PIESA ${PIESA_BUFFER.minDays}–${PIESA_BUFFER.maxDays} days before installation (currently ${gap}).`;
  }
  // PIESA no longer needs a paired install date (Jo 7 Oct); only a conflicting planned date blocks.
  const readyForPiesa = !hardWarning;
  return { install_deadline: deadline, hardWarning, bufferWarning, readyForPiesa, newPiesaRequired };
}

// ---------------- TEST-ONLY rate card fixture ----------------
/** Clearly fake rates for staging previews/tests. Never seeded into the database; refused outside test mode. */
export const TEST_REC_RATE_CARD: RateCard = {
  id: "test-rec-card", version: 1, effectiveFrom: "2026-01-01", active: true, testOnly: true,
  items: [
    { code: "DL_HALOGEN_REPLACE", description: "Replace halogen downlight with IC-rated LED (per fitting)", rule: "QUANTITY_RATE", unit: "each", rateIncGst: 55, triggerKey: "elec.downlight_type", triggerValue: "halogen", quantitySource: "elec.downlight_count" },
    { code: "DL_UNCONFIRMED", description: "Downlight type unconfirmed — conservative allowance", rule: "CONSERVATIVE_ALLOWANCE", unit: "each", rateIncGst: 55, triggerKey: "elec.downlight_type", triggerValue: "unable_to_confirm", quantitySource: "elec.downlight_count", conservativeQuantity: 4 },
    { code: "RCD_NOT_VISIBLE", description: "RCD protection allowance (not visible)", rule: "FIXED_ALLOWANCE", unit: "fixed", rateIncGst: 280, triggerKey: "elec.rcd_visible", triggerValue: "not_visible", quantitySource: null },
    { code: "SWB_CERAMIC", description: "Switchboard upgrade allowance (ceramic fuses visible)", rule: "FIXED_ALLOWANCE", unit: "fixed", rateIncGst: 650, triggerKey: "elec.switchboard_type", triggerValue: "ceramic_fuses_visible", quantitySource: null },
    { code: "WIRING_DAMAGED", description: "Damaged/exposed wiring observed", rule: "UNPRICEABLE_FLAG", unit: "fixed", rateIncGst: null, triggerKey: "elec.damaged_wiring_visible", triggerValue: "yes", quantitySource: null },
    { code: "UNUSUAL_CONDITION", description: "Unusual electrical condition observed", rule: "UNPRICEABLE_FLAG", unit: "fixed", rateIncGst: null, triggerKey: "elec.unusual_condition", triggerValue: true, quantitySource: null },
  ],
};
