// One rule for "the caller has gone away" errors.
//
// When a browser reloads, navigates, or hot-reloads mid-request, the socket is
// torn down under the server. Node reports that as `Error: aborted` thrown from
// its own HTTP internals (node:_http_server abortIncoming/socketOnClose), and
// the layers above it (Start, h3) re-wrap it with `status: 500`. Nobody is
// listening any more, so this must never be shown or logged as a crash: the
// reply is discarded either way, and a 500 error page turns a routine reload
// into a blank screen and a false incident report.
//
// Kept dependency-free so it runs in the browser, the SSR worker and the dev
// server alike.

const TEARDOWN_MESSAGE =
  /^(aborted|socket hang ?up|closed|premature close|stream canceled|response is not usable)$/i;
const TEARDOWN_NAME = /^(AbortError|ClosedError|SocketError)$/i;
const TEARDOWN_CODE = /^(ECONNRESET|ECONNABORTED|EPIPE|ERR_STREAM_PREMATURE_CLOSE|ERR_HTTP_REQUEST_TIMEOUT)$/;
const HTTP_INTERNAL = /node:_http_server|_http_server\.js|abortIncoming|socketOnClose/;

const WALK_LIMIT = 8;

export function isConnectionTeardown(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < WALK_LIMIT && current != null; depth++) {
    if (matches(current)) return true;
    current = next(current);
  }
  return false;
}

function matches(value: unknown): boolean {
  if (typeof value === "string") return TEARDOWN_MESSAGE.test(value.trim());
  if (!(value instanceof Error) && typeof value !== "object") return false;

  const candidate = value as {
    message?: unknown;
    name?: unknown;
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    stack?: unknown;
  };
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const code =
    typeof candidate.code === "string" ? candidate.code :
    typeof candidate.errno === "string" ? candidate.errno : "";
  const stack = typeof candidate.stack === "string" ? candidate.stack : "";

  if (TEARDOWN_MESSAGE.test(message.trim())) return true;
  if (TEARDOWN_NAME.test(name)) return true;
  if (TEARDOWN_CODE.test(code)) return true;
  // Node's own teardown frames with a generic message: the only thing that
  // throws from there with no application frame is a closed socket.
  return HTTP_INTERNAL.test(stack) && !/^Error: (h3 swallowed|Internal server)/i.test(message);
}

function next(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as { cause?: unknown; errors?: unknown; originalError?: unknown };
  if (candidate.cause !== undefined) return candidate.cause;
  if (candidate.originalError !== undefined) return candidate.originalError;
  if (Array.isArray(candidate.errors) && candidate.errors.length) return candidate.errors[0];
  return undefined;
}
