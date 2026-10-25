// Decision 389 (Jo, owner, 25 Oct 2026): owners only SAVE A SPOT. Jo releases spots herself, one at a time, to the
// installer she chooses (Jobs › Choose installer). Release records the chosen installer as a PENDING release and sends
// the OWNER "It's your turn" (email O77 + text); the installer is NOT contacted. Only when the owner presses Confirm on
// their secure My job page (`?screen=turn`) does the existing one-installer Ready Check offer run
// (officePickReadyCheckInstaller, unchanged). "I'm no longer interested" closes the spot. No reply: ONE reminder at day 2,
// at day 5 the release lapses → ONE Needs me row and the job is back on the waiting list. Nothing else is ever sent.
// A confirmed owner whose installer offer later comes back (Not for me / 24h) is NOT asked again: the next Release goes
// straight to the installer offer ("Owner confirmed — choose installer").
// Storage: append-only workflow_events (SPOT_RELEASE_EVENTS), one claim per job + release + slot (`spotReleaseKey`,
// unique index in pending migration docs/pending-migrations/spot-release-events.sql); confirm / decline / lapse share
// the ONE "outcome" slot so only one of them can ever win.
// PURE: no I/O. The email renderer lives in spot-release-email.core.ts (kit), I/O in spot-release.server.ts.
import { smsQuietReason } from "./quote-hold.core";

export const SPOT_RELEASED_EVENT = "spot_released";
export const SPOT_RELEASE_CONFIRMED_EVENT = "spot_release_confirmed";
export const SPOT_RELEASE_DECLINED_EVENT = "spot_release_declined";
export const SPOT_RELEASE_REMINDED_EVENT = "spot_release_reminded";
export const SPOT_RELEASE_LAPSED_EVENT = "spot_release_lapsed";
export const SPOT_RELEASE_EVENTS = [SPOT_RELEASED_EVENT, SPOT_RELEASE_CONFIRMED_EVENT, SPOT_RELEASE_DECLINED_EVENT, SPOT_RELEASE_REMINDED_EVENT, SPOT_RELEASE_LAPSED_EVENT] as const;
export type SpotReleaseEventType = (typeof SPOT_RELEASE_EVENTS)[number];

/** O77 email wording approval. false = real owners get nothing and Release on a REAL job refuses (TEST jobs work). */
export const SPOT_RELEASED_APPROVED = true; // Jo approved the O77 picture + text 25 Oct 2026 (decision 389)
/** The one real SMS sender type (sms.core `spot_released`, wordingApproved:false until Jo sees the rendered picture). */
export const SPOT_RELEASED_SMS_TYPE = "spot_released" as const;
export const SPOT_RELEASED_PURPOSE = "spot_released";
export const SPOT_RELEASE_UNAPPROVED = "The 'It's your turn' message isn't approved yet";

export const REMIND_AFTER_HOURS = 48; // day 2
export const LAPSE_AFTER_HOURS = 120; // day 5
const HOUR = 3_600_000;

/** Stored on the closed job when the owner says no on the release page (prior_stage kept, one stage_changed event). */
export const DECLINE_REASON = "No longer interested (owner, at release)";
/** The ONE Needs me row after a lapse. */
export const LAPSED_NEEDS_LINE = "Didn't confirm after release — release to someone else or leave";
/** Waiting list status for a confirmed owner with no open installer offer. */
export const OWNER_CONFIRMED_LINE = "Owner confirmed — choose installer";

// ---- keys --------------------------------------------------------------------------------------------------------

/** released = the release claim (and its first email + text); reminder = day 2; release_text = the release text sent at
 *  7am when Jo released during the 8pm–7am quiet hours; outcome = confirmed | declined | lapsed (only one can win). */
export type SpotReleaseSlot = "released" | "reminder" | "release_text" | "outcome";
export const spotReleaseKey = (jobId: string, seq: number, slot: SpotReleaseSlot) => `spot-release:v1:${jobId}:${seq}:${slot}`;

// ---- state from events -------------------------------------------------------------------------------------------

export type SpotReleaseEventRow = { event_type: string; created_at: string; details: unknown };
type Details = {
  release_seq?: number; business_id?: string; business_name?: string | null; released_by?: string | null; step?: string;
  text_waits_for_morning?: boolean; idempotency_key?: string;
};
type Release = { seq: number; businessId: string; businessName: string | null; releasedAt: string; releasedBy: string | null };

export type SpotReleaseState =
  | { state: "none" }
  | (Release & { state: "pending"; reminded: boolean; releaseTextDone: boolean; textWaitsForMorning: boolean })
  | (Release & { state: "confirmed"; at: string })
  | (Release & { state: "declined"; at: string })
  | (Release & { state: "lapsed"; at: string });
export type SpotReleaseStateName = SpotReleaseState["state"];

const det = (e: SpotReleaseEventRow) => (e.details ?? {}) as Details;
const seqOf = (e: SpotReleaseEventRow) => { const n = Number(det(e).release_seq); return Number.isInteger(n) && n > 0 ? n : null; };

