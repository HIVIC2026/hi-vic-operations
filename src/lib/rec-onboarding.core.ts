// Pure rules for the portal REC (electrician) onboarding + partner agreement signing.
// No I/O. Used by the public form (live validation) and the server (authoritative checks).
import { REC_AGREEMENT_SECTIONS } from "./rec-agreement.text";

export const REC_AGREEMENT_VERSION = "HI-VIC-A48-REC-1.4-2026-09-30";
export const REC_AGREEMENT_TITLE = "Activity 48 Registered Electrical Contractor Partner Agreement";
export const AP_ENTITY = "DC Construction Solutions Pty Ltd ABN 44 671 613 979 trading as Home Insulation Victoria (HI VIC!)";
export const MIN_PL_COVER = 5_000_000;

export const ACKNOWLEDGEMENTS = [
  { key: "authority", text: "I am authorised to bind the REC to this agreement." },
  { key: "personnel", text: "The REC will ensure every nominated electrician and worker on HI VIC! jobs complies with the obligations that apply to them." },
  { key: "compliance", text: "I understand the REC and its personnel must comply with current VEU, Code of Conduct, PIESA, electrical-safety and HI VIC! requirements." },
  { key: "records", text: "I confirm the REC will provide truthful records and evidence and cooperate with HI VIC!, ESC and ESV compliance checks." },
  { key: "no_bypass", text: "I understand that rectification, electrical upgrades, attendance and other work identified through or required for a HI VIC! Activity 48 job must be quoted, approved, scheduled and completed through the HI VIC! workflow and must not be taken off-platform or dealt with directly." },
  { key: "pricing", text: "I understand our approved rates are supplier rates, HI VIC! sets the customer price independently and may include its own margin, and HI VIC! does not have to disclose that margin to us. I will not share our rates with customers." },
  { key: "electronic_signature", text: "I agree to electronic execution and to the signed agreement, exact wording, version and audit record being stored by HI VIC!." },
] as const;
export type AckKey = (typeof ACKNOWLEDGEMENTS)[number]["key"];

export const RECT_ITEMS = [
  { key: "prohibited_luminaires", label: "IC / IC-4 light replacement", unit: "light" },
  { key: "circuit_protection", label: "Circuit protection / derating", unit: "circuit" },
  { key: "rcd_installation", label: "RCD installation", unit: "circuit" },
  { key: "tps_cable_replacement", label: "TPS cable replacement", unit: "metre" },
  { key: "basic_protection", label: "Basic Protection repair", unit: "defect" },
] as const;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const LEAD_TIMES = ["1-2 business days", "3-5 business days", "1-2 weeks", "2-4 weeks", "More than 4 weeks", "Varies"] as const;
export const RADII = [{ v: 25, l: "25 km" }, { v: 50, l: "50 km" }, { v: 75, l: "75 km" }, { v: 100, l: "100 km" }, { v: 9999, l: "Anywhere in Victoria" }] as const;
export const CAPACITY_BANDS = [{ v: "1-5", n: 5 }, { v: "6-10", n: 10 }, { v: "11-20", n: 20 }, { v: "20+", n: 25 }] as const;

export type Electrician = { full_legal_name?: string; licence_number?: string; mobile?: string; email?: string };
export type RecData = {
  legal_entity_name?: string; trading_name?: string; abn?: string; rec_registration_number?: string;
  business_address?: string; primary_contact_name?: string; business_phone?: string; business_email?: string; authorised_to_register?: boolean;
  insurer?: string; insurance_policy_number?: string; public_liability_cover_amount?: number | null; public_liability_expiry?: string; insurance_uploaded?: boolean;
  electricians?: Electrician[];
  service_rectification?: boolean; service_installation_isolation?: boolean;
  service_origin?: string; travel_radius_km?: number | null; excluded_areas?: string;
  typical_days?: string[]; normal_attendance_speed?: string;
  capacity_band?: string; accepting_jobs?: boolean;
  gst_registered?: boolean | null; assessment_rate?: number | null; installation_attendance_rate?: number | null;
  rectification_rates?: Partial<Record<(typeof RECT_ITEMS)[number]["key"], number | null>>;
  coes_fee_choice?: "included" | "separate" | ""; coes_fee?: number | null;
  bank_account_name?: string; bank_bsb?: string; bank_account_number?: string;
  agreement_reviewed?: boolean;
};

