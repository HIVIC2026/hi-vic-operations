---
name: PIESA rate launch blocker
description: Real PIESA offers blocked until every active electrician/REC has an approved PIESA rate, or office uses rate-to-confirm with an audit reason
type: feature
---
Launch blocker (recorded 4 Oct 2026, user-stated): Real PIESA offers cannot go live until approved electrician PIESA rates are entered for every active electrician/REC, or office explicitly uses rate-to-confirm with an audit reason.

- $349 is the customer-facing PIESA price only — never the electrician fee/payout.
- Electrician screens show only the electrician's own agreed rate or "Rate to be confirmed".
- Offers without a recorded agreed rate are blocked (offerRateBlocker) unless office explicitly marks rate-to-confirm (logged as rec_offer_rate_to_confirm).
- Rates live in the office-only electrician rate card (migration 0089, electrician_rates); trades can never write rates.
