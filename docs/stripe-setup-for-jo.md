# Stripe — set up in 4 steps

Card payments are only for the **$349 safety check** and **electrical fixes**. Deposit and balance stay bank transfer / PayID.
Never paste a key into chat — keys only go into Lovable's secure secrets form.

## 1. Create the account (about 15 minutes)
1. Go to **stripe.com** → **Start now**. Sign up with info@homeinsulationvictoria.com.au.
2. **Activate payments** (Stripe will ask):
   - Business type: Company → your ABN and company name
   - Industry: Home improvement / building services
   - Website: https://estimate.homeinsulationvictoria.com.au
   - Statement name (what owners see on their card): **HOME INSULATION VIC**
   - Your bank account for payouts
   - Your ID (driver's licence)
3. Turn on **Two-step authentication** when it asks.

## 2. Test mode first (I test on a TEST job before any real owner pays)
1. Top right, switch **Test mode** ON.
2. **Developers → API keys** → copy the **Secret key** (starts `sk_test_`). Don't paste it anywhere yet.

## 3. The webhook (tells the portal a card payment went through)
1. **Developers → Webhooks → Add endpoint**
2. Endpoint URL: `https://estimate.homeinsulationvictoria.com.au/api/public/hooks/stripe-payments`
3. Events: tick **checkout.session.completed**, **payment_intent.succeeded** and **charge.refunded** (so refunds show in the portal)
4. Save → on the endpoint page, **Signing secret → Reveal** (starts `whsec_`).

## 4. Tell me "Stripe ready"
I'll then open Lovable's secure form for each secret — you paste them there, not in chat:
- `STRIPE_SECRET_KEY` = the `sk_test_…` key
- `STRIPE_WEBHOOK_SECRET` = the `whsec_…` secret

I test a $349 card payment on a TEST job with Stripe's test card. When it works, you repeat steps 2–3 with Test mode OFF
(live keys `sk_live_…` and a live webhook secret), replace the two secrets, and I switch on `STRIPE_PAYMENTS_ENABLED`.
No card fee is ever charged to the owner.
