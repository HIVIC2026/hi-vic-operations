// VEU Registry selector map for the ESC Registry robot (decision 272). PURE data + tiny helpers, no browser import.
//
// The Registry's real DOM is NOT known yet (no public API, no documentation of the form markup). Every selector below
// is a best guess marked TODO; `scripts/esc-registry-robot-explore.ts` logs in (when the secrets exist), screenshots the
// install-notification and VEEC-creation forms and dumps every label/name/id so this map can be finished on the first
// supervised run with Jo. Until SELECTORS_VERIFIED for a task is flipped to true (a code change after that run), the robot
// refuses live mode and only dry-runs (esc-registry-robot.core robotMode).
//
// Field keys for the install notification are the Activity Guide v1.2 Appendix A Table 5 keys from esc.core
// DEFAULT_REGISTRY_FIELDS; VEEC creation keys are the Section 2 keys from veec-assignment-form.core VEEC_FORM_FIELDS
// plus `veec_quantity`.
import type { RobotTask } from "./esc-registry-robot.core";
import { DEFAULT_REGISTRY_FIELDS, PIESA_REGISTRY_STATUS, VEU_REGISTRY_URL } from "./esc.core";

export type FieldKind = "text" | "date" | "datetime" | "select" | "radio" | "checkbox";
export type FieldSelector = {
  /** CSS or Playwright selector of the input (for radio: the group container; options are matched by label text). */
  selector: string;
  kind: FieldKind;
  /** For select/radio: portal value → option label/value in the Registry. Missing = same text. */
  options?: Record<string, string>;
  /** For date/datetime: the text format the Registry input expects (filled as text). */
  format?: "DD/MM/YYYY" | "DD/MM/YYYY HH:mm" | "YYYY-MM-DD" | "YYYY-MM-DDTHH:mm";
  /** Open question for the first supervised run. While any field has a TODO the map is unverified. */
  todo?: string;
};

export type FormSection = {
  /** Where the form lives (absolute URL). */
  url: string;
  /** Selector that proves the form is open (waited for before filling). */
  ready: string;
  fields: Record<string, FieldSelector>;
  /** The real Submit button – ONLY pressed in live mode. */
  submit: string;
  /** Where the Registry shows the reference after submit, and how to pull the reference out of that text. */
  confirmation: { selector: string; pattern: RegExp; todo?: string };
};

/** One mark per task. Flip a task to true ONLY after a supervised run confirmed every selector of THAT form on the real
 *  Registry (decision 272: Jo watches). A task that is false stays fill-and-screenshot only, whatever the mode. */
export const SELECTORS_VERIFIED: Record<RobotTask, boolean> = { install_notification: false, veec_creation: false };
export const SELECTOR_MAP_VERSION = "2026-10-25-unverified";

const base = VEU_REGISTRY_URL.replace(/\/$/, "");

export const LOGIN = {
  url: `${base}/`,
  username: 'input[name="username"], input[type="email"], #username',
  password: 'input[type="password"]',
  submit: 'button[type="submit"], input[type="submit"]',
  /** Something only a signed-in page shows (the Activities menu). */
  loggedIn: 'text=/Activities/i',
  /** Visible text when the login was refused – reported as a failure, never retried in the same run. */
  failed: 'text=/invalid|incorrect|try again/i',
  todo: "Confirm login field names, whether there is an MFA step (the robot cannot do MFA – Jo decides), and the post-login landing page.",
};

