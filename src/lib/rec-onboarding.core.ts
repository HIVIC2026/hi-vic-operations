import { melbourneToday as melbourneTodayCore } from "./melbourne-time.core";
// Pure rules for the portal REC (electrician) onboarding + partner agreement signing.
// No I/O. Used by the public form (live validation) and the server (authoritative checks).
import { REC_AGREEMENT_SECTIONS } from "./rec-agreement.text";
import { activity48AgreementScheduleText } from "./activity48-agreement-schedule.text";

// 2.6 incorporates Guide V1.2 role-owned evidence and retention; commercial and electrical warranty terms unchanged.
export const REC_AGREEMENT_VERSION = "HI-VIC-A48-REC-2.6-2026-10-09";
/** Earlier signed agreements remain valid for office activation; only new signatures use the current version. */
export const ACTIVATABLE_REC_VERSIONS: readonly string[] = ["HI-VIC-A48-REC-2.3-2026-10-01", "HI-VIC-A48-REC-2.4-2026-10-03", "HI-VIC-A48-REC-2.5-2026-10-05", REC_AGREEMENT_VERSION];
export const REC_AGREEMENT_TITLE = "Activity 48 Registered Electrical Contractor Partner Agreement";
export const AP_ENTITY = "DC Construction Solutions Pty Ltd ABN 44 671 613 979 trading as Home Insulation Victoria";
export const MIN_PL_COVER = 5_000_000;
export const MIN_REC_PL_COVER = 5_000_000;

export const ACKNOWLEDGEMENTS = [
  { key: "authority", text: "I am authorised to bind the REC to this agreement." },
  { key: "personnel", text: "The REC will ensure every nominated electrician and staff member on Home Insulation Victoria jobs complies with the obligations that apply to them." },
  { key: "compliance", text: "I understand the REC and its personnel must comply with current VEU, Code of Conduct, PIESA, electrical-safety and Home Insulation Victoria requirements." },
  { key: "schedule", text: "I have reviewed and accept the incorporated versioned Schedule 4 — Activity 48 Compliance and Evidence, including our role-owned evidence, safety and retention responsibilities. The AP retains its own statutory duties." },
  { key: "records", text: "I confirm the REC will provide truthful records and evidence and cooperate with Home Insulation Victoria, ESC and ESV compliance checks." },
  { key: "no_bypass", text: "I understand that rectification, electrical upgrades, attendance and other work identified through or required for a Home Insulation Victoria Activity 48 job must be quoted, approved by the owner, scheduled and completed through the Home Insulation Victoria workflow and must not be taken off-platform or dealt with directly, except for the minimum work lawfully necessary to make an immediate danger safe." },
  { key: "customer_owner", text: "I understand the customer is Home Insulation Victoria's customer. I will not quote, invoice or accept payment from them separately for any work connected to a Home Insulation Victoria job, and I will not approach them for other work. Routine communication goes through the Home Insulation Victoria portal, subject only to the agreement's narrow immediate-safety and legally required exceptions." },
  { key: "same_day", text: "I understand PIESA results and any rectification quote (or confirmation that none is required) must be submitted through the Home Insulation Victoria portal on the day of each assessment." },
  { key: "pricing", text: "I understand our approved rates are supplier rates, Home Insulation Victoria sets the customer price independently and may include its own margin, and Home Insulation Victoria does not have to disclose that margin to us. I will not share our rates with customers." },
  { key: "electronic_signature", text: "I agree to electronic execution and to the signed agreement, exact wording, version and audit record being stored by Home Insulation Victoria." },
] as const;
export type AckKey = (typeof ACKNOWLEDGEMENTS)[number]["key"];

/**
 * The acknowledgements an applicant must tick to sign. The REC director binds
 * the business; a worker registering under another REC signs on their own
 * behalf and confirms the REC has approved them — they can never bind the REC.
 */
