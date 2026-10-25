import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Decision 393 (Jo 25 Oct 2026, "Yes, send all 54"): one-off backlog send, triggered from SQL with a single-use nonce
// (purpose 'backlog_send'). Each item goes through an existing guarded sender only. Counts only — never PII.
export const Route = createFileRoute("/api/public/hooks/backlog-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const nonce = request.headers.get("x-hivic-cron-nonce");
        if (nonce) {
          if (!/^[0-9a-f]{64}$/.test(nonce)) return new Response("Unauthorized", { status: 401 });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: ok } = await supabaseAdmin.rpc("consume_cron_nonce", { _nonce: nonce, _purpose: "backlog_send" });
          if (ok !== true) return new Response("Unauthorized", { status: 401 });
        } else {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }
        const { handleBacklogSendRequest } = await import("@/lib/backlog-send.server");
        try {
          return await handleBacklogSendRequest(request);
        } catch (e) {
          console.error("backlog send failed", (e as Error).message.slice(0, 200));
          return Response.json({ ok: false, error: "backlog send failed" }, { status: 500 });
        }
      },
    },
  },
});
