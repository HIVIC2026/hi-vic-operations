// Owner "My job" page (Jo-approved 5 Oct). Pure presentation: labels existing facts, never moves a job.
import { houseLevelForStage, type HouseLevel } from "./owner-house.core";
import { stageWording } from "./job-wording";
import { ownerHeadline, type OwnerHeadlineStep } from "./owner-headlines.core";
import { spotReleaseState, type SpotReleaseEventRow } from "./spot-release.core";

export const OWNER_STEPS = ["Ready Check", "Quote", "PIESA", "Install", "Done"] as const;
/** Decision 389: "turn" = the "It's your turn" page (O77's link): confirm the free Ready Check, or no longer interested.
 *  Batch 3a: "newquote" = O78's "Send me a new quote" button (new-quote-request.*).
 *  Part 4 T5: "clear" = confirm, sign and pay (the PIESA owner declarations, the ESC consent and the 50% deposit on one page).
 *  Part 4 T11: "finish" = sign the rebate form and pay the balance (the All done email's link, ?screen=finish).
 *  A48 batch 2: "taps" = the quick taps (quick-taps.*): name, address, hatch, roof, 5 years, "Yes, let's go". */
export type OwnerScreen = "home" | "spot" | "quote" | "pay" | "piesa" | "veec" | "book" | "done" | "review" | "fixes" | "turn" | "newquote" | "taps" | "clear" | "finish";
export function currentOwnerAction(facts: Record<Exclude<OwnerScreen,'home'|'done'|'finish'>,boolean>): Exclude<OwnerScreen,'home'|'done'|'finish'> | null {
  const priority = ['newquote','turn','taps','quote','clear','fixes','pay','piesa','veec','book','spot','review'] as const;
  return priority.find(action=>facts[action]) ?? null;
}
/** Part 4 Task 14 (Jo 2 Nov 2026): the old fixes and pick-a-day screens open ONLY for a job still mid-way through that step
 *  (its current action); any other old link falls through to the job's current single-action screen. */
const OLD_STEP_SCREENS: readonly OwnerScreen[] = ['fixes', 'book'];
export function resolveOwnerScreen(screen: OwnerScreen | undefined, facts: { currentAction?: Exclude<OwnerScreen, 'home' | 'done'> | null; clearStepsUnsigned?: boolean; piesaConfirm?: boolean }): Exclude<OwnerScreen, 'home'> | 'all_set' {
  // Old links to the pay / PIESA screens land on the one confirm-and-pay page while a step there is still unsigned.
  if ((screen === 'pay' || screen === 'piesa') && facts.currentAction === 'clear' && facts.clearStepsUnsigned === true) return 'clear';
  // G8 (4), LOOKS WRONG (8): ?screen=piesa before there is a safety check to confirm is blank → the job's current screen.
  if (screen === 'piesa' && facts.piesaConfirm === false && facts.currentAction !== 'piesa') return facts.currentAction ?? 'all_set';
  // G8 (4), LOOKS WRONG (13): an old "It's your turn" link (?screen=turn) while the quick taps are the live step → the taps.
  if (screen === 'turn' && facts.currentAction === 'taps') return 'taps';
  if (screen && OLD_STEP_SCREENS.includes(screen) && facts.currentAction !== screen) return facts.currentAction ?? 'all_set';
  if (screen && screen !== 'home') return screen;
  return facts.currentAction ?? 'all_set';
}

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
  /** The job's installer business (trading name), for the "will call you" line. */
  installerName?: string | null;
};

/** DRAFT (Part 4 Task 14 fix round 1, Jo to approve — JO-APPROVAL-LIST): the install-scheduling line on My job; the old
 *  "Choose your install date" is retired because the installer calls to book (touchpoint 46 / answer 21). */
