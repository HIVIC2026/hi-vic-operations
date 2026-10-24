import { melbourneToday } from "./melbourne-time.core";
// Pure rules (no I/O) for the Activity 48 signing sequence. Separate events:
//   1. Quote stage: Customer Agreement / Quote Acceptance (commercial) – unlocks invoice/deposit. The owner's Gate B
//      `veec_assignment_consent` is their consent-to-assign at acceptance; it is NOT the official form.
//   2. Owner ESC consent (after an exact installation date exists) – see consent.core.ts.
//   3. Installer safety declaration = the Mitti PIISA before work (decision 118a). The separate portal "installer
//      declaration" draft (DEECA-PIISA-March-2026-DRAFT) is superseded: its path is kept for history only.
//   4. Official ESC VEEC assignment form v1.1 (decisions 119/120, 24 Oct 2026), completed from job facts AFTER the
//      installation is recorded complete and signed lead installer (Section 3 Part B) → AP (Section 3 Part A, only once the
//      four AP prerequisites are recorded – veec-assignment-form.core.ts) → consumer (Section 4 Part B) via the owner's
//      secure link. Copy to the consumer within 10 business days. No signature is applied from the acceptance consent.
// Official wording is NEVER defined here: it comes from versioned, admin-approved compliance_templates rows.

import type { Json } from "@/integrations/supabase/types";

export type AssignmentStatus =
  | "draft" | "consumer_signed_pending_install" | "final_details_pending" | "installer_signed_pending_install"
  | "awaiting_installer_signature" | "awaiting_ap_signature" | "awaiting_consumer_signature"
  | "variation_required" | "effective_complete" | "cancelled";

export type TemplateKey = "customer_agreement" | "consumer_rights" | "esc_consent" | "installer_declaration" | "consumer_declaration" | "ap_declaration" | "partner_agreement";
export type Template = { template_key: string; version: string; body: string; approved: boolean; is_active: boolean; required: boolean; form_fields?: Json; requires_final_consumer_signature?: boolean };

/** Structured field an electronic form renders. Defined per template version by admin; never free-typed wording. */
export type FormField = { key: string; label: string; type: "text" | "number" | "date" | "select" | "checkbox"; required: boolean; options?: string[]; help?: string };

/** Plain-English "not ready" messages shown to admin (customers and trades never see a broken form). */
export const NOT_READY: Record<TemplateKey, string> = {
  customer_agreement: "Customer agreement is not ready: approve the current Home Insulation Victoria commercial agreement wording.",
  consumer_rights: "Customer agreement is not ready: add the current VEU consumer information and consumer rights.",
  esc_consent: "ESC owner consent is not ready: add the current ESC information-sharing consent form.",
  installer_declaration: "Installer declaration is not ready: add the current Activity 48 installer declaration.",
  consumer_declaration: "VEEC assignment is not ready: approve the official ESC VEEC assignment form v1.1 (1 Oct 2026) in Compliance Setup.",
  ap_declaration: "AP sign-off is not ready: approve the current Accredited Person declaration.",
  partner_agreement: "Partner onboarding is not ready: approve the current Home Insulation Victoria partner participation agreement.",
};

export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  draft: "Draft",
  consumer_signed_pending_install: "Legacy conditional assignment – retained as history",
  final_details_pending: "Final details pending",
  installer_signed_pending_install: "Legacy – installer signed",
  awaiting_installer_signature: "Awaiting lead installer signature",
  awaiting_ap_signature: "Awaiting AP representative signature",
  awaiting_consumer_signature: "Awaiting customer signature",
  variation_required: "Variation required – customer reconfirmation needed",
  effective_complete: "VEEC assignment effective",
  cancelled: "Cancelled / superseded",
};

export const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  customer_agreement: "Customer agreement – AP commercial terms (quote acceptance, pre-install)",
  consumer_rights: "VEU consumer information & consumer rights (quote acceptance, pre-install)",
  esc_consent: "ESC owner consent – information sharing (after booking, ≥24h before work)",
  installer_declaration: "Installer declaration (superseded – the installer signs the PIISA before work and Part B of the assignment form after)",
  consumer_declaration: "Activity 48 VEEC assignment – official ESC form v1.1 (post-install: installer → AP → consumer)",
  ap_declaration: "Accredited Person declaration (if required)",
  partner_agreement: "Home Insulation Victoria partner participation agreement (installer / electrician onboarding)",
};

