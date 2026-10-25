// Pure classifier for page-load failures that only a full document reload can recover from:
// the connection dropping part-way through (aborted stream, socket closed, DNS/reset) or a
// half-loaded server module (server function payload from a superseded build). App-level
// errors such as "not found" or "not authorised" must NOT match, so the UI can keep offering
// an in-place retry for those.

const TRANSPORT_ERROR =
  /aborted|aborterror|econnreset|econnrefused|socket hang up|etimedout|failed to fetch|networkerror|network request failed|load failed|reading 'method'|unsupported method|failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i;

export function isRecoverableTransportError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return TRANSPORT_ERROR.test(message);
}

// Named lazy route exports can be absent in an already-open tab after a deployment.
// Keep this pure so the router and pre-hydration document use the exact same classifier.
export const STALE_CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|undefined is not an object \(evaluating '[^']*(?:default|component|errorComponent|pendingComponent|notFoundComponent)|Cannot read properties of undefined \(reading '(?:default|component|errorComponent|pendingComponent|notFoundComponent)'\)/i;

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return STALE_CHUNK_ERROR.test(message);
}
