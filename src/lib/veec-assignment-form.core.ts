// Official ESC "VEEC Assignment Form Template: Ceiling Insulation (Activity 48) – Residential Premises", Version 1.1 –
// 1 October 2026 (Jo, decision 119/120, 24 Oct 2026). PURE: no I/O.
//   • The wording of Sections 1, 3 and 4 below is VERBATIM from the official .docx (SHA-256 in VEEC_FORM_SHA256); the only
//     substitution is "<insert name of accredited person>" → AP_NAME_ON_FORM, which the template itself instructs.
//     Do NOT change the words of the declarations (template instruction).
//   • Section 2 is the data table: VEEC_FORM_FIELDS lists every field; veecPrefill fills them from job facts and names what is
//     missing (missing facts block signing — nothing is guessed).
//   • Signing order (after install): lead installer (Section 3 Part B) → AP (Section 3 Part A, only once the four AP
//     prerequisites are recorded) → consumer (Section 4 Part B) via the owner's secure link. Copy to the consumer within
//     10 business days (electronic assignment).
//   • Decision 120: the consumer is asked by email + text at install completion, reminded on days 1, 3 and 7, and the office
//     is alerted on day 10. Wording here is DRAFT until Jo approves; sends stay TEST-only behind the flags below.
import type { FieldValue, FormField } from "./assignment.core";
import { addMelbourneBusinessDays } from "./melbourne-time.core";

export const VEEC_FORM_VERSION = "ESC-Activity48-VEEC-Assignment-v1.1-20261001";
export const VEEC_FORM_TITLE = "VEEC Assignment Form Template: Ceiling Insulation (Activity 48) – Residential Premises";
export const VEEC_FORM_EDITION = "Version 1.1 – 1 October 2026";
export const VEEC_FORM_ORIGINAL_FILE = "docs/official-forms/ESC-VEEC-Assignment-Form-Activity48-Ceiling-Insulation-v1.1-20261001.docx";
export const VEEC_FORM_SHA256 = "465de27d88ce6aa47003f93dea403cd24bcdccecff1250a4bece1e3cf4577a86";
/** Template placeholder "<insert name of accredited person>" is filled with this (Jo, 24 Oct 2026). */
export const AP_NAME_ON_FORM = "Home Insulation Victoria (DC Construction Solutions Pty Ltd, ABN 44 671 613 979, VEU Accredited Person A003654)";
/** Section 2 Part A, from the AP's own records (not job facts). Company address/phone: not found in code — office enters. */
export const AP_DETAILS = { fullName: null as string | null, companyName: "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria", companyAddress: null as string | null, phone: null as string | null };

/** Retired portal path: the separate installer declaration draft (decision 118a). Kept as history, never signed again. */
export const SUPERSEDED_INSTALLER_DECLARATION_VERSIONS: readonly string[] = ["DEECA-PIISA-March-2026-DRAFT"];
export const SUPERSEDED_ASSIGNMENT_VERSIONS: readonly string[] = ["Activity48-VEEC-Assignment-v16-DRAFT"];

const AP = "<insert name of accredited person>";
const fill = (s: string) => s.split(AP).join(AP_NAME_ON_FORM);

/** Section 1 – verbatim (AP name filled). */
export const SECTION_1_CONSUMER_RIGHTS = fill([
  "Section 1: Consumer rights information",
  "As the energy consumer, you own the rights to create certificates for energy saving activities undertaken at your premises under the Victorian Energy Upgrades program. One certificate represents one tonne of carbon dioxide equivalent (CO2-e) to be reduced by the activity.",
  "You are able to assign your right to create certificates to an accredited provider under the Victorian Energy Upgrades program. In assigning your right, the accredited provider will be entitled to create and own the certificates for the assessment undertaken at your premises. In return, the accredited provider should provide you with an identifiable benefit (e.g. price reduction on a product, free installation or a cash-back arrangement).",
  `You are responsible for ensuring you are satisfied with the terms of the assignment of certificates to ${AP}, the accredited provider (as detailed below) prior to proceeding with the activity.`,
  `If you experience any issues with the outcome of this activity, you should contact ${AP} to resolve the matter.  For any outstanding issues, you can contact program staff members at the Essential Services Commission (the commission), the government body responsible for administering the program, by sending an email to veu@esc.vic.gov.au.`,
].join("\n"));

