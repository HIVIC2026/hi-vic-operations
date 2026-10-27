import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Scheduled Outlook correspondence sync (read-only mailbox pull; never sends). Counts only in the response.
export const Route = createFileRoute("/api/public/hooks/outlook-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { runOutlookSync } = await import("@/lib/outlook-sync.server");
        const r = await runOutlookSync();
        // `partial` = the run stopped at its time budget; the saved place and pending work continue next run.
        return Response.json({ ok: r.ok, blocker: r.blocker ? (r.blocker === "not_connected" ? "not_connected" : "sync_error") : null, partial: r.partial, counts: r.counts, timingsMs: r.timingsMs });
      },
    },
  },
});
