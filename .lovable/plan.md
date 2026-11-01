HV-3682 card payment: the owner paid, but the portal was never told

Findings (read-only):
- Stripe: checkout session is complete and paid, $349.00, live. Payment intent succeeded, $349.00 received.
- Stripe live account has 0 webhook endpoints. The event (checkout.session.completed, 06:34:43 UTC) had 0 pending deliveries, so it went nowhere.
- Portal: no requests to /api/public/hooks/stripe-payments in the server logs. The only job event since 06:25 UTC is stripe_checkout_started. The invoice is still deposit_due with $0 paid.

Cause: the webhook Jo set up earlier is on the Stripe TEST account only. The live account has none.

Safe fix (needs Jo's approval):
1. Jo adds a webhook on the LIVE Stripe account. URL: https://portal.homeinsulationvictoria.com.au/api/public/hooks/stripe-payments. Events: checkout.session.completed and payment_intent.succeeded.
2. Jo saves that endpoint's signing secret as STRIPE_WEBHOOK_SECRET in Project Settings → Secrets (replacing the current value).
3. Jo uses Stripe's "Resend" on event evt_1UWsLo2mHMOLFdyfAM2pWK7A. The existing handler records the $349 once; duplicates are ignored.
4. Read-only check that HV-3682 shows $349 paid and can move to PIESA booking. No manual marking as paid, no refund, nothing re-charged.