/** Section 3 Part A – verbatim. "<insert name>" (the AP representative's own name) is typed by the signer. */
export const AP_DECLARATION = fill([
  "Section 3: Declarations",
  "Part A: Accredited person declaration",
  `I <insert name> am the authorised representative of ${AP} and declare that:`,
  "all scheme participants (i.e. installers) involved in undertaking this activity meet the relevant training and competency requirements as specified in the VEET Guidelines",
  "a licensed electrician has completed and signed a VEU pre-installation electrical safety assessment form prior to the installation commencing",
  "a copy of the completed VEU pre-installation electrical safety assessment form was provided to the lead installer and owner at least 24 hours prior to the installation commencing",
  "where electrical hazards were identified during the VEU pre-installation electrical safety assessment:”",
  "a licensed electrician rectified hazards before the installation commenced; and/or",
  "a licensed electrician was present at the start of the installation to confirm work area is electrically safe for entry",
  "written consent has been obtained from the owner of the premises to share relevant information with the commission and for the commission to share that information with the Victorian WorkCover Authority and Energy Safe Victoria.",
  "all notification requirements listed in the Ceiling Insulation Activity Guide were sent to the commission at least 24 hours before the installation.",
  "the consumer has been provided with a copy of the warranty against defects (with a minimum period of 5 years) for any product(s) installed.",
  "each installer listed in this form has been provided with the commission's VEU scheme participant collection notice and informed that their details may be disclosed to the commission and shared with the Energy Efficiency Council, for regulatory and compliance purposes.",
  "the information supplied in this form is complete and accurate and I am aware that it is an offence to provide false or misleading information to the commission under the Victorian Energy Efficiency Target Act 2007.",
  "Name:",
  "Signature:",
  "Date:",
].join("\n"));

/** Section 3 Part B – verbatim. */
export const INSTALLER_DECLARATION = [
  "Part B: Declaration by lead installer",
  "I declare that:",
  "I am certified by the Energy Efficiency Council (EEC) as a Certified Insulation Installer and am qualified to install the product(s) listed above.",
  "all work undertaken in respect of installing insulation product(s) at the above premises was undertaken by EEC Certified Insulation Installers.",
  "any luminaires in the ceiling are classified and marked as an IC luminaire or IC-4 luminaire",
  "I have received a completed copy of the VEU pre-installation electrical safety assessment form before the installation commenced.",
  "I have completed a VEU pre-installation installer safety assessment form.",
  "the above listed insulation product(s) have been installed at the above premises.",
  "the installation of above insulation product(s) have been undertaken in accordance with:",
  "all relevant AS 3999 requirements,",
  "all product manufacturer installation requirements",
  "all applicable occupational health and safety laws and requirements, including completed safe work method statement (SWMS)",
  "requirements set out in the VEU pre-installation installer safety assessment form",
  "conditions outlined in the VEU pre-installation electrical safety assessment form",
  "all spaces above a ceiling at the premises which are eligible and practical to insulate have been insulated.",
  "for under insulated areas, existing insulation was removed as required by the program rules.",
  "where existing insulation is not removed, I have advised the property owner that:",
  "the existing insulation will not be removed;",
  "the existing insulation is in a suitable condition for new insulation to be laid over the top of it; and",
  "the installation of new insulation on top of the existing insulation will meet AS3999 requirements and all product manufacturer installation requirements.",
  "all waste or debris generated from the activity, including existing insulation product(s), has been removed from the consumer’s premises and disposed of in accordance with all applicable waste management requirements under the Environment Protection Act 2017 and Regulations made under that Act.",
  "I consent to the installer information provided in this form, along with any other supporting documentation or information relating to the activity undertaken at the above premises, being disclosed to the relevant regulator and to the Energy Efficiency Council for compliance related purposes.",
  "the information supplied in this form is complete and accurate and I am aware that it is an offence to provide false or misleading information to the commission under the Victorian Energy Efficiency Target Act 2007.",
  "Installer signature:                                  Date:",
].join("\n");

