// Pure rules for the portal installer onboarding + partner agreement signing.
// Mirrors rec-onboarding.core.ts (same design/rules); shared validators are reused from there.
import { INSTALLER_AGREEMENT_SECTIONS } from "./installer-agreement.text";
import { activity48AgreementScheduleText } from "./activity48-agreement-schedule.text";
import { electricianStepErrors, type ElectricianChoice, type PreferredElectrician } from "./teaming.core";
import { AP_ENTITY, MIN_PL_COVER, validAbn, validBusinessEmail, validPhone, melbourneToday, validCalendarDate, isAustralianAddress, isVictorianAddress, DAYS, LEAD_TIMES, RADII, type ResolvedAddress } from "./rec-onboarding.core";
import type { OnboardingNoticeAck } from "./esc-collection-notice.core";

export { DAYS, LEAD_TIMES, RADII, validAbn };
export type { ResolvedAddress };
// 1.14 adds the verified AP accreditation number to the applicant-facing agreement.
// 1.16 (5 Oct, single onboarding-fix version; folds in the unsigned 1.15 changes): CII lines omit blank details; vacuum-only rate dropped;
//   payment terms: 7 days after approval (HIV-sourced) or after the later of approval and owner paid in full (installer-sourced); AP fee as recorded per installer.
// 1.20 (19 Oct): Schedule 4 incorporated; White Card for every person installing; Activity 48 product rules with foil-faced, cellulose fibre
//   and loose-fill insulation prohibited; separate minimum five-year product-defects warranty; AP-disclosure evidence for lead generation;
//   PIESA fee and pricing wording removed from this agreement.
// Earlier signed versions stay immutable and remain activatable.
export const INSTALLER_AGREEMENT_VERSION = "HI-VIC-A48-INST-1.20-2026-10-19";
export const ACTIVATABLE_INSTALLER_VERSIONS: readonly string[] = ["HI-VIC-A48-INST-1.11-2026-10-03", "HI-VIC-A48-INST-1.12-2026-10-03", "HI-VIC-A48-INST-1.13-2026-10-03", "HI-VIC-A48-INST-1.14-2026-10-03", "HI-VIC-A48-INST-1.16-2026-10-05", "HI-VIC-A48-INST-1.18-2026-10-09", "HI-VIC-A48-INST-1.19-2026-10-09", INSTALLER_AGREEMENT_VERSION];
export const INSTALLER_AGREEMENT_TITLE = "Activity 48 Insulation Installer Partner Agreement";

export const ACKNOWLEDGEMENTS = [
  { key: "authority", text: "I am authorised to bind the Installer business to this agreement." },
  { key: "personnel", text: "The Installer will ensure every person who installs on Home Insulation Victoria jobs is competent, holds a current Installer (CII) certification verified by Home Insulation Victoria before they are assigned, and complies with the obligations that apply to them." },
  { key: "compliance", text: "I understand the Installer and its personnel must comply with current VEU, Code of Conduct, Activity 48, AS 3999, safety and Home Insulation Victoria requirements, and must not install without a current signed VEU Pre Insulation Electrical Safety Assessment (PIESA) and Home Insulation Victoria ready-to-install confirmation." },
  { key: "records", text: "I confirm the Installer will provide truthful measurements, records and evidence and cooperate with Home Insulation Victoria, ESC and regulator compliance checks." },
  { key: "no_bypass", text: "I understand that removal, access, extras and other work identified through a Home Insulation Victoria Activity 48 job must be quoted, approved, scheduled and completed through the Home Insulation Victoria workflow and must not be taken off-platform or dealt with directly." },
  { key: "pricing", text: "I understand our approved rates are supplier rates, not customer prices. On Home Insulation Victoria-sourced jobs, Home Insulation Victoria sets the customer price and may include its own margin, which it is not required to disclose to us. On jobs we bring in ourselves, we set our own price and Home Insulation Victoria adds no lead fee and no margin to it; the customer quote adds the Accredited Person fee recorded for the Installer in Home Insulation Victoria (standard $349 including GST, or a lower pilot rate agreed in writing) and that fee is fixed once the customer accepts the quote. The PIESA is a compliance step arranged or required by Home Insulation Victoria and is not part of our supplier rate. I will not share our rates with customers." },
  { key: "same_day", text: "I understand the signed VEU pre-installation installer safety assessment and install-day evidence must be submitted through the Home Insulation Victoria portal on the day of each installation." },
  { key: "electronic_signature", text: "I agree to electronic execution and to the signed agreement, exact wording, version and audit record being stored by Home Insulation Victoria." },
] as const;