export const ASSIGNMENT_EVENTS = {
  QUOTE_ACCEPTED: "QUOTE_ACCEPTED",
  CUSTOMER_AGREEMENT_SIGNED: "CUSTOMER_AGREEMENT_SIGNED",
  CONDITIONAL_ASSIGNMENT_SIGNED: "CONDITIONAL_ASSIGNMENT_SIGNED",
  DEPOSIT_PAID: "DEPOSIT_PAID",
  INSTALLATION_COMPLETED: "INSTALLATION_COMPLETED",
  INSTALLER_DECLARATION_SIGNED: "INSTALLER_DECLARATION_SIGNED",
  FINAL_ASSIGNMENT_PREPARED: "FINAL_ASSIGNMENT_PREPARED",
  FINAL_ASSIGNMENT_SIGNED: "FINAL_ASSIGNMENT_SIGNED",
  ASSIGNMENT_VARIATION_REQUIRED: "ASSIGNMENT_VARIATION_REQUIRED",
  VEEC_ASSIGNMENT_EFFECTIVE: "VEEC_ASSIGNMENT_EFFECTIVE",
} as const;

export const MATERIAL_AREA_TOLERANCE = 0.05;
export const MATERIAL_MONEY_TOLERANCE = 1;
export const RETENTION_YEARS = 6;

export function activeTemplate(templates: Template[], key: TemplateKey): Template | null {
  return templates.find((t) => t.template_key === key && t.is_active && t.approved) ?? null;
}

export type Phase = "agreement" | "consent" | "installer" | "final";
/** Configuration blockers per event. Each event only needs its OWN wording. */
export function templateBlockers(templates: Template[], phase: Phase): string[] {
  const keys: TemplateKey[] = phase === "agreement" ? ["consumer_rights"] : phase === "consent" ? ["esc_consent"] : phase === "installer" ? ["installer_declaration"] : ["consumer_declaration"];
  const out = keys.filter((k) => !activeTemplate(templates, k)).map((k) => NOT_READY[k]);
  if (phase === "final") {
    const ap = templates.find((t) => t.template_key === "ap_declaration" && t.is_active);
    if (ap && ap.required && !ap.approved) out.push(NOT_READY.ap_declaration);
  }
  return out;
}

// ---------- 1. Customer Agreement / Quote Acceptance ----------
export type AgreementSignInput = {
  signatoryName: string; authorityType: "owner" | "authorised_representative"; over18: boolean;
  readConsumerInfo: boolean; acceptAgreement: boolean; signatureName: string;
};