/** Section 4 – verbatim (AP name filled). */
export const CONSUMER_DECLARATION = fill([
  "Section 4: Consumer details and declaration",
  "Part A: Consumer details",
  "Consumer details",
  "Full name:",
  "Phone number:",
  "Email address:",
  "Part B: Declaration by consumer or authorised representative",
  "I declare that:",
  "I am the energy consumer, or I am authorised to make this declaration on behalf of the above-named entity that is the consumer",
  "to the best of my knowledge, the information provided by the installer in Section 2 is correct and complete",
  "I have been provided with a copy of the completed VEU pre-installation electrical safety assessment form",
  `I have received an identifiable benefit from ${AP} in exchange for assigning my rights to create the VEECs for the above activity`,
  `I understand that by signing this form I am assigning the right to create certificates for the product to ${AP}`,
  "the commission has the right to inspect the installation with reasonable notice",
  "I understand that information on this form will be disclosed to the commission for the purpose of creating certificates under the Victorian Energy Efficiency Target Act 2007 and for related verification, audit and program monitoring purposes",
  "I consent to the information provided in this form, along with any other supporting documentation or information relating to the activity undertaken at the above premises, being disclosed to the relevant regulator and to the Energy Efficiency Council for compliance related purposes",
  "I understand that commission may use the details provided on this form to issue commission correspondence.",
  "I am aware that it is an offence to provide false or misleading information to the commission or any person exercising powers under or in connection with the Victorian Energy Efficiency Target Act 2007.",
  "Consumer signature:                                       Date:",
].join("\n"));

/** The compliance_templates body for version VEEC_FORM_VERSION: Sections 1, 3 and 4 in official order (Section 2 = form_fields). */
export const VEEC_FORM_BODY = [`${VEEC_FORM_TITLE}\n${VEEC_FORM_EDITION}`, SECTION_1_CONSUMER_RIGHTS, "Section 2: Activity and personnel details\n(completed from the job record – see the form fields)", AP_DECLARATION, INSTALLER_DECLARATION, CONSUMER_DECLARATION].join("\n\n");

// ---------- Section 2 fields ----------
export const MAX_INSTALLERS = 4;
export const MAX_AREAS = 3;
export const BENEFIT_FORMS = ["Upfront cash", "Price reduction", "Delayed cash", "Other (please describe)"] as const;
export const DEFAULT_BENEFIT_FORM: (typeof BENEFIT_FORMS)[number] = "Price reduction";
export const PRODUCT_TYPES = ["48A: Bulk insulation batt or blanket product", "48B: Rigid cellular foam insulation product"] as const;
export const CEILING_SPACE_TYPES = ["Uninsulated", "Under insulated"] as const;

const f = (key: string, label: string, type: FormField["type"] = "text", required = true, extra: Partial<FormField> = {}): FormField => ({ key, label, type, required, ...extra });
const yesNo = (key: string, label: string, required = true) => f(key, label, "select", required, { options: ["Yes", "No"] });
/** Official instruction above the three criteria: ticking a box confirms the existing insulation does NOT meet that criterion. */
export const NOT_REMOVED_HELP = "Where existing insulation was not removed, confirm that existing insulation does not meet any of the criteria below (check boxes as relevant)";

