Read-only check of the card button for HV-3682 is finished. Nothing was changed.

If Jo wants the button turned on (only with her approval):
1. Add a new project secret, STRIPE_PAYMENTS_ENABLED, set to exactly `true`. Jo adds it herself in Project Settings → Secrets.
2. Make sure the live Stripe webhook points at /api/public/hooks/stripe-payments, sends checkout.session.completed and payment_intent.succeeded, and that its signing secret is saved as STRIPE_WEBHOOK_SECRET.
3. Read-only re-check: stripeBlocker for HV-3682 should then return no blocker.

No code changes are needed.
