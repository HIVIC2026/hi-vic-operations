export const OWN_MITTI_REQUEST_EVENT = 'own_customer_mitti_requested';
export function ownCustomerMittiAllowed(f: { channel: string | null; requested: boolean; portalSaved: boolean }): boolean {
  return f.channel !== 'installer_sourced' || (f.requested && !f.portalSaved);
}