export function agreementSignBlockers(i: AgreementSignInput, templates: Template[]): string[] {
  const b = templateBlockers(templates, "agreement");
  if (!i.over18) b.push("Signatory must confirm they are 18 or older.");
  if (!i.readConsumerInfo) b.push("Please confirm you have read the VEU consumer information.");
  if (!i.acceptAgreement) b.push("Please confirm you accept the quote and agreement.");
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

/** Compares a signed baseline with current facts; returns plain-language material changes (empty = none). */
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

// ---------- 4. Final Activity 48 VEEC assignment ----------
export function apDeclarationRequired(templates: Template[]) {
  const ap = activeTemplate(templates, "ap_declaration");
  return !!ap && ap.required;
}

/** Decision 118a: the separate portal installer declaration is superseded by the PIISA (before work) + Part B (after). */
export const INSTALLER_DECLARATION_SUPERSEDED = "Superseded: the installer signs the Mitti PIISA before work and Section 3 Part B of the official VEEC assignment form after the install. Nothing is signed here.";

/** The official form is prepared from job facts as soon as the installation is recorded complete (decision 119):
 *  the lead installer signs Part B from their job screen, so no AP-review stage or evidence pack is required first. */
export function finalAssignmentAvailability(i: { installationCompleted: boolean; agreementSigned: boolean; templates: Template[] }): string[] {
  const b: string[] = [];
  if (!i.agreementSigned) b.push("Customer agreement / quote acceptance not signed");
  if (!i.installationCompleted) b.push("Installation not yet recorded as complete");
  b.push(...templateBlockers(i.templates, "final"));
  return b;
}

export type FinalFacts = {
  job_number: string; ap_legal_entity: string; property_address: string;
  completed_date: string; installed: { product: string; r_value: string | null; area_m2: number }[]; zones: unknown[]; total_installed_area_m2: number;
  installer: { user_id: string | null; name: string | null; business: string | null; abn: string | null; licence: string | null };
  consumer: { name: string; email: string | null; phone: string | null };
  final_customer_price_inc_gst: number; veu_benefit_inc_gst: number; price_before_benefit_inc_gst: number; co_payment_inc_gst: number;
  payment: { status: string | null; reference: string | null; amount_paid: number | null };
  template_version: string; form_values: Record<string, FieldValue>;
};

/** Deterministic snapshot of the final facts (no commercial T&Cs – only facts the official form records). */
export function buildFinalFacts(i: Omit<FinalFacts, "co_payment_inc_gst" | "total_installed_area_m2">): FinalFacts {
  const total = i.installed.reduce((s, x) => s + Number(x.area_m2 || 0), 0);
  return { ...i, total_installed_area_m2: Math.round(total * 100) / 100, co_payment_inc_gst: Math.round(Number(i.final_customer_price_inc_gst) * 100) / 100 };
}

export type Party = "installer" | "ap" | "consumer";
export const SIGNING_ORDER: Party[] = ["installer", "ap", "consumer"];

export type FinalState = {
  status: AssignmentStatus; prepared: boolean; installerSigned: boolean; apSigned: boolean; consumerSigned: boolean;
  installedProduct: string | null; installedArea: number | null; openVariation: boolean; templates: Template[];
  /** Historical compatibility only; every new post-install assignment requires the consumer signature. */
  consumerFinalRequired?: boolean; consumerFinalSigned?: boolean;
};

/** Historical conditional records may need a second signature; new assignments are signed only after final facts exist. */
export function finalConsumerSignatureRequired(templates: Template[]): boolean {
  return !!activeTemplate(templates, "consumer_declaration")?.requires_final_consumer_signature;
}

/** Enforces lead installer -> AP representative -> consumer. */
export function signingOrderBlocker(s: Pick<FinalState, "status" | "installerSigned" | "apSigned" | "consumerSigned" | "openVariation" | "consumerFinalRequired" | "consumerFinalSigned">, party: Party): string | null {
  if (s.status === "effective_complete" || s.status === "cancelled") return "This assignment is closed.";
  if (s.openVariation || s.status === "variation_required") return "A variation must be reconfirmed by the customer first.";
  if (s.status === "consumer_signed_pending_install" || s.status === "draft") return "Final assignment details are completed after installation.";
  const consumerDone = s.consumerSigned && (!s.consumerFinalRequired || !!s.consumerFinalSigned);
  const done = { installer: s.installerSigned, ap: s.apSigned, consumer: consumerDone };
  if (done[party]) return "Already signed.";
  const idx = SIGNING_ORDER.indexOf(party);
  const waiting = SIGNING_ORDER.slice(0, idx).find((p) => !done[p]);
  return waiting ? `Waiting for the ${waiting === "ap" ? "AP representative" : waiting === "installer" ? "lead installer" : "customer"} to sign first.` : null;
}

/** The ONLY rule deciding the final assignment status. Effective only when all signatures + final facts + wording are complete. */
export function evaluateAssignment(s: FinalState): { status: AssignmentStatus; missing: string[] } {
  if (s.status === "cancelled" || s.status === "effective_complete") return { status: s.status, missing: [] };
  if (!s.prepared) return { status: "draft", missing: ["Final assignment not prepared"] };
  if (s.openVariation || s.status === "variation_required") return { status: "variation_required", missing: ["Customer must reconfirm the variation"] };
  const facts: string[] = [];
  if (!s.installedProduct) facts.push("Final installed product not recorded");
  if (!(Number(s.installedArea) > 0)) facts.push("Actual installed m² not recorded");
  facts.push(...templateBlockers(s.templates, "final"));
  if (facts.length) return { status: "final_details_pending", missing: facts };
  if (!s.installerSigned) return { status: "awaiting_installer_signature", missing: ["Lead installer has not signed"] };
  if (!s.apSigned) return { status: "awaiting_ap_signature", missing: ["AP representative has not signed"] };
  if (!s.consumerSigned) return { status: "awaiting_consumer_signature", missing: ["Customer has not signed"] };
  if (s.consumerFinalRequired && !s.consumerFinalSigned) return { status: "awaiting_consumer_signature", missing: ["Customer must confirm the final assignment details (required by the official form)"] };
  return { status: "effective_complete", missing: [] };
}

/** Decision 120: no job reaches Ready for VEEC without the consumer-signed official form. */
export const ASSIGNMENT_VEEC_BLOCKER = "The owner has not signed the VEEC assignment form yet (Section 4 Part B via their secure link) – the job cannot go to Ready for VEEC until the signed form is in.";

export function retainUntil(from: Date): string {
  const d = new Date(from); d.setFullYear(d.getFullYear() + RETENTION_YEARS + 1);
  return melbourneToday(d);
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

// ---------- Electronic forms: structured fields + prefill (no duplicate data entry) ----------
const FIELD_TYPES = new Set(["text", "number", "date", "select", "checkbox"]);
export function parseFormFields(v: unknown): FormField[] {
  if (!Array.isArray(v)) return [];
  const out: FormField[] = [], seen = new Set<string>();
  for (const f of v) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const key = typeof o["key"] === "string" ? o["key"].trim() : "";
    const label = typeof o["label"] === "string" ? o["label"].trim() : "";
    const type = String(o["type"] ?? "text");
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(key) || !label || !FIELD_TYPES.has(type) || seen.has(key)) continue;
    seen.add(key);
    const options = Array.isArray(o["options"]) ? (o["options"] as unknown[]).map(String).filter(Boolean).slice(0, 50) : undefined;
    out.push({ key, label: label.slice(0, 200), type: type as FormField["type"], required: o["required"] !== false, ...(options?.length ? { options } : {}), ...(typeof o["help"] === "string" ? { help: (o["help"] as string).slice(0, 300) } : {}) });
  }
  return out;
}

