// Installer Add job: one phone-first flow Customer -> Job details -> Review & save (Jo, 8 Oct 2026).
// Pure presentation/state rules only. Validation comes from the existing validators; no new lifecycle.
import { PICK_ADDRESS, onsiteProblems, type OnsiteInput, type OnsiteState } from "./onsite-ready-check.core";
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
  return { full_name: s("full_name"), address_line: s("address_line"), suburb: s("suburb"), postcode: s("postcode"), phone: s("phone"), email: s("email"), contact_permission: false, consent_by: null, address_verified: d.address_verified === true };
};

/** On the phone the address must also be picked from the Google list (Jo 24 Oct); sample screens type freely. */
export const customerProblems = (c: OnsiteInput, opts: { requirePicked?: boolean } = {}) =>
  opts.requirePicked === false || c.address_verified === true ? onsiteProblems(c) : [PICK_ADDRESS, ...onsiteProblems(c)];

export type ExistingDetails = { area: string; method: string; amount: string; includes: string };
export const parseAmount = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t.replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : NaN; };

export function existingDetailsProblems(d: ExistingDetails): string[] {
  const out: string[] = [];
  const amount = parseAmount(d.amount);
  out.push(...quotedIntakeProblems({ quoted: "yes", area: d.area, method: d.method, amount: amount != null && Number.isNaN(amount) ? 0 : amount, includes: d.includes }));
  return out;
}

export type ExistingTicks = { feeAwareness: boolean; belowR2: boolean; ownerAgreed: boolean };
export function existingReviewProblems(t: ExistingTicks): string[] {
  const out: string[] = [];
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
  if (/load failed|failed to fetch|network|timeout|fetch failed/i.test(m)) return "The save confirmation was interrupted. Your details are kept; tap Retry submission to finish the same job. Do not add it again.";
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

/** Entry choices and their next-step promise (Jo, 8 Oct 10:14 UTC). Shown on the choice, the review and the outcome. */
export const MODE_CHOICES: { mode: AddJobMode; title: string; next: string }[] = [
  { mode: "onsite", title: "I'm at the property now", next: "Add the customer and we’ll prepare your Mitti Ready Check form. It usually takes about 90 seconds and opens automatically when ready." },
  { mode: "later", title: "A job for later", next: "Enter your visit date and time. Once confirmed, it appears in Upcoming visits under My work. On the day, open the job and complete the Ready Check form." },
  { mode: "existing", title: "A job I’ve already visited", next: "Send us the job details and your quote. We’ll contact the owner for the eligibility check and quote approval, then let you know when they accept." },
];
export const nextStepText = (m: AddJobMode) => MODE_CHOICES.find((c) => c.mode === m)!.next;

export type Outcome = { tone: "success" | "waiting" | "blocked"; heading: string; body: string; waitingOn: string | null };
/** The real outcome after saving, from the server's own answer. Saving alone is never shown as the goal. */
export function outcomeFor(mode: AddJobMode, r: { booking?: BookingOutcome; state?: OnsiteState | undefined }): Outcome {
  if (mode === "existing") return { tone: "waiting", heading: "Sent to Home Insulation Victoria", body: "Nobody has been contacted yet. Next, Home Insulation Victoria contacts the owner for the eligibility check and quote approval, then lets you know when they accept.", waitingOn: "Home Insulation Victoria" };
  if (mode === "later") {
    if (r.booking === "confirmed") return { tone: "success", heading: "Visit booked", body: "It's in Upcoming visits under My work. On the day, open the job and complete the Ready Check form.", waitingOn: null };
    return { tone: "blocked", heading: "Job saved — visit not confirmed yet", body: r.booking === "waiting_paperwork" ? "The owner needs to sign the first paperwork before the visit can be confirmed. It won't show in Upcoming visits until then." : "The visit time couldn't be confirmed yet. It won't show in Upcoming visits until Home Insulation Victoria checks it.", waitingOn: r.booking === "waiting_paperwork" ? "The owner" : "Home Insulation Victoria" };
  }
  const s = r.state;
  if (s?.kind === "open") return { tone: "success", heading: "Your Ready Check form is ready", body: "Opening it now. Complete it while you're onsite.", waitingOn: null };
  if (s?.kind === "preparing") return { tone: "waiting", heading: "Job saved — preparing your Ready Check form…", body: "It usually takes about 90 seconds and opens automatically when ready. You can stay on this screen.", waitingOn: null };
  return { tone: "blocked", heading: "Job saved — form not ready yet", body: `${s?.message ?? "The form couldn't be prepared."} You don't need to add the job again.`, waitingOn: s?.kind === "owner_paperwork" ? "The owner" : s?.kind === "retry" && /signal|answering/i.test(s.message) ? null : "Home Insulation Victoria" };
}

/** Review-summary wording: positive only when the same rule final validation uses is satisfied (restored drafts reset these on purpose). */
export const contactPermissionSummary = (c: Pick<OnsiteInput, "contact_permission" | "consent_by">) =>
  c.contact_permission === true && c.consent_by === "installer" ? "Permission to contact given" : "Contact permission still needs to be ticked";
export const organiseSummary = (coord: "hivic_managed" | "self_managed" | string | null, selfAck: boolean) =>
  coord === "self_managed"
    ? selfAck ? "I’ll manage the job myself (responsibility acknowledged)" : "I’ll manage the job myself — responsibility still needs to be ticked"
    : coord ? "Home Insulation Victoria manages the process" : "Who organises the job still needs to be chosen";
