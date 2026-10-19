// Shared external-provider timeouts. Keep these conservative: an unknown outcome
// must be recorded/reconciled, not automatically retried into a duplicate.
export const EXTERNAL_FETCH_TIMEOUT_MS = 20_000;
export const MITTI_FETCH_TIMEOUT_MS = 20_000;
export const TWILIO_FETCH_TIMEOUT_MS = 15_000;
export const XERO_FETCH_TIMEOUT_MS = 20_000;
export const RESEND_FETCH_TIMEOUT_MS = 20_000;

export function timeoutSignal(ms: number): AbortSignal | null {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : null;
}
