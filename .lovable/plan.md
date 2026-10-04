# Step 11: Ready Check booking (owner windows + installer one-tap), plus step 10 tests

## Also in this build: tests for step 10
- The installer safety form is not sent to Mitti while the day-before check is failed or missing, and is sent once it passes.
- Installation evidence uploads are refused (request and confirm) while locked. Measure-up photos still work.
- Recording the ESC submission re-runs the check straight away, so the lock lifts when everything else is fine.

## What exists today
- The owner requests a Ready Check (estimate page, then "Ready Check - Awaiting Acceptance"). The office then assigns an installer by hand. The installer phones the owner, and the time is set through propose/confirm. The 24h reminder and 48h flag already cover Ready Checks.
- The PIESA side already has everything this step needs:
  - owner morning/afternoon windows (3–5 windows, 3 different days, 2 business days to 21 days out, Vic public holidays)
  - matching of electricians, with price never counted
  - offers to 3 at a time, with 4 business hours to accept
  - the 15-minute timer
  - one tap books the visit and closes the other offers
  - contact details released for one visit only
  - two rounds, then needs-attention
- Installer offers today allow only one open offer per job. That blocks offering a Ready Check to 3 installers at once.
- Estimate views are already recorded ("estimate_viewed").

## What changes
1. **Owner picks windows when requesting the Ready Check.** It uses the same picker and rules as PIESA, with the wording changed to "Ready Check".
2. **Price seen first.** If the job has an estimate and the owner hasn't viewed it yet, the estimate is shown before they can submit, and the view is recorded. If there is no estimate, nothing is blocked.
3. **Matching installers.** The PIESA matching is reused for installers.
   - Eligible: approved, a FULL and current EEC certification, covers the postcode, free in at least one window, and under their m²-per-day capacity if set. The Ready Check counts as one visit, not m².
   - Ranked by: a job nearby that day, then reliability, then fewest Ready Checks in the last 30 days, then acceptance speed. Price is never used.
4. **Offers and timing.** Top 3 at once, 4 business hours to accept, then the next 3. With no taker, the owner is asked once for more times. After that round, the job goes to needs-attention ("No installer could take the owner's Ready Check times").
5. **One tap = booked.** It uses the same safe first-tap-wins booking as PIESA. That tap books the Ready Check, makes the installer the assigned installer, closes the other offers, and releases contact details for the Ready Check only. Messages are queued only.
6. **Quoted installer by default.** Whatever happens today when the Ready Check installer becomes the quoting installer stays as it is. If no such link exists today, I'll tell you rather than add one.
7. **Fallback.** "None of these work — accept and arrange a time" assigns the installer, releases contact for the Ready Check only, and uses the old propose/confirm path with the 24h/48h checks.
8. **No payment to installers.** The offer shows "Free Ready Check — unpaid". No rate is shown or needed, and no rate-card check applies.
9. The office can still assign an installer by hand.

## Parts touched
- The owner estimate and Ready Check request page, and the shared window picker.
- Matching, offers and timer code (reused, with an installer/Ready Check version added).
- The installer dashboard: a "Ready Check times" offer card, like the PIESA card.
- The office needs-attention list: one new entry.
- One small additive database change, proved on a practice database first. It allows up to 3 open Ready Check offers per job instead of one, and adds a first-tap-wins booking action for Ready Checks. It adds no tables and changes no rows.

## Effect on existing jobs and records
- Nothing existing is changed and nothing is filled in after the fact.
- Jobs already assigned or booked for a Ready Check stay on the old path.
- Existing open installer offers stay as they are.
- Sending and the payment gate stay off.

## Undo
Roll back to the previous version in History, and run the ready undo file for the database change. That puts back the one-open-installer-offer rule and removes the new booking action.

## Technical details
- Reuse `piesa-windows.core` (generalise labels by visit kind), `rankRecCandidates`/`nextOfferBatch` (installer facts: EEC from `worker_certification_levels`, capacity from `daily_capacity_m2`), `offerExpiryBusinessHours`, `noTakerStep`.
- Migration: replace the `partner_offers_one_pending_installer` partial index with a kind-aware one (one pending per business stays). Add a Ready Check variant of the accept-slot SQL function (`booking_kind = ready_check`, stage moves to `ready_check_scheduled`, contact release `ready_check`).
- Gate: price-seen comes from `estimate_viewed` engagement or estimate link `last_viewed_at`.
- New tests: window rules for Ready Checks, installer eligibility/ranking (price excluded), the round flow, a practice-database first-tap race, the price-seen gate, and the three step 10 tests.
