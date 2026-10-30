import type { InHouseSkip } from './in-house.core';
/** Presentation only: never authorises bookings or changes workflow/payment gates. */
export function ownerVisitCoordinationAllowed(state: InHouseSkip | null | undefined): boolean { return state == null; }
export function inHouseVisitForStage(stage: string | null | undefined): string | null {
  if (['ready_check_ready_to_schedule','ready_check_booking'].includes(stage ?? '')) return 'Ready Check';
  if (['assessment_booking','piesa_and_install_window_pending','awaiting_electrician'].includes(stage ?? '')) return 'PIESA';
  if (stage === 'rectification_scheduling') return 'rectification';
  if (stage === 'installation_scheduling') return 'install';
  return null;
}
export function inHouseTradeBookingText(stage: string | null | undefined): string | null {
  const visit = inHouseVisitForStage(stage);
  return visit ? `Book the ${visit} in the portal` : null;
}
