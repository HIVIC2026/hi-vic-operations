/** Screen-only feedback: never a delivery claim or a persisted job event. */
export function showTradeSaved(line: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('trade-saved', { detail: { path: window.location.pathname, line } }));
}