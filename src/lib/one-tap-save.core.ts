// "Save my free spot" in the estimate emails saves the spot in ONE tap (decision 12, Jo 2 Nov 2026): the link carries
// ?save=1 and the page runs the canonical save once, then shows the Spot saved screen. PURE.
export const oneTapSaveUrl = (campaignUrl: string): string => `${campaignUrl}${campaignUrl.includes("?") ? "&" : "?"}save=1`;

export function shouldAutoSaveSpot(i: { save: unknown; saveAllowed: boolean; spotSavedAt: string | null; optedOutAt: string | null }): boolean {
  return (i.save === "1" || i.save === 1) && i.saveAllowed && !i.spotSavedAt && !i.optedOutAt;
}

/** Only a deliberate tap or key press counts; scrolling or wheeling does not. */
export const ONE_TAP_SAVE_EVENTS = ["pointerdown", "touchstart", "keydown"] as const;
/** A tap on a button, a link or anything marked data-no-autosave (the opt-out) must never start the save. */
export const ONE_TAP_SAVE_EXCLUDE = "button,a,[data-no-autosave]";

/** The ?save=1 link must not save on page load (email link scanners run the page's JS). It arms, then saves once on the first
 *  trusted tap or key press that is not on a button, a link or the opt-out control. */
export function shouldFireOneTapSave(i: { armed: boolean; alreadyFired: boolean; eventIsTrusted: boolean; eventType: string; target: { closest?: (selector: string) => unknown } | null }): boolean {
  if (!i.armed || i.alreadyFired || !i.eventIsTrusted) return false;
  if (!(ONE_TAP_SAVE_EVENTS as readonly string[]).includes(i.eventType)) return false;
  return !(typeof i.target?.closest === "function" && i.target.closest(ONE_TAP_SAVE_EXCLUDE));
}
