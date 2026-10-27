import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/hooks/mitti-pull")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { runMittiPullWorker } = await import("@/lib/mitti-pull-worker.server");
        const { syncPendingMitti } = await import("@/lib/mitti.server");
        const { sweepCompletedMittiReadyChecks } = await import("@/lib/mitti-complete.server");
        const result = await runMittiPullWorker({
          pending: () => syncPendingMitti(null),
          completed: () => sweepCompletedMittiReadyChecks(),
        });
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});