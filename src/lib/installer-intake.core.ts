// Installer-supplied customer intake (Jo, 8 Oct 2026, approved redesign). Pure rules only.
// One short intake; owner eligibility is checked by Home Insulation Victoria after contact; full Ready Check
// evidence is deferrable to install day but is ALWAYS required (and verified) before the rebate.

import { parseProposedR } from "./intake-quote-details.core";
export const INTAKE_RULESET_VERSION = "installer-intake-2026-10-08";

export type ExistingInsulation = "none" | "below_r2" | "unknown";
export const EXISTING_INSULATION_CHOICES: { value: ExistingInsulation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "below_r2", label: "Confirmed below R2" },
  { value: "unknown", label: "Not yet confirmed" },
];

export const EVIDENCE_ACK =
  "All required Ready Check and installation evidence must be supplied and accepted before this job can receive the rebate.";

/** Quote status on Add job (Jo, 8 Oct): a job can be registered BEFORE a visit and BEFORE any quote. */
export type QuoteStatus = "not_quoted" | "have_quote";
export const QUOTE_STATUS_CHOICES: { value: QuoteStatus; label: string }[] = [
  { value: "not_quoted", label: "Not quoted yet" },
  { value: "have_quote", label: "I have a quote" },
];
export const JOB_DETAILS_LEAD = "Add what you know. You can complete the measurements, quote and Ready Check later.";

export type IntakeInput = {
  area: string; amount: string; includes: string; proposedR: string;
  insulation: ExistingInsulation | null; quoteFileCount: number; evidenceAck: boolean;
  /** null = not chosen yet. Omitted (legacy callers) = "have_quote". */
  quoteStatus?: QuoteStatus | null;
  /** New intake "Yes, measured and quoted": area + insulation required. Later edits leave them optional. */
  requireMeasured?: boolean;
};

const num = (s: string) => { const t = s.trim(); if (!t) return null; const n = Number(t.replace(/[$,\sRr]/g, "")); return Number.isFinite(n) ? n : NaN; };
export const parseIntakeAmount = num;

/**
 * Problems for JOB CREATION (and later installer edits). Area, quote, inclusions, product and insulation are all optional;
 * anything that IS entered must be valid. "I have a quote" needs an upload OR a manual amount + what it includes.
 * Owner quote readiness is a separate, stricter check (installerQuoteReadiness).
 */
export function intakeProblems(i: IntakeInput): string[] {
  const out: string[] = [];
  const area = num(i.area);
  if (area != null && (Number.isNaN(area) || area <= 0 || area > 5000)) out.push("Check the ceiling area (m²) — or leave it as not measured yet");
  const qs = i.quoteStatus === undefined ? "have_quote" : i.quoteStatus;
  if (!qs) out.push("Choose the quote status");
  if (qs === "have_quote") {
    // "Yes, measured and quoted": the measured area and existing insulation are required (Jo, 9 Oct).
    if (i.requireMeasured) {
      if (area == null) out.push("Enter the measured ceiling area (m²)");
      if (!i.insulation) out.push("Choose the existing insulation");
    }
    const amount = num(i.amount);
    const manual = amount != null && !Number.isNaN(amount) && amount > 0;
    if (amount != null && (Number.isNaN(amount) || amount <= 0 || amount > 1_000_000)) out.push("Check the quote amount inc GST");
    else if (!manual && i.quoteFileCount === 0) out.push("Upload your quote or enter the quote amount inc GST");
    if (manual && !i.includes.trim()) out.push("Tell us what the quote includes");
    const r = parseProposedR(i.proposedR);
    if (r != null && (Number.isNaN(r) || r <= 0 || r > 10)) out.push("Check the proposed product R-rating");
  }
  if (!i.evidenceAck) out.push("Tick that all required evidence must be supplied and accepted before the rebate");
  return out;
}

/** Area as entered: a positive number, or null when not measured yet. Never Number("") = 0. */
export function intakeArea(s: string): number | null {
  const a = num(s); return a != null && !Number.isNaN(a) && a > 0 && a <= 5000 ? a : null;
}

/**
 * Quote facts actually sent. Not quoted = all null (never zero/fake). A quote file without a typed amount is
 * "have quote, amount from file" — quoted stays null (the DB requires a positive amount for quoted = yes).
 */
