/** Owner-facing seasonal wording. One office toggle (workflow_settings.owner_copy_season) switches every line. */
export type CopySeason = "summer" | "winter";
export const DEFAULT_COPY_SEASON: CopySeason = "summer";

export const SEASON_COPY = {
  summer: {
    myJobHeadline: "Your cooler home is on its way",
    myJobDoneHeadline: "Your home is cooler",
    allDoneHeadline: "Your home is cooler",
    bookingHeadline: "Two visits, then you're cooler",
    referralHeadline: "Know someone with a hot house?",
  },
  winter: {
    myJobHeadline: "Your warmer home is on its way",
    myJobDoneHeadline: "Your home is warmer",
    allDoneHeadline: "Your home is warmer",
    bookingHeadline: "Two visits, then you're warm",
    referralHeadline: "Know someone with a cold house?",
  },
} as const satisfies Record<CopySeason, Record<string, string>>;

export type SeasonCopy = (typeof SEASON_COPY)[CopySeason];

/** Missing or unknown values fall back to summer. */
export function resolveSeason(value: unknown): CopySeason {
  return value === "winter" ? "winter" : DEFAULT_COPY_SEASON;
}
export function seasonCopy(value: unknown): SeasonCopy {
  return SEASON_COPY[resolveSeason(value)];
}
