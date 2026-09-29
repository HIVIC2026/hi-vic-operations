import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Scheduled worker for the durable post-intake queue. Authenticated with the project cron secret (Bearer).
// Recovers abandoned intelligence runs / expired leases, then processes due items. No communications, no Xero/Mitti.
export const Route = createFileRoute("/api/public/hooks/post-intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: single-use database-minted nonce (pg_cron tick) OR the project cron secret (Bearer).
        const nonce = request.headers.get("x-hivic-cron-nonce");
        if (nonce) {
          if (!/^[0-9a-f]{64}$/.test(nonce)) return new Response("Unauthorized", { status: 401 });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: ok } = await supabaseAdmin.rpc("consume_cron_nonce", { _nonce: nonce, _purpose: "post_intake" });
          if (ok !== true) return new Response("Unauthorized", { status: 401 });
        } else {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }
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