export function intakeQuotePayload(i: { quoteStatus: QuoteStatus | null; amount: string; includes: string; proposedR: string }) {
  if (i.quoteStatus !== "have_quote") return { quoted: i.quoteStatus === "not_quoted" ? "no" as const : null, quoted_price_inc_gst: null, price_includes: null, proposed_r_value: null };
  const a = num(i.amount); const amount = a != null && !Number.isNaN(a) && a > 0 ? a : null;
  const r = parseProposedR(i.proposedR); const proposed = r != null && !Number.isNaN(r) && r > 0 && r <= 10 ? r : null;
  return { quoted: amount ? "yes" as const : null, quoted_price_inc_gst: amount, price_includes: amount ? i.includes.trim() || null : null, proposed_r_value: proposed };
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
  /** What the quote includes (scope). Checked when provided by the caller. */
  includes?: string | null;
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
  else if (f.includes !== undefined && !f.includes?.trim()) b.push("What the installer quote includes is missing");
  return { ready: b.length === 0, blockers: b };
}

/** Actual release (send) needs a current granted owner_contact_consents row and fee awareness on record — an event alone is not consent. */
/**
 * Owner quote release holds. Fee awareness must match the CURRENT electrician payer: a declaration made for one payer
 * (e.g. HIV's $349 PIESA) does not cover another (own electrician billing directly). Office records (payer null) count.
 * Undecided electrician holds the quote until the owner's electrician cost is known and disclosed.
 */