export function acknowledgementsFor(d: RecData) {
  if (d.works_under_rec === true) {
    return ACKNOWLEDGEMENTS.map((a) =>
      a.key === "authority"
        ? { key: a.key, text: "I am signing on my own behalf, and the REC I work under has approved me registering under their business." }
        : a,
    );
  }
  return [...ACKNOWLEDGEMENTS];
}

export const RECT_ITEMS = [
  { key: "prohibited_luminaires", rateCode: "DOWNLIGHT_UPGRADE", label: "Downlight upgrade to IC-4 LED", unit: "light" },
  { key: "circuit_protection", rateCode: "SWITCHBOARD_UPGRADE", label: "Switchboard upgrade", unit: "switchboard" },
  { key: "rcd_installation", rateCode: "RCD_INSTALL", label: "RCD installation", unit: "RCD" },
  { key: "tps_cable_replacement", rateCode: "TPS_CABLE_REPLACEMENT", label: "TPS cable replacement", unit: "metre" },
  { key: "basic_protection", rateCode: "EXHAUST_CLEARANCE", label: "Exhaust fan clearance guard", unit: "guard" },
] as const;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const LEAD_TIMES = ["1-2 business days", "3-5 business days", "1-2 weeks", "2-4 weeks", "More than 4 weeks", "Varies"] as const;
export const RADII = [{ v: 25, l: "25 km" }, { v: 50, l: "50 km" }, { v: 75, l: "75 km" }, { v: 100, l: "100 km" }, { v: 9999, l: "Anywhere in Victoria" }] as const;
/** Legacy values retained only so old drafts and signed snapshots can still be read. */
export const CAPACITY_BANDS = [{ v: "1-5", n: 5 }, { v: "6-10", n: 10 }, { v: "11-20", n: 20 }, { v: "20+", n: 25 }] as const;

export type Electrician = { full_legal_name?: string; licence_number?: string; licence_expiry?: string; mobile?: string; email?: string };
export type ResolvedAddress = {
  label: string; street?: string | null; suburb?: string | null; postcode?: string | null;
  state?: string | null; country: "AU"; provider: "google_places_au"; latitude?: number | null; longitude?: number | null;
};
export type CustomRectificationRate = { id: string; description: string; unit: string; price: number | null };
export type RecData = {
  how_it_works_acknowledged?: boolean;
  works_under_rec?: boolean | null; host_rec_name?: string; host_rec_number?: string;
  legal_entity_name?: string; trading_name?: string; abn?: string; rec_registration_number?: string;
  business_address?: string; business_address_details?: ResolvedAddress | null; primary_contact_name?: string; business_phone?: string; business_email?: string; authorised_to_register?: boolean;
  /** Explicit confirmation that the person registering is a licensed electrician (must be true to proceed). */
  contact_is_licensed_electrician?: boolean | null;
  /** The applicant's own Victorian electrician licence (always required). */
  licence_number?: string;
  licence_expiry?: string;
  insurer?: string; insurance_policy_number?: string; public_liability_cover_amount?: number | null; public_liability_expiry?: string; insurance_uploaded?: boolean;
  electricians?: Electrician[];
  /** Legacy per-service flags — ignored. All three services are mandatory for every REC. */
  service_piesa?: boolean; service_rectification?: boolean; service_installation_isolation?: boolean;
  /** "I confirm our REC can provide all three electrical services listed above, as required for each job." */
  services_all_confirmed?: boolean;
  service_origin?: string; service_origin_details?: ResolvedAddress | null; travel_radius_km?: number | null; excluded_areas?: string;
  typical_days?: string[]; normal_attendance_speed?: string;
  capacity_band?: string; accepting_jobs?: boolean;
  gst_registered?: boolean | null; assessment_rate?: number | null; installation_attendance_rate?: number | null;
  rectification_rates?: Partial<Record<(typeof RECT_ITEMS)[number]["key"], number | null>>;
  custom_rectification_rates?: CustomRectificationRate[];
  coes_fee_choice?: "included" | "separate" | ""; coes_fee?: number | null;
  bank_account_name?: string; bank_bsb?: string; bank_account_number?: string;
  agreement_reviewed?: boolean;
};

