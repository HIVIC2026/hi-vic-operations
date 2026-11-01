# In-house partners: pick any jobs, and 5/10/7-day stall flags — design

Date: 2 Nov 2026 · Design approved in chat by Jo, spec waiting for her review

## Why

While writing the guide for Rapid, Reinsulate and No Gap, we checked it against the code and found two places where the portal doesn't match what Jo decided:

1. Jobs can only go to an in-house partner 5 at a time (`readyInHouseBatch` needs 5, and the server says "Waiting for 5 eligible jobs for this installer"). Jo wants to give any number.
2. A stalled in-house job is flagged when a visit isn't booked within 2 business days (`bookingOverdue`). Jo's rule is 5 / 10 / 7 days.

## Rules (Jo, 2 Nov 2026)

**Giving jobs**
- Jo ticks the jobs she wants to give. She can give any number, from 1 up.

**Stalled in-house jobs** (these replace the 2-business-day flag for in-house jobs)
- **Ready Check:** not booked 5 business days after the job was given to the partner.
- **PIESA:** not booked 10 business days after the quote was accepted (the $349 paid).
- **Install:** not booked when there are 7 days or fewer left on the 30-day clock. This flags even if the owner hasn't paid the 10% deposit, and the line says which.
- The partner keeps the job. Only the office sees the flag.

## What changes

### 1. Pick jobs with tick boxes

- `src/components/portal/in-house-handoff.tsx` (the In-house installers section on the installer waiting screen): each partner lists **all** their waiting jobs (job number · address), each with a tick box. Nothing is ticked to start with.
- The button reads "Give N job(s) to <partner>" (for example "Give 1 job to Rapid", "Give 3 jobs to Rapid").
- With nothing ticked the button is greyed out, with the line "Tick at least one job to give." (This follows Jo's greyed-out-button rule.)
- After giving, the ticks clear and the list refreshes.
- `src/lib/in-house-batch.core.ts` `readyInHouseBatch`: returns the distinct ids when there's at least 1 (no 5 minimum and no cutting down to 5).
- `src/lib/in-house-batch.server.ts` `sendInHouseBatch`: with no eligible jobs, the refusal reads "No eligible jobs for this installer". All the other checks stay as they are (coverage, opted out, quick taps "yes", another installer waiting).
- `src/routes/_authenticated/admin.in-house-batches.tsx`: the `checkedIds.length < 5` limit becomes `< 1`, so this page can't still demand 5.

### 2. New stall flags for in-house jobs

New pure function in `src/lib/in-house-booking.core.ts`, replacing `bookingOverdue` for in-house jobs:

`inHouseStall({ visit, anchorAt, booked, deadline, depositPaid, now })` → null, or `{ visit, at, line }`

- `ready_check`: anchor = the `in_house_batch_sent` time. Flags when not booked and now is after the anchor + 5 Melbourne business days (`addMelbourneBusinessDays`).
- `piesa`: anchor = when the job entered `piesa_and_install_window_pending` (the same date the code uses now). Flags when not booked and now is after the anchor + 10 Melbourne business days.
- `installation`: deadline = `installWindowDeadline(clearance timing date, stored install deadline)`. Flags when no install is booked and the Melbourne date today is on or after deadline − 7 days. Checked at every stage from `piesa_complete` up to and including `installation_scheduling` (not on hold or cancelled), so jobs still waiting on electrical upgrades or the deposit are covered.

Office lines (in `src/lib/office-needs.core.ts`, used only when the job is with an in-house partner):
- "Ready Check not booked after 5 business days"
- "PIESA not booked 10 business days after quote accepted"
- "Install not booked · 7 days left · deposit paid" / "… · deposit not paid"

The flag keeps its current rank, group and "Open job" button. `src/lib/office-needs.server.ts` (the in-house block around line 312) gathers the anchor, booking, deadline and deposit facts and calls `inHouseStall`. Jobs not with an in-house partner keep the 48-hour rule as it is today.

`bookingOverdue` is removed if nothing else uses it.

## Not changing

- Owner messages: the owner still gets the email only when a job goes to a partner.
- Reinsulate can't choose HIV's electrician on in-house jobs (left out).
- No flag for electrical upgrades (rectification) bookings.
- No emails to partners about stalls.
- Where flags show in the office.

## Testing

- Unit tests for `readyInHouseBatch` (0, 1, 3, 7 ids; duplicates).
- Unit tests for `inHouseStall`: each visit just before and just after its limit, weekends and public holidays for the business-day rules, install with the deposit paid and not paid, booked visits never flag, and a missing deadline never flags.
- Unit test for the office lines.
- Component test: the button is greyed out with nothing ticked, the label counts the ticks, and ticking 1 job sends 1 id.
- The existing in-house tests still pass. TEST jobs stay excluded, as now.

## After it's live

Update the partner guide doc (section 6, "If something changes") to the 5/10/7 rule, and section 3 to remove "5 at a time".
