# Final Operating Model v2 items: cancellations, reminders, AP queue, daily brief

The task list gets these items when the build starts. Trade payouts (E) are not built and stay blocked until Xero is connected.

## What exists today
- Only the office can cancel a booking. There is no self-service cancel or reschedule for the owner, and no record of a no-show.
- The matching ranking already has places for no-shows and evidence rejections, but both are always 0 because nothing records them.
- Trades have no "I've arrived" tap.
- Reminders exist only before a booking is made: the 24h nudge and the 48h flag. Nothing reminds either side before a booked visit.
- Jobs at AP Review show in the normal office list. There is no clean/flagged grouping and no daily summary.
- The ESC "update notification" and "withdraw and resubmit" flags already react to a moved install date.

## Proposed split (3 builds, one at a time)

### Part 1: Cancellations, no-shows and real reliability (A)
- **Owner, more than 24h before:** an owner link in the booking message and on the owner page lets them reschedule or cancel. Rescheduling reopens the owner time picker for that visit type: Ready Check, PIESA or install days. Rectification reopens the electrician's windows.
- **Owner, under 24h before, or not home:**
  - A late cancel counts as an owner no-show.
  - The trade can mark "Owner not home" after the visit start.
  - First miss: the owner is offered new times once, free.
  - Second miss: the job goes on the needs-attention list.
- **Trade cancels:** the booking closes and the owner is automatically offered new times (queued only). One cancellation is recorded against that business.
- **Trade no-show:** if 4 hours after the visit start there is no "I've arrived" tap and no evidence, the job goes on the needs-attention list straight away and one no-show is recorded against that business. A new large "I've arrived" button goes on the trade's job page.
- **Install moved:** uses the existing ESC flags and the 30-day hard gate. No change.
- **Reliability:** no-shows, trade cancellations and evidence rejections are now recorded per business. Matching uses the real counts from the last 90 days for both electricians and installers.
- **Database:** one new permanent table of visit events (cancelled, no-show, arrived, evidence rejected). Nothing existing changes.

### Part 2: Visit reminders and the daily brief (B + D)
- **Reminders:** 24 hours and 2 hours before every booked visit, to both the owner and the trade, for all four visit types. They are queued only and sent once each. If the visit is moved, new reminders are queued for the new time.
- **Daily brief at 7am Melbourne:** one message to the AP, and also a "Today" page in the office portal.
  - What needs them: the needs-attention list grouped by urgency, and the AP approval queue count.
  - At risk this week: 30-day clocks ending, ESC submit deadlines, and installs without a passed pre-start check.
  - Yesterday's numbers: enquiries, bookings, installs completed, VEECs submitted and registered.
- While sending is off, the brief is stored and shown in the portal only.
- **Database:** one small table that keeps each day's brief, so the brief is produced only once per day. The existing 15-minute timer produces it at 7am, so no new timer is needed.

### Part 3: AP approval queue (C)
- A new office page lists jobs ready for final AP review in two groups:
  - **No flags.**
  - **Flagged**, each with its reasons. Example reasons: measured area more than 15% from the estimate, a provisional or expired certificate, rejected evidence that was re-uploaded, an office override used, a recorded no-show or late change, a manual price edit.
- The flag reasons come only from existing records. No new rules decide eligibility.
- Each job is approved one at a time with its own record: who, when and a note.
- "Approve" stays per job. There is no bulk approve and nothing is ever approved automatically.
- **Database:** probably none. Approval reuses the existing AP review action and its audit history. If a separate approval record is needed, it will be additive and proved on a practice database first.

## Effect on existing records
- Nothing existing is changed and nothing is filled in after the fact.
- Old no-shows aren't known, so everyone starts at 0, the same as now.
- Existing bookings get reminders only for visits more than 2 hours away once Part 2 is live.
- Sending and the payment gate stay off.

## Undo
Each part is its own version, so you can roll it back in History. Each database change has a ready undo file that removes only the new tables.

## Assumptions (correct me if wrong)
1. "Up to 24h before" is measured from the visit start time.
2. A trade no-show is counted 4 hours after the visit start. The office can clear a wrong no-show, with a reason.
3. A trade cancellation lowers reliability just like a decline. A no-show counts more: 0.1 each, as already in the ranking.
4. The daily brief goes to users with the admin (AP) role.

## Technical details
- Part 1:
  - pure `visit-events.core.ts` for the cutoff, the no-show timing and the rebook count
  - persistence in `visit-events.server.ts`, with an owner link signed like the estimate link
  - matching facts come from `visit_events` instead of the zeros now in `allocation.server.ts` and `readycheck-booking.server.ts`
  - new needs codes `owner_no_show_repeat` and `trade_no_show`
- Part 2:
  - outbox actions keyed by booking + time, so each reminder is queued once
  - `daily_briefs` table with a unique day row, built in `daily-brief.server.ts` and run from `allocation-tick` after 7am Melbourne
- Part 3:
  - pure `ap-flags.core.ts` that turns existing facts into flags (area variance from `ceiling_measurements` vs the estimate, certification level, evidence history, overrides, visit events)
  - a route under `_authenticated/admin`
- Each part: a practice database (PGlite) test, then live; then focused tests, the code check, the wording scan and the preview build.
