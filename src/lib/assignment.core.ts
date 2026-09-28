// Pure rules for Customer Acceptance & VEEC Assignment (no I/O). Server modules call these.
// Official declaration / consumer-rights wording is NEVER defined here: it comes from versioned,
// admin-approved compliance_templates rows. Missing wording = configuration blocker.

export type AssignmentStatus =
  | "draft" | "consumer_signed_pending_install" | "final_details_pending" | "installer_signed_pending_install"
  | "variation_required" | "effective_complete" | "cancelled";

export type TemplateKey = "consumer_declaration" | "consumer_rights" | "esc_consent" | "installer_declaration" | "ap_declaration";
export type Template = { template_key: string; version: string; body: string; approved: boolean; is_active: boolean; required: boolean };

export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  draft: "Draft",
  consumer_signed_pending_install: "Customer signed – awaiting installation",
  final_details_pending: "Installed – final details / installer declaration pending",
  installer_signed_pending_install: "Installer signed – awaiting installation record",
  variation_required: "Variation required – customer reconfirmation needed",
  effective_complete: "VEEC assignment effective",
  cancelled: "Cancelled",
};

export const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  consumer_declaration: "Consumer declaration & VEEC assignment wording (Activity 48)",
  consumer_rights: "VEU consumer information & cooling-off / consumer rights",
  esc_consent: "Owner written consent – ESC information sharing (Regulation 23A / Activity 48)",
  installer_declaration: "Installer declaration (Activity 48)",
  ap_declaration: "Accredited Person / assignee declaration (if required by template)",
};

export const ASSIGNMENT_EVENTS = {
  QUOTE_ACCEPTED: "QUOTE_ACCEPTED",
  CONSUMER_ASSIGNMENT_SIGNED: "CONSUMER_ASSIGNMENT_SIGNED",
  DEPOSIT_PAID: "DEPOSIT_PAID",
  INSTALLATION_COMPLETED: "INSTALLATION_COMPLETED",
  INSTALLER_DECLARATION_SIGNED: "INSTALLER_DECLARATION_SIGNED",
  ASSIGNMENT_VARIATION_REQUIRED: "ASSIGNMENT_VARIATION_REQUIRED",
  VEEC_ASSIGNMENT_EFFECTIVE: "VEEC_ASSIGNMENT_EFFECTIVE",
} as const;

/** Installed area differing from quoted area by more than this fraction is a material change. */
export const MATERIAL_AREA_TOLERANCE = 0.05;
/** Money differences above this (AUD) are material. */
export const MATERIAL_MONEY_TOLERANCE = 1;
export const RETENTION_YEARS = 6;

export function activeTemplate(templates: Template[], key: TemplateKey): Template | null {
  return templates.find((t) => t.template_key === key && t.is_active && t.approved) ?? null;
}

/** Configuration blockers for a phase. Consumer phase needs consumer wording; final phase needs installer (+ AP if marked required). */
export function templateBlockers(templates: Template[], phase: "consumer" | "final"): string[] {
  const keys: TemplateKey[] = phase === "consumer" ? ["consumer_declaration", "consumer_rights", "esc_consent"] : ["installer_declaration"];
  const out = keys.filter((k) => !activeTemplate(templates, k)).map((k) => `Configuration required: approved "${TEMPLATE_LABEL[k]}" text not configured.`);
  if (phase === "final") {
    const ap = templates.find((t) => t.template_key === "ap_declaration" && t.is_active);
    if (ap && ap.required && !ap.approved) out.push(`Configuration required: "${TEMPLATE_LABEL.ap_declaration}" not approved.`);
  }
  return out;
}

export type ConsumerSignInput = {
  signatoryName: string; authorityType: "owner" | "authorised_representative"; over18: boolean;
  readConsumerInfo: boolean; acceptDeclaration: boolean; acceptAssignment: boolean; signatureName: string; acceptEscConsent?: boolean | undefined;
};