/** First name for greetings throughout onboarding and the portal. */
export function firstName(d: { primary_contact_name?: string }): string {
  return (d.primary_contact_name ?? "").trim().split(/\s+/)[0] || "";
}

/**
 * The licensed electricians on this application. The person signing up IS the
 * electrician, so when no explicit list exists we derive it from their own
 * details. An explicit list (legacy applications) always wins.
 */
export function effectiveElectricians(d: RecData): Electrician[] {
  if ((d.electricians ?? []).length > 0) return d.electricians!;
  if (!txt(d.primary_contact_name) || !txt(d.licence_number)) return [];
  return [{
    full_legal_name: (d.primary_contact_name ?? "").trim(),
    licence_number: (d.licence_number ?? "").trim().toUpperCase(),
    ...(d.licence_expiry ? { licence_expiry: d.licence_expiry } : {}),
    mobile: (d.business_phone ?? "").trim(),
    email: (d.business_email ?? "").trim().toLowerCase(),
  }];
}

export const STEPS = [
  { key: "about", title: "About you" },
  { key: "business", title: "Business details" },
  { key: "contact", title: "Business address" },
  { key: "insurance", title: "Public liability insurance" },
  { key: "services", title: "Home Insulation Victoria work" },
  { key: "coverage", title: "Where you work" },
  { key: "availability", title: "When you're available to work" },
  { key: "capacity", title: "Availability" }, // legacy draft anchor; no longer shown or required
  { key: "assessment_pricing", title: "PIESA pricing" },
  { key: "rectification_pricing", title: "Rectification pricing" },
  { key: "bank", title: "Payment details" },
  { key: "review", title: "Review agreement" },
  { key: "sign", title: "Sign agreement" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export type VisibleRecPage = {
  key: StepKey;
  title: string;
  members: readonly StepKey[];
};

/**
 * Public presentation only. Persisted drafts keep the legacy StepKey anchors,
 * while related legacy steps are rendered and validated together.
 */
export const REC_VISIBLE_PAGES: readonly VisibleRecPage[] = [
  { key: "about", title: "About you", members: ["about"] },
  { key: "business", title: "Business details", members: ["business", "contact"] },
  { key: "insurance", title: "Insurance", members: ["insurance"] },
  { key: "services", title: "Work & coverage", members: ["services", "coverage"] },
  { key: "availability", title: "Availability", members: ["availability", "capacity"] },
  { key: "assessment_pricing", title: "Rates", members: ["assessment_pricing", "rectification_pricing"] },
  { key: "bank", title: "Payment details", members: ["bank"] },
  { key: "review", title: "Review agreement", members: ["review"] },
  { key: "sign", title: "Sign agreement", members: ["sign"] },
] as const;

export function visiblePageForStep(step: string | null | undefined): StepKey {
  return REC_VISIBLE_PAGES.find((page) => page.members.some((member) => member === step))?.key ?? "about";
}

/** Canonical persisted legacy anchor for a visible page; unknown input fails safe to About you. */
export function canonicalStepKey(step: string | null | undefined): StepKey {
  return visiblePageForStep(step);
}

export function pageMembers(step: StepKey): readonly StepKey[] {
  return REC_VISIBLE_PAGES.find((page) => page.key === visiblePageForStep(step))?.members ?? ["about"];
}

/**
 * Statements the REC makes about their own business. These stay mandatory in every
 * mode — sample previews and test mode included — because they are the REC's own
 * undertaking, not data entry we can prefill for them.
 */
export const ALWAYS_MANDATORY_STEPS: readonly StepKey[] = ["services", "review"];
export const isAlwaysMandatoryStep = (step: StepKey) => ALWAYS_MANDATORY_STEPS.includes(step);

/**
 * Server-side guard: the first always-mandatory step that is still incomplete while the
 * draft claims to be at or past a later step. Applies in every mode, test mode included.
 */
export function blockedMandatoryStep(targetStep: string, d: RecData, now = new Date()): StepKey | null {
  // Keep raw legacy ordering here so a saved legacy member after `services`
  // (for example `coverage`) cannot bypass the mandatory declaration.
  const order = STEPS.map((s) => s.key as string);
  const target = order.indexOf(targetStep);
  for (const m of ALWAYS_MANDATORY_STEPS) {
    const at = order.indexOf(m);
    if ((target === -1 || target > at) && stepErrors(m, d, now).length) return m;
  }
  return null;
}

export type RecSampleStep = StepKey | "welcome" | "submitted";

/** Accept only real onboarding steps for the public no-write sample. */
export function parseRecSampleStep(value: string | null): RecSampleStep | null {
  if (value === "welcome" || value === "submitted") return value;
  return STEPS.some((step) => step.key === value) ? visiblePageForStep(value) : null;
}

/** Legacy drafts must resolve their old worker/business answer before continuing. */
export function recDraftRole(d: RecData): "business" | "worker" | "unresolved" {
  if (d.works_under_rec === false) return "business";
  if (d.works_under_rec === true) return "worker";
  return "unresolved";
}

export function visibleSteps(d: RecData) {
  return REC_VISIBLE_PAGES.filter((page) =>
    !(["insurance", "assessment_pricing", "bank"] as StepKey[]).includes(page.key) || d.works_under_rec !== true);
}

export function validAbn(abn: string | undefined): boolean {
  const digits = (abn ?? "").replace(/\s/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const n = digits.split("").map(Number);
  n[0] = (n[0] ?? 0) - 1;
  return n.reduce((s, d, i) => s + d * (w[i] ?? 0), 0) % 89 === 0;
}
export const validPhone = (p?: string) => /^(?:\+61|0)[2-478]\d{8}$/.test((p ?? "").replace(/[\s()-]/g, ""));
export function validBusinessEmail(e?: string) {
  const v = (e ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && !v.endsWith("@privaterelay.appleid.com") && v.length <= 320;
}
const txt = (s?: string) => (s ?? "").trim().length > 0;
const pos = (n?: number | null) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 100000;
const stateCode = (state?: string | null) => (state ?? "").trim().toUpperCase();
const AU_STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
export const isAustralianAddress = (address?: ResolvedAddress | null) => !!address && address.provider === "google_places_au" && address.country === "AU" && AU_STATES.has(stateCode(address.state)) && /^\d{4}$/.test(address.postcode ?? "");
export const isVictorianAddress = (address?: ResolvedAddress | null) => isAustralianAddress(address) && ["VIC", "VICTORIA"].includes(stateCode(address?.state));
/**
 * The address lookup sometimes returns details without the house/unit number
 * the chosen suggestion showed (e.g. "3/12 Smith St, …" → "Smith St, …").
 * Keep the number from the suggestion the person picked; never add one from free text.
 */
const STREET_ABBR: Record<string, string> = { street: "st", road: "rd", avenue: "ave", drive: "dr", court: "ct", place: "pl", crescent: "cres", parade: "pde", highway: "hwy", boulevard: "blvd", terrace: "tce", lane: "ln", close: "cl", grove: "gr", circuit: "cct", square: "sq" };
const normStreet = (v: string) => v.toLowerCase().replace(/[.]/g, "").split(/\s+/).filter(Boolean).map((w) => STREET_ABBR[w] ?? w).join(" ");
export function keepPickedNumber(suggestionLabel: string, details: ResolvedAddress): ResolvedAddress {
  const pickedFirst = (suggestionLabel.split(",")[0] ?? "").trim();
  const detailFirst = (details.label.split(",")[0] ?? "").trim();
  if (!pickedFirst || !detailFirst || /\d/.test(detailFirst)) return details;
  const m = pickedFirst.match(/^((?:(?:unit|apt|shop|suite|level|lot)\s*)?\d[\w-]*(?:\s*\/\s*\d[\w-]*)?)\s+(.+)$/i);
  if (!m) return details;
  const prefix = m[1]!.trim();
  if (normStreet(m[2]!) !== normStreet(detailFirst)) return details;
  const label = `${prefix} ${details.label.trim()}`;
  const street = details.street && !/\d/.test(details.street) ? `${prefix} ${details.street}` : details.street ?? null;
  return { ...details, label, street };
}
export const customRateCode = (id: string) => `CUSTOM_${id.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`.slice(0, 40);

export const MAX_CUSTOM_RECT_ITEMS = 20;
export function customRectificationRateErrors(rows: CustomRectificationRate[] | undefined): string[] {
  const errors: string[] = [];
  const labels = new Set<string>();
  const codes = new Set<string>();
  if ((rows ?? []).length > MAX_CUSTOM_RECT_ITEMS) errors.push(`Add no more than ${MAX_CUSTOM_RECT_ITEMS} custom items.`);
  for (const [index, row] of (rows ?? []).entries()) {
    const label = row.description.trim();
    const unit = row.unit.trim();
    const code = customRateCode(row.id);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(row.id)) errors.push(`Custom item ${index + 1} has an invalid identifier.`);
    if (label.length < 2 || label.length > 120) errors.push(`Enter a description for custom item ${index + 1} (2–120 characters).`);
    if (unit.length < 1 || unit.length > 30) errors.push(`Enter a unit for custom item ${index + 1}.`);
    if (!pos(row.price)) errors.push(`Enter a positive rate for custom item ${index + 1}.`);
    const normalized = label.toLowerCase();
    if (labels.has(normalized)) errors.push(`Custom item descriptions must be unique.`);
    if (codes.has(code) || RECT_ITEMS.some((item) => item.key.toUpperCase() === code)) errors.push(`Custom item identifiers must be unique.`);
    labels.add(normalized); codes.add(code);
  }
  return [...new Set(errors)];
}

/** A real YYYY-MM-DD calendar date (rejects 2026-02-30 etc). */
export function validCalendarDate(v?: string | null): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v ?? "")) return false;
  const [y, m, d] = (v as string).split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m! - 1 && t.getUTCDate() === d;
}

