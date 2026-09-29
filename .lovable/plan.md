# Step 3 outcome-email routing fix

## Scope
- Route initial customer outcomes only from the latest official recorded system/admin eligibility decision.
- Send estimate emails only for official likely/onsite outcomes.
- Send the existing ineligible email only for official confirmed ineligible outcomes, using the stored official customer-safe reason.
- Hold review, undecided, unrecorded, and pending-initial-check states without reservation or delivery.
- Keep legacy exported names/purpose keys where needed for compatibility and preserve existing sent-history idempotency.

## Retry safety
- Extend the scheduled initial-email scan to consider both eligible estimate links and confirmed-ineligible jobs.
- Recheck official eligibility, queue state, consent, suppression, backlog cutoff, both delivery locks, and existing reservations immediately before any mocked delivery.
- Ensure stale website preliminary outcomes never select delivery.

## Verification
- Add focused regressions for preliminary/official disagreement, pending/review states, confirmed ineligible without preliminary data, direct-sender bypass attempts, scheduled retries, and duplicate prevention.
- Re-run the focused routing/dispatch tests, typecheck, and automatic build check.
- Report the separate no-area renderer failure as an unchanged limitation only.

## Exclusions
No Gate 1 rule, pricing, formula, website, email copy/UI, production data/settings, deployment, payment, or external send changes.
