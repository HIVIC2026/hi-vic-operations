// Decision 335 (Jo, 25 Oct 2026): the My job review screen (`?screen=review&stars=N`, the O51 star links). Pure rules only.
// The owner taps 1–5 stars; each tap is recorded as an append-only `owner_review_stars` event. 4–5 stars → thank you +
// a button to the Google review link (env HIV_GOOGLE_REVIEW_URL; unset → thanks only). 1–3 stars → a short private
// feedback box ("What could we have done better?") saved as an append-only `owner_review_feedback` event that raises ONE
// Needs me row for Jo per job; a 1–3 star owner is never sent to Google.
import type { SystemRow } from "./office-needs.core";

export const OWNER_REVIEW_STARS_EVENT = "owner_review_stars";
export const OWNER_REVIEW_FEEDBACK_EVENT = "owner_review_feedback";
export const REVIEW_FEEDBACK_MAX = 1000;
/** A Needs me row stays for this many days after the feedback (the job may already be closed). */
export const REVIEW_FEEDBACK_ROW_DAYS = 14;
/** The same stars tapped again within this window (e.g. the page reloaded) is not recorded twice. */
export const REVIEW_STARS_DEDUPE_HOURS = 24;

export const REVIEW_COPY = {
  title: "How did we go?",
  sub: "Tap a star.",
  thanksHappy: "Thank you! We're so glad you're happy.",
  googleAsk: "A quick Google review helps other Victorians find the rebate too.",
  googleButton: "Leave a Google review",
  thanksPlain: "Thank you for letting us know.",
  feedbackTitle: "What could we have done better?",
  feedbackSub: "This comes straight to us, not to Google. We'll be in touch.",
  feedbackButton: "Send",
  feedbackSent: "Thanks. We have your note and will be in touch.",
} as const;

/** "?stars=N" → 1..5, anything else → null. */
export function parseStars(raw: unknown): 1 | 2 | 3 | 4 | 5 | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*[1-5]\s*$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : null;
}

/** 4–5 → Google (when a link is set); 1–3 → the private feedback box. Never Google for 1–3. */
export function reviewOutcome(stars: number): "google" | "private" {
  return stars >= 4 ? "google" : "private";
}

/** The Google review link from env, only when it is a real https URL. */
export function googleReviewLink(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v && /^https:\/\/\S+$/.test(v) ? v : null;
}

/** What the screen shows for a given star tap: the Google link only for 4–5 and only when one is set. */
export function reviewScreen(stars: number | null, googleUrl: string | null): { kind: "ask" } | { kind: "thanks"; googleUrl: string | null } | { kind: "feedback" } {
  if (stars == null) return { kind: "ask" };
  return reviewOutcome(stars) === "google" ? { kind: "thanks", googleUrl } : { kind: "feedback" };
}

/** Record this tap? Not when the latest recorded tap is the same stars within the dedupe window. */
export function shouldRecordStars(stars: number, latest: { stars: number; at: string } | null, now: Date = new Date()): boolean {
  if (!latest) return true;
  return !(latest.stars === stars && now.getTime() - Date.parse(latest.at) < REVIEW_STARS_DEDUPE_HOURS * 3_600_000);
}

/** Feedback is only for 1–3 stars, 1–1000 characters after trimming. */
export function reviewFeedbackBlocker(stars: number | null, text: string): string | null {
  if (stars == null || reviewOutcome(stars) !== "private") return "Feedback is for 1 to 3 stars.";
  const t = text.trim();
  if (!t) return "Please tell us what we could have done better.";
  if (t.length > REVIEW_FEEDBACK_MAX) return `Please keep it under ${REVIEW_FEEDBACK_MAX} characters.`;
  return null;
}

export type ReviewFeedbackEvent = { job_id: string; created_at: string; details: { stars?: number; feedback?: string } | null };

/** ONE Needs me row per job (the latest feedback), for REVIEW_FEEDBACK_ROW_DAYS days. */
export function reviewFeedbackRows(events: ReviewFeedbackEvent[], jobs: Map<string, { jobNumber: string; surname: string; isTest?: boolean }>, now: number, includeTest = false): SystemRow[] {
  const latest = new Map<string, ReviewFeedbackEvent>();
  for (const e of events) {
    if (now - Date.parse(e.created_at) >= REVIEW_FEEDBACK_ROW_DAYS * 86_400_000) continue;
    const prev = latest.get(e.job_id);
    if (!prev || e.created_at > prev.created_at) latest.set(e.job_id, e);
  }
  const out: SystemRow[] = [];
  for (const [jobId, e] of latest) {
    const j = jobs.get(jobId);
    if (!j || (j.isTest && !includeTest)) continue;
    const stars = Number(e.details?.stars ?? 0);
    const text = String(e.details?.feedback ?? "").trim();
    out.push({ key: `review-feedback:${jobId}`, tag: "Review", who: `${j.jobNumber} ${j.surname}`.trim(), line: `${stars} star${stars === 1 ? "" : "s"} · “${text.length > 120 ? `${text.slice(0, 117)}…` : text}”`, since: e.created_at, button: "Open job", href: `/admin/jobs/${jobId}`, jobId });
  }
  return out.sort((a, b) => String(b.since).localeCompare(String(a.since)));
}
