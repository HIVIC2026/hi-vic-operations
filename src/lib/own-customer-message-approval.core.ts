// Version-bound, individually approved through the existing audited office switches.
export const OWN_CUSTOMER_MESSAGE_KEYS = ['own_owner_quote', 'own_owner_updated_quote', 'own_installer_quote_sent', 'own_installer_updated_quote_sent', 'own_installer_owner_accepted'] as const;
export type OwnCustomerMessageKey = typeof OWN_CUSTOMER_MESSAGE_KEYS[number];
export const ownMessageSwitch = (key: OwnCustomerMessageKey) => `email:${key}:5nov-v1`;
export function ownMessageApproved(map: unknown, key: OwnCustomerMessageKey): boolean {
  return !!map && typeof map === 'object' && !Array.isArray(map) && (map as Record<string, unknown>)[ownMessageSwitch(key)] === true;
}
export function ownQuoteMessageKey(updated: boolean): OwnCustomerMessageKey {
  return updated ? 'own_owner_updated_quote' : 'own_owner_quote';
}