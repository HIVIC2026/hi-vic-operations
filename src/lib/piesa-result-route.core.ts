// Part 4 Task 2 (Jo 2 Nov 2026, touchpoints 40/42, answer 21): ONE owner message per PIESA result. Pure rules, no network.
//  - all clear (or upgrades done on the day) -> "You're clear to install" (carries the signed PIESA + the confirm-and-pay button)
//  - upgrades still to come -> "Your safety check found electrical upgrades needed" (carries the signed PIESA)
//  - old-flow job, or the owner is on Do not contact -> only the standalone signed copy (a legal copy, so it still goes)
// The installer's copy is separate and always sends.
export type PiesaResultRoute = "clear_to_install" | "upgrades_needed" | "standalone_copy";
export type PiesaOutcome = "all_clear" | "upgrades_needed";

// Wording for these two owner emails is "draft -> Jo approves" (Part 4 Tasks 3 and 4). Until each is approved and built, its
// route stays on the standalone signed copy, so owners never lose the legal PIESA copy. Tasks 3/4: flip the flag only when
// the email exists. When that email sends, it MUST also record the owner piesa_deliveries + official_form_deliveries rows
// (see recordDelivery in piesa-delivery.server.ts) because readyToInstall and PIISA Part 8(a) read them.
export const CLEAR_TO_INSTALL_EMAIL_APPROVED = false as boolean;
export const UPGRADES_NEEDED_EMAIL_APPROVED = false as boolean;

export type PiesaEmailApprovals = { clearToInstall: boolean; upgradesNeeded: boolean };
const DEFAULT_APPROVALS = (): PiesaEmailApprovals => ({ clearToInstall: CLEAR_TO_INSTALL_EMAIL_APPROVED, upgradesNeeded: UPGRADES_NEEDED_EMAIL_APPROVED });

export function piesaResultRoute(
  f: { outcome: PiesaOutcome; upgradesDoneSameDay: boolean; doNotContact: boolean; newFlow: boolean },
  approvals: PiesaEmailApprovals = DEFAULT_APPROVALS(),
): PiesaResultRoute[] {
  if (!f.newFlow || f.doNotContact) return ["standalone_copy"];
  if (f.outcome === "all_clear" || f.upgradesDoneSameDay) return approvals.clearToInstall ? ["clear_to_install"] : ["standalone_copy"];
  return approvals.upgradesNeeded ? ["upgrades_needed"] : ["standalone_copy"];
}

/** Jo 2 Nov, answer 21: the confirm-and-pay page (and so the 10% deposit) opens straight after the PIESA result,
 *  including when electrical upgrades are still to come. Booking the install day still needs the deposit paid. */
export function depositOpenAfterPiesa(f: { outcome: PiesaOutcome | null }): boolean {
  return f.outcome === "all_clear" || f.outcome === "upgrades_needed";
}