export const INSTALLER_WILL_CALL_TO_BOOK_DRAFT = (installer: string | null | undefined) => `${installer?.trim() || "Your installer"} will call you to book your install day.`; // DRAFT
/** DRAFT (Part 4 Task 15, Jo to approve — JO-APPROVAL-LIST): the PIESA-booking line on My job, from decision 34's approved
 *  O22 line "{Installer}'s licensed electrician will call you to book it."; the old "Choose times for your PIESA" is retired
 *  because the electrician calls to book (nobody picks times on the page). */
export const ELECTRICIAN_WILL_CALL_TO_BOOK_DRAFT = (installer: string | null | undefined) => `${installer?.trim() || "Your installer"}'s licensed electrician will call you to book it.`; // DRAFT

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).replace(":00", "").replace(" ", "");
export const visitPill = (iso: string) => `${fmtDay(iso)} · ${fmtTime(iso)}`;

export function ownerAction(f: OwnerFacts): OwnerAction {
  const s = f.stage;
  const none = (title: string, sentence: string, pill: string | null = null): OwnerAction => ({ kicker: "Nothing for you to do", title, sentence, pill, button: null });
  const todo = (title: string, sentence: string, label: string, screen: OwnerScreen, pill: string | null = null): OwnerAction => ({ kicker: "You need to do this", title, sentence, pill, button: { label, screen } });
  if (s === "complete") return none(stageWording("complete").owner!, "Your insulation is in and the paperwork is finished.");
  if (s === "cancelled") return none(OWNER_CLOSED_HEADLINE, "Got a question? Message us.");
  if (s === "on_hold") return none(stageWording("on_hold").owner!, "We'll let you know as soon as it's moving again.");
  if (f.visit) return none(f.visit.kind === "installation" ? stageWording("installation_booked").owner! : f.visit.kind === "ready_check" ? stageWording("ready_check_scheduled").owner! : f.visit.kind === "rectification" ? stageWording("rectification_booked").owner! : stageWording("piesa_scheduled").owner!, "We'll text you the day before.", visitPill(f.visit.startsAt));
  if (f.quoteOpen) return todo(stageWording("measured_estimate_ready").owner!, "Have a look at your quote and say yes when you're ready.", "See my quote", "quote", f.quoteOpen.expiresAt ? `Please approve by ${fmtDay(f.quoteOpen.expiresAt)}` : null);
  // Part 4 Tasks 14/15 (Jo 2 Nov 2026): the trades call the owner to book; the owner never picks times on the page. Each stage
  // keeps its own line, except the two retired "choose" lines: installation_scheduling's "Choose your install date" and
  // piesa_and_install_window_pending's "Choose times for your PIESA" → DRAFT "will call you" lines (decision 34).
  if (f.bookingOpen) return none(s === "installation_scheduling" ? INSTALLER_WILL_CALL_TO_BOOK_DRAFT(f.installerName) : s === "piesa_and_install_window_pending" ? ELECTRICIAN_WILL_CALL_TO_BOOK_DRAFT(f.installerName) : stageWording(s).owner ?? stageWording("measured_quote_accepted").owner!, "We'll be in touch with your next step.");
  if (["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance"].includes(s) && !f.readyCheckRequested)
    // Decision 388: before release, spot-only wording (no Ready Check, times or speed).
    return todo("Save your spot", "It's free, with no obligation. Spots are released in the order they were saved.", "Save my spot", "spot");
  if (["ready_check_ready_to_schedule", "ready_check_awaiting_payment"].includes(s) || f.readyCheckRequested && houseLevelForStage(s) === 0) return none(stageWording("ready_check_ready_to_schedule").owner!, "We'll be in touch with your next step.");
  if (houseLevelForStage(s) === 2) return none(stageWording("ready_check_complete").owner!, "It usually takes a day or two.");
  if (["evidence_outstanding", "ap_review", "ready_for_veec"].includes(s)) return none(stageWording("evidence_outstanding").owner!, "You don't need to do anything.");
  return none("We're on it", "We'll let you know when there's something for you.");
}

/** A cancelled or archived job is closed for the owner. */
export const OWNER_CLOSED_HEADLINE = "This job is closed";
export function ownerStage(stage: string, deletedAt: string | null): string { return deletedAt ? "cancelled" : stage; }

