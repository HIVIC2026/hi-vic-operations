import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage, renderReloadPage } from "./lib/error-page";
import { isConnectionTeardown } from "./lib/http-abort";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { testOfficeBoundary } from "./lib/qa-office-boundary";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // A client that disconnects while loading must never receive an empty
    // successful-looking document if the response is still deliverable.
    if (isConnectionTeardown(error)) {
      return new Response(renderReloadPage(), {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, testOfficeBoundary],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
