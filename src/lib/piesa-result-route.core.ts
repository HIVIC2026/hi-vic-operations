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
export const CLEAR_TO_INSTALL_EMAIL_APPROVED = true as boolean; // ON at go-live 5 Nov 2026
export const UPGRADES_NEEDED_EMAIL_APPROVED = true as boolean; // ON at go-live 5 Nov 2026

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

/** Safety net (Jo ruling 3 Nov): a non-standalone route may only hold back the owner's standalone PIESA copy for 24 hours
 *  after the PIESA result. The clear-to-install / upgrades-needed email can be blocked (paid, booked, no deadline, no invoice,
 *  documents held), and a double copy is harmless where a missing legal copy is not. */
export const OWNER_STANDALONE_GRACE_MS = 24 * 60 * 60 * 1000;
export function ownerStandaloneDue(f: { route: PiesaResultRoute[]; resultAt: Date | string | null; now: Date; ownerDelivered: boolean }): boolean {
  if (f.ownerDelivered) return false;
  if (f.route.includes("standalone_copy")) return true;
  const at = f.resultAt == null ? NaN : (f.resultAt instanceof Date ? f.resultAt.getTime() : Date.parse(f.resultAt));
  if (!Number.isFinite(at)) return true; // unknown result time: fail open to the legal copy
  return f.now.getTime() - at >= OWNER_STANDALONE_GRACE_MS;
}
