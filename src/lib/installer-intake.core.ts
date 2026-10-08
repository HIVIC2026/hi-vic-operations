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
export function rebateEvidenceBlockers(x: { items: EvidenceItem[]; apApprovedBy: string | null; requiredCategories?: readonly string[] }): string[] {
  const b: string[] = [];
  if (x.items.length === 0) b.push("No evidence requirements recorded for this job");
  for (const c of x.requiredCategories ?? []) {
    const it = x.items.filter((i) => i.category === c);
    if (!it.length) b.push(`${c.replace(/_/g, " ")}: no evidence requirement recorded`);
    else if (!it.some((i) => i.status === "verified")) b.push(`${c.replace(/_/g, " ")}: photo/video evidence not verified (a declaration does not count)`);
  }
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

/**
 * An uploaded file that genuinely covers more than one customer is rejected (one job = one customer).
 * Email count alone is NOT a signal: a normal quote carries the contractor's email and the customer's.
 * Signals: two or more different labelled customer names, or two or more different labelled site addresses,
 * or a table/CSV with several data rows that each carry their own email address.
 */
export function multiCustomerAmbiguity(text: string): boolean {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,]+$/, "");
  const labelled = (re: RegExp) => new Set([...text.matchAll(re)].map((m) => norm(m[1] ?? "")).filter((v) => v.length > 2));
  const names = labelled(/^\s*(?:customer|client|home ?owner|owner)(?: name)?\s*[:\-]\s*(.+)$/gim);
  const sites = labelled(/^\s*(?:site|property|install(?:ation)?|job) address\s*[:\-]\s*(.+)$/gim);
  if (names.size > 1 || sites.size > 1) return true;
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((l) => /,/.test(l) && /e-?mail/i.test(l));
  if (header >= 0) {
    const rowEmails = new Set(lines.slice(header + 1).map((l) => l.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase()).filter(Boolean));
    if (rowEmails.size > 1) return true;
  }
  return false;
}

/**
 * Prefill from the extracted file: only values the reader actually found; nothing invented.
 * The PROPOSED product R-rating is filled ONLY from an explicit "proposed/new product R-value" label in the text —
 * a bare "R5" or a generic r_value is never taken as the proposal and is never existing insulation.
 */
export function prefillFromExtracted(x: { measured_area_m2?: { value: unknown; confidence: string } | undefined; product?: { value: unknown; confidence: string } | undefined; quote_lines?: { description: string; amount: number | null }[] | undefined }, text?: string) {
  const found = (f?: { value: unknown; confidence: string }) => (f && f.confidence === "found" && f.value != null && String(f.value).trim() ? String(f.value) : "");
  const lines = (x.quote_lines ?? []).filter((l) => l.amount != null && l.amount > 0);
  const total = lines.length === 1 ? String(lines[0]!.amount) : ""; // several lines = ambiguous total, confirm manually
  const pr = text?.match(/(?:proposed|new)\s+(?:product\s+)?r[- ]?(?:value|rating)\s*[:\-]\s*R?\s*(\d+(?:\.\d+)?)/i)?.[1] ?? "";
  return { area: found(x.measured_area_m2), proposedR: pr, includes: [found(x.product), ...lines.map((l) => l.description)].filter(Boolean).join("; ").slice(0, 1000), amount: total };
}

/**
 * Facts sent to confirmImport. Never carries r_value / existing_r_value: the proposed product rating travels only
 * in intake.proposed_r_value, so it can never become the EXISTING insulation value on the measurement.
 */
export function intakeConfirmFacts(c: { full_name: string; email: string; phone: string; address_line: string; suburb: string; postcode: string }, areaM2: number): Record<string, string | number | null> {
  return { full_name: c.full_name.trim(), email: c.email.trim(), phone: c.phone.trim(), address_line: c.address_line.trim(), suburb: c.suburb.trim(), postcode: c.postcode.trim(),
    measured_area_m2: areaM2, measurement_method: "Installer supplied (unverified)" };
}

/** Server-side strip: whatever a client sends, intake submissions never store a proposed or existing R-value as fact. */
export function stripIntakeRValues<T extends Record<string, unknown>>(facts: T): T {
  const o = { ...facts }; delete o["r_value"]; delete o["existing_r_value"]; return o;
}

/**
 * Usable scope for an installer-supplied OWNER QUOTE: verified, then measured, then the installer-supplied provisional
 * figure. Provisional stays labelled provisional; it is never marked complete/accepted and never used for the rebate.
 */