export function ownerHero(stage: string, rebate: number): { level: HouseLevel; headline: string; step: number; closed: boolean } {
  const level = houseLevelForStage(stage);
  if (stage === "cancelled") return { level, headline: OWNER_CLOSED_HEADLINE, step: -1, closed: true };
  return { level, headline: ownerHeadline(HEADLINE_BY_LEVEL[level]!, rebate), step: ownerStepIndex(stage), closed: false };
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
  // Decision 388: the step after "Spot saved" is the release, never a Ready Check promise.
  { label: "Spot released", sub: "Spots are released in the order they were saved. We'll be in touch when your spot is released." },
  { label: "Your quote", sub: "Rebate taken off" },
  { label: "PIESA", sub: "Pre Insulation Electrical Safety Assessment by a licensed electrician" },
  { label: "Install", sub: "" },
  { label: "Done", sub: "" },
] as const;
/** Spot-saved page once the spot is released (Jo, 29 Oct, HV-3542): no "waiting" lines, "Spot released" ticked, quote is current. */
/** Released for the page = the latest release is waiting on the owner or confirmed. Lapsed = back on the waiting list. */
export const spotReleasedForPage = (events: readonly SpotReleaseEventRow[]) => ["pending", "confirmed"].includes(spotReleaseState(events).state);
export function spotSavedLayout(released: boolean) {
  return released
    ? { stepLabel: "Step 2 of 6", showWaitingBox: false, doneSub: null, currentIndex: 2, showReleasedSub: false }
    : { stepLabel: "Step 1 of 6", showWaitingBox: true, doneSub: "Nothing else to do until your spot is released.", currentIndex: 1, showReleasedSub: true };
}
export function isSpotSavedStage(stage: string, spot: { spot_saved_at: string | null; opted_out_at: string | null } | null, readyCheckBooked: boolean) {
  return !!spot?.spot_saved_at && !spot.opted_out_at && !readyCheckBooked && (SPOT_SAVED_STAGES as readonly string[]).includes(stage);
}
/** Gate A to-do card: "todo" until every Gate A document is done, then "done". */
export const gateACard = (todo: { gate: string }[]) => (todo.some((t) => t.gate === "A") ? "todo" as const : "done" as const);