/** Activities → Submit a new install notification (Activity 48). */
export const INSTALL_NOTIFICATION: FormSection = {
  url: `${base}/activities/install-notifications/new`,
  ready: 'form',
  fields: {
    installation_start: { selector: 'input[name="installationStart"]', kind: "datetime", format: "DD/MM/YYYY HH:mm", todo: "date-time picker or two inputs?" },
    installation_end: { selector: 'input[name="installationEnd"]', kind: "datetime", format: "DD/MM/YYYY HH:mm", todo: "date-time picker or two inputs?" },
    premises_address: { selector: 'input[name="installationAddress"]', kind: "text", todo: "address lookup (type + pick) or free text?" },
    owner_first_name: { selector: 'input[name="ownerFirstName"]', kind: "text", todo: "name" },
    owner_last_name: { selector: 'input[name="ownerLastName"]', kind: "text", todo: "name" },
    owner_phone: { selector: 'input[name="ownerPhone"]', kind: "text", todo: "name" },
    owner_email: { selector: 'input[name="ownerEmail"]', kind: "text", todo: "name" },
    owner_entity_name: { selector: 'input[name="ownerEntityName"]', kind: "text", todo: "name; optional" },
    lead_installer: { selector: 'select[name="schemeParticipant"]', kind: "select", todo: "likely a lookup of VEU-verified scheme participants – matched by legal name?" },
    lead_installer_phone: { selector: 'input[name="installerPhone"]', kind: "text", todo: "name" },
    lead_installer_cii_number: { selector: 'input[name="eecCertificationNumber"]', kind: "text", todo: "name" },
    installer_company: { selector: 'input[name="installerCompanyName"]', kind: "text", todo: "name; optional" },
    installer_abn_acn: { selector: 'input[name="installerAbnAcn"]', kind: "text", todo: "name" },
    piesa_status: {
      selector: '[name="piesaStatus"]', kind: "radio",
      options: { [PIESA_REGISTRY_STATUS.notCompleted]: PIESA_REGISTRY_STATUS.notCompleted, [PIESA_REGISTRY_STATUS.noIssues]: PIESA_REGISTRY_STATUS.noIssues, [PIESA_REGISTRY_STATUS.allRectified]: PIESA_REGISTRY_STATUS.allRectified, [PIESA_REGISTRY_STATUS.electricianAtInstall]: PIESA_REGISTRY_STATUS.electricianAtInstall },
      todo: "radio group or select; the four verbatim answers are in esc.core PIESA_REGISTRY_STATUS",
    },
    coes_number: { selector: 'input[name="coesNumber"]', kind: "text", todo: "shown only after 'all rectified'?" },
    rec_number: { selector: 'input[name="recRegistrationNumber"]', kind: "text", todo: "shown only with a CoES?" },
    owner_consent_to_share: { selector: '[name="ownerConsent"]', kind: "radio", options: { Yes: "Yes", No: "No" }, todo: "radio or checkbox" },
  },
  submit: 'button[type="submit"]:has-text("Submit")',
  confirmation: { selector: 'main', pattern: /(?:notification|reference)\s*(?:ID|number|no\.?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i, todo: "exact wording of the confirmation page and the shape of the notification ID" },
};

/** Activities → my install notifications → open one → Update (same notification ID; esc.core REGISTRY_UPDATABLE_KEYS only). */
export const INSTALL_NOTIFICATION_UPDATE = {
  /** The notification's page; `{id}` is the Registry notification ID. */
  url: (id: string) => `${base}/activities/install-notifications/${encodeURIComponent(id)}`,
  editButton: 'a:has-text("Update"), button:has-text("Update")',
  ready: 'form',
  submit: 'button[type="submit"]:has-text("Save"), button[type="submit"]:has-text("Update")',
  confirmation: INSTALL_NOTIFICATION.confirmation,
  todo: "Confirm how an existing notification is opened and which fields the update form exposes (Table 5 column 3).",
};

/** Activities → Create certificates (VEEC creation for Activity 48). Keys = VEEC_FORM_FIELDS + veec_quantity. */
export const VEEC_CREATION: FormSection = {
  url: `${base}/activities/certificates/new`,
  ready: 'form',
  fields: {
    veec_quantity: { selector: 'input[name="numberOfCertificates"]', kind: "text", todo: "is the quantity entered or calculated by the Registry from area/R-value?" },
    installation_address: { selector: 'input[name="installationAddress"]', kind: "text", todo: "address lookup?" },
    date_completed: { selector: 'input[name="installationDate"]', kind: "date", format: "DD/MM/YYYY", todo: "format" },
    consumer_full_name: { selector: 'input[name="consumerName"]', kind: "text", todo: "name" },
    consumer_phone: { selector: 'input[name="consumerPhone"]', kind: "text", todo: "name" },
    consumer_email: { selector: 'input[name="consumerEmail"]', kind: "text", todo: "name" },
    installer_1_name: { selector: 'input[name="installerName"]', kind: "text", todo: "scheme participant lookup?" },
    installer_1_eec: { selector: 'input[name="installerEec"]', kind: "text", todo: "name" },
    elec_full_name: { selector: 'input[name="electricianName"]', kind: "text", todo: "name" },
    elec_licence: { selector: 'input[name="electricianLicence"]', kind: "text", todo: "name" },
    elec_rec_number: { selector: 'input[name="recNumber"]', kind: "text", todo: "name" },
    ces_number: { selector: 'input[name="cesNumber"]', kind: "text", todo: "name" },
    area_1_product_brand: { selector: 'input[name="productBrand"]', kind: "text", todo: "product picker (approved product list)?" },
    area_1_product_model: { selector: 'input[name="productModel"]', kind: "text", todo: "product picker?" },
    area_1_product_r_value: { selector: 'input[name="rValue"]', kind: "text", todo: "name" },
    area_1_area_m2: { selector: 'input[name="areaM2"]', kind: "text", todo: "name" },
    price_before_incentive: { selector: 'input[name="priceBeforeIncentive"]', kind: "text", todo: "name" },
    consumer_payment_after: { selector: 'input[name="consumerPayment"]', kind: "text", todo: "name" },
    benefit_amount: { selector: 'input[name="benefitAmount"]', kind: "text", todo: "name" },
  },
  submit: 'button[type="submit"]:has-text("Create")',
  confirmation: { selector: 'main', pattern: /(?:certificate|creation|reference|submission)\s*(?:ID|number|no\.?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i, todo: "exact wording and the shape of the creation reference" },
};

/** Every open question in the map. Non-empty = unverified; the robot stays in dry-run (and the explore script prints these). */
export function selectorGaps(): string[] {
  const out: string[] = [];
  if (LOGIN.todo) out.push(`login: ${LOGIN.todo}`);
  for (const [name, sec] of [["install notification", INSTALL_NOTIFICATION], ["VEEC creation", VEEC_CREATION]] as const) {
    for (const [k, f] of Object.entries(sec.fields)) if (f.todo) out.push(`${name} · ${k}: ${f.todo}`);
    if (sec.confirmation.todo) out.push(`${name} · confirmation: ${sec.confirmation.todo}`);
  }
  if (INSTALL_NOTIFICATION_UPDATE.todo) out.push(`install notification update: ${INSTALL_NOTIFICATION_UPDATE.todo}`);
  return out;
}

/** Table 5 keys that have NO selector yet – listed by the explore script so nothing is silently left blank. */
export function unmappedNotificationKeys(): string[] {
  return DEFAULT_REGISTRY_FIELDS.map((f) => f.key).filter((k) => !(k in INSTALL_NOTIFICATION.fields));
}

/** Pulls the Registry reference out of the confirmation text. Null when the pattern does not match – never guessed. */
export function extractReference(text: string | null | undefined, pattern: RegExp): string | null {
  const m = pattern.exec((text ?? "").replace(/\s+/g, " "));
  return m?.[1]?.trim() || null;
}

/** Melbourne wall-clock text in the Registry's input format from an ISO instant. */
export function formatForRegistry(iso: string, format: NonNullable<FieldSelector["format"]>): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((p) => [p.type, p.value])) as Record<string, string>;
  const d = `${parts["day"]}/${parts["month"]}/${parts["year"]}`, t = `${parts["hour"]}:${parts["minute"]}`, i = `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
  return format === "DD/MM/YYYY" ? d : format === "DD/MM/YYYY HH:mm" ? `${d} ${t}` : format === "YYYY-MM-DD" ? i : `${i}T${t}`;
}