/** Legacy business-level answer (kept for old drafts/history only — never treated as certification). */
export const CII_STATUSES = [
  { v: "certified", l: "Yes — trained / certified" },
  { v: "in_progress", l: "In progress" },
  { v: "not_yet", l: "Not yet" },
] as const;
/** Per-person EEC Certified Insulation Installer (CII) status — self-declared; only office verification counts. */
export const WORKER_CII = [
  { v: "held", l: "Yes, certified" },
  { v: "in_training", l: "Still training" },
  { v: "not_held", l: "Not certified" },
] as const;
export type WorkerCii = (typeof WORKER_CII)[number]["v"];

export const EXTRA_ITEMS = [
  // Jo (5 Oct): only ONE optional extra is asked/offered for new onboarding. Tile/metal roof access and
  // minimum charge were retired; already-signed agreement texts and stored rate cards keep them as history.
  { key: "difficult_access", label: "Difficult access", unit: "job" },
] as const;

export const CAPACITY_BANDS = [{ v: "1-3", n: 3 }, { v: "4-8", n: 8 }, { v: "9-15", n: 15 }, { v: "15+", n: 20 }] as const;

export type Installer = { full_legal_name?: string; qualification?: string; mobile?: string; email?: string; cii_holds?: WorkerCii | null; cii_certificate_number?: string; cii_issuer?: string; cii_issue_date?: string; cii_level?: "full" | "provisional" | null; cii_expiry?: string; is_self?: boolean; piisa_done?: "yes" | "no" | null; piisa_date?: string; piisa_uploaded?: boolean;
  /** Decision 319: derived server-side from data.white_card_files (never trusted from the browser); optional at onboarding. */
  white_card_uploaded?: boolean;
  /** ESC collection notice (esc-collection-notice.core.ts): the browser sends the tick; the server stamps `esc_notice_ack`. */
  esc_notice_ticked?: boolean; esc_notice_ack?: OnboardingNoticeAck | null };
