import { createFileRoute } from "@tanstack/react-router";
import { redirectResponse } from "@/lib/engagement.core";

// Tracked estimate-email CTA: validates the opaque token, logs one email_clicked, 302s to the secure estimate.
export const Route = createFileRoute("/t/e/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { resolveClick } = await import("@/lib/engagement.server");
        const to = await resolveClick(params.token).catch(() => "/estimate/unavailable");
        return redirectResponse(to);
      },
    },
  },
});
