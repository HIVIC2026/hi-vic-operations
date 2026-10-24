// Installer Add a job (Jo, 8 Oct 2026; basics only since decision 34, 24 Oct 2026; ONE screen per approved mock-up
// M3, decision 198). Pure presentation/state rules only. Validation comes from the existing validators; no new lifecycle.
import { PICK_ADDRESS, onsiteProblems, type OnsiteInput, type OnsiteState } from "./onsite-ready-check.core";
import { installTimeLabel } from "./install-days.core";

/** Mock-up M3 heading lines. */
export const ADD_JOB_LEAD = "Just the owner's details. Everything else goes in the Ready Check form in Mitti.";
export const ADD_JOB_DETAIL = "Enter the details perfectly and in full — they carry onto the quote and all the paperwork.";
/** Mock-up M3 "what happens next" (decisions 115, 163). */
export const WHAT_HAPPENS_NEXT = "The Ready Check form appears in your Mitti app within about 15 minutes. Press Complete in Mitti only when it's fully finished — that sends the owner their quote. Your typed details stay on your phone if the signal drops.";

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

/** Save button wording: says what the tap really does — saving is not booking and not an open form. */
export const SAVE_LABEL = "Add job";
export const BUSY_LABEL = "Saving…";

/** Jo 25 Oct: errors say why. The "customer who isn't yours" message names no other owner or business; raw database
 *  collisions (unique-key text) still become one neutral line. */