export type InstData = {
  legal_entity_name?: string; trading_name?: string; abn?: string; cii_status?: string; cii_details?: string;
  business_address?: string; business_address_details?: ResolvedAddress | null; primary_contact_name?: string; business_phone?: string; business_email?: string; authorised_to_register?: boolean;
  works_for_business?: boolean | null;
  /** "Are you one of the installers?" — presentation helper; Yes copies page-1 contact details into Installer 1. */
  self_is_installer?: boolean | null;
  insurer?: string; insurance_policy_number?: string; public_liability_cover_amount?: number | null; public_liability_expiry?: string; insurance_uploaded?: boolean;
  installers?: Installer[];
  service_batts_removal?: boolean; service_loose_fill_removal?: boolean; wants_hivic_leads?: boolean | null; free_quotes_for_hivic_leads?: boolean | null; free_measureups_for_hivic_quote_leads?: boolean | null;
  service_origin?: string; service_origin_details?: ResolvedAddress | null; travel_radius_km?: number | null; excluded_areas?: string;
  typical_days?: string[]; normal_attendance_speed?: string;
  capacity_band?: string; daily_capacity_m2?: number | null; accepting_jobs?: boolean;
  gst_registered?: boolean | null; r5_rate?: number | null; r6_rate?: number | null; r7_rate?: number | null; topup_r5_rate?: number | null; vacuum_only_rate?: number | null; batts_removal_rate?: number | null; loose_fill_removal_rate?: number | null;
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

export type VisibleInstallerPage = { key: StepKey; title: string; members: readonly StepKey[] };

/**
 * Public presentation only: nine visible pages. Persisted drafts keep the legacy StepKey anchors
 * (the first member of each page); every member step is validated together.
 */
export const INSTALLER_VISIBLE_PAGES: readonly VisibleInstallerPage[] = [
  { key: "about", title: "Business & contact", members: ["about", "business", "contact"] },
  { key: "insurance", title: "Insurance", members: ["insurance"] },
  { key: "installers", title: "Your installers", members: ["installers"] },
  { key: "electrician", title: "Electrical partner", members: ["electrician"] },
  { key: "services", title: "Work & coverage", members: ["services", "coverage"] },
  { key: "availability", title: "Availability", members: ["availability", "capacity"] },
  { key: "install_pricing", title: "Rates", members: ["install_pricing", "extras_pricing"] },
  { key: "bank", title: "Bank details", members: ["bank"] },
  { key: "review", title: "Review & sign", members: ["review", "sign"] },
] as const;
export const visibleSteps = (_d: InstData) => INSTALLER_VISIBLE_PAGES;

/** Any legacy or current step key -> its visible page anchor; unknown input fails safe to the first page. */
export function visiblePageForStep(step: string | null | undefined): StepKey {
  return INSTALLER_VISIBLE_PAGES.find((p) => p.members.some((m) => m === step))?.key ?? "about";
}
export function pageMembers(step: StepKey): readonly StepKey[] {
  return INSTALLER_VISIBLE_PAGES.find((p) => p.key === visiblePageForStep(step))?.members ?? ["about"];
}
export function pageErrors(step: StepKey, d: InstData, now = new Date()): string[] {
  return pageFieldErrors(step, d, now).map((x) => x.message);
}

export type InstallerSampleStep = StepKey | "welcome" | "submitted";
/** Read-only sample preview: only allow-listed keys are accepted. */
export function parseInstallerSampleStep(value: string | null): InstallerSampleStep | null {
  if (value === "welcome" || value === "submitted") return value;
  return STEPS.some((s) => s.key === value) ? visiblePageForStep(value) : null;
}

const txt = (s?: string) => (s ?? "").trim().length > 0;
const cents = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
/** Required supplier rate: positive, whole cents, at most $100,000. */
export const validRequiredRate = (n?: number | null) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 100000 && cents(n);
/** Optional extra: $0 = "no extra charge", blank = quoted separately on the job; otherwise a positive whole-cent amount. */
export const validOptionalRate = (n?: number | null) => n == null || (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100000 && cents(n));
export const resolvedBusinessAddress = (d: InstData) => isAustralianAddress(d.business_address_details) && d.business_address_details?.label === d.business_address;
export const resolvedServiceOrigin = (d: InstData) => isVictorianAddress(d.service_origin_details) && d.service_origin_details?.label === d.service_origin;

/** Field-level error: `field` is the DOM id of the input that fixes it (used for focus + aria). */
export type FieldError = { field: string; message: string };

export function stepFieldErrors(step: StepKey, d: InstData, now = new Date()): FieldError[] {
  const e: FieldError[] = [];
  const add = (field: string, message: string) => e.push({ field, message });
  // Business/contact questions only exist on the "register my business" branch.
  if ((step === "business" || step === "contact") && d.works_for_business !== false) return e;
  switch (step) {
    case "about":
      if (d.works_for_business !== false) { add("works_for_business", "Choose whether you're registering your business."); break; }
      if (!txt(d.primary_contact_name)) add("primary_contact_name", "Enter your name.");
      if (!validPhone(d.business_phone)) add("business_phone", "Enter a valid Australian mobile.");
      if (!validBusinessEmail(d.business_email)) add("business_email", "Enter a real email address.");
      break;
    case "business":
      if (!txt(d.legal_entity_name)) add("legal_entity_name", "Enter the legal entity name.");
      if (!validAbn(d.abn)) add("abn", "Enter a valid 11-digit ABN.");
      break;
    case "contact":
      if (!txt(d.business_address)) add("business-address", "Enter your business address.");
      else if (!resolvedBusinessAddress(d)) add("business-address", "Select an Australian business address from the list.");
      break;
    case "insurance":
      if (d.insurance_uploaded !== true) add("insurance-upload", "Upload your Certificate of Currency.");
      if (!txt(d.insurer)) add("insurer", "Enter the insurer.");
      if (!txt(d.insurance_policy_number)) add("insurance_policy_number", "Enter the policy number.");
      if (!(typeof d.public_liability_cover_amount === "number" && Number.isFinite(d.public_liability_cover_amount) && d.public_liability_cover_amount >= MIN_PL_COVER)) add("public_liability_cover_amount", "Public liability cover must be at least $5,000,000.");
      if (!validCalendarDate(d.public_liability_expiry)) add("public_liability_expiry", "Enter a real insurance expiry date.");
      else if ((d.public_liability_expiry as string) < melbourneToday(now)) add("public_liability_expiry", "Insurance expiry must be today or later.");
      break;
    case "installers": {
      const list = d.installers ?? [];
      if (list.length < 1) add("add-installer", "Add at least one installer.");
      const today = melbourneToday(now);
      // One installer: plain messages. Several: say which installer the message is about.
      const say = (i: number, m: string) => (list.length > 1 ? `Installer ${i + 1}: ${m.charAt(0).toLowerCase()}${m.slice(1)}` : m);
      if (!list.length && typeof d.self_is_installer !== "boolean") add("self_is_installer", "Tell us if you're one of the installers.");
      list.forEach((x, i) => {
        if (!txt(x.full_legal_name)) add(`installer-${i}-name`, say(i, "Enter their full legal name."));
        if (!validPhone(x.mobile)) add(`installer-${i}-mobile`, say(i, "Enter a valid Australian mobile."));
        if (!validBusinessEmail(x.email)) add(`installer-${i}-email`, say(i, "Enter a real email address."));
        if (!WORKER_CII.some((c) => c.v === x.cii_holds)) add(`installer-${i}-cii`, say(i, "Tell us their CII certification status."));
        if (x.cii_holds === "held") {
          // Issuer is always EEC (saved automatically) and the issue date is no longer asked.
          if (!txt(x.cii_certificate_number)) add(`installer-${i}-cii-number`, say(i, "Enter the CII certificate or ID number."));
          if (!txt(x.cii_issuer)) add(`installer-${i}-cii-issuer`, say(i, "Enter who issued the certificate, for example Energy Efficiency Council Victoria."));
          if (x.cii_level !== "full" && x.cii_level !== "provisional") add(`installer-${i}-cii-level`, say(i, "Choose Full or Provisional."));
          if (!validCalendarDate(x.cii_expiry)) add(`installer-${i}-cii-expiry`, say(i, "Enter the expiry date, for example 05/10/2028."));
          else if ((x.cii_expiry as string) <= today) add(`installer-${i}-cii-expiry`, say(i, "This certificate has expired — enter a future expiry date."));
        }
        // PIISA training: Yes needs date + certificate; No can still submit (flagged, no jobs until verified).
        if (x.piisa_done !== "yes" && x.piisa_done !== "no") add(`installer-${i}-piisa`, say(i, "Tell us if they've done the PIISA training."));
        if (x.piisa_done === "yes") {
          if (!validCalendarDate(x.piisa_date)) add(`installer-${i}-piisa-date`, say(i, "Enter the date they finished PIISA training."));
          else if ((x.piisa_date as string) > today) add(`installer-${i}-piisa-date`, say(i, "The PIISA date can't be in the future."));
          const files = (d as { piisa_files?: Record<string, string> }).piisa_files;
          const uploaded = files ? !!files[(x.email ?? "").trim().toLowerCase()] : x.piisa_uploaded === true;
          if (!uploaded) add(`installer-${i}-piisa-upload`, say(i, "Upload the PIISA certificate."));
        }
        // ESC rule (1 Oct 2026, decision 130): the applicant acknowledges the collection notice for themself here; every other
        // installer gets their own secure link after approval — the owner cannot tick for them.
        if (x.is_self && x.esc_notice_ticked !== true) add(`installer-${i}-esc-notice`, say(i, "Tick that you've read the ESC privacy collection notice."));
      });
      const emails = list.map((x) => (x.email ?? "").trim().toLowerCase()).filter(Boolean);
      if (new Set(emails).size !== emails.length) add("add-installer", "Each installer needs a different email.");
      break;
    }
    case "electrician":
      for (const m of electricianStepErrors(d)) add("electrician_choice", m);
      break;
    case "services":
      if (typeof d.wants_hivic_leads !== "boolean") add("wants_hivic_leads", "Tell us if you want to receive pre-qualified leads from Home Insulation Victoria.");
      if (d.wants_hivic_leads === true && d.free_measureups_for_hivic_quote_leads !== true) add("free_measureups", "Free Ready Checks are required to receive pre-qualified Home Insulation Victoria leads.");
      break;
    case "coverage":
      if (!txt(d.service_origin)) add("service-origin", "Enter your service starting location.");
      else if (!resolvedServiceOrigin(d)) add("service-origin", "Select a Victorian service starting location from the list.");
      if (!RADII.some((r) => r.v === d.travel_radius_km)) add("travel_radius_km", "Choose a travel radius.");
      break;
    case "availability": {
      const days = d.typical_days ?? [];
      if (!days.length) add("typical_days", "Select at least one day.");
      else if (days.some((x) => !DAYS.includes(x as never)) || new Set(days).size !== days.length) add("typical_days", "Choose days from the list.");
      if (!LEAD_TIMES.includes((d.normal_attendance_speed ?? "") as never)) add("normal_attendance_speed", "Choose your usual lead time.");
      if (typeof d.accepting_jobs !== "boolean") add("accepting_jobs", "Tell us if you're available for new work now.");
      break;
    }
    case "capacity":
      break; // Trades run their own diaries: weekly capacity is no longer asked (stored answers ignored).
    case "install_pricing":
      if (typeof d.gst_registered !== "boolean") add("gst_registered", "Tell us if you're GST registered.");
      if (!validRequiredRate(d.r5_rate)) add("rate-r5", "Enter your R5.0 supply & install rate per m².");
      if (!validOptionalRate(d.r6_rate) || d.r6_rate === 0) add("rate-r6", "R6.0 supply & install: enter a valid rate per m².");
      if (!validOptionalRate(d.r7_rate) || d.r7_rate === 0) add("rate-r7", "R7.0 supply & install: enter a valid rate per m².");
      if (!validOptionalRate(d.topup_r5_rate) || d.topup_r5_rate === 0) add("rate-topup", "Top up to R5.0: enter a valid rate per m².");
      if (!validRequiredRate(d.batts_removal_rate)) add("rate-batts", "Enter your batts removal rate per m² — removal is required for all installer partners.");
      if (!validRequiredRate(d.loose_fill_removal_rate)) add("rate-loose", "Enter your loose fill removal rate per m² — removal is required for all installer partners.");
      break;
    case "extras_pricing":
      for (const it of EXTRA_ITEMS) if (!validOptionalRate(d.extra_rates?.[it.key] ?? null)) add(`rate-${it.key}`, `${it.label}: enter a valid amount or $0.`);
      break;
    case "bank":
      if (!txt(d.bank_account_name)) add("bank_account_name", "Enter the bank account name.");
      if (!/^\d{3}-?\d{3}$/.test(d.bank_bsb ?? "")) add("bank_bsb", "Enter a valid 6-digit BSB.");
      if (!/^\d{5,10}$/.test(d.bank_account_number ?? "")) add("bank_account_number", "Enter a valid bank account number.");
      break;
    case "review":
      if (d.agreement_reviewed !== true) add("agreement_reviewed", "Confirm you've reviewed the agreement and schedules.");
      break;
    case "sign":
      break;
  }
  return e;
}
export const stepErrors = (step: StepKey, d: InstData, now = new Date()) => [...new Set(stepFieldErrors(step, d, now).map((x) => x.message))];
export function pageFieldErrors(step: StepKey, d: InstData, now = new Date()): FieldError[] {
  const seen = new Set<string>();
  return pageMembers(step).flatMap((m) => stepFieldErrors(m, d, now)).filter((x) => (seen.has(x.message) ? false : (seen.add(x.message), true)));
}

/**
 * Server-side normalisation of every loaded/saved draft:
 *  - removal is mandatory, so both removal services are always on (old drafts left the booleans unset);
 *  - an address whose text no longer matches its verified lookup loses the lookup, so the applicant must re-select it.
 */
export function normaliseInstallerDraft(d: InstData): InstData {
  const n: InstData = { ...d, service_batts_removal: true, service_loose_fill_removal: true };
  if (n.business_address_details && n.business_address_details.label !== n.business_address) n.business_address_details = null;
  if (n.service_origin_details && n.service_origin_details.label !== n.service_origin) n.service_origin_details = null;
  return n;
}

export function firstIncompleteStep(d: InstData, now = new Date()): StepKey | null {
  for (const s of STEPS) if (s.key !== "sign" && stepErrors(s.key, d, now).length) return visiblePageForStep(s.key);
  return null;
}

export type InstallerSignUiBlocker = { key: string; message: string; page?: StepKey; target?: string };
/** Complete applicant-facing signing checklist. It explains disabled signing without weakening server validation. */
export function installerSignUiBlockers(input: {
  data: InstData; reviewed: boolean; acknowledgements: Record<string, boolean>;
  signerName: string; signerPosition: string; signerEmail: string; relaxed?: boolean; preview?: boolean; now?: Date;
}): InstallerSignUiBlocker[] {
  const blockers: InstallerSignUiBlocker[] = [];
  if (!input.reviewed || input.data.agreement_reviewed !== true) blockers.push({ key: "review", message: "Review the agreement and tick the review confirmation above.", page: "review", target: "agreement-review" });
  if (!input.relaxed && !input.preview) {
    for (const page of INSTALLER_VISIBLE_PAGES) {
      if (page.key === "review") continue;
      const errors = pageFieldErrors(page.key, input.data, input.now);
      if (errors.length) blockers.push({ key: `page-${page.key}`, message: `${page.title}: ${errors[0]?.message ?? "Complete this page."}`, page: page.key });
    }
  }
  const unticked = ACKNOWLEDGEMENTS.filter((a) => input.acknowledgements[a.key] !== true).length;
  if (unticked) blockers.push({ key: "acknowledgements", message: `Tick all ${ACKNOWLEDGEMENTS.length} signing acknowledgements (${unticked} remaining).`, page: "review", target: "signing-acknowledgements" });
  if (input.signerName.trim().length < 2) blockers.push({ key: "signer-name", message: "Enter the signer's full legal name.", page: "review", target: "signer-name" });
  if (input.signerPosition.trim().length < 2) blockers.push({ key: "signer-position", message: "Enter the signer's position or title.", page: "review", target: "signer-position" });
  if (!validBusinessEmail(input.signerEmail)) blockers.push({ key: "signer-email", message: "Enter a valid business email for the signer.", page: "review", target: "signer-email" });
  return blockers;
}

/** Fields that never appear in the signed agreement text; every other answer requires the agreement to be reviewed again. */
export const NON_MATERIAL_FIELDS = ["self_is_installer", "agreement_reviewed", "how_it_works_acknowledged", "bank_account_name", "bank_bsb", "bank_account_number", "insurance_uploaded"] as const;
export function materiallyChanged(prev: InstData, next: InstData): boolean {
  const strip = (d: InstData) => { const o: Record<string, unknown> = { ...d }; for (const k of NON_MATERIAL_FIELDS) delete o[k]; return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k] ?? null]).filter(([, v]) => v !== null)); };
  return strip(prev) !== strip(next);
}
export function applyMaterialReset(prev: InstData, next: InstData): InstData {
  return materiallyChanged(prev, next) && prev.agreement_reviewed ? { ...next, agreement_reviewed: false } : next;
}
export const isInstallerRevisionTimestamp = (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));

