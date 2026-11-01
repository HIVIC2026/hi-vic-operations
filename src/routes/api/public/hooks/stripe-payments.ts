import { createFileRoute } from "@tanstack/react-router";

// Stripe webhook (decision 144): card payments for the $349 safety check and the electrical fixes. The raw body is
// verified against STRIPE_WEBHOOK_SECRET, or optional STRIPE_TEST_WEBHOOK_SECRET for explicit livemode=false only
// (Stripe-Signature, 5-minute tolerance); no secret / bad signature = 400 and
// nothing is touched. Payments are recorded once per PaymentIntent (append-only ledger); TEST jobs accept test-mode
// events only and real jobs live-mode only. Always answers quickly so Stripe does not retry a handled event.
export const Route = createFileRoute("/api/public/hooks/stripe-payments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { STRIPE_SIGNATURE_HEADER } = await import("@/lib/stripe.core");
        const { handleStripeWebhook } = await import("@/lib/stripe.server");
        try {
          const r = await handleStripeWebhook(raw, request.headers.get(STRIPE_SIGNATURE_HEADER));
          return r.status === 200 ? Response.json({ received: true, outcome: r.outcome }) : new Response(null, { status: r.status });
        } catch (e) {
          console.error("stripe webhook failed", (e as Error).message);
          return new Response(null, { status: 500 }); // Stripe retries; the ledger dedupes on the PaymentIntent
        }
      },
    },
  },
});
