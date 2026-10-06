// Owner "My job" page (Jo-approved 5 Oct). Pure presentation: labels existing facts, never moves a job.
import { houseLevelForStage, type HouseLevel } from "./owner-house.core";
import { ownerHeadline, type OwnerHeadlineStep } from "./owner-headlines.core";

export const OWNER_STEPS = ["Ready Check", "Quote", "Safety check", "Install", "Done"] as const;
export type OwnerScreen = "home" | "spot" | "quote" | "book" | "done";

const HEADLINE_BY_LEVEL: OwnerHeadlineStep[] = ["spot_saved", "ready_check_booked", "quote_ready", "booking_visits", "install_booked", "all_done"];

/** 0-based index into OWNER_STEPS for the job's current step. */
export function ownerStepIndex(stage: string): number {
  if (stage === "complete") return 4;
  if (["evidence_outstanding", "ap_review", "ready_for_veec", "installation_scheduling", "installation_booked"].includes(stage)) return 3;
  const lv = houseLevelForStage(stage);
  if (lv >= 3) return 2;
  if (lv === 2) return 1;
  return 0;
}

export type OwnerAction = { kicker: "You need to do this" | "Nothing for you to do"; title: string; sentence: string; pill: string | null; button: { label: string; screen: OwnerScreen } | null };

export type OwnerFacts = {
  stage: string;
  readyCheckRequested: boolean;
  visit: { kind: string; startsAt: string } | null;
  quoteOpen: { expiresAt: string | null } | null;
  bookingOpen: boolean; // payment option cleared + owner still needs to give times
  approveBy?: string | null;
};

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).replace(":00", "").replace(" ", "");
export const visitPill = (iso: string) => `${fmtDay(iso)} · ${fmtTime(iso)}`;

export function ownerAction(f: OwnerFacts): OwnerAction {
  const s = f.stage;
  const none = (title: string, sentence: string, pill: string | null = null): OwnerAction => ({ kicker: "Nothing for you to do", title, sentence, pill, button: null });
  const todo = (title: string, sentence: string, label: string, screen: OwnerScreen, pill: string | null = null): OwnerAction => ({ kicker: "You need to do this", title, sentence, pill, button: { label, screen } });
  if (s === "complete") return none("All done", "Your insulation is in and the paperwork is finished.");
  if (s === "cancelled") return none("This job is closed", "Got a question? Message us.");
  if (s === "on_hold") return none("We're sorting something out", "We'll let you know as soon as it's moving again.");
  if (f.visit) return none(f.visit.kind === "installation" ? "Your install is booked" : f.visit.kind === "ready_check" ? "Your Ready Check is booked" : "Your safety check is booked", "We'll text you the day before.", visitPill(f.visit.startsAt));
  if (f.quoteOpen) return todo("Approve your price", "Have a look at your exact price and say yes when you're ready.", "See my price", "quote", f.quoteOpen.expiresAt ? `Please approve by ${fmtDay(f.quoteOpen.expiresAt)}` : null);
  if (f.bookingOpen) return todo("Pick your visit times", "Choose the times that suit you for the safety check and the install.", "Pick times", "book");
  if (["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance"].includes(s) && !f.readyCheckRequested)
    return todo("Save your spot", "Pick at least 3 times for your free Ready Check.", "Save my spot", "spot");
  if (["ready_check_ready_to_schedule", "ready_check_awaiting_payment"].includes(s) || f.readyCheckRequested && houseLevelForStage(s) === 0) return none("We're lining up your visit", "We'll text you once a time is locked in.");
  if (houseLevelForStage(s) === 2) return none("We're working out your exact price", "It usually takes a day or two.");
  if (["evidence_outstanding", "ap_review", "ready_for_veec"].includes(s)) return none("Your insulation is in", "We're finishing the paperwork. You don't need to do anything.");
  return none("We're on it", "We'll let you know when there's something for you.");
}

export function ownerHero(stage: string, rebate: number): { level: HouseLevel; headline: string; step: number } {
  const level = houseLevelForStage(stage);
  return { level, headline: ownerHeadline(HEADLINE_BY_LEVEL[level]!, rebate), step: ownerStepIndex(stage) };
}

/** Earliest allowed install date after a safety check, from the office gap setting (days). */
export function earliestInstall(piesaDate: string, gapDays: number): string {
  const d = new Date(`${piesaDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.floor(gapDays)));
  return d.toISOString().slice(0, 10);
}
export const DEFAULT_PIESA_INSTALL_GAP_DAYS = 2;
/** Install must be within 30 days of the safety check (PIESA rule). */
export function installDeadline(piesaDate: string): string { return earliestInstall(piesaDate, 30); }

export const TWO_HOUR_WINDOWS = ["8–10am", "10am–12", "12–2pm", "2–4pm"] as const;
export const MIN_SPOT_PICKS = 3;

/** Stages where a saved spot is still waiting for an installer (before any Ready Check is booked). */
export const SPOT_SAVED_STAGES = ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_awaiting_payment", "ready_check_ready_to_schedule"] as const;
export const SPOT_SAVED_PROGRESS = [
  { label: "Spot saved", sub: "You're on the list" },
  { label: "Free Ready Check", sub: "We measure your roof space" },
  { label: "Your price", sub: "Exact quote, rebate taken off" },
  { label: "Safety check", sub: "A licensed electrician checks it's safe" },
  { label: "Install", sub: "About 4 hours" },
  { label: "Done", sub: "Lower bills for years" },
] as const;
export function isSpotSavedStage(stage: string, spot: { spot_saved_at: string | null; opted_out_at: string | null } | null, readyCheckBooked: boolean) {
  return !!spot?.spot_saved_at && !spot.opted_out_at && !readyCheckBooked && (SPOT_SAVED_STAGES as readonly string[]).includes(stage);
}
/** Gate A to-do card: "todo" until every Gate A document is done, then "done". */
export const gateACard = (todo: { gate: string }[]) => (todo.some((t) => t.gate === "A") ? "todo" as const : "done" as const);

/** Stages from which the owner can no longer cancel from My job: the safety check is booked or later. */
const NO_OWNER_CANCEL = new Set(["piesa_scheduled", "piesa_complete", "electrical_variation_pending", "rectification_required", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec", "complete", "cancelled", "on_hold"]);
/** Plain "Cancel my job" (Jo, 6 Oct): offered only until the safety check is booked. No cooling-off period. */
export function ownerCanCancel(stage: string, bookingKinds: string[]): boolean {
  if (NO_OWNER_CANCEL.has(stage)) return false;
  return !bookingKinds.includes("assessment");
}