export const REC_INVALID_LINK_MESSAGE = "This onboarding link is no longer valid. Please start again.";
/** Only a definitive "link not found" may forget the saved resume token; network/server blips must keep it. */
export const shouldForgetResumeToken = (error: unknown) => error instanceof Error && error.message === REC_INVALID_LINK_MESSAGE;

/** Today in Melbourne as YYYY-MM-DD. */
export function melbourneToday(now = new Date()): string {
  return melbourneTodayCore(now);
}

export function stepErrors(step: StepKey, d: RecData, now = new Date()): string[] {
  const e: string[] = [];
  switch (step) {
    case "about":
      // Business vs staff is asked once, first. Unknown/legacy drafts stay unanswered (never defaulted to business).
      if (d.works_under_rec == null) { e.push("Tell us if you are registering your REC business or joining as staff."); break; }
      if (d.works_under_rec === true) { e.push("Staff join Home Insulation Victoria by private invitation from your REC business."); break; }
      if (!txt(d.primary_contact_name)) e.push("Enter your name.");
      // Only licensed electricians may register; old drafts with false/null must be explicitly confirmed again.
      if (d.contact_is_licensed_electrician !== true) e.push("Confirm you are a licensed electrician to continue.");
      if (!txt(d.licence_number)) e.push("Enter your Victorian electrician licence number.");
      if (!validCalendarDate(d.licence_expiry)) e.push("Enter your licence expiry date.");
      else if ((d.licence_expiry as string) < melbourneToday(now)) e.push("Your licence has expired. Enter the new expiry date.");
      if (!validPhone(d.business_phone)) e.push("Enter a valid Australian mobile.");
      if (!validBusinessEmail(d.business_email)) e.push("Enter a real email address.");
      break;
    case "business":
      if (!txt(d.legal_entity_name)) e.push(d.works_under_rec === true ? "Enter your full legal name." : "Enter the legal entity / REC registered name.");
      if (d.works_under_rec === true) {
        if (!txt(d.host_rec_name)) e.push("Enter the REC business you work under.");
        if (!txt(d.host_rec_number)) e.push("Enter their REC number.");
      } else {
        if (!validAbn(d.abn)) e.push("Enter a valid 11-digit ABN.");
        if (!txt(d.rec_registration_number)) e.push("Enter your REC number.");
      }
      break;
    case "contact":
      if (!txt(d.business_address)) e.push("Enter your business address.");
      if (!isAustralianAddress(d.business_address_details) || d.business_address_details?.label !== d.business_address) e.push("Select an Australian business address from the list.");
      if (!txt(d.primary_contact_name)) e.push("Enter a contact name.");
      if (!validPhone(d.business_phone)) e.push("Enter a valid Australian phone number.");
      if (!validBusinessEmail(d.business_email)) e.push("Enter a real business email address.");
      break;
    case "insurance":
      if (d.works_under_rec === true) break; // host REC holds the insurance
      if (d.insurance_uploaded !== true) e.push("Upload your Certificate of Currency.");
      if (!txt(d.insurer)) e.push("Enter the insurer.");
      if (!txt(d.insurance_policy_number)) e.push("Enter the policy number.");
      if (!(typeof d.public_liability_cover_amount === "number" && d.public_liability_cover_amount >= MIN_REC_PL_COVER)) e.push("Public liability cover must be at least $5,000,000.");
      if (!validCalendarDate(d.public_liability_expiry) || (d.public_liability_expiry as string) < melbourneToday(now)) e.push("Insurance expiry must be today or later.");
      break;
    case "services":
      if (d.services_all_confirmed !== true) e.push("Confirm your REC can provide all three electrical services.");
      break;
    case "coverage":
      if (!txt(d.service_origin)) e.push("Enter your service starting location.");
      if (!isVictorianAddress(d.service_origin_details) || d.service_origin_details?.label !== d.service_origin) e.push("Sorry, your service area needs to be in Victoria.");
      if (!RADII.some((r) => r.v === d.travel_radius_km)) e.push("Choose a travel radius.");
      break;
    case "availability":
      if (!(d.typical_days ?? []).length) e.push("Select at least one day.");
      else if ((d.typical_days ?? []).some((x) => !DAYS.includes(x as never)) || new Set(d.typical_days).size !== d.typical_days!.length) e.push("Choose days from the list.");
      if (!LEAD_TIMES.includes((d.normal_attendance_speed ?? "") as never)) e.push("Choose your usual lead time.");
      if (typeof d.accepting_jobs !== "boolean") e.push("Tell us if you're accepting new Home Insulation Victoria work now.");
      break;
    case "capacity":
      break; // Trades manage their own diaries; stored legacy answers are ignored.
    case "assessment_pricing":
      if (d.works_under_rec === true) break; // rates agreed with the host REC
      if (typeof d.gst_registered !== "boolean") e.push("Tell us if you're GST registered.");
      if (!pos(d.assessment_rate)) e.push("Enter your PIESA visit rate.");
      if (!pos(d.installation_attendance_rate)) e.push("Enter your installation-day attendance rate.");
      break;
    case "rectification_pricing":
      if (d.works_under_rec === true) break; // rates agreed with the host REC
      for (const it of RECT_ITEMS) if (!pos(d.rectification_rates?.[it.key] ?? null)) e.push(`Enter a rate for ${it.label}.`);
      if (d.coes_fee_choice !== "included" && d.coes_fee_choice !== "separate") e.push("Choose how the Certificate of Electrical Safety is charged.");
      if (d.coes_fee_choice === "separate" && !pos(d.coes_fee)) e.push("Enter the Certificate of Electrical Safety fee.");
      e.push(...customRectificationRateErrors(d.custom_rectification_rates));
      break;
    case "bank":
      if (d.works_under_rec === true) break; // paid through the host REC
      if (!txt(d.bank_account_name)) e.push("Enter the bank account name.");
      if (!/^\d{3}-?\d{3}$/.test(d.bank_bsb ?? "")) e.push("Enter a valid 6-digit BSB.");
      if (!/^\d{5,10}$/.test(d.bank_account_number ?? "")) e.push("Enter a valid bank account number.");
      break;
    case "review":
      if (d.agreement_reviewed !== true) e.push("Confirm you've reviewed the agreement and schedules.");
      break;
    case "sign":
      break;
  }
  return e;
}