/** Stages from which the owner can no longer cancel from My job: the safety check is booked or later. */
const NO_OWNER_CANCEL = new Set(["piesa_scheduled", "piesa_complete", "electrical_variation_pending", "rectification_required", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec", "complete", "cancelled", "on_hold"]);
/** Plain "Cancel my job" (Jo, 6 Oct): offered only until the safety check is booked or paid. No cooling-off period. */
export function ownerCanCancel(stage: string, bookingKinds: string[], safetyCheckPaid: boolean): boolean {
  if (safetyCheckPaid || NO_OWNER_CANCEL.has(stage)) return false;
  return !bookingKinds.includes("assessment");
}

// ---- A48 batch 1 final fix (Jo 29 Oct 2026): the owner uploads the life support consent / medical plan on My job ----
/** Photo or PDF, the same owner upload size limit as the owner photo/video uploads (job-files bucket). */
export const LIFE_SUPPORT_PLAN_MAX_BYTES = 200 * 1024 * 1024;
export const LIFE_SUPPORT_PLAN_SOURCE = "owner_life_support";
const LS_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp" };
const LS_EXT: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp" };
/** The file's type (phones sometimes send an empty type: fall back to a known extension), or null. */
export function lifeSupportPlanType(mime: string | null | undefined, fileName: string | null | undefined): string | null {
  const m = (mime ?? "").toLowerCase().split(";")[0]!.trim();
  if (LS_TYPES[m]) return m === "image/jpg" ? "image/jpeg" : m;
  if (m && m !== "application/octet-stream") return null;
  return LS_EXT[(fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ""] ?? null;
}
/** Jo-approved error lines for this card only (29 Oct 2026), verbatim. */
export const LIFE_SUPPORT_PLAN_WRONG_TYPE = "Please upload a photo or PDF.";
export const LIFE_SUPPORT_PLAN_TOO_BIG = "That file is too big. Please upload a smaller photo or PDF.";
export function validateLifeSupportPlanFile(x: { mime: string | null; fileName: string | null; size: number }): { ok: true; mime: string } | { ok: false; error: string } {
  const mime = lifeSupportPlanType(x.mime, x.fileName);
  if (!mime) return { ok: false, error: LIFE_SUPPORT_PLAN_WRONG_TYPE };
  if (!Number.isFinite(x.size) || x.size <= 0) return { ok: false, error: "That file looks empty. Please try again." };
  if (x.size > LIFE_SUPPORT_PLAN_MAX_BYTES) return { ok: false, error: LIFE_SUPPORT_PLAN_TOO_BIG };
  return { ok: true, mime };
}
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const lifeSupportPlanPath = (jobId: string, uploadId: string, mime: string) => `${jobId}/owner-life-support/${uploadId}.${LS_TYPES[mime] ?? "bin"}`;
/** Server-side check that a client-returned path belongs to THIS link's job. Returns the upload id or null. */
export function parseLifeSupportPlanPath(jobId: string, path: unknown): string | null {
  if (typeof path !== "string") return null;
  const m = path.match(new RegExp(`^(${UUID_RE})/owner-life-support/(${UUID_RE})\\.(pdf|jpg|png|heic|heif|webp)$`));
  return m && m[1] === jobId ? m[2]! : null;
}

/** G8 (6), 4 Nov 2026 (LOOKS WRONG 12): the owner's line when the quote can't be accepted yet because the office setup is
 *  missing a template (the office sees why on Needs me). DRAFT. */
export const QUOTE_NOT_READY_OWNER_LINE = "This quote isn't ready to accept yet — we'll email you when it is.";

// ---- G8 (4), Jo 4 Nov 2026 ("show the next visit"): the booked visit on the all-set screen -------------------------------
/** "Tue 10 Nov, 10:00am" in Melbourne time. */
export function visitWhen(startsAt: string): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startsAt))) p[x.type] = x.value;
  const h = Number(p["hour"]) % 24;
  return `${p["weekday"]} ${p["day"]} ${p["month"]}, ${h % 12 === 0 ? 12 : h % 12}:${p["minute"]}${h < 12 ? "am" : "pm"}`;
}
/** DRAFT wording (listed on JO-APPROVAL-LIST): the visit's name, when, who is coming, and the one note for the install. */
export const NEXT_VISIT_WORDS = {
  ready_check: "Your Ready Check",
  assessment: "Your electrical safety check (PIESA)",
  rectification: "Your electrical upgrades",
  installation: "Your insulation install",
  installNote: "Someone 18 or over needs to be home.",
} as const;
export type NextVisitCard = { title: string; line: string; note: string | null };
/** The next booked visit, e.g. "Your electrical safety check (PIESA): Tue 10 Nov, 10:00am — Will from Rapid Insulation" /
 *  "Your insulation install: Mon 9 Nov, 8:00am — Rapid Insulation" (+ the 18-or-over note). A visit kind this page doesn't
 *  name, or no day, = null. The person is named on the electrical visits only (the business runs the install day). */
export function nextVisitCard(v: { kind: string; startsAt: string | null; person: string | null; company: string | null }): NextVisitCard | null {
  const title = (NEXT_VISIT_WORDS as Record<string, string>)[v.kind];
  if (!title || !v.startsAt || !Number.isFinite(Date.parse(v.startsAt))) return null;
  const electrical = v.kind === "assessment" || v.kind === "rectification";
  const person = (v.person ?? "").trim();
  const company = (v.company ?? "").trim();
  const who = electrical && person && !/^your /i.test(person) ? (company ? `${person} from ${company}` : person) : company || null;
  return { title, line: `${visitWhen(v.startsAt)}${who ? ` — ${who}` : ""}`, note: v.kind === "installation" ? NEXT_VISIT_WORDS.installNote : null };
}
