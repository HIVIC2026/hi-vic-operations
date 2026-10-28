import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/hooks/mitti-pull")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const work = (async () => {
          const { runMittiPullWorker } = await import("@/lib/mitti-pull-worker.server");
          const { syncPendingMitti } = await import("@/lib/mitti.server");
          const { sweepCompletedMittiReadyChecks } = await import("@/lib/mitti-complete.server");
          return runMittiPullWorker({
            pending: () => syncPendingMitti(null),
            completed: () => sweepCompletedMittiReadyChecks(),
          });
        })();
        // Keep going if the cron caller's connection drops: the platform keeps this promise alive past the request.
        const { requestContext } = await import("@/lib/background.server");
        requestContext.getStore()?.waitUntil?.(work);
        const result = await work;
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