/** Every legacy member must pass before its containing visible page can advance. */
export function pageErrors(step: StepKey, d: RecData, now = new Date()): string[] {
  return [...new Set(pageMembers(step).flatMap((member) => stepErrors(member, d, now)))];
}

/** First visible step (before signing) with an error, or null if all are complete. */
export function firstIncompleteStep(d: RecData, now = new Date()): StepKey | null {
  for (const s of visibleSteps(d)) if (s.key !== "sign" && pageErrors(s.key, d, now).length) return s.key;
  return null;
}

export const MATERIAL_FIELDS = [
  "legal_entity_name", "trading_name", "abn", "rec_registration_number", "business_address", "primary_contact_name", "business_phone", "business_email", "licence_number", "licence_expiry", "service_origin", "travel_radius_km",
  "excluded_areas", "typical_days", "normal_attendance_speed", "services_all_confirmed",
  "assessment_rate", "installation_attendance_rate", "rectification_rates", "custom_rectification_rates", "coes_fee_choice", "coes_fee", "gst_registered", "electricians",
  "works_under_rec", "host_rec_name", "host_rec_number",
  "insurer", "insurance_policy_number", "public_liability_cover_amount", "public_liability_expiry", "insurance_uploaded",
] as const;

/** Accept the ISO timestamps returned by PostgREST, including explicit UTC offsets. */
export function isRecRevisionTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

