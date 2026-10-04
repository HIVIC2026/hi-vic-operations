# Step 7: Electrician matching (Operating Model v2)

Plus the approved one-liner: an office-entered **confirmed** booking clears the 48-hour flag.

## What exists today
- Offers already go out in batches of 3 (setting), with "next batch" when nobody accepts, and the step 6 "ask owner for more times" then needs-attention flow.
- Eligibility check already covers: approved and active, accepting jobs, verified postcode coverage, current licence/REC, at least one approved licensed electrician, weekly capacity.
- Ranking today: preferred partner, exact postcode, spare capacity, fewest recent offers, acceptance rate. Price is not used.
- Offers expire after a plain number of clock hours (setting, default 2), checked by the existing 15-minute timer.
- Not tracked today: daily job limit, no-shows, acceptance speed, "job nearby that day".

## What I would change
1. **Eligibility** – add two checks:
   - Free in at least one of the owner's PIESA windows (no confirmed booking for that electrician in that window). If the owner hasn't given times yet, this check is skipped.
   - Under their daily limit, only if one is set (new optional field, empty = no limit).
2. **Ranking** (new order, price still never used):
   1. Already has a confirmed job in a nearby postcode on one of the owner's window days (same postcode, or one of their verified service postcodes).
   2. Reliability: acceptance rate, minus no-shows and rejected evidence where recorded. Missing history = neutral.
   3. Fewest jobs in the last 30 days (fair spread).
   4. Fastest average acceptance time.
   The existing "preferred electrician of the installer" rule stays first — please confirm or tell me to drop it.
3. **4 business hours to accept** – Melbourne time, weekdays 8am–5pm (please confirm hours), skipping Vic public holidays (reuses the step 6 holiday list). An offer sent Friday 4pm expires Monday 11am.
4. **Next 3** – unchanged batches of 3 with the same owner times; when everyone has been tried, step 6's flow runs as today.
5. **Office booking** – an office-entered confirmed booking clears the 48-hour flag (one line in the job-page timer).
6. Uses the existing 15-minute timer; no new schedule.

## Parts touched
- Electrician eligibility/ranking rules and offer expiry (pure, tested).
- The candidate list builder that gathers facts for each electrician.
- Office REC settings: one optional "daily job limit" box.
- Job-page 48-hour timer (office booking line).
- Tests for each rule, plus a business-hours expiry test across a weekend and a public holiday.

## Database change (practice first)
One small additive change: an optional daily limit on businesses, and a "business hours" offer time setting (default 4). Proven on a practice database first (existing rows unchanged, rollback clean), then applied only after you say go. No-shows: counted from existing booking records where marked; if no such marker exists I count none and say so, rather than invent one.

## Effect on existing offers and records
- Offers already sent keep their current expiry time; the new 4-business-hour rule applies only to new offers.
- No existing records changed. No backfill. Sending stays off.

## Undo
Revert ranking/expiry functions in History; the new optional field and setting can be left unused (empty = old behaviour).

## Questions
- Business hours: 8am–5pm OK?
- Keep the installer's preferred electrician at the top?
