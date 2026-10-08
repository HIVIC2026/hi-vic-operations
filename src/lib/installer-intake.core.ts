// Installer-supplied customer intake (Jo, 8 Oct 2026, approved redesign). Pure rules only.
// One short intake; owner eligibility is checked by Home Insulation Victoria after contact; full Ready Check
// evidence is deferrable to install day but is ALWAYS required (and verified) before the rebate.

export const INTAKE_RULESET_VERSION = "installer-intake-2026-10-08";

export type ExistingInsulation = "none" | "below_r2" | "unknown";
export const EXISTING_INSULATION_CHOICES: { value: ExistingInsulation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "below_r2", label: "Confirmed below R2" },
  { value: "unknown", label: "Not yet confirmed" },
];

export const EVIDENCE_ACK =
  "All required Ready Check and installation evidence must be supplied and accepted before this job can receive the rebate.";

export type IntakeInput = {
  area: string; amount: string; includes: string; proposedR: string;
  insulation: ExistingInsulation | null; quoteFileCount: number; evidenceAck: boolean;
};

const num = (s: string) => { const t = s.trim(); if (!t) return null; const n = Number(t.replace(/[$,\sRr]/g, "")); return Number.isFinite(n) ? n : NaN; };
export const parseIntakeAmount = num;

/** Problems on the intake job-details step. A quote upload OR a manual amount + inclusions is required. */
export function intakeProblems(i: IntakeInput): string[] {
  const out: string[] = [];
  const area = num(i.area);
  if (area == null || Number.isNaN(area) || area <= 0 || area > 5000) out.push("Enter the ceiling area (m²)");
  if (!i.insulation) out.push("Choose the existing insulation");
  const amount = num(i.amount);
  const manual = amount != null && !Number.isNaN(amount) && amount > 0;
  if (amount != null && (Number.isNaN(amount) || amount <= 0)) out.push("Check the quote amount inc GST");
  if (!manual && i.quoteFileCount === 0) out.push("Upload your quote or enter the quote amount inc GST");
  if (manual && !i.includes.trim()) out.push("Tell us what the quote includes");
  const r = num(i.proposedR);
  if (r != null && (Number.isNaN(r) || r <= 0 || r > 10)) out.push("Check the proposed product R-rating");
  if (!i.evidenceAck) out.push("Tick that all required evidence must be supplied and accepted before the rebate");
  return out;
}

/** Only None or below R2 qualify. R2.0 exactly or more never qualifies; unknown holds the quote. */
export function insulationQualifies(v: ExistingInsulation | null | undefined, measuredR?: number | null): boolean {
  if (measuredR != null && Number.isFinite(measuredR) && measuredR >= 2) return false;
  return v === "none" || v === "below_r2";
}

export type QuoteReadinessFacts = {
  channel: string | null;
  officeEligibility: "eligible" | "declined" | "unresolved";
  insulation: ExistingInsulation | null;
  measuredR?: number | null;
  areaM2: number | null;
  installerQuoteIncGst: number | null;
};

/** Owner quote readiness for installer-supplied jobs. Ready Check media is NOT a prerequisite here. */
export function installerQuoteReadiness(f: QuoteReadinessFacts): { ready: boolean; blockers: string[] } {
  const b: string[] = [];
  if (f.channel !== "installer_sourced") b.push("Not an installer-supplied job");
  if (f.officeEligibility === "declined") b.push("Office found the owner or property not eligible");
  else if (f.officeEligibility !== "eligible") b.push("Office has not checked owner and property eligibility yet");
  if (f.measuredR != null && f.measuredR >= 2) b.push("Existing insulation is R2.0 or more — not eligible");
  else if (f.insulation === "unknown" || !f.insulation) b.push("Existing insulation not confirmed (must be none or below R2.0)");
  if (!(f.areaM2 && f.areaM2 > 0)) b.push("Measured ceiling area is missing");
  if (!(f.installerQuoteIncGst && f.installerQuoteIncGst > 0)) b.push("Installer quote amount is missing");
  return { ready: b.length === 0, blockers: b };
}