export type FieldValue = string | number | boolean | null;
export function formFieldBlockers(defs: FormField[], values: Record<string, FieldValue>): string[] {
  const b: string[] = [];
  for (const f of defs) {
    const v = values[f.key];
    const empty = v == null || (typeof v === "string" && !v.trim()) || (f.type === "checkbox" && v !== true);
    if (f.required && empty) { b.push(`Please complete "${f.label}".`); continue; }
    if (empty) continue;
    if (f.type === "number" && !Number.isFinite(Number(v))) b.push(`"${f.label}" must be a number.`);
    if (f.type === "select" && f.options && !f.options.includes(String(v))) b.push(`Choose a valid option for "${f.label}".`);
    if (f.type === "date" && Number.isNaN(Date.parse(String(v)))) b.push(`"${f.label}" must be a date.`);
  }
  return b;
}
export function pickFieldValues(defs: FormField[], values: Record<string, FieldValue>): Record<string, FieldValue> {
  return Object.fromEntries(defs.filter((f) => f.key in values).map((f) => [f.key, values[f.key] ?? null]));
}

export function resolveInstalledDetails(i: { asQuotedProduct: boolean; product?: string | null; area: number }, quoted: { product: string | null }): { product: string; area: number } | { error: string } {
  const product = i.asQuotedProduct ? quoted.product : i.product?.trim() || null;
  if (!product || product.length < 2) return { error: i.asQuotedProduct ? "Quoted product is missing – enter the installed product." : "Enter the installed product." };
  if (!(i.area > 0)) return { error: "Enter the actual installed area (m²)." };
  return { product, area: i.area };
}

export type PrefillRow = { label: string; value: string };
export function prefillRows(rows: [string, string | number | null | undefined][]): PrefillRow[] {
  return rows.map(([label, v]) => ({ label, value: v == null || v === "" ? "—" : String(v) }));
}

export type SetupKey = "agreement" | "esc_consent" | "installer" | "final_assignment" | "ap" | "esc_config";
export type SetupItem = { key: SetupKey; label: string; ready: boolean; message: string };
/** Readiness cards for the admin Compliance Setup page – one per separate event. */
export function setupStatus(templates: Template[], escConfigReady: boolean): SetupItem[] {
  const card = (key: SetupKey, label: string, phase: Phase, ok: string): SetupItem => {
    const b = templateBlockers(templates, phase);
    return { key, label, ready: !b.length, message: b[0] ?? ok };
  };
  const apActive = templates.find((t) => t.template_key === "ap_declaration" && t.is_active);
  return [
    card("agreement", "Customer agreement / consumer rights (pre-install)", "agreement", activeTemplate(templates, "customer_agreement") ? "Customers can accept quotes electronically (commercial agreement only)." : "Customers can accept quotes electronically. Optional Home Insulation Victoria commercial agreement wording not configured."),
    card("esc_consent", "ESC owner consent (after booking)", "consent", "Owner consent is generated once an exact installation date is booked."),
    { key: "installer", label: "Installer declaration (superseded)", ready: true, message: INSTALLER_DECLARATION_SUPERSEDED },
    card("final_assignment", "Official ESC VEEC assignment form v1.1 (post-install)", "final", "The form is completed from job facts once the install is recorded complete and signed lead installer → AP (after the four prerequisites) → owner via their secure link."),
    { key: "ap", label: "AP declaration (if required)", ready: !(apActive && apActive.required && !apActive.approved), message: activeTemplate(templates, "ap_declaration") ? "AP declaration wording approved." : "No separate AP declaration configured – AP representative signs the final assignment form." },
    // Jo 24 Oct 2026 (decision 121): no approval is needed to PREPARE the Registry notice — the default field list applies until Jo confirms the real fields.
    { key: "esc_config", label: "ESC notification fields", ready: true, message: escConfigReady ? "ESC notice fields are approved." : "Default VEU Registry field list in use; approve a field list here once Jo confirms the real Registry fields." },
  ];
}
