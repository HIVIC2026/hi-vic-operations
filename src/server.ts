import "./lib/local-network-guard.install"; // D-7: LOCAL UAT network isolation (inert in production)
import "./lib/error-capture";
import { requestContext } from "./lib/background.server";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage, renderReloadPage } from "./lib/error-page";
import { isConnectionTeardown } from "./lib/http-abort";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError();
  if (isConnectionTeardown(captured)) {
    return new Response(renderReloadPage(), {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}


// srvx ties its Request.signal to the Node response socket. TanStack reads that
// signal while rendering, so closing or superseding a page request can dispatch
// an AbortError from srvx's `res.close` listener after our fetch try/catch has
// finished. Page requests have no body: give rendering an equivalent Request
// without the adapter-owned signal, while preserving normal POST cancellation.
function detachedPageRequest(request: Request): Request {
  if (request.method !== "GET" && request.method !== "HEAD") return request;
  return detachedGetRequest(request, request.url);
}

function detachedGetRequest(request: Request, url: string): Request {
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
  });
}


export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const incoming = detachedPageRequest(request);
      const handler = await getServerEntry();
      const c = ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
      const waitUntil = typeof c?.waitUntil === "function" ? c.waitUntil.bind(c) : undefined;
      const response = await requestContext.run({ waitUntil }, () => handler.fetch(incoming, env, ctx));

      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      if (isConnectionTeardown(error)) {
        return new Response(renderReloadPage(), {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
