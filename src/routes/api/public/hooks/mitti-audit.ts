import { createFileRoute } from "@tanstack/react-router";
import { mittiNoticeAuditId, mittiNoticeTokenOk } from "@/lib/mitti-webhook.core";

// Mitti "form changed" notice. Caller is verified by the secret token in the URL (?t=). The body is only used to find the
// audit id; the portal re-reads the form itself. Once the token is good this always answers 200 so Mitti never retries.
export const Route = createFileRoute("/api/public/hooks/mitti-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!mittiNoticeTokenOk(new URL(request.url).searchParams.get("t"), process.env["MITTI_WEBHOOK_TOKEN"])) return new Response("forbidden", { status: 403 });
        const auditId = mittiNoticeAuditId(await request.text());
        if (auditId) {
          try {
            const { handleMittiNotice } = await import("@/lib/mitti-webhook.server");
            await handleMittiNotice(auditId);
          } catch (e) {
            console.error("mitti notice: handler failed", e instanceof Error ? e.message : String(e));
          }
        }
        return Response.json({ ok: true });
      },
    },
  },
});
