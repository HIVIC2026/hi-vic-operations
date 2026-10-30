import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Scheduled Outlook correspondence sync (read-only mailbox pull), then the AI auto-reply sender. Counts only in the response.
export const Route = createFileRoute("/api/public/hooks/outlook-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { runOutlookSync } = await import("@/lib/outlook-sync.server");
        const r = await runOutlookSync();
        // AI replies step 4: only now — after the whole sync, inbound AND Sent Items stored — are queued AI replies (and,
        // from 7am, ones held overnight) checked again and sent. A failed or incomplete sync (catch-up, or a
        // next link left over) sends nothing this tick. Never stops the mail sync.
        const held = await (await import("@/lib/ai-auto-send.server")).sweepHeldAutoReplies(new Date(), { syncOk: r.ok && r.complete })
          .catch((e) => { console.error("held AI replies sweep failed", e instanceof Error ? e.message : e); return null; });
        return Response.json({ ok: r.ok, blocker: r.blocker ? (r.blocker === "not_connected" ? "not_connected" : "sync_error") : null, counts: r.counts, heldAutoReplies: held });
      },
    },
  },
});
