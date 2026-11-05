/** Declared dates never verify a certificate or extend the office-verified expiry. */
export function certificateExpiryValid(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function declaredCertificateExpiry(certification: unknown): string | null {
  const value = (certification as { eec_upload?: { expires_on?: unknown } } | null)?.eec_upload?.expires_on;
  return typeof value === 'string' && certificateExpiryValid(value) ? value : null;
}
export function effectiveCertificateExpiry(verified: string | null, declared: string | null): string | null {
  return verified && declared ? (verified < declared ? verified : declared) : verified ?? declared;
}
/** Reuse the existing 30-day warning window; allocation alone consumes this blocker. */
export function certificateExpiryWarning(expiry: string | null | undefined, today: string): string | null {
  if (!certificateExpiryValid(expiry) || !expiry) return null;
  const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days < 0) return 'CII/EEC certificate expired — not available for install days.';
  if (days <= 30) return `CII/EEC certificate expires in ${days} days — not available for install days.`;
  return null;
}