const money = (n?: number | null) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");
const workerCiiLabel = (x: Installer) => x.cii_holds === "held"
  ? `CII declared held — certificate ${x.cii_certificate_number ?? ""}${txt(x.cii_issuer) ? `, issued by ${x.cii_issuer!.trim()}` : ""}${txt(x.cii_issue_date) ? ` on ${x.cii_issue_date!.trim()}` : ""}${x.cii_level ? `, level ${x.cii_level === "full" ? "Full" : "Provisional (cannot receive work until Full)"}` : ""}${x.cii_expiry ? `, expires ${x.cii_expiry}` : ""} (subject to Home Insulation Victoria verification)`
  : x.cii_holds === "in_training" ? "CII training in progress — cannot be assigned until certified and verified" : x.cii_holds === "not_held" ? "Not CII certified — cannot be assigned" : "CII status not provided";

export function scheduleText(d: InstData): string {
  const gst = d.gst_registered ? "inc GST" : "total rate (not GST registered)";
  const L: string[] = [];
  L.push("SCHEDULE 1 — INSTALLER DETAILS");
  L.push(`Legal entity: ${d.legal_entity_name ?? ""}`, `Trading name: ${d.trading_name || "—"}`, `ABN: ${d.abn ?? ""}`,
    `Business address: ${d.business_address ?? ""}`, `Contact: ${d.primary_contact_name ?? ""}, ${d.business_phone ?? ""}, ${d.business_email ?? ""}`,
    `Public liability: ${d.insurer ?? ""} policy ${d.insurance_policy_number ?? ""}, cover ${money(d.public_liability_cover_amount)}, expires ${d.public_liability_expiry ?? ""}`);
  L.push("", "Nominated installers:");
  (d.installers ?? []).forEach((x, i) => L.push(`${i + 1}. ${x.full_legal_name} — ${workerCiiLabel(x)}`));
  L.push("Only people whose Installer (CII) certification Home Insulation Victoria has verified may be assigned to install.");
  L.push("", "SCHEDULE 2 — SERVICES, COVERAGE AND CAPACITY");
  L.push("Free Ready Check: installer eligibility check, ceiling Ready Check and required site evidence; no electrical assessment or PIESA");
  L.push("Ceiling insulation supply & installation: included");
  L.push("Removal of existing insulation (batts and loose fill): included — required of all installer partners",
    `Receives pre-qualified Home Insulation Victoria leads: ${d.wants_hivic_leads ? "yes" : "no"}`);
  if (d.wants_hivic_leads) L.push("Free Ready Checks for those leads: yes — the installer receives the job if it proceeds, unless the owner specifies otherwise");
  L.push(`Service origin: ${d.service_origin ?? ""}; radius: ${d.travel_radius_km === 9999 ? "anywhere in Victoria" : `${d.travel_radius_km} km`}${d.excluded_areas ? `; excluded: ${d.excluded_areas}` : ""}`);
  L.push(`Days: ${(d.typical_days ?? []).join(", ")}; lead time: ${d.normal_attendance_speed ?? ""}`);
  L.push(`Available for new work at signing: ${d.accepting_jobs === true ? "yes" : "no — Home Insulation Victoria will not offer new leads until the Installer updates this"}`);
  L.push("", `SCHEDULE 3 — PROPOSED SUPPLIER RATES (${gst}; not binding until accepted by Home Insulation Victoria under clause 17)`);
  L.push(`R5.0 ceiling insulation supply & install: ${money(d.r5_rate)} / m²`);
  // Optional higher R-values appear only when supplied, so existing agreement text is unchanged.
  if (d.r6_rate != null) L.push(`R6.0 ceiling insulation supply & install: ${money(d.r6_rate)} / m²`);
  if (d.r7_rate != null) L.push(`R7.0 ceiling insulation supply & install: ${money(d.r7_rate)} / m²`);
  if (d.topup_r5_rate != null) L.push(`Top up to R5.0 over existing insulation (existing stays in place): ${money(d.topup_r5_rate)} / m²`);
  // Vacuum-only rate is no longer asked (1.16); saved answers stay as history on older agreements.
  L.push(`Batts removal: ${money(d.batts_removal_rate)} / m²`);
  L.push(`Loose fill removal: ${money(d.loose_fill_removal_rate)} / m²`);
  for (const it of EXTRA_ITEMS) { const v = d.extra_rates?.[it.key]; L.push(`${it.label}: ${typeof v === "number" && v > 0 ? `${money(v)} / ${it.unit}` : v === 0 ? "no extra charge ($0)" : "no set rate — quoted separately on the job before owner approval"}`); }
  L.push("Any other extras are quoted separately on the specific job before owner approval.");
  return L.join("\n");
}