export function installerQuoteReleaseBlockers(r: { consentStatus: string | null; feeAwarenessRecorded: boolean; feeAwarenessPayer?: ElectricianPayer | null; electricianPayer?: ElectricianPayer }): string[] {
  const b: string[] = [];
  if (r.consentStatus !== "granted") b.push("No current owner contact consent on record");
  if (r.electricianPayer === "undecided") b.push("Electrician not decided yet — the owner's electrician cost must be known and disclosed before the quote");
  if (!r.feeAwarenessRecorded) b.push("Owner fee awareness not recorded yet");
  // Legacy office records (no payer) used the HIV PIESA + AP wording: they never clear an own-electrician (direct billing) job.
  else if (r.electricianPayer && r.electricianPayer !== "undecided" && (r.feeAwarenessPayer ?? "hivic") !== r.electricianPayer) b.push("Owner fee awareness was given for a different electrician arrangement — record it again for the current one");
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
export function rebateEvidenceBlockers(x: { items: EvidenceItem[]; apApprovedBy: string | null; requiredCategories?: readonly string[]; notApplicableCategories?: readonly string[] }): string[] {
  const b: string[] = [];
  const na = new Set(x.notApplicableCategories ?? []);
  x = { ...x, items: x.items.filter((i) => !(i.category && na.has(i.category))) };
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
 * Facts sent to confirmImport. r_value is the established PROPOSED product R (pilot.core); existing_r_value is never
 * sent, so the proposal can never become the existing insulation value on the measurement.
 */
export function intakeConfirmFacts(c: { full_name: string; email: string; phone: string; address_line: string; suburb: string; postcode: string }, areaM2: number | null, proposedR: number | null = null): Record<string, string | number | null> {
  const area = areaM2 != null && Number.isFinite(areaM2) && areaM2 > 0 ? areaM2 : null; // not measured = null, never 0
  return { full_name: c.full_name.trim(), email: c.email.trim(), phone: c.phone.trim(), address_line: c.address_line.trim(), suburb: c.suburb.trim(), postcode: c.postcode.trim(),
    measured_area_m2: area, measurement_method: area == null ? null : "Installer supplied (unverified)", r_value: proposedR };
}

/**
 * Server-side strip for intake submissions: the installer is never asked for an EXISTING R-value, so any
 * existing_r_value a client sends is dropped. facts.r_value keeps its established meaning (PROPOSED product R).
 */
export function stripIntakeRValues<T extends Record<string, unknown>>(facts: T): T {
  const o = { ...facts }; delete o["existing_r_value"]; return o;
}

/** Truthful consent source for the remote installer intake — never "onsite_ready_check" (that unlocks onsite paperwork). */
export const INSTALLER_INTAKE_CONSENT_SOURCE = "installer_intake_remote";

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
export function importClaimDecision(s: ImportClaimState, userId: string, nowMs: number): "claim" | "done" | "busy" | "refuse" {
  if (s.status === "confirmed") return s.confirmedBy === userId && s.jobId ? "done" : "refuse";
  if (s.status !== "draft") return "refuse";
  if (!s.confirmedBy) return "claim"; // never claimed, or safely released (a partial job_id is reused by the claimer)
  const age = s.confirmedAt ? nowMs - Date.parse(s.confirmedAt) : Infinity;
  return age >= CLAIM_STALE_MS ? "claim" : "busy"; // a FRESH claim is busy for everyone, even the same user with a partial job
}

/** Stable key of what a submission attempted, so a retry onto a partial job cannot silently write different facts. */
export function intakeAttemptKey(d: { facts: unknown; occupancy?: unknown; progress?: unknown; details?: unknown; installer?: unknown; electrician?: unknown }): string {
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(norm({ facts: d.facts, occupancy: d.occupancy ?? null, progress: d.progress ?? null, details: d.details ?? null, installer: d.installer ?? null, electrician: d.electrician ?? null }));
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
export const EXISTING_R_CATEGORY = "existing_insulation_r_value";

/**
 * Original-condition media that actually APPLIES, from the canonical Ready Check answer `insulation.existing`
 * (none | present | unknown; "present" covers mixed ceilings where any area has existing insulation).
 * - none: the before-ceiling-space media shows the empty ceiling; no existing R-value item is applicable (never fabricated).
 * - present (incl. mixed): before-ceiling media AND verified existing R-value/depth media.
 * - unknown / not recorded: fail closed — both stay required and a blocker says the answer is missing.
 */
export function intakeOriginalConditionMedia(existing: string | null | undefined): { required: string[]; notApplicable: string[]; blocker: string | null } {
  if (existing === "none") return { required: ["before_ceiling_space"], notApplicable: [EXISTING_R_CATEGORY], blocker: null };
  if (existing === "present") return { required: [...INTAKE_REQUIRED_MEDIA], notApplicable: [], blocker: null };
  return { required: [...INTAKE_REQUIRED_MEDIA], notApplicable: [], blocker: "Existing insulation (none / present) is not recorded in the Ready Check" };
}

// ---- Who will organise this job? (Jo, 8 Oct 2026). Coordination responsibility only — never waives any gate. ----
export type Coordination = "hivic_managed" | "self_managed";
export const COORDINATION_VERSION = "coordination-2026-10-08";
// Jo, 9 Oct 2026 01:17 Sydney: organise choice comes FIRST on its own screen, before "Have you measured and quoted?".
export const ORGANISE_QUESTION = "How would you like to organise this job?";
export const COORDINATION_CHOICES: { value: Coordination; title: string; badge?: string; body: string }[] = [
  { value: "hivic_managed", title: "Home Insulation Victoria manages the process", badge: "Recommended", body: "We coordinate bookings, the required documentation, and your VEEC submission once all requirements are met." },
  { value: "self_managed", title: "I’ll manage the job myself", body: "You coordinate the owner, electrician and installation, meet the required steps and deadlines, and provide the complete evidence for our review." },
];

// ---------- Jo, 9 Oct 2026: measured/quoted question, electrician payer and installer fee declaration ----------
export const INSTALLER_CONTACT_PERMISSION = "The owner has given permission for Home Insulation Victoria to contact them to check eligibility and discuss this job.";
export const MEASURED_QUOTED_QUESTION = "Have you measured and quoted this job?";
export const MEASURED_QUOTED_CHOICES: { value: QuoteStatus; label: string }[] = [{ value: "have_quote", label: "Yes" }, { value: "not_quoted", label: "No" }];
export const NOT_MEASURED_NOTE = "That’s fine — we’ll save the job now. Add your measurements and quote on this same job when ready.";
/** Who arranges/pays the electrician on an installer-supplied job (separate from who manages the job). */
export type ElectricianPayer = "hivic" | "own" | "undecided";
export const ELECTRICIAN_PAYER_CHOICES: { value: ElectricianPayer; label: string; body: string }[] = [
  { value: "hivic", label: "Home Insulation Victoria arranges — $349 including GST", body: "We arrange an approved electrician. The $349 PIESA fee is on the owner’s quote." },
  { value: "own", label: "I’ll use my own electrician", body: "Your electrician invoices the owner directly at the price agreed with them. Our $349 PIESA fee is not charged. The office still verifies the electrician, the PIESA, any conditions, evidence and notices before work." },
  { value: "undecided", label: "To be arranged", body: "You can save now. The owner quote waits until the electrician and their cost are known." },
];
export const FEE_AWARENESS_HIV_REC = "The owner has been advised of the $349 PIESA fee and $349 AP management fee, both including GST.";
export const FEE_AWARENESS_OWN_REC = "The owner has been advised of the $349 AP management fee including GST and that their electrician invoices them separately at the agreed price.";
export const FEE_AWARENESS_VERSION = "installer-fee-awareness-2026-10-09";
export const feeAwarenessText = (p: ElectricianPayer | null): string | null => (p === "hivic" ? FEE_AWARENESS_HIV_REC : p === "own" ? FEE_AWARENESS_OWN_REC : null);
/** jobs.electrician_choice -> payer. HIV organise/matched/books = HIV; preferred/nominated/own = direct own REC. */
export function payerFromChoice(choice: string | null | undefined): ElectricianPayer {
  if (choice === "hivic_organise" || choice === "hivic_matched" || choice === "installer_own_hivic_books") return "hivic";
  if (choice === "preferred" || choice === "nominated" || choice === "installer_own") return "own";
  return "undecided";
}
/** Next action for an installer-supplied job by route x measured/quoted. */
export function intakeNextAction(c: Coordination | null, quoted: boolean): string {
  if (quoted) return "Home Insulation Victoria checks the owner's eligibility, then prepares the owner quote.";
  return c === "self_managed"
    ? "Home Insulation Victoria checks the owner's eligibility. Then measure and quote the job and add it here."
    : "Home Insulation Victoria checks the owner's eligibility, then arranges the Ready Check.";
}
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

export type IntakeCurrent = { areaM2: number | null; insulation: ExistingInsulation | null; quoted: "yes" | "no" | null; quoteIncGst: number | null; includes: string | null; proposedR: number | null };
/**
 * Material changes only (pure). Blank area keeps the known area (never cleared to 0). "Not quoted yet" clears stale
 * quote facts to null honestly; "I have a quote" with a file but no amount keeps quoted unknown.
 */
export function pickIntakeChanges(cur: IntakeCurrent, next: { areaM2: number | null; insulation: ExistingInsulation; quoteStatus: QuoteStatus; quoteIncGst: number | null; includes: string | null; proposedR: number | null; files: unknown[] }) {
  const out: { area?: number; insulation?: ExistingInsulation; proposedR?: number | null; quote?: { quoted: "yes" | "no" | null; quoteIncGst: number | null; includes: string | null } } = {};
  if (next.areaM2 != null) { if (!(next.areaM2 > 0 && next.areaM2 <= 5000)) throw new Error("Check the ceiling area (m²)"); if (next.areaM2 !== cur.areaM2) out.area = next.areaM2; }
  if (next.insulation !== (cur.insulation ?? "unknown")) out.insulation = next.insulation;
  const q = next.quoteStatus === "not_quoted" ? { quoted: "no" as const, quoteIncGst: null, includes: null }
    : next.quoteIncGst != null ? { quoted: "yes" as const, quoteIncGst: next.quoteIncGst, includes: next.includes?.trim() || null }
    : { quoted: null, quoteIncGst: null, includes: null };
  if (next.quoteStatus === "have_quote") {
    if (next.quoteIncGst != null && !(next.quoteIncGst > 0 && next.quoteIncGst <= 1_000_000)) throw new Error("Check the quote amount inc GST");
    if (next.quoteIncGst != null && !q.includes) throw new Error("Tell us what the quote includes");
    if (next.quoteIncGst == null && !next.files.length && cur.quoteIncGst == null && cur.quoted !== "yes") { /* file may already be on the job */ }
  }
  if (q.quoted !== cur.quoted || q.quoteIncGst !== cur.quoteIncGst || q.includes !== (cur.includes ?? null)) out.quote = q;
  const pr = next.quoteStatus === "not_quoted" ? null : next.proposedR;
  if (pr != null && !(pr > 0 && pr <= 10)) throw new Error("Check the proposed product R-rating");
  if (pr !== cur.proposedR) out.proposedR = pr;
  return out;
}

/**
 * Installer changes who arranges/pays the electrician on their own job (before any electrician has accepted).
 * Validated BEFORE any write: a fee declaration sent with the change must match the NEW payer and its exact wording.
 */
export function planPayerChange(x: { currentPayer: ElectricianPayer; requested: ElectricianPayer | undefined; electricianAccepted: boolean; fee?: { payer: ElectricianPayer; text: string } | undefined }):
  { ok: true; change: boolean; nextPayer: ElectricianPayer } | { ok: false; error: string } {
  const change = x.requested !== undefined && x.requested !== x.currentPayer;
  if (change && x.electricianAccepted) return { ok: false, error: "An electrician has already accepted this job. Ask Home Insulation Victoria to change it." };
  const nextPayer = change ? x.requested! : x.currentPayer;
  if (x.fee && (x.fee.payer !== nextPayer || x.fee.text !== feeAwarenessText(nextPayer))) return { ok: false, error: "The fee confirmation doesn't match the electrician arrangement you chose — tick it again." };
  return { ok: true, change, nextPayer };
}

/** Release/accept guard (Jo 9 Oct): an installer quote's electrical billing lines must match the CURRENT payer,
 *  whichever path changed the payer. Accepted quotes are frozen and never re-checked/repriced. */
export function electricalLineBlocker(codes: (string | null)[], payer: ElectricianPayer): string | null {
  if (payer === "undecided") return "Electrician arrangement not decided yet — this quote can't go to the owner";
  const has = codes.includes("PIESA");
  if (payer === "hivic" && !has) return "This quote has no PIESA line but Home Insulation Victoria is arranging the electrician — prepare a fresh quote first";
  if (payer === "own" && has) return "This quote charges a PIESA but the owner's own electrician invoices them directly — prepare a fresh quote first";
  return null;
}

/**
 * The installer's explicit "Have you measured and quoted this job?" answer, separate from price readiness.
 * Latest recorded answer wins (a later No overrides retained files); older jobs fall back to jobs.installer_quoted.
 * Never inferred from attachments.
 */
export function resolveQuoteAnswer(events: { answer: unknown; at: string }[], installerQuoted: string | null | undefined): QuoteStatus | null {
  const valid = events.filter((e) => e.answer === "have_quote" || e.answer === "not_quoted").sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (valid[0]) return valid[0].answer as QuoteStatus;
  return installerQuoted === "yes" ? "have_quote" : installerQuoted === "no" ? "not_quoted" : null;
}

/**
 * Fields the initial Add job form actually applies: "Not measured or quoted" never serializes or validates hidden
 * area/quote facts typed earlier on the Yes branch (they stay in the draft only so switching back restores them).
 */
export function applicableIntakeDetails<T extends { quoteStatus?: QuoteStatus | null; area: string; amount: string; includes: string; proposedR: string }>(d: T): T {
  return d.quoteStatus === "have_quote" ? d : { ...d, area: "", amount: "", includes: "", proposedR: "" };
}

export type RecoveredIntakeReceipt = { insulation: ExistingInsulation; quoted: boolean; next: string; feeHeld: boolean };
/**
 * Receipt for an Add job that was saved but whose reply was lost (refresh / dropped response), rebuilt only from
 * the job's own recorded intake events — never from the browser's draft.
 */
export function recoveredIntakeReceipt(events: { event_type: string; details: Record<string, unknown> | null }[]): RecoveredIntakeReceipt {
  const latest = (t: string) => events.find((e) => e.event_type === t)?.details ?? null;
  const answer = latest("installer_quote_answer")?.answer;
  const quoted = answer !== "not_quoted";
  const coordRaw = latest("installer_coordination_chosen")?.coordination;
  const coord: Coordination | null = coordRaw === "self_managed" || coordRaw === "hivic_managed" ? coordRaw : null;
  const ins = latest("installer_existing_insulation_declared")?.value;
  const insulation: ExistingInsulation = ins === "none" || ins === "below_r2" ? ins : "unknown";
  const fee = events.some((e) => e.event_type === "installer_owner_fee_awareness");
  return { insulation, quoted, next: intakeNextAction(coord, quoted), feeHeld: quoted && !fee };
}

/** Details editor: the own-electrician selection to send — on a payer change to own, or own -> a different own. */
export function editorElectricianSend(x: { payerChanged: boolean; payer: ElectricianPayer; plan: { mode: string; business_id?: string | null; nomination_id?: string | null } | null; currentBusinessId: string | null | undefined }):
  { mode: "mine"; business_id: string | null; nomination_id: string | null } | undefined {
  if (x.payer !== "own" || x.plan?.mode !== "mine" || !(x.plan.business_id || x.plan.nomination_id)) return undefined;
  if (!x.payerChanged && x.plan.business_id && x.plan.business_id === x.currentBusinessId) return undefined; // same saved electrician
  return { mode: "mine", business_id: x.plan.business_id ?? null, nomination_id: x.plan.nomination_id ?? null };
}
