// Constants and a few tiny pure helpers that the installer (trade) screens need, kept here with NO imports so the
// screens do not download the email, MJML, official-form, onboarding-agreement or Mitti code that used to own them
// (speed: installer screens towards 1 second, task 2). Each old home re-exports its constant, so every other importer
// is unchanged and the values are byte-identical. tests/trade-import-graph.test.ts keeps the trade screens off those modules.

/** esc-collection-notice.core.ts: plain message shown wherever an unacknowledged person is refused as lead or crew. */
export const COLLECTION_NOTICE_BLOCK_MESSAGE = "ESC privacy collection notice not acknowledged — this person can't be listed as lead or crew until they open their link and acknowledge it.";

/** mitti-invite.core.ts (also worker-role.core.ts as CREW_NO_MITTI). */
export const CREW_SKIP = "Crew aren't invited automatically — the office adds them to Mitti by hand.";

/** rec-onboarding.core.ts: least public liability cover for an electrician who does not work under a REC. */
export const MIN_REC_PL_COVER = 5_000_000;

/** fixes-day.core.ts: the short link label on the electrician's job page. */
export const FIXES_FORM_LINK_LABEL = "Fixes form in Mitti";

/** Same text as PIESA_FULL in job-wording.ts (a test keeps them equal); repeated so this file has no imports. */
const PIESA_FULL_TEXT = "Pre Insulation Electrical Safety Assessment (PIESA)";
/** piesa-owner-confirm.core.ts: installer job page "Next" line while the owner has not confirmed. */
export const OWNER_PIESA_CONFIRM_WAITING = `Waiting for the owner to confirm the ${PIESA_FULL_TEXT}`;

/**
 * portal-presentation.core.ts: dropdown menu placement (More / Actions): the menu's left offset from its button.
 * Start-aligned on the button, flipped to the button's end edge when it would run past the right of the viewport,
 * then clamped so it keeps an 8px gutter on both sides.
 */
export function menuOffset(i: { anchorLeft: number; anchorWidth: number; menuWidth: number; viewportWidth: number }, gutter = 8): number {
  const w = Math.min(i.menuWidth, i.viewportWidth - 2 * gutter);
  let left = 0;
  if (i.anchorLeft + w > i.viewportWidth - gutter) left = i.anchorWidth - w;
  if (i.anchorLeft + left < gutter) left = gutter - i.anchorLeft;
  return Math.round(left);
}

// ---- rec-onboarding.core.ts: address checks used by the address box on the trade screens ----
export type ResolvedAddress = {
  label: string; street?: string | null; suburb?: string | null; postcode?: string | null;
  state?: string | null; country: "AU"; provider: "google_places_au"; latitude?: number | null; longitude?: number | null;
};
const stateCode = (state?: string | null) => (state ?? "").trim().toUpperCase();
const AU_STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
export const isAustralianAddress = (address?: ResolvedAddress | null) => !!address && address.provider === "google_places_au" && address.country === "AU" && AU_STATES.has(stateCode(address.state)) && /^\d{4}$/.test(address.postcode ?? "");
export const isVictorianAddress = (address?: ResolvedAddress | null) => isAustralianAddress(address) && ["VIC", "VICTORIA"].includes(stateCode(address?.state));
/**
 * The address lookup sometimes returns details without the house/unit number
 * the chosen suggestion showed (e.g. "3/12 Smith St, …" → "Smith St, …").
 * Keep the number from the suggestion the person picked; never add one from free text.
 */
const STREET_ABBR: Record<string, string> = { street: "st", road: "rd", avenue: "ave", drive: "dr", court: "ct", place: "pl", crescent: "cres", parade: "pde", highway: "hwy", boulevard: "blvd", terrace: "tce", lane: "ln", close: "cl", grove: "gr", circuit: "cct", square: "sq" };
const normStreet = (v: string) => v.toLowerCase().replace(/[.]/g, "").split(/\s+/).filter(Boolean).map((w) => STREET_ABBR[w] ?? w).join(" ");
export function keepPickedNumber(suggestionLabel: string, details: ResolvedAddress): ResolvedAddress {
  const pickedFirst = (suggestionLabel.split(",")[0] ?? "").trim();
  const detailFirst = (details.label.split(",")[0] ?? "").trim();
  if (!pickedFirst || !detailFirst || /\d/.test(detailFirst)) return details;
  const m = pickedFirst.match(/^((?:(?:unit|apt|shop|suite|level|lot)\s*)?\d[\w-]*(?:\s*\/\s*\d[\w-]*)?)\s+(.+)$/i);
  if (!m) return details;
  const prefix = m[1]!.trim();
  if (normStreet(m[2]!) !== normStreet(detailFirst)) return details;
  const label = `${prefix} ${details.label.trim()}`;
  const street = details.street && !/\d/.test(details.street) ? `${prefix} ${details.street}` : details.street ?? null;
  return { ...details, label, street };
}