/** The job's release state from its own spot-release events (any order). The latest release decides; its first outcome
 *  (confirmed / declined / lapsed) wins. A confirmed owner stays confirmed: no later release is ever recorded for them. */
export function spotReleaseState(events: readonly SpotReleaseEventRow[]): SpotReleaseState {
  const releases = events.filter((e) => e.event_type === SPOT_RELEASED_EVENT && seqOf(e) != null);
  if (!releases.length) return { state: "none" };
  const top = releases.reduce((a, b) => (seqOf(b)! > seqOf(a)! || (seqOf(b) === seqOf(a) && b.created_at < a.created_at) ? b : a));
  const seq = seqOf(top)!;
  const d = det(top);
  const base: Release = { seq, businessId: String(d.business_id ?? ""), businessName: d.business_name ?? null, releasedAt: top.created_at, releasedBy: d.released_by ?? null };
  // A confirmation of an EARLIER release stands (the owner is never asked again).
  const confirmedBefore = events.filter((e) => e.event_type === SPOT_RELEASE_CONFIRMED_EVENT).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const mine = events.filter((e) => seqOf(e) === seq);
  const outcome = mine.filter((e) => e.event_type === SPOT_RELEASE_CONFIRMED_EVENT || e.event_type === SPOT_RELEASE_DECLINED_EVENT || e.event_type === SPOT_RELEASE_LAPSED_EVENT)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (outcome) {
    const st = outcome.event_type === SPOT_RELEASE_CONFIRMED_EVENT ? "confirmed" : outcome.event_type === SPOT_RELEASE_DECLINED_EVENT ? "declined" : "lapsed";
    return { ...base, state: st, at: outcome.created_at };
  }
  if (confirmedBefore) return { ...base, state: "confirmed", at: confirmedBefore.created_at };
  const steps = mine.filter((e) => e.event_type === SPOT_RELEASE_REMINDED_EVENT).map((e) => det(e).step);
  return { ...base, state: "pending", reminded: steps.includes("reminder"), releaseTextDone: steps.includes("release_text"), textWaitsForMorning: d.text_waits_for_morning === true };
}

/** Next release number for this job (1, 2, …) — part of every key, so two presses of Release can't both go. */
export const nextReleaseSeq = (events: readonly SpotReleaseEventRow[]) =>
  Math.max(0, ...events.filter((e) => e.event_type === SPOT_RELEASED_EVENT).map((e) => seqOf(e) ?? 0)) + 1;

// ---- what is due (15-minute tick) ----------------------------------------------------------------------------------

export type SpotReleaseDue = "lapse" | "reminder" | "release_text";
/** Only a pending release on a job still waiting at the Ready Check scheduling stage (no installer) is chased.
 *  Day 5 → lapse (any hour, nothing sent). Day 2 → ONE reminder, only outside quiet hours (8pm–7am Melbourne).
 *  Released during quiet hours → the release text goes once at 7am (the email went at once). */
export function spotReleaseDue(s: SpotReleaseState, now: Date, job: { waiting: boolean }): SpotReleaseDue | null {
  if (s.state !== "pending" || !job.waiting) return null;
  const age = now.getTime() - Date.parse(s.releasedAt);
  if (!Number.isFinite(age)) return null;
  if (age >= LAPSE_AFTER_HOURS * HOUR) return "lapse";
  const quiet = smsQuietReason(now.toISOString()) != null;
  if (age >= REMIND_AFTER_HOURS * HOUR) return s.reminded || quiet ? null : "reminder";
  if (s.textWaitsForMorning && !s.releaseTextDone && !quiet) return "release_text";
  return null;
}

// ---- Release (office) ----------------------------------------------------------------------------------------------

export type ReleasePlan = { mode: "release" } | { mode: "direct_offer" } | { mode: "refused"; reason: string };
/** What pressing Release does. A confirmed owner → straight to the installer offer (never asked twice). */
export function releasePlan(f: { state: SpotReleaseState; testJob: boolean; emailApproved: boolean; smsApproved: boolean; now?: number }): ReleasePlan {
  const s = f.state;
  if (s.state === "confirmed") return { mode: "direct_offer" };
  if (s.state === "pending") return { mode: "refused", reason: `Already released to ${s.businessName ?? "an installer"} — waiting for the owner to confirm.` };
  if (s.state === "declined") return { mode: "refused", reason: "The owner said they're no longer interested." };
  if (!f.testJob && !(f.emailApproved && f.smsApproved)) return { mode: "refused", reason: SPOT_RELEASE_UNAPPROVED };
  return { mode: "release" };
}