export const STEPS = [
  { key: "business", title: "Business details" },
  { key: "contact", title: "Contact details" },
  { key: "insurance", title: "Public liability insurance" },
  { key: "electricians", title: "Licensed electricians" },
  { key: "services", title: "HI VIC! work" },
  { key: "coverage", title: "Where you work" },
  { key: "availability", title: "When you work" },
  { key: "capacity", title: "Weekly capacity" },
  { key: "assessment_pricing", title: "PIESA & assessment pricing" },
  { key: "rectification_pricing", title: "Rectification pricing" },
  { key: "bank", title: "Payment details" },
  { key: "review", title: "Review agreement" },
  { key: "sign", title: "Sign agreement" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export function visibleSteps(d: RecData) {
  return STEPS.filter((s) => s.key !== "rectification_pricing" || d.service_rectification === true);
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

/** Today in Melbourne as YYYY-MM-DD. */
export function melbourneToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(now);
}

export function stepErrors(step: StepKey, d: RecData, now = new Date()): string[] {
  const e: string[] = [];
  switch (step) {
    case "business":
      if (!txt(d.legal_entity_name)) e.push("Enter the legal entity / REC registered name.");
      if (!validAbn(d.abn)) e.push("Enter a valid 11-digit ABN.");
      if (!txt(d.rec_registration_number)) e.push("Enter your REC number.");
      break;
    case "contact":
      if (!txt(d.business_address)) e.push("Enter your business address.");
      if (!txt(d.primary_contact_name)) e.push("Enter a contact name.");
      if (!validPhone(d.business_phone)) e.push("Enter a valid Australian phone number.");
      if (!validBusinessEmail(d.business_email)) e.push("Enter a real business email address.");
      if (d.authorised_to_register !== true) e.push("Confirm you're authorised to set up this REC.");
      break;
    case "insurance":
      if (d.insurance_uploaded !== true) e.push("Upload your Certificate of Currency.");
      if (!txt(d.insurer)) e.push("Enter the insurer.");
      if (!txt(d.insurance_policy_number)) e.push("Enter the policy number.");
      if (!(typeof d.public_liability_cover_amount === "number" && d.public_liability_cover_amount >= MIN_PL_COVER)) e.push("Public liability cover must be at least $5,000,000.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.public_liability_expiry ?? "") || (d.public_liability_expiry as string) < melbourneToday(now)) e.push("Insurance expiry must be today or later.");
      break;
    case "electricians": {
      const list = d.electricians ?? [];
      if (list.length < 1) e.push("Add at least one licensed electrician.");
      list.forEach((x, i) => {
        if (!txt(x.full_legal_name) || !txt(x.licence_number) || !validPhone(x.mobile) || !validBusinessEmail(x.email)) e.push(`Electrician ${i + 1}: complete name, licence number, a valid mobile and email.`);
      });
      const emails = list.map((x) => (x.email ?? "").trim().toLowerCase()).filter(Boolean);
      const lic = list.map((x) => (x.licence_number ?? "").trim().toUpperCase()).filter(Boolean);
      if (new Set(emails).size !== emails.length) e.push("Each electrician needs a different email.");
      if (new Set(lic).size !== lic.length) e.push("Each electrician needs a different licence number.");
      break;
    }
    case "services":
      break;
    case "coverage":
      if (!txt(d.service_origin)) e.push("Enter your service starting location.");
      if (!pos(d.travel_radius_km ?? null) && d.travel_radius_km !== 9999) e.push("Choose a travel radius.");
      break;
    case "availability":
      if (!(d.typical_days ?? []).length) e.push("Select at least one day.");
      if (!LEAD_TIMES.includes((d.normal_attendance_speed ?? "") as never)) e.push("Choose your usual lead time.");
      break;
    case "capacity":
      if (!CAPACITY_BANDS.some((b) => b.v === d.capacity_band)) e.push("Choose your weekly capacity.");
      break;
    case "assessment_pricing":
      if (typeof d.gst_registered !== "boolean") e.push("Tell us if you're GST registered.");
      if (!pos(d.assessment_rate)) e.push("Enter your assessment visit rate.");
      if (d.service_installation_isolation && !pos(d.installation_attendance_rate)) e.push("Enter your installation-day attendance rate.");
      break;
    case "rectification_pricing":
      if (!d.service_rectification) break;
      for (const it of RECT_ITEMS) if (!pos(d.rectification_rates?.[it.key] ?? null)) e.push(`Enter a rate for ${it.label}.`);
      if (d.coes_fee_choice !== "included" && d.coes_fee_choice !== "separate") e.push("Choose how the Certificate of Electrical Safety is charged.");
      if (d.coes_fee_choice === "separate" && !pos(d.coes_fee)) e.push("Enter the Certificate of Electrical Safety fee.");
      break;
    case "bank":
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

/** First visible step (before signing) with an error, or null if all are complete. */
export function firstIncompleteStep(d: RecData, now = new Date()): StepKey | null {
  for (const s of visibleSteps(d)) if (s.key !== "sign" && stepErrors(s.key, d, now).length) return s.key;
  return null;
}

export const MATERIAL_FIELDS = [
  "legal_entity_name", "trading_name", "abn", "rec_registration_number", "business_email", "service_origin", "travel_radius_km",
  "excluded_areas", "typical_days", "normal_attendance_speed", "capacity_band", "service_rectification", "service_installation_isolation",
  "assessment_rate", "installation_attendance_rate", "rectification_rates", "coes_fee_choice", "coes_fee", "gst_registered", "electricians",
] as const;

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
  lines.push(`Legal entity: ${d.legal_entity_name ?? ""}`, `Trading name: ${d.trading_name || "—"}`, `ABN: ${d.abn ?? ""}`, `REC number: ${d.rec_registration_number ?? ""}`,
    `Business address: ${d.business_address ?? ""}`, `Contact: ${d.primary_contact_name ?? ""}, ${d.business_phone ?? ""}, ${d.business_email ?? ""}`,
    `Public liability: ${d.insurer ?? ""} policy ${d.insurance_policy_number ?? ""}, cover ${money(d.public_liability_cover_amount)}, expires ${d.public_liability_expiry ?? ""}`);
  lines.push("", "Nominated electricians:");
  (d.electricians ?? []).forEach((x, i) => lines.push(`${i + 1}. ${x.full_legal_name} — licence ${x.licence_number}`));
  lines.push("", "SCHEDULE 2 — SERVICES, COVERAGE AND CAPACITY");
  lines.push("Initial onsite assessment + ceiling measure-up + PIESA: included");
  lines.push(`Electrical rectification: ${d.service_rectification ? "yes" : "no"}`, `Installation-day electrical attendance: ${d.service_installation_isolation ? "yes" : "no"}`);
  lines.push(`Service origin: ${d.service_origin ?? ""}; radius: ${d.travel_radius_km === 9999 ? "anywhere in Victoria" : `${d.travel_radius_km} km`}${d.excluded_areas ? `; excluded: ${d.excluded_areas}` : ""}`);
  lines.push(`Days: ${(d.typical_days ?? []).join(", ")}; lead time: ${d.normal_attendance_speed ?? ""}; weekly assessments: ${d.capacity_band ?? ""}`);
  lines.push("", `SCHEDULE 3 — PROPOSED SUPPLIER RATES (${gst}; not binding until accepted by HI VIC! under clause 17)`);
  lines.push(`Assessment visit (measure-up + assessment + PIESA): ${money(d.assessment_rate)} / visit`);
  if (d.service_installation_isolation) lines.push(`Installation-day attendance: ${money(d.installation_attendance_rate)} / visit`);
  if (d.service_rectification) {
    for (const it of RECT_ITEMS) lines.push(`${it.label}: ${money(d.rectification_rates?.[it.key] ?? null)} / ${it.unit}`);
    lines.push(`Certificate of Electrical Safety: ${d.coes_fee_choice === "separate" ? `${money(d.coes_fee)} separate fee` : "included"}`);
  }
  return lines.join("\n");
}

/** Exact text the partner signs: header, all clauses, schedules and acknowledgements. */
export function agreementText(d: RecData): string {
  const parts = [
    `${REC_AGREEMENT_TITLE}`, `Version: ${REC_AGREEMENT_VERSION}`,
    `Between: ${AP_ENTITY}, acting as an Accredited Person for Victorian Energy Upgrades (VEU) Activity 48, and the Registered Electrical Contractor (REC) identified in Schedule 1.`, "",
    ...REC_AGREEMENT_SECTIONS.flatMap((s) => [`${s.n}. ${s.title}`, ...s.paras, ""]),
    scheduleText(d), "", "ACKNOWLEDGEMENTS",
    ...ACKNOWLEDGEMENTS.map((a, i) => `${i + 1}. ${a.text}`),
  ];
  return parts.join("\n");
}