export function intakeScopeArea(m: { verified_area_m2?: unknown; measured_area_m2?: unknown; supplied_area_m2?: unknown; provenance?: string | null } | null): { areaM2: number | null; provenance: "verified" | "measured" | "installer_provisional" | null } {
  const n = (v: unknown) => { const x = v == null ? NaN : Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  if (!m) return { areaM2: null, provenance: null };
  if (n(m.verified_area_m2)) return { areaM2: n(m.verified_area_m2), provenance: "verified" };
  if (n(m.measured_area_m2)) return { areaM2: n(m.measured_area_m2), provenance: "measured" };
  if (n(m.supplied_area_m2) && m.provenance === "installer_supplied_provisional") return { areaM2: n(m.supplied_area_m2), provenance: "installer_provisional" };
  return { areaM2: null, provenance: null };
}

/**
 * Race-safe submission claim on a draft import. confirmed_by + confirmed_at act as the claim while status stays draft;
 * status becomes confirmed only after EVERY step succeeded. A stale claim (crashed request) may be taken over.
 */
export const CLAIM_STALE_MS = 120_000;
export type ImportClaimState = { status: string; confirmedBy: string | null; confirmedAt: string | null; jobId: string | null };
export function importClaimDecision(s: ImportClaimState, userId: string, nowMs: number): "claim" | "resume" | "done" | "busy" | "refuse" {
  if (s.status === "confirmed") return s.confirmedBy === userId && s.jobId ? "done" : "refuse";
  if (s.status !== "draft") return "refuse";
  if (!s.confirmedBy) return "claim";
  const age = s.confirmedAt ? nowMs - Date.parse(s.confirmedAt) : Infinity;
  if (s.confirmedBy === userId) return s.jobId || age >= CLAIM_STALE_MS ? "resume" : "busy";
  return age >= CLAIM_STALE_MS ? "claim" : "busy";
}

/** What a material intake correction does to an existing quote. Accepted prices are never changed unilaterally. */
export function staleQuoteAction(status: string): "supersede" | "withdraw" | "reconfirm" | "keep" {
  if (status === "draft") return "supersede";
  if (status === "issued") return "withdraw";
  if (status === "accepted") return "reconfirm";
  return "keep";
}

/** Final-gate evidence the installer intake route must ALWAYS have as real verified media (declarations never count). */
export const INTAKE_REQUIRED_MEDIA = ["before_ceiling_space", "existing_insulation_r_value"] as const;

// ---- Who will organise this job? (Jo, 8 Oct 2026). Coordination responsibility only — never waives any gate. ----
export type Coordination = "hivic_managed" | "self_managed";
export const COORDINATION_VERSION = "coordination-2026-10-08";
export const COORDINATION_CHOICES: { value: Coordination; title: string; badge?: string; body: string }[] = [
  { value: "hivic_managed", title: "Home Insulation Victoria manages the process", badge: "Recommended", body: "We coordinate bookings, guide you through the required checks and documentation, and prepare your VEEC submission once the job meets all eligibility, compliance and evidence requirements." },
  { value: "self_managed", title: "I'll organise the job myself", body: "You coordinate the owner, electrician and installation, meet all required compliance steps and deadlines, and provide the complete evidence pack for our review." },
];
export const SELF_MANAGED_ACK = "I understand I am responsible for organising the required assessments and installation, meeting the applicable requirements and deadlines, and supplying complete, accurate evidence. Missing, late or unacceptable evidence may prevent this job from receiving the rebate.";
export const VEEC_NOTE = "VEEC claims can only be submitted once all requirements are met. Final registration is subject to the regulator's approval.";

export function coordinationProblems(c: Coordination | null, selfAck: boolean): string[] {
  if (!c) return ["Choose who will organise this job"];
  if (c === "self_managed" && !selfAck) return ["Tick that you are responsible for organising the job and supplying complete evidence"];
  return [];
}

/** Office next action by route. Both routes keep every AP check, notice, evidence and final approval step. */
export function coordinationNextAction(c: Coordination | null): string {
  if (c === "self_managed") return "Installer organises bookings — check eligibility, then review the installer's recorded bookings and evidence as they arrive.";
  if (c === "hivic_managed") return "Home Insulation Victoria organises — check eligibility, then arrange bookings through the normal workflow.";
  return "Coordination not recorded — confirm with the installer.";
}
