// Rectification (Operating Model v2). Pure rules only.
// Electrician gives estimated hours + 3-5 windows at PIESA submit (same day rules as owner PIESA times).
// Owner approves the quote and picks ONE window (at least 24h away) in one step. "None of these work" -> old propose/confirm.
// Quote timing: nudges at 24h and day 3 after sending; day 5 unanswered -> needs-attention. Never auto-expires.
import { piesaWindowBlockers, type PiesaWindowPick } from "./piesa-windows.core";

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

// ---- Auto-queue vs hold (Operating Model v2, smallest safe addition) ----
// "Standard agreed-rate" = every required item is a catalogue rate (not "Other"), not flagged
// needs_office_pricing, and the generated quote was not manually adjusted after creation.
export type RectItemFact = { is_other: boolean; needs_office_pricing: boolean };
export function rectQuoteIsStandardOnly(items: RectItemFact[], manuallyAdjusted: boolean): boolean {
  if (manuallyAdjusted) return false;
  if (!items.length) return false;
  return items.every((i) => !i.is_other && !i.needs_office_pricing);
}

/** Auto-queue only when the switch is on AND every line is standard/agreed-rate; otherwise unchanged (hold for office review). */
export function rectAutoQueueDecision(switchOn: boolean, items: RectItemFact[], manuallyAdjusted: boolean): "auto_queue" | "hold" {
  return switchOn && rectQuoteIsStandardOnly(items, manuallyAdjusted) ? "auto_queue" : "hold";
}
