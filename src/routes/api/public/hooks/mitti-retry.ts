import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/hooks/mitti-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { runMittiRetrySweep } = await import("@/lib/mitti-retry.server");
        const result = await runMittiRetrySweep();
        return Response.json(result);
      },
    },
  },
});