export function agreementText(d: InstData): string {
  return [
    INSTALLER_AGREEMENT_TITLE, `Version: ${INSTALLER_AGREEMENT_VERSION}`,
    `Between: ${AP_ENTITY}, acting as an Accredited Person for Victorian Energy Upgrades (VEU) Activity 48, and the insulation installation business (Installer) identified in Schedule 1.`,
    "AP accreditation number: A003654", "",
    ...INSTALLER_AGREEMENT_SECTIONS.flatMap((s) => [`${s.n}. ${s.title}`, ...s.paras, ""]),
    scheduleText(d), "", activity48AgreementScheduleText(), "", "ACKNOWLEDGEMENTS",
    ...ACKNOWLEDGEMENTS.map((a, i) => `${i + 1}. ${a.text}`),
  ].join("\n");
}

/** Friendly date entry: accepts 05/10/2028, 5/10/28, 5-10-2028 or ISO 2028-10-05. Returns ISO or null. */
export function parseDateInput(raw: string): string | null {
  const v = raw.trim();
  let y: number, m: number, day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  const au = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/.exec(v);
  if (iso) { y = Number(iso[1]); m = Number(iso[2]); day = Number(iso[3]); }
  else if (au) { const yy = au[3] ?? ""; day = Number(au[1]); m = Number(au[2]); y = yy.length === 2 ? 2000 + Number(yy) : Number(yy); }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
/** ISO -> dd/mm/yyyy for display. */
export const formatDateAu = (iso?: string | null) => { const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? ""); return r ? `${r[3]}/${r[2]}/${r[1]}` : (iso ?? ""); };
