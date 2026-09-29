import { createFileRoute } from "@tanstack/react-router";
import { clickBody } from "@/lib/referral.core";

const CORS = { "Access-Control-Allow-Origin": "https://homeinsulationvictoria.com.au", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store" };

// Public referral click. Always returns the same generic success; no PII in or out.
export const Route = createFileRoute("/api/public/referrals/track-click")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length <= 1024) {
          let b: unknown = null;
          try { b = JSON.parse(raw); } catch { /* generic */ }
          const body = clickBody(b);
          if (body) {
            const { trackReferralClick } = await import("@/lib/referral.server");
            await trackReferralClick(body.token).catch((e) => console.error("referral click failed", (e as Error).message));
          }
        }
        return Response.json({ ok: true }, { headers: CORS });
      },
    },
  },
});