function installerFields(n: number): FormField[] {
  const req = n === 1, p = `installer_${n}_`;
  const sfx = req ? "" : ` (installer ${n})`;
  return [f(`${p}name`, `Installer full name${sfx}`, "text", req), f(`${p}company`, `Installer company name${sfx}`, "text", req), f(`${p}phone`, `Installer phone number${sfx}`, "text", req), f(`${p}eec`, `Installer EEC Certification number${sfx}`, "text", req)];
}
function areaFields(n: number): FormField[] {
  const req = n === 1, p = `area_${n}_`;
  const sfx = req ? "" : ` (area ${n})`;
  return [
    f(`${p}name`, `Name of upgrade area ${n} (e.g. Area ${n})`, "text", req),
    f(`${p}existing_type`, `Existing ceiling space type${sfx}`, "select", req, { options: [...CEILING_SPACE_TYPES] }),
    f(`${p}existing_r_value`, `If under insulated: estimated R-value of existing insulation${sfx}`, "text", false),
    yesNo(`${p}removed`, `Was the existing insulation removed${sfx}`, req),
    f(`${p}not_metallic`, `Existing insulation product is made from metallic materials or has a metallic surface that conducts electricity${sfx}`, "checkbox", false, { help: NOT_REMOVED_HELP }),
    f(`${p}suitable_condition`, `Existing insulation product is not in suitable condition for new product(s) to be installed over${sfx}`, "checkbox", false, { help: NOT_REMOVED_HELP }),
    f(`${p}meets_as3999`, `Installing new product(s) on top of the existing insulation will not meet AS 3999 requirements or product manufacturer’s installation requirements.${sfx}`, "checkbox", false, { help: NOT_REMOVED_HELP }),
    f(`${p}product_type`, `Product type${sfx}`, "select", req, { options: [...PRODUCT_TYPES] }),
    f(`${p}product_brand`, `Product brand${sfx}`, "text", req),
    f(`${p}product_model`, `Product model${sfx}`, "text", req),
    f(`${p}product_r_value`, `R-value of installed product${sfx}`, "text", req),
    f(`${p}area_m2`, `Area insulated (m2)${sfx}`, "number", req),
  ];
}

/** Every Section 2 field, in the official order. Keys match parseFormFields (lower-case, ≤41 chars). */
export const VEEC_FORM_FIELDS: FormField[] = [
  // Part A: Accredited person details
  f("ap_full_name", "Accredited person – full name"), f("ap_company_name", "Accredited person – company name"), f("ap_company_address", "Accredited person – company address"), f("ap_phone", "Accredited person – phone number"),
  // Part B: Pre-installation electrical safety assessment details
  f("elec_full_name", "Licensed electrician – full name"), f("elec_phone", "Licensed electrician – phone number"), f("elec_licence", "Licensed electrician – licence number"), f("elec_company_name", "Licensed electrician – company name"), f("elec_company_address", "Licensed electrician – company address"), f("elec_rec_number", "Licensed electrician – REC Registration number"),
  yesNo("ces_issued", "Was a Certificate of Electrical Safety issued for electrical rectification work undertaken prior to installation works commencing?"),
  f("ces_number", "Certificate of Electrical Safety number", "text", false, { help: "Required when a Certificate of Electrical Safety was issued." }),
  // Part C: Installation details
  ...Array.from({ length: MAX_INSTALLERS }, (_, i) => installerFields(i + 1)).flat(),
  f("installation_address", "Installation address"), f("date_completed", "Date installation was completed", "date"),
  ...Array.from({ length: MAX_AREAS }, (_, i) => areaFields(i + 1)).flat(),
  // Co-payment details (includes product and labour/installation costs)
  f("price_before_incentive", "Price of installed product(s) including GST (before VEEC incentive): $", "number"),
  f("consumer_payment_after", "Consumer payment for installed product(s) including GST (after VEEC incentive): $", "number"),
  f("benefit_form", "Form of benefit provided", "select", true, { options: [...BENEFIT_FORMS] }),
  f("benefit_other_description", "Other (please describe)", "text", false),
  f("benefit_amount", "Amount of benefit provided for assignment of certificates: $", "number"),
  // Section 4 Part A: Consumer details
  f("consumer_full_name", "Consumer – full name"), f("consumer_phone", "Consumer – phone number"), f("consumer_email", "Consumer – email address"),
];

