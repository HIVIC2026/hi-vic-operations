// Pure rules for the portal installer onboarding + partner agreement signing.
// Mirrors rec-onboarding.core.ts (same design/rules); shared validators are reused from there.
import { INSTALLER_AGREEMENT_SECTIONS } from "./installer-agreement.text";
import { electricianStepErrors, type ElectricianChoice, type PreferredElectrician } from "./teaming.core";
import { AP_ENTITY, MIN_PL_COVER, validAbn, validBusinessEmail, validPhone, melbourneToday, DAYS, LEAD_TIMES, RADII } from "./rec-onboarding.core";

export { DAYS, LEAD_TIMES, RADII, validAbn };
export const INSTALLER_AGREEMENT_VERSION = "HI-VIC-A48-INST-1.4-2026-10-01";
export const INSTALLER_AGREEMENT_TITLE = "Activity 48 Insulation Installer Partner Agreement";

export const ACKNOWLEDGEMENTS = [
  { key: "authority", text: "I am authorised to bind the Installer business to this agreement." },
  { key: "personnel", text: "The Installer will ensure every nominated installer and worker on Home Insulation Victoria jobs is trained, competent and complies with the obligations that apply to them." },
  { key: "compliance", text: "I understand the Installer and its personnel must comply with current VEU, Code of Conduct, Activity 48, AS 3999, safety and Home Insulation Victoria requirements, and must not install without a current PIESA and Home Insulation Victoria ready-to-install confirmation." },
  { key: "records", text: "I confirm the Installer will provide truthful measurements, records and evidence and cooperate with Home Insulation Victoria, ESC and regulator compliance checks." },
  { key: "no_bypass", text: "I understand that removal, access, extras and other work identified through a Home Insulation Victoria Activity 48 job must be quoted, approved, scheduled and completed through the Home Insulation Victoria workflow and must not be taken off-platform or dealt with directly." },
  { key: "pricing", text: "I understand our approved rates are supplier rates, Home Insulation Victoria sets the customer price independently and may include its own margin, and Home Insulation Victoria does not have to disclose that margin to us. I will not share our rates with customers." },
  { key: "same_day", text: "I understand the PIISA and install-day evidence must be submitted through the Home Insulation Victoria portal on the day of each installation." },
  { key: "electronic_signature", text: "I agree to electronic execution and to the signed agreement, exact wording, version and audit record being stored by Home Insulation Victoria." },
] as const;

export const CII_STATUSES = [
  { v: "certified", l: "Yes — trained / certified" },
  { v: "in_progress", l: "In progress" },
  { v: "not_yet", l: "Not yet" },
] as const;

export const EXTRA_ITEMS = [
  { key: "tile_roof_access", label: "Tile roof access (lift & relay tiles)", unit: "job" },
  { key: "metal_roof_access", label: "Metal sheet roof access", unit: "job" },
  { key: "difficult_access", label: "Difficult / restricted ceiling access", unit: "job" },
  { key: "call_out_minimum", label: "Minimum charge / call-out", unit: "job" },
] as const;

export const CAPACITY_BANDS = [{ v: "1-3", n: 3 }, { v: "4-8", n: 8 }, { v: "9-15", n: 15 }, { v: "15+", n: 20 }] as const;

export type Installer = { full_legal_name?: string; qualification?: string; mobile?: string; email?: string };
export type InstData = {
  legal_entity_name?: string; trading_name?: string; abn?: string; cii_status?: string; cii_details?: string;
  business_address?: string; primary_contact_name?: string; business_phone?: string; business_email?: string; authorised_to_register?: boolean;
  insurer?: string; insurance_policy_number?: string; public_liability_cover_amount?: number | null; public_liability_expiry?: string; insurance_uploaded?: boolean;
  installers?: Installer[];
  service_batts_removal?: boolean; service_loose_fill_removal?: boolean; free_quotes_for_hivic_leads?: boolean | null; free_measureups_for_hivic_quote_leads?: boolean | null;
  service_origin?: string; travel_radius_km?: number | null; excluded_areas?: string;
  typical_days?: string[]; normal_attendance_speed?: string;
  capacity_band?: string; accepting_jobs?: boolean;
  gst_registered?: boolean | null; r5_rate?: number | null; batts_removal_rate?: number | null; loose_fill_removal_rate?: number | null;
  extra_rates?: Partial<Record<(typeof EXTRA_ITEMS)[number]["key"], number | null>>;
  bank_account_name?: string; bank_bsb?: string; bank_account_number?: string;
  agreement_reviewed?: boolean;
  electrician_choice?: ElectricianChoice | null; preferred_electricians?: PreferredElectrician[]; electrician_contact_consent?: boolean;
  how_it_works_acknowledged?: boolean;
};

/** First name for greetings throughout onboarding and the portal. */
export function firstName(d: { primary_contact_name?: string }): string {
  return (d.primary_contact_name ?? "").trim().split(/\s+/)[0] || "";
}