/** Office status line on the waiting list / Choose installer panel. */
export function releaseStatusLine(s: SpotReleaseState, now: number): string | null {
  const since = (iso: string) => {
    const ms = now - Date.parse(iso);
    const when = new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });
    if (!Number.isFinite(ms)) return when;
    const h = Math.floor(ms / HOUR);
    return h < 1 ? `${when} (just now)` : h < 48 ? `${when} (${h}h)` : `${when} (${Math.floor(h / 24)} days)`;
  };
  switch (s.state) {
    case "pending": return `Released to ${s.businessName ?? "an installer"} · waiting for owner since ${since(s.releasedAt)}`;
    case "confirmed": return OWNER_CONFIRMED_LINE;
    case "lapsed": return `Didn't confirm after release to ${s.businessName ?? "an installer"} — release to someone else or leave`;
    case "declined": return "Owner said no longer interested at release";
    default: return null;
  }
}
/** One pile per job: the office's Ready Check item given the release state. A pending release needs nothing from the
 *  office (it waits for the owner; the waiting list shows its status); a lapsed one becomes the ONE "didn't confirm"
 *  row instead of "choose installer". Everything else (incl. a returned offer for a confirmed owner) is unchanged. */
export type ReleaseOfficeItem<T> = T | { code: "release_lapsed"; name: string | null; at: string } | null;
export function officeItemWithRelease<T extends { code: string } | null>(item: T, s: SpotReleaseState | undefined | null): ReleaseOfficeItem<T> {
  if (!item || !s) return item;
  if (s.state === "pending") return null;
  if (s.state === "lapsed" && item.code === "choose_installer") return { code: "release_lapsed", name: s.businessName, at: s.at };
  return item;
}
/** Pending releases are not available to release again (until they lapse or the owner says no). */
export const releasable = (s: SpotReleaseState) => s.state !== "pending" && s.state !== "declined";

// ---- wording (Jo's words, decision 389) ----------------------------------------------------------------------------

export const SPOT_RELEASED_SUBJECT = "It's your turn — confirm your free Ready Check";
export const SPOT_RELEASED_REMINDER_SUBJECT = "Just checking — it's your turn to confirm your free Ready Check";
export const SPOT_RELEASED_LINE = "It's your turn! Press here to confirm you'd still like your free Ready Check, and one of our EEC-certified installers will be in touch.";
export const SPOT_RELEASED_REMINDER_LINE = "Just checking — it's your turn! Press here to confirm you'd still like your free Ready Check, and one of our EEC-certified installers will be in touch.";
/** Jo-approved "What happens next" block (coordinator, 25 Oct): email O77 under the main line + the Confirm page. */
export const WHAT_HAPPENS_NEXT = {
  title: "What happens next:",
  steps: [
    "Press Confirm.",
    "Within a day or so, your installer will text and email you 3 times for your free Ready Check.",
    "Tap the time that suits you (or suggest other days). They'll check your ceiling and measure up, and your fixed quote follows.",
  ],
} as const;
export const CONFIRM_BUTTON = "Confirm";

/** The text (short, no "What happens next"). */
export function spotReleasedText(link: string, reminder = false): string {
  return reminder
    ? `Home Insulation Victoria: just checking — it's your turn! Confirm you'd still like your free Ready Check and one of our EEC-certified installers will be in touch: ${link}`
    : `Home Insulation Victoria: it's your turn! Confirm you'd still like your free Ready Check and one of our EEC-certified installers will be in touch: ${link}`;
}
/** The owner's secure page: their own My job link on the "turn" screen. */
export const spotReleasePageLink = (myJobLink: string) => `${myJobLink}?screen=turn`;

// ---- owner page ----------------------------------------------------------------------------------------------------

export const SPOT_RELEASE_PAGE = {
  title: "It's your turn!",
  lead: "Please confirm you'd still like your free Ready Check, and one of our EEC-certified installers will be in touch.",
  confirm: "Yes, I'd still like my free Ready Check",
  decline: "I'm no longer interested",
  confirming: "Confirming…",
  thanks: (installer: string | null) => `Thanks — confirmed. ${installer?.trim() || "Your installer"} will text and email you 3 times for your free Ready Check within a day or so.`,
  declined: "Thanks for letting us know. We've closed your spot and won't contact you about it again.",
  closed: "This link has closed. If you'd still like your free Ready Check, just reply to our email and we'll sort it out.",
} as const;

export type OwnerTurnView =
  | { kind: "ask" }
  | { kind: "confirmed"; installer: string | null }
  | { kind: "declined" }
  | { kind: "closed" };
/** What the owner sees on `?screen=turn`. Ask only while the release is pending and the job is still waiting. */
export function ownerTurnView(s: SpotReleaseState, job: { waiting: boolean; cancelled: boolean }): OwnerTurnView {
  if (s.state === "confirmed") return { kind: "confirmed", installer: s.businessName };
  if (s.state === "declined" || (job.cancelled && s.state !== "none")) return { kind: "declined" };
  if (s.state === "pending" && job.waiting) return { kind: "ask" };
  return { kind: "closed" };
}

/** Still waiting for an installer: our lead at the Ready Check scheduling stage, nobody assigned, not deleted. */
export const jobWaitingForInstaller = (j: { channel: string | null; stage: string | null; hasInstaller: boolean; deleted: boolean }) =>
  !j.deleted && j.channel === "hivic_sourced" && j.stage === "ready_check_ready_to_schedule" && !j.hasInstaller;
