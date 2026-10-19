// Rectification (Operating Model v2). Pure rules only.
// Electrician gives estimated hours + 3-5 windows at PIESA submit (same day rules as owner PIESA times).
// Owner approves the quote and picks ONE window (at least 24h away) in one step. "None of these work" -> old propose/confirm.
// Quote timing: nudges at 24h and day 3 after sending; day 5 unanswered -> needs-attention. Never auto-expires.
import { piesaWindowBlockers, type PiesaWindowPick } from "./piesa-windows.core";
import { melbourneToday } from "./melbourne-time.core";

export const RECT_MIN_HOURS_AHEAD = 24;
export const RECT_UNANSWERED_DAYS = 5;
const HOUR = 3_600_000, DAY = 86_400_000;

export function rectHoursBlocker(h: number | null | undefined): string | null {
  if (h == null || !Number.isFinite(h)) return "Enter the estimated hours for the rectification work.";
  if (h <= 0 || h > 100) return "Estimated hours must be more than 0 and no more than 100.";
  return null;
}

/** Everything the electrician must give at PIESA submit when rectification is needed. */
export function rectPlanBlockers(hours: number | null | undefined, picks: PiesaWindowPick[], now: Date = new Date()): string[] {
  const out: string[] = [];
  const h = rectHoursBlocker(hours);
  if (h) out.push(h);
  out.push(...piesaWindowBlockers(picks, now));
  return out;
}

/** Windows the owner may pick: still open and at least 24 hours away. */
export function pickableRectWindows<T extends { starts_at: string; status: string }>(rows: T[], now: Date = new Date()): T[] {
  return rows.filter((w) => w.status === "proposed" && new Date(w.starts_at).getTime() - now.getTime() >= RECT_MIN_HOURS_AHEAD * HOUR)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export type RectTimerAction = "nudge_24h" | "nudge_day3" | null;
type RectQ = { kind: string; status: string; sent_at: string | null; nudge_24h_at: string | null; nudge_day3_at: string | null };

export function rectQuoteTimerAction(q: RectQ, now: Date = new Date()): RectTimerAction {
  if (q.kind !== "rectification" || q.status !== "issued" || !q.sent_at) return null;
  const age = now.getTime() - new Date(q.sent_at).getTime();
  if (age >= 3 * DAY && !q.nudge_day3_at) return "nudge_day3";
  if (age >= 24 * HOUR && !q.nudge_24h_at && !q.nudge_day3_at) return "nudge_24h";
  return null;
}

export function rectQuoteUnanswered(q: { kind: string; status: string; sent_at: string | null }, now: Date = new Date()): boolean {
  return q.kind === "rectification" && q.status === "issued" && !!q.sent_at && now.getTime() - new Date(q.sent_at).getTime() >= RECT_UNANSWERED_DAYS * DAY;
}

/** What to do with a held owner pick once the job reaches rectification scheduling. */
export function heldWindowAction(startsAt: string, now: Date = new Date()): "book" | "lapsed" {
  return new Date(startsAt).getTime() > now.getTime() ? "book" : "lapsed";
}

export function sectionCBlockers(f: { outcome: "pass" | "fail"; completedDate: string; sectionCCompleted?: boolean; sectionCSignedDate?: string | null }, today: Date = new Date()): string[] {
  if (f.outcome !== "pass") return [];
  const out: string[] = [];
  if (f.sectionCCompleted !== true) out.push("Confirm Section C has been completed and signed.");
  if (!f.sectionCSignedDate) out.push("Enter the Section C signed date.");
  else {
    // Victorian calendar dates (YYYY-MM-DD) compared as dates: "today" is the Melbourne date, never UTC midnight,
    // so a Section C signed this morning in Victoria is not rejected as "in the future" before 10/11am.
    const d = new Date(`${f.sectionCSignedDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== f.sectionCSignedDate) out.push("Section C signed date is invalid.");
    else {
      if (f.sectionCSignedDate > melbourneToday(today)) out.push("Section C signed date cannot be in the future.");
      if (f.sectionCSignedDate < f.completedDate) out.push("Section C signed date cannot be before the PIESA completion date.");
    }
  }
  return out;
}

