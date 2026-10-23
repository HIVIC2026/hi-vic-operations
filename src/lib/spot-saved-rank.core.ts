// Jo 23 Oct 2026: Spots saved — one list, most likely eligible first, then longest waiting.
export type SpotRankFacts = {
  reviewOutcome: "no_insulation" | "below_r2" | "over_r2" | "unclear" | null;
  hadUnclearReview: boolean;
  deskLooksEligible: boolean;
  declared: "none" | "present" | "unknown" | null;
  mediaCount: number;
  tapRoute: string | null;
  declaredThinPatchy: boolean;
};

export const SPOT_RANK_LABEL: Record<number, string> = {
  1: "Photos: no insulation",
  2: "Said none + photos",
  3: "Photos: below R2",
  4: "Office approved below R2",
  5: "Said none",
  6: "Old house / loose fill / thin",
  7: "Has insulation",
  8: "Don't know",
  9: "Not enough info",
};

export function spotSavedRank(f: SpotRankFacts): number {
  if (f.reviewOutcome === "no_insulation") return 1;
  if (f.declared === "none" && f.mediaCount > 0) return 2;
  if (f.reviewOutcome === "below_r2" && f.mediaCount > 0 && !f.hadUnclearReview) return 3;
  if (f.reviewOutcome === "below_r2" || f.deskLooksEligible) return 4;
  if (f.declared === "none") return 5;
  if (f.tapRoute === "thin_patchy" || f.declaredThinPatchy) return 6;
  if (f.declared === "present") return 7;
  if (f.declared === "unknown") return 8;
  return 9;
}

/** Rank first, then longest waiting (oldest saved first). */
export function compareSpots(a: { rank: number; spotSavedAt: string | null }, b: { rank: number; spotSavedAt: string | null }): number {
  return a.rank - b.rank || (a.spotSavedAt ?? "9").localeCompare(b.spotSavedAt ?? "9");
}

const INS: Record<string, string> = { none: "said no insulation", present: "said has insulation", unknown: "doesn't know" };
export function spotSummary(x: { owner: string | null; suburb: string | null; houseAge: string | null; said: string | null; declared: string | null; mediaCount: number; areaM2: number | null; spotSavedAt: string | null }, now = Date.now()): string {
  const days = x.spotSavedAt ? Math.max(0, Math.floor((now - new Date(x.spotSavedAt).getTime()) / 86_400_000)) : null;
  return [
    x.owner ?? "Owner", x.suburb ?? "—", x.houseAge,
    x.said ?? (x.declared ? INS[x.declared] : "no insulation answer"),
    `${x.mediaCount} photo${x.mediaCount === 1 ? "" : "s"}`,
    x.areaM2 ? `${Math.round(x.areaM2)} m²` : "m² unknown",
    days == null ? null : `saved ${days} day${days === 1 ? "" : "s"} ago`,
  ].filter(Boolean).join(" · ");
}
