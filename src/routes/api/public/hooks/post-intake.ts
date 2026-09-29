import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Scheduled worker for the durable post-intake queue. Authenticated with the project cron secret (Bearer).
// Recovers abandoned intelligence runs / expired leases, then processes due items. No communications, no Xero/Mitti.
export const Route = createFileRoute("/api/public/hooks/post-intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { processPostIntakeWork } = await import("@/lib/postintake.server");
        try {
          const r = await processPostIntakeWork({ limit: 5 });
          return Response.json({ ok: true, recovered: r.recovered, claimed: r.claimed, results: r.results.map((x) => ({ status: x.status })) });
        } catch (e) {
          console.error("post-intake worker failed", (e as Error).message);
          return Response.json({ ok: false, error: "worker failed" }, { status: 500 });
        }
      },
    },
  },
});
