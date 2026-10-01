import "./lib/error-capture";
import { requestContext } from "./lib/background.server";
import { customerEntryPoint } from "./lib/customer-entry.core";

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

// The customer web address is a marketing entry point, not a portal door: the bare
// address must SHOW the calculator at "/" itself (an internal rewrite, not a redirect),
// so the calculator genuinely is the home page of that address and search engines see
// one canonical URL. Staff reach the portal at /home on any address.
function customerEntryRewrite(request: Request): Request | undefined {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return undefined;
  }
  const target = customerEntryPoint(request.headers.get("host"), url.pathname);
  if (!target) return undefined;
  url.pathname = target;
  return new Request(url.toString(), request);
}


export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const entryRedirect = customerEntryRedirect(request);
      if (entryRedirect) return entryRedirect;
      const handler = await getServerEntry();
      const c = ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
      const waitUntil = typeof c?.waitUntil === "function" ? c.waitUntil.bind(c) : undefined;
      const response = await requestContext.run({ waitUntil }, () => handler.fetch(request, env, ctx));
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
