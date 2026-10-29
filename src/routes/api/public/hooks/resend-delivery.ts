import { createFileRoute } from "@tanstack/react-router";

// Resend webhook: tells us whether an email was delivered or bounced. The raw body is verified against
// RESEND_WEBHOOK_SECRET (Svix headers, 5-minute tolerance); no secret / bad signature = 401 and nothing is touched.
// Unknown ids and other event types answer 200 so Resend does not retry them.
export const Route = createFileRoute("/api/public/hooks/resend-delivery")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const secret = process.env["RESEND_WEBHOOK_SECRET"];
        if (!secret) return new Response(null, { status: 401 });
        const { verifyResendSignature, resendEventResult } = await import("@/lib/email-delivery.core");
        const ok = verifyResendSignature(raw, { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, secret, Date.now());
        if (!ok) return new Response(null, { status: 401 });
        let evt: Parameters<typeof resendEventResult>[0];
        try { evt = JSON.parse(raw); } catch { return Response.json({ received: true, changed: 0 }); }
        const r = resendEventResult(evt);
        if (!r) return Response.json({ received: true, changed: 0 });
        try {
          const { applyDeliveryResult } = await import("@/lib/email-delivery.server");
          const changed = await applyDeliveryResult({ providerMessageId: r.emailId, result: r.result, detail: r.detail, at: new Date().toISOString() });
          return Response.json({ received: true, changed });
        } catch (e) {
          console.error("resend delivery webhook failed", (e as Error).message);
          return new Response(null, { status: 500 }); // Resend retries; the update is idempotent
        }
      },
    },
  },
});
