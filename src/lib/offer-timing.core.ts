// Offer timing rule (Jo, 7 Oct 2026). Applies to installer Ready Check offers and electrician safety-check (PIESA) offers.
// First N real hours (workflow_settings.offer_suggest_time_after_hours, default 24): accept an owner time or decline only.
// After N hours with no taker: trades still holding a pending offer may suggest another time; office sees "no taker" in Needs me.
// Once anyone accepts, every other pending offer for that job closes ("This job has been taken").
import { melbourneDateTimeLabel } from "./offer-timing.label";

export const DEFAULT_SUGGEST_AFTER_HOURS = 24;
export const TIMED_OFFER_KINDS = ["ready_check", "piesa"] as const;

export function suggestAfterHours(setting: number | null | undefined): number {
  return typeof setting === "number" && Number.isFinite(setting) && setting > 0 ? setting : DEFAULT_SUGGEST_AFTER_HOURS;
}

/** Real elapsed hours (timezone-independent instants); the unlock moment is shown in Melbourne time. */
export function offerTiming(offeredAt: string, hours: number, now: Date = new Date()) {
  const unlockAt = new Date(Date.parse(offeredAt) + hours * 3_600_000);
  const canSuggest = now.getTime() >= unlockAt.getTime();
  return { canSuggest, unlockAt: unlockAt.toISOString(), unlockLabel: melbourneDateTimeLabel(unlockAt) };
}

export type OfferRow = { id: string; job_id: string; kind: string; status: string; offered_at: string };

/** Office Needs me: jobs whose timed offers reached N hours with nobody accepting. One entry per job+kind. */
export function offersWithNoTaker(rows: OfferRow[], hours: number, now: Date = new Date()) {
  const byJob = new Map<string, OfferRow[]>();
  for (const r of rows) if ((TIMED_OFFER_KINDS as readonly string[]).includes(r.kind)) { const k = `${r.job_id}:${r.kind}`; byJob.set(k, [...(byJob.get(k) ?? []), r]); }
  const out: { job_id: string; kind: string; since: string }[] = [];
  for (const list of byJob.values()) {
    if (list.some((r) => r.status === "accepted")) continue;
    const pending = list.filter((r) => r.status === "pending");
    if (!pending.length) continue;
    const first = pending.map((r) => r.offered_at).sort()[0]!;
    const t = offerTiming(first, hours, now);
    if (t.canSuggest) out.push({ job_id: list[0]!.job_id, kind: list[0]!.kind, since: t.unlockAt });
  }
  return out;
}

/** Statuses a losing trade sees after someone else accepted. */
export function offerClosedMessage(status: string, declinedByMe: boolean): string {
  if (declinedByMe || status === "declined") return "Offer declined";
  return "This job has been taken";
}