// ---------- Prefill from job facts ----------
export type VeecInstaller = { name: string | null; company: string | null; phone: string | null; eec: string | null };
export type VeecArea = { name: string; existing: "uninsulated" | "under_insulated" | null; existingRValue: string | null; removed: boolean | null; productType: "48A" | "48B" | null; brand: string | null; model: string | null; rValue: string | null; areaM2: number | null };
export type VeecFacts = {
  ap: { fullName: string | null; companyName: string | null; companyAddress: string | null; phone: string | null };
  electrician: { name: string | null; phone: string | null; licence: string | null; company: string | null; companyAddress: string | null; recNumber: string | null };
  ces: { issued: boolean | null; number: string | null };
  installers: VeecInstaller[];
  installationAddress: string | null;
  dateCompleted: string | null;
  areas: VeecArea[];
  priceBeforeIncentive: number | null;
  consumerPaymentAfter: number | null;
  benefitAmount: number | null;
  consumer: { name: string | null; phone: string | null; email: string | null };
};

const put = (o: Record<string, FieldValue>, k: string, v: FieldValue | undefined) => { if (v !== undefined && v !== null && v !== "") o[k] = v; };

/** Fills every Section 2 field it can from facts. Blanks stay blank (never guessed); `missing` names the required ones left empty. */
export function veecPrefill(x: VeecFacts, overrides: Record<string, FieldValue> = {}): { values: Record<string, FieldValue>; missing: string[] } {
  const v: Record<string, FieldValue> = {};
  put(v, "ap_full_name", x.ap.fullName); put(v, "ap_company_name", x.ap.companyName); put(v, "ap_company_address", x.ap.companyAddress); put(v, "ap_phone", x.ap.phone);
  put(v, "elec_full_name", x.electrician.name); put(v, "elec_phone", x.electrician.phone); put(v, "elec_licence", x.electrician.licence); put(v, "elec_company_name", x.electrician.company); put(v, "elec_company_address", x.electrician.companyAddress); put(v, "elec_rec_number", x.electrician.recNumber);
  if (x.ces.issued != null) v["ces_issued"] = x.ces.issued ? "Yes" : "No";
  put(v, "ces_number", x.ces.number);
  x.installers.slice(0, MAX_INSTALLERS).forEach((i, n) => { const p = `installer_${n + 1}_`; put(v, `${p}name`, i.name); put(v, `${p}company`, i.company); put(v, `${p}phone`, i.phone); put(v, `${p}eec`, i.eec); });
  put(v, "installation_address", x.installationAddress); put(v, "date_completed", x.dateCompleted);
  x.areas.slice(0, MAX_AREAS).forEach((a, n) => {
    const p = `area_${n + 1}_`;
    put(v, `${p}name`, a.name);
    if (a.existing) v[`${p}existing_type`] = a.existing === "uninsulated" ? CEILING_SPACE_TYPES[0] : CEILING_SPACE_TYPES[1];
    put(v, `${p}existing_r_value`, a.existingRValue);
    if (a.removed != null) v[`${p}removed`] = a.removed ? "Yes" : "No";
    if (a.productType) v[`${p}product_type`] = a.productType === "48A" ? PRODUCT_TYPES[0] : PRODUCT_TYPES[1];
    put(v, `${p}product_brand`, a.brand); put(v, `${p}product_model`, a.model); put(v, `${p}product_r_value`, a.rValue); put(v, `${p}area_m2`, a.areaM2);
  });
  put(v, "price_before_incentive", x.priceBeforeIncentive); put(v, "consumer_payment_after", x.consumerPaymentAfter);
  v["benefit_form"] = DEFAULT_BENEFIT_FORM; put(v, "benefit_amount", x.benefitAmount);
  put(v, "consumer_full_name", x.consumer.name); put(v, "consumer_phone", x.consumer.phone); put(v, "consumer_email", x.consumer.email);
  const values = { ...v, ...Object.fromEntries(Object.entries(overrides).filter(([, val]) => val !== undefined && val !== null && val !== "")) };
  const missing = VEEC_FORM_FIELDS.filter((d) => d.required && (values[d.key] == null || String(values[d.key]).trim() === "")).map((d) => d.label);
  if (values["ces_issued"] === "Yes" && !String(values["ces_number"] ?? "").trim()) missing.push("Certificate of Electrical Safety number");
  if (values["benefit_form"] === "Other (please describe)" && !String(values["benefit_other_description"] ?? "").trim()) missing.push("Other (please describe)");
  return { values, missing };
}

