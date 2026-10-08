// Installer Add job: one phone-first flow Customer -> Job details -> Review & save (Jo, 8 Oct 2026).
// Pure presentation/state rules only. Validation comes from the existing validators; no new lifecycle.
import { onsiteProblems, type OnsiteInput, type OnsiteState } from "./onsite-ready-check.core";
import { laterReadyCheckProblems, type LaterReadyCheck } from "./later-ready-check.core";
import { quotedIntakeProblems } from "./installer-quote-intake.core";

export type AddJobMode = "onsite" | "later" | "existing";
export type AddJobStep = "customer" | "details" | "review";
export const ADD_JOB_STEPS: { key: AddJobStep; label: string }[] = [
  { key: "customer", label: "Customer" }, { key: "details", label: "Job details" }, { key: "review", label: "Review & save" },
];
export const nextStep = (s: AddJobStep): AddJobStep => (s === "customer" ? "details" : "review");
export const prevStep = (s: AddJobStep): AddJobStep | null => (s === "review" ? "details" : s === "details" ? "customer" : null);

export const blankCustomer = (): OnsiteInput => ({ full_name: "", address_line: "", suburb: "", postcode: "", phone: "", email: "", contact_permission: false, consent_by: null });

/** A restored phone draft never carries consent forward: it must be ticked again for this job. */
export const restoreCustomer = (raw: unknown): OnsiteInput => {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof OnsiteInput, unknown>>;
  const s = (k: keyof OnsiteInput) => (typeof d[k] === "string" ? (d[k] as string) : "");
  return { full_name: s("full_name"), address_line: s("address_line"), suburb: s("suburb"), postcode: s("postcode"), phone: s("phone"), email: s("email"), contact_permission: false, consent_by: null };
};

export const customerProblems = (c: OnsiteInput) => onsiteProblems(c);

export type ExistingDetails = { siteCheck: "yes" | "no" | null; quoted: "yes" | "no" | null; area: string; method: string; amount: string; includes: string };
export const parseAmount = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t.replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : NaN; };

export function existingDetailsProblems(d: ExistingDetails): string[] {
  const out: string[] = [];
  if (!d.quoted) out.push("Answer Have you quoted?");
  if (d.quoted === "yes" && !d.siteCheck) out.push("Answer Have you done the site check / measure-up?");
  const amount = parseAmount(d.amount);
  out.push(...quotedIntakeProblems({ quoted: d.quoted, area: d.area, method: d.method, amount: amount != null && Number.isNaN(amount) ? 0 : amount, includes: d.includes }));
  return out;
}

export type ExistingTicks = { feeAwareness: boolean; belowR2: boolean; ownerAgreed: boolean };
export function existingReviewProblems(t: ExistingTicks): string[] {
  const out: string[] = [];
  if (!t.ownerAgreed) out.push("Tick that the owner agreed to your quoted price");
  if (!t.feeAwareness) out.push("Tick that the owner knows about the fees");
  if (!t.belowR2) out.push("Tick that any existing insulation is below R2.0");
  return out;
}

export type LaterDetails = { date: string; manual: boolean; area: string; method: string; notes: string };
export const laterPayload = (d: LaterDetails): LaterReadyCheck => ({
  startsAt: d.date && Number.isFinite(Date.parse(d.date)) ? new Date(d.date).toISOString() : "",
  ...(d.manual && d.area.trim() ? { area: Number(d.area) } : {}),
  ...(d.manual ? { method: d.method, notes: d.notes } : {}),
});
export const laterDetailsProblems = (d: LaterDetails) => laterReadyCheckProblems(laterPayload(d));

/** Save button wording: says what the tap really does — saving is not booking and not an open form. */
export function submitLabel(mode: AddJobMode): string {
  if (mode === "onsite") return "Save job and prepare Ready Check form";
  if (mode === "later") return "Save job for later";
  return "Add job";
}
export const BUSY_LABEL = "Saving…";

/** Duplicate/collision errors become one neutral line; never reveals another owner or business. */
export const NEUTRAL_SAVE_ERROR = "Job not added. Please contact the office for help; your entered details are kept.";
export function saveErrorMessage(msg: string | null | undefined): string {
  const m = msg ?? "";
  if (/already on another customer record|owners_email_uq|duplicate key|Contact the office/i.test(m)) return NEUTRAL_SAVE_ERROR;
  if (!m) return "No signal — your details are kept. Tap again when you have signal.";
  return m;
}

export type FormLabel = { label: "Form available" | "Preparing form" | "Form unavailable"; detail: string | null };
/** Form state after saving, from the server's own structured state only. */
export function formLabel(s: OnsiteState): FormLabel {
  if (s.kind === "open") return { label: "Form available", detail: null };
  if (s.kind === "preparing") return { label: "Preparing form", detail: s.message };
  return { label: "Form unavailable", detail: s.message };
}

export type BookingOutcome = "confirmed" | "blocked" | "waiting_paperwork" | undefined;
export function bookingLabel(b: BookingOutcome): string | null {
  if (b === "confirmed") return "Appointment confirmed";
  if (b === "blocked") return "Appointment saved but not confirmed — the office will check it";
  if (b === "waiting_paperwork") return "Appointment not confirmed yet — the owner signs the first paperwork first";
  return null;
}
