// Jo 23 Oct 2026 08:23 UTC: Spots saved — one list, 8 ranks, most likely eligible first, then longest waiting.
// Jo 08:27 UTC: photo owners also get Save my spot straight away; until the office checks the photos they
// rank by their tap answers (or Missing info) with a 📷 badge; the photo check then moves them.
export type SpotRankFacts = {
  reviewOutcome: "no_insulation" | "below_r2" | "over_r2" | "unclear" | null;
  hadUnclearReview: boolean;
  deskLooksEligible: boolean;
  declared: "none" | "present" | "unknown" | null;
  mediaCount: number;
  tap?: { insulation_type?: string; insulation_thickness?: string; house_built_period?: string } | null;
  /** Website answer said thin/patchy/partial. */
  declaredThinPatchy: boolean;
};

export const SPOT_RANK_LABEL: Record<number, string> = {
  1: "✅ No insulation (photos checked)",
  2: "✅ Under R2 (photos checked)",
  3: "🟡 Under R2 (approved, no clear photos)",
  4: "🟡 No insulation (their word only)",
  5: "🟡 Older home or thin insulation",
  6: "⚪ Thicker insulation",
  7: "⚪ Not sure",
  8: "❔ Missing info",
};

export function spotSavedRank(f: SpotRankFacts): number {
  const t = f.tap ?? null;
  if (f.reviewOutcome === "no_insulation") return 1;
  if (f.reviewOutcome === "below_r2" && f.mediaCount > 0 && !f.hadUnclearReview) return 2;
  if (f.reviewOutcome === "below_r2" || f.deskLooksEligible) return 3;
  // Jo 08:27 UTC: an office photo check of a saved spot moves it automatically.
  if (f.reviewOutcome === "over_r2") return 6;
  if (f.reviewOutcome === "unclear") return 7;
  if (f.declared === "none") return 4;
  if (t?.house_built_period === "1990_or_earlier" || t?.insulation_type === "loose_fill" || t?.insulation_thickness === "thin" || f.declaredThinPatchy) return 5;
  if (t?.insulation_thickness === "hand" || t?.insulation_thickness === "thicker") return 6;
  if (t || f.declared === "unknown") return 7;
  return 8;
}

/** Rank first, then longest waiting (oldest saved first). */
export function compareSpots(a: { rank: number; spotSavedAt: string | null }, b: { rank: number; spotSavedAt: string | null }): number {
  return a.rank - b.rank || (a.spotSavedAt ?? "9").localeCompare(b.spotSavedAt ?? "9");
}

/** One line: owner · suburb · built · m² · 📷 n · waiting X days */
export function spotSummary(x: { owner: string | null; suburb: string | null; houseAge: string | null; mediaCount: number; areaM2: number | null; spotSavedAt: string | null }, now = Date.now()): string {
  const days = x.spotSavedAt ? Math.max(0, Math.floor((now - new Date(x.spotSavedAt).getTime()) / 86_400_000)) : null;
  return [
    x.owner ?? "Owner", x.suburb ?? "—",
    x.houseAge && x.houseAge !== "Age not given" ? `built ${x.houseAge}` : "built ?",
    x.areaM2 ? `${Math.round(x.areaM2)} m²` : "m² ?",
    `📷 ${x.mediaCount}`,
    days == null ? null : `waiting ${days} day${days === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
}

/** Jo 08:27 UTC: photo-check choices on a Spots saved row and the rank each one gives. */
export const SPOT_PHOTO_CHOICES = [
  { outcome: "no_insulation", label: "No insulation", rank: 1 },
  { outcome: "below_r2", label: "Under R2", rank: 2 },
  { outcome: "over_r2", label: "Thicker / over R2", rank: 6 },
  { outcome: "unclear", label: "Can't tell", rank: 7 },
] as const;