/** The co-payment figures come from the accepted quote: price before = subtotal, after = customer total, benefit = VEU discount. */
export function coPaymentFromQuote(q: { subtotalIncGst: number | null; customerTotalIncGst: number | null; veecDiscountIncGst: number | null }) {
  return { priceBeforeIncentive: q.subtotalIncGst, consumerPaymentAfter: q.customerTotalIncGst, benefitAmount: q.veecDiscountIncGst };
}

// ---------- AP (Section 3 Part A) prerequisites ----------
export const LEAD_24H_MS = 24 * 3600_000;
export const AP_PREREQ_EVENTS = {
  /** Office-recorded: the consumer was given the product warranty against defects (≥5 years). */
  WARRANTY_COPY_PROVIDED: "warranty_copy_provided",
  /** Office-recorded per installer business/worker: the ESC VEU scheme participant collection notice was given. */
  ESC_COLLECTION_NOTICE_PROVIDED: "esc_collection_notice_provided",
} as const;

export type ApPrerequisiteFacts = {
  installStart: string | null;
  piesaCopyToInstallerAt: string | null;
  piesaCopyToOwnerAt: string | null;
  escNotificationSentAt: string | null;
  warrantyCopyProvidedAt: string | null;
  /** Installer names on the form → when their collection notice was recorded (null = not recorded). */
  collectionNotices: { installer: string; providedAt: string | null }[];
};

const t = (s: string | null) => (s ? new Date(s).getTime() : NaN);
const before24h = (at: string | null, start: string | null) => !!at && !!start && t(at) <= t(start) - LEAD_24H_MS;

/** Everything the AP declaration asserts must be recorded first. Empty = the AP may sign. */
export function apPrerequisiteBlockers(x: ApPrerequisiteFacts): string[] {
  const b: string[] = [];
  if (!x.installStart) b.push("No installation start is recorded, so the 24-hour checks can't be made.");
  if (!before24h(x.piesaCopyToInstallerAt, x.installStart)) b.push("PIESA copy to the lead installer is not recorded at least 24 hours before the installation started.");
  if (!before24h(x.piesaCopyToOwnerAt, x.installStart)) b.push("PIESA copy to the owner is not recorded at least 24 hours before the installation started.");
  if (!before24h(x.escNotificationSentAt, x.installStart)) b.push("ESC installation notification is not recorded as sent at least 24 hours before the installation started.");
  if (!x.warrantyCopyProvidedAt) b.push("Product warranty copy (minimum 5 years) given to the consumer is not recorded.");
  if (!x.collectionNotices.length) b.push("No installer is listed on the form yet.");
  for (const n of x.collectionNotices) if (!n.providedAt) b.push(`ESC scheme participant collection notice to ${n.installer} is not recorded.`);
  return b;
}

// ---------- Consumer signing request + reminders (decision 120) ----------
/** Flags: real sends to owners stay off until Jo approves the wording. TEST jobs use test-send only. */
export const VEEC_COPY_EMAIL_APPROVED = false;
export const VEEC_SIGN_EMAIL_APPROVED = false;
export const VEEC_SIGN_SMS_APPROVED = false;

export type VeecReminderStep = "request" | "reminder_1" | "reminder_3" | "reminder_7" | "office_alert_10";
export const VEEC_REMINDER_SCHEDULE: { step: VeecReminderStep; afterDays: number }[] = [
  { step: "request", afterDays: 0 }, { step: "reminder_1", afterDays: 1 }, { step: "reminder_3", afterDays: 3 }, { step: "reminder_7", afterDays: 7 }, { step: "office_alert_10", afterDays: 10 },
];
export const VEEC_REMINDER_EVENT = "veec_sign_reminder";
export const VEEC_OFFICE_ALERT_EVENT = "veec_assignment_unsigned_10_days";

/** Next unsent step whose day has arrived (one per sweep, in order; nothing once the consumer has signed). */
export function nextVeecReminderStep(x: { installCompletedAt: string | null; consumerSignedAt: string | null; done: VeecReminderStep[]; now: string }): VeecReminderStep | null {
  if (!x.installCompletedAt || x.consumerSignedAt) return null;
  const base = t(x.installCompletedAt), now = t(x.now);
  for (const s of VEEC_REMINDER_SCHEDULE) {
    if (x.done.includes(s.step)) continue;
    return now >= base + s.afterDays * 86400_000 ? s.step : null;
  }
  return null;
}

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

