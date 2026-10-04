# Step 2 — A real scheduled timer for reminders and expired offers

## What changes for you
Today, expired electrician offers and the 24-hour booking reminders are only checked when someone opens the office "Needs Home Insulation Victoria" queue. If nobody opens it, nothing happens. After this step, the portal checks automatically every 15 minutes, whether or not anyone is signed in.

## What the timer will do (exactly what the queue already does today, nothing new)
1. Expire electrician offers that ran out of time, and offer the job to the next batch.
2. Queue the 24-hour "no time entered yet" reminders and raise the 48-hour "needs attention" flags.
3. Flag electricians who have lost approval.

## What stays exactly the same
- Messages are still only queued. The sending switch stays off, so nothing reaches anyone.
- The payment gate stays off, so no real PIESA offer can start.
- No job changes stage. No Xero, no Mitti.
- The office queue keeps running the same checks when opened (harmless, they're safe to repeat).
- No new reminder types and no new timings. Those come in later steps.

## One thing to know
The existing check includes "start PIESA offers for jobs that are ready". While the payment gate is off, no job can be ready, so it does nothing. Once the payment gate is switched on, the timer will start offers automatically without anyone opening the queue. That matches the approved design, but it's worth knowing before that switch is flipped.

## Cost
Every 15 minutes is 96 checks a day. That keeps the database a little busier even when there's nothing to do. Hourly (24 a day) would be cheaper, but an offer could then sit expired for up to an hour before the next batch. 15 minutes fits the 4-hour offer window well.

## What it adds, what it touches, what it leaves alone
- Adds: one new timed check, and one schedule that calls it every 15 minutes.
- Touches: nothing existing is edited. It reuses the two checks the office queue already runs.
- Leaves alone: no tables, fields or saved records are changed or removed. No screens, wording, rules or switches change. The office queue, follow-up emails and enquiry checks keep working as they do now.
- To undo: delete the schedule, and everything goes back to how it works today.

## Technical details
- New route `src/routes/api/public/hooks/allocation-tick.ts`, secured the same way as the existing `customer-followups` hook (one-time cron nonce via `consume_cron_nonce`, fallback `authenticateCronRequest`). Calls existing `sweepRecOffers()` and `sweepCoordination()`; returns counts only, no personal data.
- One `pg_cron` job (every 15 min) calling the published URL, created with the same nonce pattern as the existing follow-up cron. Data-only setup; no table changes, no migration.
- Tests: route rejects calls without valid auth; calls both sweeps; returns counts only.
- Not published. Will run against the preview first and confirm in the job history that a tick happened with no stage changes and no messages sent.