export const NEUTRAL_SAVE_ERROR = "Job not added. Please contact the office for help; your entered details are kept.";
export function saveErrorMessage(msg: string | null | undefined): string {
  const m = msg ?? "";
  if (/customer who isn't yours/i.test(m)) return m;
  if (/already on another customer record|owners_email_uq|duplicate key/i.test(m)) return NEUTRAL_SAVE_ERROR;
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

// ---- Decision 116 (Jo 24 Oct): ONE optional field at the end — "Ready Check visit day and time (optional)". ----
export const VISIT_FIELD_LABEL = "Ready Check visit day and time (optional)";
export const VISIT_FIELD_NOTE = "You arrange the visit with the owner. Enter the day and time here and it goes on your day list, with the Mitti form link in the 6:30am text. Leave it blank and nothing is booked — you can add it on the job later. The owner isn't messaged.";
/** Mock-up M3 short hint under the field. */
export const VISIT_FIELD_HINT = "Skip it or fill it. A time puts the visit in your 6:30am text. No time = no reminder.";
/** Day dropdown option: "Mon 26 Oct". */
export function dayOptionLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
}
export type VisitPick = { day: string; time: string };
/** Blank = nothing booked. A day without a time (or vice versa) is incomplete, never guessed. */
export function visitPayload(v: VisitPick): VisitPick | null {
  return v.day && v.time ? { day: v.day, time: v.time } : null;
}
export function visitProblems(v: VisitPick): string[] {
  if (!v.day && !v.time) return [];
  if (!v.day || !v.time) return ["Choose both the visit day and the arrival time, or leave both blank"];
  return [];
}
export function visitSummary(v: VisitPick): string {
  const p = visitPayload(v);
  if (!p) return "Visit day and time: not entered (you can add it on the job)";
  const d = new Date(`${p.day}T00:00:00`);
  const day = Number.isNaN(d.getTime()) ? p.day : d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  return `Ready Check visit: ${day}, ${installTimeLabel(p.time)}`;
}

/** Review-summary wording: positive only when the same rule final validation uses is satisfied (restored drafts reset these on purpose). */
export const contactPermissionSummary = (c: Pick<OnsiteInput, "contact_permission" | "consent_by">) =>
  c.contact_permission === true && c.consent_by === "installer" ? "Permission to contact given" : "Contact permission still needs to be ticked";
export const organiseSummary = (coord: "hivic_managed" | "self_managed" | string | null, selfAck: boolean) =>
  coord === "self_managed"
    ? selfAck ? "I’ll manage the job myself (responsibility acknowledged)" : "I’ll manage the job myself — responsibility still needs to be ticked"
    : coord ? "Home Insulation Victoria manages the process" : "Who organises the job still needs to be chosen";

// ---- What the installer sees after saving (decisions 115/116): the real outcome from the server's own answer. ----
export type AddJobBooking = "none" | "confirmed" | "blocked";
export type Outcome = { tone: "success" | "waiting" | "blocked"; heading: string; body: string; waitingOn: string | null; visit: string | null };
export const FORM_WITHIN_15 = "Your Ready Check form is being set up in Mitti, with the owner's details filled in. It appears within about 15 minutes.";
export function outcomeFor(r: { booking: AddJobBooking; state: OnsiteState | undefined }): Outcome {
  const visit = r.booking === "confirmed" ? "Visit day and time saved — it's in your 6:30am text with the form link."
    : r.booking === "blocked" ? "The visit day and time couldn't be saved. The job is saved; enter the time on the job." : null;
  const s = r.state;
  if (s?.kind === "open") return { tone: "success", heading: "Job saved — your Ready Check form is ready", body: "Open it in Mitti when you're at the home.", waitingOn: null, visit };
  if (s?.kind === "preparing") return { tone: "waiting", heading: "Job saved", body: FORM_WITHIN_15, waitingOn: null, visit };
  return { tone: "blocked", heading: "Job saved — form not ready yet", body: `${s?.message ?? "The form couldn't be prepared."} You don't need to add the job again.`, waitingOn: s?.kind === "owner_paperwork" ? "The owner" : s?.kind === "retry" && /signal|answering/i.test(s.message) ? null : "Home Insulation Victoria", visit };
}

// ---------- Heavier Add a job (approved 24 Oct 2026, decision 237): error state + "Job added" screen. Presentation only. ----------
export type AddJobField = "full_name" | "address" | "phone" | "email" | "permission" | "visit";
/** One short red line per field from the existing validator messages (validation itself is unchanged). */
export function fieldErrors(problems: string[]): Partial<Record<AddJobField, string>> {
  const out: Partial<Record<AddJobField, string>> = {};
  for (const p of problems) {
    if (/full name|first and last|owner's name/i.test(p)) out.full_name ??= "Enter the owner's first and last name.";
    else if (/mobile/i.test(p)) out.phone ??= /Check the mobile/i.test(p) ? "That doesn't look like a mobile number." : "Enter the owner's mobile.";
    else if (/email/i.test(p)) out.email ??= /Check the email/i.test(p) ? "That doesn't look like an email address." : "Enter the owner's email.";
    else if (/permission/i.test(p)) out.permission ??= "Tick this once the owner has agreed.";
    else if (p === PICK_ADDRESS || /address|street|suburb|postcode|Victorian/i.test(p)) out.address ??= /Victorian jobs|postcode list/i.test(p) ? p.replace(/ — .*$/, ".") : "Pick the address from the list.";
    else out.visit ??= p.replace(/\.?$/, ".");
  }
  return out;
}
/** "3 things to fix before the job can be added." */
export function errorSummary(n: number): string | null {
  return n <= 0 ? null : `${n} thing${n === 1 ? "" : "s"} to fix before the job can be added.`;
}
export const ADD_JOB_OFFLINE_NOTE = "Your typed details stay on your phone if the signal drops.";
export const VISIT_CARD = { title: "Ready Check visit (optional)", sub: "Only if you've already agreed a time with the owner." } as const;
export const OWNER_CARD_TITLE = "Owner";

/** The approved "Job added" screen: tick header, Mitti card, what we do now, two links. Every fact comes from the save result. */
export type AddedView = { heading: string; line1: string; line2: string; card: { title: string; body: string; button: "Open Mitti form" | "Try again" | null }; steps: string[]; goToJob: string; addAnother: string };
export function addedView(r: { jobNumber: string | null; address: string; ownerName: string; phone: string; ownerFirstName: string | null; booking: AddJobBooking; visit: VisitPick; state: OnsiteState | undefined }): AddedView {
  const owner = r.ownerFirstName ?? "the owner";
  const visit = r.booking === "confirmed" && visitPayload(r.visit) ? `Ready Check ${dayOptionLabel(r.visit.day)} at ${installTimeLabel(r.visit.time)} — it's in your 6:30am text. ` : r.booking === "blocked" ? "The visit day and time couldn't be saved — enter it on the job. " : "";
  const s = r.state;
  const card = s?.kind === "open"
    ? { title: "Your Ready Check form is ready in Mitti", body: `${visit}Fill in as much as you can at the visit. Press Complete only when it's fully finished — that sends ${owner} their quote.`, button: "Open Mitti form" as const }
    : s?.kind === "preparing" || !s
      ? { title: "Your Ready Check form is being set up in Mitti", body: `${visit}It appears within about 15 minutes. Press Complete only when it's fully finished — that sends ${owner} their quote.`, button: null }
      : { title: "Job added — form not ready yet", body: `${s.message} You don't need to add the job again.`, button: s.kind === "retry" ? "Try again" as const : null };
  return {
    heading: "Job added",
    line1: [r.jobNumber, r.address].filter(Boolean).join(" · "),
    line2: [r.ownerName, r.phone].filter(Boolean).join(" · "),
    card,
    steps: [`Nothing is sent to ${owner} until you press Complete.`, "We prepare the quote from your Ready Check and the price you enter on the job page, plus our $349 fee.", `We arrange the electrical safety check once ${owner} accepts.`],
    goToJob: "Go to the job", addAnother: "Add another job",
  };
}
