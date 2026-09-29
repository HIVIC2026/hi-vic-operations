import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Hourly Step 3 follow-up worker (pg_cron customer_followups_tick). Delivers only via a configured adapter.
export const Route = createFileRoute("/api/public/hooks/customer-followups")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const nonce = request.headers.get("x-hivic-cron-nonce");
        if (nonce) {
          if (!/^[0-9a-f]{64}$/.test(nonce)) return new Response("Unauthorized", { status: 401 });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: ok } = await supabaseAdmin.rpc("consume_cron_nonce", { _nonce: nonce, _purpose: "customer_followups" });
          if (ok !== true) return new Response("Unauthorized", { status: 401 });
        } else {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }
        const { processDueFollowups, processPendingInitialEstimateEmails } = await import("@/lib/followups.server");
        try {
          const initial = await processPendingInitialEstimateEmails(20);
          const r = await processDueFollowups();
          const n = (s: string) => r.results.filter((x) => x.status === s).length;
          // Counts only — never PII.
          return Response.json({ ok: true, initial, followups: { claimed: r.claimed, sent: n("sent"), suppressed: n("suppressed"), blocked: n("blocked"), retry: n("retry"), failed: n("failed"), error: n("error") } });
        } catch (e) {
          console.error("customer follow-up worker failed", (e as Error).message);
          return Response.json({ ok: false, error: "worker failed" }, { status: 500 });
        }
      },
    },
  },
});