export const STEPS = [
  { key: "about", title: "About you" },
  { key: "howitworks", title: "How we work together" },
  { key: "business", title: "Business details" },
  { key: "contact", title: "Contact details" },
  { key: "insurance", title: "Public liability insurance" },
  { key: "installers", title: "Your installers" },
  { key: "electrician", title: "Your electrician" },
  { key: "services", title: "Home Insulation Victoria work" },
  { key: "coverage", title: "Where you work" },
  { key: "availability", title: "When you work" },
  { key: "capacity", title: "Weekly capacity" },
  { key: "install_pricing", title: "Installation & removal pricing" },
  { key: "extras_pricing", title: "Access & extras pricing" },
  { key: "bank", title: "Payment details" },
  { key: "review", title: "Review agreement" },
  { key: "sign", title: "Sign agreement" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];
export const visibleSteps = (_d: InstData) => STEPS;

const txt = (s?: string) => (s ?? "").trim().length > 0;
const pos = (n?: number | null) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 100000;
const optPos = (n?: number | null) => n == null || pos(n);

export function stepErrors(step: StepKey, d: InstData, now = new Date()): string[] {
  const e: string[] = [];
  switch (step) {
    case "about":
      if (!txt(d.primary_contact_name)) e.push("Enter your name.");
      if (!validPhone(d.business_phone)) e.push("Enter a valid Australian mobile.");
      if (!validBusinessEmail(d.business_email)) e.push("Enter a real email address.");
      break;
    case "howitworks":
      if (d.how_it_works_acknowledged !== true) e.push("Confirm you've read how the two options work.");
      break;
    case "business":
      if (!txt(d.legal_entity_name)) e.push("Enter the legal entity name.");
      if (!validAbn(d.abn)) e.push("Enter a valid 11-digit ABN.");
      if (!CII_STATUSES.some((c) => c.v === d.cii_status)) e.push("Tell us your ceiling insulation installation (CII) training / certification status.");
      if (d.cii_status === "certified" && !txt(d.cii_details)) e.push("Enter your CII certification / training details.");
      break;
    case "contact":
      if (!txt(d.business_address)) e.push("Enter your business address.");
      if (!txt(d.primary_contact_name)) e.push("Enter a contact name.");
      if (!validPhone(d.business_phone)) e.push("Enter a valid Australian phone number.");
      if (!validBusinessEmail(d.business_email)) e.push("Enter a real business email address.");
      if (d.authorised_to_register !== true) e.push("Confirm you're authorised to set up this business.");
      break;
    case "insurance":
      if (d.insurance_uploaded !== true) e.push("Upload your Certificate of Currency.");
      if (!txt(d.insurer)) e.push("Enter the insurer.");
      if (!txt(d.insurance_policy_number)) e.push("Enter the policy number.");
      if (!(typeof d.public_liability_cover_amount === "number" && d.public_liability_cover_amount >= MIN_PL_COVER)) e.push("Public liability cover must be at least $5,000,000.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.public_liability_expiry ?? "") || (d.public_liability_expiry as string) < melbourneToday(now)) e.push("Insurance expiry must be today or later.");
      break;
    case "installers": {
      const list = d.installers ?? [];
      if (list.length < 1) e.push("Add at least one installer.");
      list.forEach((x, i) => {
        if (!txt(x.full_legal_name) || !txt(x.qualification) || !validPhone(x.mobile) || !validBusinessEmail(x.email)) e.push(`Installer ${i + 1}: complete name, training / certification, a valid mobile and email.`);
      });
      const emails = list.map((x) => (x.email ?? "").trim().toLowerCase()).filter(Boolean);
      if (new Set(emails).size !== emails.length) e.push("Each installer needs a different email.");
      break;
    }
    case "electrician":
      e.push(...electricianStepErrors(d));
      break;
    case "services":
      if (typeof d.free_quotes_for_hivic_leads !== "boolean") e.push("Tell us if you offer free quotes for pre-qualified Home Insulation Victoria leads.");
      if (typeof d.free_measureups_for_hivic_quote_leads !== "boolean") e.push("Tell us if you will provide free measure-ups for pre-qualified Home Insulation Victoria quote leads.");
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
    case "install_pricing":
      if (typeof d.gst_registered !== "boolean") e.push("Tell us if you're GST registered.");
      if (!pos(d.r5_rate)) e.push("Enter your R5.0 supply & install rate per m².");
      if (!pos(d.batts_removal_rate)) e.push("Enter your batts removal rate per m² — removal is required for all installer partners.");
      if (!pos(d.loose_fill_removal_rate)) e.push("Enter your loose fill removal rate per m² — removal is required for all installer partners.");
      break;
    case "extras_pricing":
      for (const it of EXTRA_ITEMS) if (!optPos(d.extra_rates?.[it.key] ?? null)) e.push(`${it.label}: enter a valid amount or leave it blank.`);
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

export function firstIncompleteStep(d: InstData, now = new Date()): StepKey | null {
  for (const s of visibleSteps(d)) if (s.key !== "sign" && stepErrors(s.key, d, now).length) return s.key;
  return null;
}

export const MATERIAL_FIELDS = [
  "legal_entity_name", "trading_name", "abn", "cii_status", "cii_details", "business_email", "service_origin", "travel_radius_km",
  "excluded_areas", "typical_days", "normal_attendance_speed", "capacity_band", "service_batts_removal", "service_loose_fill_removal",
  "free_quotes_for_hivic_leads", "free_measureups_for_hivic_quote_leads", "gst_registered", "r5_rate", "batts_removal_rate", "loose_fill_removal_rate", "extra_rates", "installers",
] as const;

export function applyMaterialReset(prev: InstData, next: InstData): InstData {
  const changed = MATERIAL_FIELDS.some((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(next[k] ?? null));
  return changed && prev.agreement_reviewed ? { ...next, agreement_reviewed: false } : next;
}

const money = (n?: number | null) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");
const ciiLabel = (v?: string) => CII_STATUSES.find((c) => c.v === v)?.l ?? "—";

export function scheduleText(d: InstData): string {
  const gst = d.gst_registered ? "inc GST" : "total rate (not GST registered)";
  const L: string[] = [];
  L.push("SCHEDULE 1 — INSTALLER DETAILS");
  L.push(`Legal entity: ${d.legal_entity_name ?? ""}`, `Trading name: ${d.trading_name || "—"}`, `ABN: ${d.abn ?? ""}`,
    `CII training / certification: ${ciiLabel(d.cii_status)}${d.cii_details ? ` — ${d.cii_details}` : ""}`,
    `Business address: ${d.business_address ?? ""}`, `Contact: ${d.primary_contact_name ?? ""}, ${d.business_phone ?? ""}, ${d.business_email ?? ""}`,
    `Public liability: ${d.insurer ?? ""} policy ${d.insurance_policy_number ?? ""}, cover ${money(d.public_liability_cover_amount)}, expires ${d.public_liability_expiry ?? ""}`);
  L.push("", "Nominated installers:");
  (d.installers ?? []).forEach((x, i) => L.push(`${i + 1}. ${x.full_legal_name} — ${x.qualification}`));
  L.push("", "SCHEDULE 2 — SERVICES, COVERAGE AND CAPACITY");
  L.push("Free Home Insulation Ready Check: installer eligibility check, ceiling measure-up and required site evidence; no electrical assessment or PIESA");
  L.push("Ceiling insulation supply & installation: included");
  L.push("Removal of existing insulation (batts and loose fill): included — required of all installer partners",
    `Free quotes for pre-qualified Home Insulation Victoria leads: ${d.free_quotes_for_hivic_leads ? "yes" : "no"}`,
    `Free eligibility measure-ups for Home Insulation Victoria pre-qualified quote leads: ${d.free_measureups_for_hivic_quote_leads ? "yes" : "no"}`);
  L.push(`Service origin: ${d.service_origin ?? ""}; radius: ${d.travel_radius_km === 9999 ? "anywhere in Victoria" : `${d.travel_radius_km} km`}${d.excluded_areas ? `; excluded: ${d.excluded_areas}` : ""}`);
  L.push(`Days: ${(d.typical_days ?? []).join(", ")}; lead time: ${d.normal_attendance_speed ?? ""}; weekly installations: ${d.capacity_band ?? ""}`);
  L.push("", `SCHEDULE 3 — PROPOSED SUPPLIER RATES (${gst}; not binding until accepted by Home Insulation Victoria under clause 17)`);
  L.push(`R5.0 ceiling insulation supply & install: ${money(d.r5_rate)} / m²`);
  L.push(`Batts removal: ${money(d.batts_removal_rate)} / m²`);
  L.push(`Loose fill removal: ${money(d.loose_fill_removal_rate)} / m²`);
  for (const it of EXTRA_ITEMS) { const v = d.extra_rates?.[it.key]; if (typeof v === "number") L.push(`${it.label}: ${money(v)} / ${it.unit}`); }
  L.push("Any other extras are quoted separately on the specific job before owner approval.");
  return L.join("\n");
}

export function agreementText(d: InstData): string {
  return [
    INSTALLER_AGREEMENT_TITLE, `Version: ${INSTALLER_AGREEMENT_VERSION}`,
    `Between: ${AP_ENTITY}, acting as an Accredited Person for Victorian Energy Upgrades (VEU) Activity 48, and the insulation installation business (Installer) identified in Schedule 1.`, "",
    ...INSTALLER_AGREEMENT_SECTIONS.flatMap((s) => [`${s.n}. ${s.title}`, ...s.paras, ""]),
    scheduleText(d), "", "ACKNOWLEDGEMENTS",
    ...ACKNOWLEDGEMENTS.map((a, i) => `${i + 1}. ${a.text}`),
  ].join("\n");
}