/** If anything that appears in the agreement schedules changed, the review must be redone. */
export function applyMaterialReset(prev: RecData, next: RecData): RecData {
  const changed = MATERIAL_FIELDS.some((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(next[k] ?? null));
  return changed && prev.agreement_reviewed ? { ...next, agreement_reviewed: false } : next;
}

const money = (n?: number | null) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");

/** Schedules rendered into the signed agreement text so the partner's own details are part of what they sign. */
export function scheduleText(d: RecData): string {
  const gst = d.gst_registered ? "inc GST" : "total rate (not GST registered)";
  const lines: string[] = [];
  lines.push("SCHEDULE 1 — REC DETAILS");
  lines.push(`Legal entity: ${d.legal_entity_name ?? ""}`, `Trading name: ${d.trading_name || "—"}`, `ABN: ${d.abn ?? ""}`,
    d.works_under_rec === true
      ? `REC: works under ${d.host_rec_name ?? ""} (REC ${d.host_rec_number ?? ""})`
      : `REC number: ${d.rec_registration_number ?? ""}`,
    `Business address: ${d.business_address ?? ""}`, `Contact: ${d.primary_contact_name ?? ""}, ${d.business_phone ?? ""}, ${d.business_email ?? ""}`,
    d.works_under_rec === true
      ? `Public liability: held by host REC (${d.host_rec_name ?? ""}, REC ${d.host_rec_number ?? ""})`
      : `Public liability: ${d.insurer ?? ""} policy ${d.insurance_policy_number ?? ""}, cover ${money(d.public_liability_cover_amount)}, expires ${d.public_liability_expiry ?? ""}`);
  lines.push("", "Nominated electricians:");
  const sparks = effectiveElectricians(d);
  if (sparks.length === 0) lines.push("To be confirmed with the Home Insulation Victoria office before any work is allocated.");
  sparks.forEach((x, i) => lines.push(`${i + 1}. ${x.full_legal_name} — licence ${x.licence_number}`));
  lines.push("", "SCHEDULE 2 — SERVICES, COVERAGE AND AVAILABILITY");
  lines.push("Required electrical services (all three, as required for each job):",
    "- Pre-installation electrical safety assessment (PIESA)",
    "- Electrical rectification (completing required electrical work after approval)",
    "- Installation-day electrical attendance (when required for the job)");
  lines.push(`Service origin: ${d.service_origin ?? ""}; radius: ${d.travel_radius_km === 9999 ? "anywhere in Victoria" : `${d.travel_radius_km} km`}${d.excluded_areas ? `; excluded: ${d.excluded_areas}` : ""}`);
  lines.push(`Days: ${(d.typical_days ?? []).join(", ")}; lead time: ${d.normal_attendance_speed ?? ""}`);
  lines.push("", `SCHEDULE 3 — PROPOSED SUPPLIER RATES (${gst}; not binding until accepted by Home Insulation Victoria under clause 17)`);
  lines.push(`Pre-insulation electrical safety assessment (PIESA): ${money(d.assessment_rate)} / visit`);
  lines.push(`Installation-day attendance: ${money(d.installation_attendance_rate)} / visit`);
  for (const it of RECT_ITEMS) lines.push(`${it.label}: ${money(d.rectification_rates?.[it.key] ?? null)} / ${it.unit}`);
  for (const it of d.custom_rectification_rates ?? []) lines.push(`${it.description.trim()}: ${money(it.price)} / ${it.unit.trim()} (custom approved item ${customRateCode(it.id)})`);
  lines.push(`Certificate of Electrical Safety: ${d.coes_fee_choice === "separate" ? `${money(d.coes_fee)} separate fee` : "included"}`);
  return [...lines, "", activity48AgreementScheduleText()].join("\n");
}

/** Exact text the partner signs: header, all clauses, schedules and acknowledgements. */
export function agreementText(d: RecData): string {
  const parts = [
    `${REC_AGREEMENT_TITLE}`, `Version: ${REC_AGREEMENT_VERSION}`,
    `Between: ${AP_ENTITY}, acting as an Accredited Person for Victorian Energy Upgrades (VEU) Activity 48, and the Registered Electrical Contractor (REC) identified in Schedule 1.`,
    "AP accreditation number: A003654", "",
    ...REC_AGREEMENT_SECTIONS.flatMap((s) => [`${s.n}. ${s.title}`, ...s.paras, ""]),
    scheduleText(d), "", "ACKNOWLEDGEMENTS",
    ...ACKNOWLEDGEMENTS.map((a, i) => `${i + 1}. ${a.text}`),
  ];
  return parts.join("\n");
}

/** Draft reviews use current terms; signed records must use their exact stored text and version. */
export function recAgreementView(app: { status: string; agreement_text?: string | null; agreement_version?: string | null }, d: RecData) {
  if (app.status === "draft") return { title: REC_AGREEMENT_TITLE, version: REC_AGREEMENT_VERSION, text: agreementText(d) };
  if (!app.agreement_text || !app.agreement_version) throw new Error("The stored signed agreement is incomplete; please contact the office.");
  return { title: REC_AGREEMENT_TITLE, version: app.agreement_version, text: app.agreement_text };
}

/** Continue from Review is allowed only with a loaded current-version agreement AND an explicit tick. */
export const recReviewGateOpen = (d: RecData, ready: { sha256: string; version: string } | null) =>
  ready !== null && ready.version === REC_AGREEMENT_VERSION && d.agreement_reviewed === true;
/** What the resume screen does after a failed load. The token is never cleared automatically. */
export const resumeFailureMode = (error: unknown): "invalid" | "retry" => (shouldForgetResumeToken(error) ? "invalid" : "retry");
