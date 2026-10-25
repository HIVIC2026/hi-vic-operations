// Template registers moved verbatim from their original office pages so the Templates hub and the
// original pages read ONE list (no duplicate copies). Presentation metadata only — never workflow.
import type { FormKey } from "./mitti-forms.core";
import piesaPdf from "@/assets/veu-piesa-form.pdf.asset.json";
import piisaPdf from "@/assets/veu-piisa-form.pdf.asset.json";

// [key, label, purpose, when it is sent, mandatory forms attached, preview available]
/** The two pre-15-Oct customer emails that are still sent and have no newer approved design. The superseded
 *  enquiry emails (likely/onsite/ineligible, P1-S77) and the five lifecycle placeholders (measured quote, booking +
 *  consent, pre-install pack, assignment signing, completion pack — replaced by the approved O18, O35, O28, P4 and
 *  O47 designs on 24 Oct 2026) were removed; their stored review versions stay in the database as history. */
export const CUSTOMER_COMMUNICATION_CATALOG = [
  ["estimate_unopened_3d", "Estimate not opened reminder", "Manual-first follow-up after three days.", "1 · Enquiry", "None", false],
  ["area_unavailable", "No partner in service area", "Used only after both REC and installer coverage are conclusively checked.", "1 · Enquiry", "None", false],
] as const;

export const MITTI_FORM_ORDER: { key: FormKey; letter: string; forWho: string; who: string }[] = [
  { key: "ready_check_priced", letter: "A1", forWho: "For a customer THE INSTALLER brought", who: "Installer · free Ready Check on their own customer (price entered by the business owner in the portal)" },
  { key: "ready_check", letter: "A2", forWho: "For a customer WE brought you", who: "Installer · free Ready Check on a Home Insulation Victoria lead (no price)" },
  { key: "piesa", letter: "A3", forWho: "For every job that needs electrical work", who: "Licensed electrician · official DEECA PIESA" },
  { key: "fixes", letter: "A4", forWho: "For repair work done on a later visit", who: "Licensed electrician · electrical fixes day (CoES number, certificate and finished-work photo; decision 293)" },
  { key: "piisa", letter: "A5", forWho: "For every installation", who: "Lead installer · official DEECA PIISA on install day" },
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
  { name: "Customer Acceptance", purpose: "Records the accepted commercial quote and customer terms.", signer: "Owner", timing: "At quote acceptance", blocks: "Invoice and deposit", source: "Approved customer agreement and consumer rights versions" },
  { name: "ESC Owner Consent (Reg 23A)", purpose: "Records consent for required information sharing.", signer: "Owner", timing: "After booking and at least 24 hours before work", blocks: "Ready to install", source: "Approved ESC consent version" },
  { name: "PIESA and Consumer Information Pack", purpose: "Gives the owner the PIESA copy, Consumer Factsheet, Code of Conduct information and CES when electrical fixes occurred.", signer: "Electronic delivery evidence", timing: "Before installation; PIESA copy at least 24 hours before", blocks: "Installation start", source: "Current PIESA and approved customer documents" },
  { name: "Ready Check (Home Insulation Victoria checklist)", purpose: "Free installer eligibility and Ready Check with required photos, videos and floor plan.", signer: "Installer", timing: "Before the PIESA", blocks: "Quote", source: "Mitti form A1 (installer's own customer) / A2 (our lead)" },
  { name: "Pre-installation electrical safety assessment (PIESA)", purpose: "Official DEECA form: licensed electrician checks mains, solar, hazards, cables and luminaires; B1 outcome; Section C after electrical fixes; owner declaration.", signer: "Electrician → owner", timing: "No earlier than 30 days before work; copy to owner and installer at least 24 hours before", blocks: "Installation start", source: "Official DEECA form · Mitti form A3", pdf: piesaPdf.url },
  { name: "Pre-installation installer safety assessment (PIISA)", purpose: "Official DEECA form: lead installer confirms SWMS, isolation, PIESA review, existing insulation and products.", signer: "Lead installer", timing: "Install day, within 30 days of the PIESA; re-check each extra day", blocks: "Installation start", source: "Official DEECA form · Mitti form A5", pdf: piisaPdf.url },
  // "Installer Declaration" (separate post-install form) removed 24 Oct 2026: decision 118a dropped it; the lead installer
  // declares in PIISA Part 8 before work and in Part B of the VEEC assignment form after (decision 119; audit removal 7).
  { name: "Final Activity 48 VEEC Assignment", purpose: "Records verified final installation, price and benefit facts for VEEC creation.", signer: "Lead installer → AP → owner", timing: "After installation, during Final check", blocks: "VEEC lodgement", source: "Approved official assignment version" },
  { name: "Completion Pack", purpose: "Gives the owner the tax invoice, dispute information, instructions, contacts and five-year warranty.", signer: "Electronic delivery evidence", timing: "On completion", blocks: "Final check", source: "Current approved completion documents" },
] as const;