/** DRAFT texts (Jo to approve). Under 2 SMS segments; secure link; STOP line. The brand prefix is added by brandSmsBody. */
export function veecSignRequestText(rebate: number, link: string): string {
  return `Your install is done! One last thing: please sign your rebate form so we can claim your ${money(rebate)} rebate: ${link} Reply STOP to opt out.`;
}
export function veecSignReminderText(rebate: number, link: string): string {
  return `Your rebate form still needs your signature so we can claim your ${money(rebate)} rebate. It takes a minute: ${link} Reply STOP to opt out.`;
}
export const SMS_SEGMENT_LIMIT = 2 * 153;

/** DRAFT email (Jo to approve). */
export function veecSignEmail(x: { firstName: string | null; rebate: number; link: string; step: VeecReminderStep; test: boolean }): { subject: string; html: string; text: string } {
  const hi = x.firstName ? `Hi ${x.firstName},` : "Hi,";
  const first = x.step === "request";
  const subject = `${x.test ? "[TEST] " : ""}${first ? "All done! One last thing: sign your rebate form" : "Your rebate form still needs your signature"}`;
  const lines = first
    ? [hi, "Your ceiling insulation is in. Thank you for choosing Home Insulation Victoria.", `One last thing: please sign your VEEC assignment (rebate) form so we can claim your ${money(x.rebate)} Victorian Energy Upgrades rebate. It takes about a minute.`, `Sign here: ${x.link}`, "The form shows your installer, what was installed and the price. If anything looks wrong, reply to this email before signing.", "You'll get a copy of the signed form within 10 business days."]
    : [hi, `Your VEEC assignment (rebate) form still needs your signature so we can claim your ${money(x.rebate)} rebate.`, `Sign here: ${x.link}`, "It takes about a minute. If anything on the form looks wrong, reply to this email before signing."];
  const text = [...lines, "", "Home Insulation Victoria"].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1b2a41">${lines.map((l) => `<p>${l.replace(x.link, `<a href="${x.link}">${x.link}</a>`)}</p>`).join("")}<p>Home Insulation Victoria</p></div>`;
  return { subject, html, text };
}

/** DRAFT copy-to-consumer email (template instruction: copy within 10 business days of electronic signing). */
export function veecCopyEmail(x: { firstName: string | null; jobNumber: string; signedAt: string; link: string; test: boolean }): { subject: string; html: string; text: string } {
  const hi = x.firstName ? `Hi ${x.firstName},` : "Hi,";
  const lines = [hi, `Here is your copy of the signed VEEC assignment form for job ${x.jobNumber}. Keep it with your home records.`, `Open it from your My job page: ${x.link}`, "Signed on " + new Date(x.signedAt).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" }) + ".", "Questions? Reply to this email or contact veu@esc.vic.gov.au for anything we can't resolve."];
  return { subject: `${x.test ? "[TEST] " : ""}Your signed rebate form (copy)`, text: [...lines, "", "Home Insulation Victoria"].join("\n"), html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1b2a41">${lines.map((l) => `<p>${l.replace(x.link, `<a href="${x.link}">${x.link}</a>`)}</p>`).join("")}<p>Home Insulation Victoria</p></div>` };
}

/** Electronic assignment: the executed copy is due to the consumer within 10 business days of the consumer's signature. */
export const veecCopyDueAt = (consumerSignedAt: string) => addMelbourneBusinessDays(consumerSignedAt, 10);

/** Printable (read-only) Section 2 rows for the owner/office view, from the stored field values. */
export function veecFormRows(values: Record<string, FieldValue>): { label: string; value: string }[] {
  return VEEC_FORM_FIELDS.filter((d) => values[d.key] != null && String(values[d.key]).trim() !== "").map((d) => ({ label: d.label, value: d.type === "checkbox" ? (values[d.key] === true ? "Confirmed" : "—") : String(values[d.key]) }));
}
