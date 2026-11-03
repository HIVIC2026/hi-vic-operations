// Part 4 Task 2 (Jo 2 Nov 2026, touchpoints 40/42, answer 21): ONE owner message per PIESA result. Pure rules, no network.
//  - all clear (or upgrades done on the day) -> "You're clear to install" (carries the signed PIESA + the confirm-and-pay button)
//  - upgrades still to come -> "Your safety check found electrical upgrades needed" (carries the signed PIESA)
//  - old-flow job, or the owner is on Do not contact -> only the standalone signed copy (a legal copy, so it still goes)
// The installer's copy is separate and always sends.
export type PiesaResultRoute = "clear_to_install" | "upgrades_needed" | "standalone_copy";
export type PiesaOutcome = "all_clear" | "upgrades_needed";

export function piesaResultRoute(f: { outcome: PiesaOutcome; upgradesDoneSameDay: boolean; doNotContact: boolean; newFlow: boolean }): PiesaResultRoute[] {
  if (!f.newFlow || f.doNotContact) return ["standalone_copy"];
  if (f.outcome === "all_clear" || f.upgradesDoneSameDay) return ["clear_to_install"];
  return ["upgrades_needed"];
}

/** Jo 2 Nov, answer 21: the confirm-and-pay page (and so the 10% deposit) opens straight after the PIESA result,
 *  including when electrical upgrades are still to come. Booking the install day still needs the deposit paid. */
export function depositOpenAfterPiesa(f: { outcome: PiesaOutcome | null }): boolean {
  return f.outcome === "all_clear" || f.outcome === "upgrades_needed";
}
