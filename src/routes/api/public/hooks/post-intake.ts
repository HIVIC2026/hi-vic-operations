import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Scheduled worker for the durable post-intake queue. Authenticated with the project cron secret (Bearer).
// Recovers abandoned intelligence runs / expired leases, then processes due items and re-routes held automatic initial enquiry responses (all send guards apply). No Xero/Mitti.
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
        const { processPostIntakeWork, recordWorkerRun } = await import("@/lib/postintake.server");
        try {
          const r = await processPostIntakeWork({ limit: 5 });
          const failed = r.results.filter((x) => x.status === "failed" || x.status === "retry").length;
          await recordWorkerRun({ recovered: r.recovered, claimed: r.claimed, failed }).catch(() => {});
          // Same tick drives electrician offer expiry/refill/auto-start and 24h/48h coordination checks.
          // Reminders only enter the outbox as not-released candidates; nothing is sent while sending is off.
          const alloc = await import("@/lib/allocation.server");
          await alloc.sweepRecOffers().catch((e) => console.error("rec offer sweep failed", (e as Error).message));
          await alloc.sweepCoordination().catch((e) => console.error("coordination sweep failed", (e as Error).message));
          // Durable retry for automatic initial enquiry responses (held/failed ones are re-routed under every guard).
          const sweep = await import("@/lib/first-response-sweep.server");
          await sweep.sweepUnansweredFirstResponses().catch((e) => console.error("first-response sweep failed", (e as Error).message));
          return Response.json({ ok: true, recovered: r.recovered, claimed: r.claimed, results: r.results.map((x) => ({ status: x.status })) });
        } catch (e) {
          console.error("post-intake worker failed", (e as Error).message);
          await recordWorkerRun({ recovered: 0, claimed: 0, failed: 0 }, "worker failed").catch(() => {});
          return Response.json({ ok: false, error: "worker failed" }, { status: 500 });
        }
      },
    },
  },
});