/** Validates the consumer signing step. Returns blockers (empty = can sign). */
export function consumerSignBlockers(i: ConsumerSignInput, templates: Template[]): string[] {
  const b = templateBlockers(templates, "consumer");
  if (!i.over18) b.push("Signatory must confirm they are 18 or older.");
  if (!i.readConsumerInfo) b.push("Please confirm you have read the VEU consumer information.");
  if (!i.acceptDeclaration) b.push("Please confirm the consumer declarations.");
  if (!i.acceptAssignment) b.push("Please confirm the assignment of VEEC rights.");
  if (!i.acceptEscConsent) b.push("Please give written consent for the ESC information sharing.");
  if (i.signatureName.trim().length < 2) b.push("Type your full name to sign.");
  if (i.signatoryName.trim().length < 2) b.push("Signatory name is required.");
  return b;
}

export type Snapshot = {
  installer_user_id: string | null; installer_business_id: string | null;
  product: string | null; area_m2: number | null;
  price_before_benefit_inc_gst: number; veu_benefit_inc_gst: number; final_customer_price_inc_gst: number;
  scope_codes?: string[];
};

/** Compares the signed snapshot with current facts; returns plain-language material changes (empty = none). */
export function materialChanges(signed: Snapshot, current: Partial<Snapshot>): string[] {
  const out: string[] = [];
  const diff = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && Math.abs(Number(a) - Number(b)) > MATERIAL_MONEY_TOLERANCE;
  if (current.installer_user_id !== undefined && signed.installer_user_id && current.installer_user_id !== signed.installer_user_id) out.push("Installer changed");
  if (current.installer_business_id !== undefined && signed.installer_business_id && current.installer_business_id !== signed.installer_business_id) out.push("Installer business changed");
  if (current.product != null && signed.product && norm(current.product) !== norm(signed.product)) out.push("Installed product changed");
  if (current.area_m2 != null && signed.area_m2 && Math.abs(Number(current.area_m2) - Number(signed.area_m2)) / Number(signed.area_m2) > MATERIAL_AREA_TOLERANCE) out.push("Installed area changed materially");
  if (diff(signed.veu_benefit_inc_gst, current.veu_benefit_inc_gst)) out.push("VEU benefit changed");
  if (diff(signed.final_customer_price_inc_gst, current.final_customer_price_inc_gst)) out.push("Customer price changed");
  if (current.scope_codes && signed.scope_codes && [...current.scope_codes].sort().join() !== [...signed.scope_codes].sort().join()) out.push("Scope changed");
  return out;
}
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type FinalState = {
  status: AssignmentStatus; consumerSigned: boolean; installationCompleted: boolean; installerSigned: boolean;
  installedProduct: string | null; installedArea: number | null; openVariation: boolean; templates: Template[];
};

/** The ONLY rule deciding the staged status. Effective only after eligible install AND installer final details/declaration. */
export function evaluateAssignment(s: FinalState): { status: AssignmentStatus; missing: string[] } {
  if (s.status === "cancelled" || s.status === "effective_complete") return { status: s.status, missing: [] };
  if (!s.consumerSigned) return { status: "draft", missing: ["Customer has not signed"] };
  if (s.openVariation || s.status === "variation_required") return { status: "variation_required", missing: ["Customer must reconfirm the variation"] };
  const missing: string[] = [];
  if (!s.installationCompleted) missing.push("Eligible installation not yet undertaken");
  if (!s.installerSigned) missing.push("Installer declaration not signed");
  if (!s.installedProduct) missing.push("Final installed product not recorded");
  if (!(Number(s.installedArea) > 0)) missing.push("Actual installed m² not recorded");
  missing.push(...templateBlockers(s.templates, "final"));
  if (!missing.length) return { status: "effective_complete", missing };
  if (s.installationCompleted) return { status: "final_details_pending", missing };
  if (s.installerSigned) return { status: "installer_signed_pending_install", missing };
  return { status: "consumer_signed_pending_install", missing };
}

export const ASSIGNMENT_VEEC_BLOCKER = "Customer Acceptance & VEEC Assignment not yet effective.";

export function retainUntil(from: Date): string {
  const d = new Date(from); d.setFullYear(d.getFullYear() + RETENTION_YEARS + 1); // 6 years + margin
  return d.toISOString().slice(0, 10);
}

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Deterministic JSON (sorted keys) so the hash is reproducible. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
