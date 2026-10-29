import { createFileRoute } from "@tanstack/react-router";
import { mittiNoticeAuditId, mittiNoticeBodyKeys, mittiNoticeTokenOk } from "@/lib/mitti-webhook.core";

// Mitti "form changed" notice. Caller is verified by the secret token in the URL (?t=). The body is only used to find the
// audit id; the portal re-reads the form itself. Once the token is good this always answers 200 at once so Mitti never retries;
// the one-job sync runs after the response (runAfterResponse) and the 15-minute pull is the backup.
export const Route = createFileRoute("/api/public/hooks/mitti-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!mittiNoticeTokenOk(new URL(request.url).searchParams.get("t"), process.env["MITTI_WEBHOOK_TOKEN"])) return new Response("forbidden", { status: 403 });
        // Answer Mitti first; the sync runs after the response. An unreadable (aborted) body gets 200 and runs nothing.
        let auditId: string | null = null;
        try {
          const raw = await request.text();
          auditId = mittiNoticeAuditId(raw);
          // Key names only, never values: tells us Mitti's real body shape from the first live notice.
          if (!auditId) console.warn("mitti notice: no audit id", mittiNoticeBodyKeys(raw));
        } catch {
          return Response.json({ ok: true });
        }
        if (auditId) {
          const id = auditId;
          const { runAfterResponse } = await import("@/lib/background.server");
          runAfterResponse(async () => {
            try {
              const { handleMittiNotice } = await import("@/lib/mitti-webhook.server");
              await handleMittiNotice(id);
            } catch (e) {
              console.error("mitti notice: handler failed", id, e instanceof Error ? e.message : String(e));
            }
          });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
