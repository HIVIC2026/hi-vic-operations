import { createFileRoute } from "@tanstack/react-router";

// Twilio incoming-message webhook: records STOP / START. Caller is verified by the secret token in the URL.
// Never sends anything back itself; Twilio's own opt-out reply handles the confirmation text.
export const Route = createFileRoute("/api/public/twilio/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env["SMS_WEBHOOK_TOKEN"];
        if (!token || new URL(request.url).searchParams.get("t") !== token) return new Response("forbidden", { status: 403 });
        const f = new URLSearchParams(await request.text());
        const from = f.get("From"), body = f.get("Body");
        if (from) {
          const { recordInboundReply } = await import("@/lib/sms.server");
          await recordInboundReply(from, body ?? "");
        }
        return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
      },
    },
  },
});
