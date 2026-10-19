import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/hooks/external-actions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const nonce = request.headers.get("x-hivic-cron-nonce");
        if (nonce) {
          const { data: ok } = await supabaseAdmin.rpc("consume_cron_nonce", { _nonce: nonce, _purpose: "external_actions" });
          if (!ok) return new Response("forbidden", { status: 403 });
        } else if (!(await authenticateCronRequest(request))) return new Response("forbidden", { status: 403 });
        const { processExternalActionOutbox } = await import("@/lib/external-action-outbox.server");
        return Response.json(await processExternalActionOutbox(20));
      },
    },
  },
});
