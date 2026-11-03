// "Save my free spot" in the estimate emails saves the spot in ONE tap (decision 12, Jo 2 Nov 2026): the link carries
// ?save=1 and the page runs the canonical save once, then shows the Spot saved screen. PURE.
export const oneTapSaveUrl = (campaignUrl: string): string => `${campaignUrl}${campaignUrl.includes("?") ? "&" : "?"}save=1`;

export function shouldAutoSaveSpot(i: { save: unknown; saveAllowed: boolean; spotSavedAt: string | null; optedOutAt: string | null }): boolean {
  return (i.save === "1" || i.save === 1) && i.saveAllowed && !i.spotSavedAt && !i.optedOutAt;
}
