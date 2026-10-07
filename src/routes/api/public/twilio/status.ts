import { createFileRoute } from "@tanstack/react-router";

// Twilio delivery-status callback. Caller is verified by the secret token in the URL (SMS_WEBHOOK_TOKEN).
export const Route = createFileRoute("/api/public/twilio/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env["SMS_WEBHOOK_TOKEN"];
        if (!token || new URL(request.url).searchParams.get("t") !== token) return new Response("forbidden", { status: 403 });
        const f = new URLSearchParams(await request.text());
        const sid = f.get("MessageSid"), status = f.get("MessageStatus");
        if (sid && status) {
          const { recordSmsStatus } = await import("@/lib/sms.server");
          await recordSmsStatus(sid, status, f.get("ErrorCode"));
        }
        return new Response("ok");
      },
    },
  },
});
