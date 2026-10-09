// Template registers moved verbatim from their original office pages so the Templates hub and the
// original pages read ONE list (no duplicate copies). Presentation metadata only — never workflow.
import type { FormKey } from "./mitti-forms.core";
import piesaPdf from "@/assets/veu-piesa-form.pdf.asset.json";
import piisaPdf from "@/assets/veu-piisa-form.pdf.asset.json";

// [key, label, purpose, when it is sent, mandatory forms attached, preview available]
export const CUSTOMER_COMMUNICATION_CATALOG = [
  ["likely_estimate", "Likely eligible estimate", "After the official Gate 1 result; includes estimate and free Ready Check action.", "1 · Enquiry", "None – preliminary estimate only", true],
  ["onsite_estimate", "Needs onsite confirmation estimate", "Explains what the installer must confirm during the free Ready Check.", "1 · Enquiry", "None – preliminary estimate only", true],
  ["ineligible_result", "Ineligible result", "No quote or Ready Check action; offers result review only.", "1 · Enquiry", "None", true],
  ["estimate_unopened_3d", "Estimate not opened reminder", "Manual-first follow-up after three days.", "1 · Enquiry", "None", false],
  ["area_unavailable", "No partner in service area", "Used only after both REC and installer coverage are conclusively checked.", "1 · Enquiry", "None", false],
  ["measured_quote", "Measured quote (after Ready Check)", "Sends the measured quote for one electronic acceptance.", "2 · Quote", "Customer Acceptance · VEU Consumer Factsheet · Consumer rights & Home Insulation Victoria terms · Code of Conduct / dispute information", true],
  ["booking_consent", "Booking confirmation + ESC consent", "Confirms the install date and requests electronic Reg 23A consent.", "3 · Booked", "ESC Owner Consent (Reg 23A) – signed ≥24h before work", false],
  ["pre_install_pack", "Pre-installation pack", "Delivers PIESA copy and consumer documents before work.", "4 · Before install", "PIESA copy (≥24h before) · Certificate of Electrical Safety if rectified · Life-support plan if applicable", false],
  ["assignment_signing", "Final VEEC assignment signing", "Electronic signature after installer and AP have signed verified final facts.", "5 · After install", "Final Activity 48 VEEC Assignment (installer → AP → homeowner)", false],
  ["completion_pack", "Completion email + certificate pack", "Final email after installation and sign-off.", "6 · Complete", "Tax invoice & $200+ co-payment receipt · Certificate of installation / Installer Declaration · Signed assignment copy · Warranties & product info · Dispute and contact information", false],
] as const;

export const MITTI_FORM_ORDER: { key: FormKey; letter: string; forWho: string; who: string }[] = [
  { key: "ready_check", letter: "A2", forWho: "For a customer WE brought you", who: "Installer · free Ready Check on a Home Insulation Victoria lead (no price)" },
  { key: "ready_check_priced", letter: "A1", forWho: "For a customer THE INSTALLER brought", who: "Installer · free Ready Check on their own customer (with quoted price)" },
  { key: "piesa", letter: "B", forWho: "For every job that needs electrical work", who: "Licensed electrician · official DEECA PIESA" },
  { key: "piisa", letter: "C", forWho: "For every installation", who: "Lead installer · official DEECA PIISA on install day" },
];


export const COMPLIANCE_TEMPLATE_KEYS = [
  ["consumer_rights", "Customer agreement – VEU consumer information & rights (pre-install, at quote acceptance)"],
  ["customer_agreement", "Customer agreement – Home Insulation Victoria commercial terms (optional, pre-install)"],
  ["esc_consent", "ESC Owner Consent – information sharing (after booking, ≥24h before work)"],
  ["installer_declaration", "Installer declaration (post-install)"],
  ["consumer_declaration", "Final Activity 48 VEEC Assignment – official form (post-install)"],
  ["ap_declaration", "AP declaration (if required)"],
  ["partner_agreement", "Home Insulation Victoria partner participation agreement (partner onboarding)"],
] as const;

export const ACTIVITY_48_FORMS = [
  { name: "Customer Acceptance", purpose: "Records the accepted commercial quote and customer terms.", signer: "Homeowner", timing: "At quote acceptance", blocks: "Invoice and deposit", source: "Approved customer agreement and consumer rights versions" },
  { name: "ESC Owner Consent (Reg 23A)", purpose: "Records consent for required information sharing.", signer: "Homeowner", timing: "After booking and at least 24 hours before work", blocks: "Ready to install", source: "Approved ESC consent version" },
  { name: "PIESA and Consumer Information Pack", purpose: "Gives the owner the PIESA copy, Consumer Factsheet, Code of Conduct information and CES when rectification occurred.", signer: "Electronic delivery evidence", timing: "Before installation; PIESA copy at least 24 hours before", blocks: "Installation start", source: "Current PIESA and approved customer documents" },
  { name: "Ready Check (Home Insulation Victoria checklist)", purpose: "Free installer eligibility and measure-up with required photos, videos and floor plan.", signer: "Installer", timing: "Before the PIESA", blocks: "Quote", source: "Mitti form A1 (installer's own customer) / A2 (our lead)" },
  { name: "Pre-installation electrical safety assessment (PIESA)", purpose: "Official DEECA form: licensed electrician checks mains, solar, hazards, cables and luminaires; B1 outcome; Section C after rectification; owner declaration.", signer: "Electrician → owner", timing: "No earlier than 30 days before work; copy to owner and installer at least 24 hours before", blocks: "Installation start", source: "Official DEECA form · Mitti form B", pdf: piesaPdf.url },
  { name: "Pre-installation installer safety assessment (PIISA)", purpose: "Official DEECA form: lead installer confirms SWMS, isolation, PIESA review, existing insulation and products.", signer: "Lead installer", timing: "Install day, within 30 days of the PIESA; re-check each extra day", blocks: "Installation start", source: "Official DEECA form · Mitti form C", pdf: piisaPdf.url },
  { name: "Installer Declaration", purpose: "Confirms the installed work and evidence after completion.", signer: "Lead installer", timing: "After installation", blocks: "AP review", source: "Approved installer declaration version" },
  { name: "Final Activity 48 VEEC Assignment", purpose: "Records verified final installation, price and benefit facts for VEEC creation.", signer: "Lead installer → AP → homeowner", timing: "After installation, during AP review", blocks: "VEEC lodgement", source: "Approved official assignment version" },
  { name: "Completion Pack", purpose: "Gives the owner the tax invoice, dispute information, instructions, contacts and written insulation product warranty details: minimum five-year cover against defects from installation, purchase or supply as applicable under Activity 48 table 48-3, with an Australian warranty contact where the warrantor is overseas. The separate workmanship defects warranty is twelve months from completion; non-excludable Australian Consumer Law rights remain unchanged.", signer: "Electronic delivery evidence", timing: "On completion", blocks: "AP review", source: "Current approved completion documents" },
] as const;