/** Actual release (send) needs a current granted owner_contact_consents row and fee awareness on record — an event alone is not consent. */
export function installerQuoteReleaseBlockers(r: { consentStatus: string | null; feeAwarenessRecorded: boolean }): string[] {
  const b: string[] = [];
  if (r.consentStatus !== "granted") b.push("No current owner contact consent on record");
  if (!r.feeAwarenessRecorded) b.push("Owner fee awareness (AP management and PIESA fees) not recorded yet");
  return b;
}

export type EvidenceItem = { category: string; label: string; blocking: boolean; status: "outstanding" | "uploaded" | "verified" | "rejected" | "not_required" };

/** Ready Check list shown on the job: only verified/not_required count as done; uploaded is still "awaiting check". */
export function readyCheckOutstanding(items: EvidenceItem[]): { outstanding: EvidenceItem[]; count: number } {
  const outstanding = items.filter((i) => i.blocking && i.status !== "verified" && i.status !== "not_required");
  return { outstanding, count: outstanding.length };
}

/**
 * Final AP / VEEC / rebate gate. Every blocking evidence item must be VERIFIED (not uploaded, not a tick or
 * declaration), no rejected item may remain, and a human AP approval must exist. Declarations such as
 * "below R2 confirmed" never substitute for photo evidence here.
 */
export function rebateEvidenceBlockers(x: { items: EvidenceItem[]; apApprovedBy: string | null }): string[] {
  const b: string[] = [];
  if (x.items.length === 0) b.push("No evidence requirements recorded for this job");
  for (const i of x.items) {
    if (!i.blocking || i.status === "not_required" || i.status === "verified") continue;
    b.push(i.status === "rejected" ? `${i.label}: rejected — re-upload needed` : i.status === "uploaded" ? `${i.label}: uploaded, not yet verified` : `${i.label}: missing`);
  }
  if (!x.apApprovedBy) b.push("Final Accredited Person approval not given");
  return b;
}

/** Install-day order: initial-condition evidence before removal/covering, prestart answers before PIISA/works. */
export function installDayBlockers(x: { initialConditionCaptured: boolean; prestartComplete: boolean }, action: "removal_or_cover" | "piisa_or_works"): string[] {
  const b: string[] = [];
  if (!x.initialConditionCaptured) b.push("Capture before photos/video of the existing ceiling space first");
  if (action === "piisa_or_works" && !x.prestartComplete) b.push("Answer the pre-start questions first");
  return b;
}

/** Stable idempotency key so a double tap or retry reuses the same draft/job. */
export const intakeKey = (businessId: string, email: string, address: string) =>
  `${businessId}:${email.trim().toLowerCase()}:${address.trim().toLowerCase().replace(/\s+/g, " ")}`;

/** An uploaded file that names more than one customer is rejected: one job = one customer. */
export function multiCustomerAmbiguity(text: string): boolean {
  const emails = new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()));
  return emails.size > 1;
}

/** Prefill from the extracted file: only values the reader actually found; nothing invented. */
export function prefillFromExtracted(x: { measured_area_m2?: { value: unknown; confidence: string } | undefined; r_value?: { value: unknown; confidence: string } | undefined; product?: { value: unknown; confidence: string } | undefined; quote_lines?: { description: string; amount: number | null }[] | undefined }) {
  const found = (f?: { value: unknown; confidence: string }) => (f && f.confidence === "found" && f.value != null && String(f.value).trim() ? String(f.value) : "");
  const lines = (x.quote_lines ?? []).filter((l) => l.amount != null && l.amount > 0);
  const total = lines.length === 1 ? String(lines[0]!.amount) : ""; // several lines = ambiguous total, confirm manually
  return { area: found(x.measured_area_m2), proposedR: found(x.r_value), includes: [found(x.product), ...lines.map((l) => l.description)].filter(Boolean).join("; ").slice(0, 1000), amount: total };
}