// ---- enquiry.core.ts: the owner's insulation answers as one line (job screen) ----
export type InsulationDetail = {
  insulation_type: "batts" | "loose_fill" | "foil" | "unknown" | null;
  insulation_thickness: "thin" | "hand" | "thicker" | "unknown" | null;
  insulation_coverage: "whole" | "partial" | "unknown" | null;
};

const DETAIL_WORDS: Record<string, string> = { batts: "batts", loose_fill: "loose fill", foil: "foil", thin: "thin", hand: "about a hand thick", thicker: "thicker than a hand", whole: "whole ceiling", partial: "patchy" };
/** "loose fill, thin, patchy" — null when the owner gave none of the three answers. */
export function insulationDetailText(d: Partial<InsulationDetail> | null | undefined): string | null {
  if (!d) return null;
  const parts = [d.insulation_type, d.insulation_thickness, d.insulation_coverage].map((v) => (v ? (v === "unknown" ? "not sure" : DETAIL_WORDS[v] ?? v) : null));
  return parts.every((p) => p == null) ? null : parts.map((p) => p ?? "not answered").join(", ");
}

// ---- install-attendance.core.ts: what the electrician's install-day attendance card needs ----
export const ATTENDANCE_ANCHOR = "install-attendance";
/** The electrician gives 1–5 days they can do: the same value as OWNER_SUGGEST_MAX in install-days.core (a test keeps them equal). */
export const ATTENDANCE_MAX_DAYS = 5;
export const ATTENDANCE_YES = "I'll be there";
export const ATTENDANCE_NO = "Can't make it";

// ---- "Can't make it": reason + the days they can do ----
export const ATTENDANCE_REASONS = { sick: "Sick", another_job: "Another job", short_notice: "Too short notice", other: "Other" } as const;
export type AttendanceReason = keyof typeof ATTENDANCE_REASONS;
export const isAttendanceReason = (x: unknown): x is AttendanceReason => typeof x === "string" && x in ATTENDANCE_REASONS;
/** What the installer reads in brackets: the label, or the electrician's own words for Other. */
export function attendanceReasonLabel(reason: AttendanceReason, text: string | null | undefined): string {
  return reason === "other" ? (text?.trim() || ATTENDANCE_REASONS.other) : ATTENDANCE_REASONS[reason];
}

/** "Can't make it" input check. `allowed` = install days still inside the 30-day window (install-days.core
 *  `allowedInstallDays`); `bookedDay` = the Melbourne day being released (never offered back). `noDays` = "I can't do any
 *  day before the window closes" (the only path that raises an office row straight away). */
export function declineBlockers(f: { reason: unknown; otherText?: string | null; days: string[]; noDays: boolean; allowed: string[]; bookedDay: string | null }): string[] {
  const b: string[] = [];
  if (!isAttendanceReason(f.reason)) b.push("Please pick a reason.");
  else if (f.reason === "other" && !f.otherText?.trim()) b.push("Please say why.");
  if (f.noDays) { if (f.days.length) b.push("Pick days you can do, or tick that you can't do any day — not both."); return b; }
  const uniq = new Set(f.days);
  if (uniq.size !== f.days.length) b.push("Each day can only be chosen once.");
  if (uniq.size < 1) b.push("Please pick at least 1 day you can do.");
  if (uniq.size > ATTENDANCE_MAX_DAYS) b.push(`Please pick no more than ${ATTENDANCE_MAX_DAYS} days.`);
  if ([...uniq].some((d) => d === f.bookedDay)) b.push("Pick days other than the day you can't make.");
  if ([...uniq].some((d) => !f.allowed.includes(d))) b.push("One of those days is outside the 30-day window or too soon. Please choose again.");
  return b;
}


// ---- enquiry.core.ts: owner-declared answers read by eligibility.core (run screen) ----
// Base44 stores the homeowner answers under `answers.insulation` and `answers.top_floor`;
// older/alternative spellings are kept as fallbacks only.
export const EXISTING_INSULATION_KEYS = ["insulation", "declared_existing_insulation", "existing_insulation", "has_existing_insulation", "current_insulation"];
const TOP_FLOOR_KEYS = ["top_floor", "declared_top_floor", "is_top_floor", "top_floor_unit", "top_storey"];
export const answerText = (v: unknown): string | null => {
  if (v === true) return "yes"; if (v === false) return "no";
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
  return null;
};
/** Owner-declared existing insulation / top-floor answers from the Base44 answer snapshot (declared, never verified). */
export function declaredExtras(answers: Record<string, unknown> | null | undefined) {
  const pick = (keys: string[]) => { for (const k of keys) { const t = answerText(answers?.[k]); if (t) return t; } return null; };
  return { existing_insulation: pick(EXISTING_INSULATION_KEYS), top_floor: pick(TOP_FLOOR_KEYS) };
}

// ---- mitti.core.ts: text normaliser (swms.core, run on the safety plan card) ----
export const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/²/g, "2").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

// ---- fixes-times.core.ts ----
export const FIXES_TIMES_ANCHOR = "fixes-times";
