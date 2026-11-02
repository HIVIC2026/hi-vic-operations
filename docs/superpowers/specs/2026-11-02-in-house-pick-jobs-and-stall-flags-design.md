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

### 2. Stall flags for in-house jobs

**Found while planning:** in-house jobs already get two sets of stall flags in `src/lib/office-needs.core.ts`:
- the `ih` block (around line 220): install not booked with ≤7 days left (`in_house_install_not_booked`), PIESA not *completed* 10 *calendar* days after quote acceptance (`in_house_piesa_overdue`), and Ready Check not booked after 2 business days (`in_house_ready_check_not_booked`)
- the `bookingOverdue` row ("… not booked after 2 business days"), fed from `office-needs.server.ts` around line 312

The change makes the `ih` block follow Jo's rules and removes the duplicate in-house `bookingOverdue` flag:

- **Ready Check** (`in_house_ready_check_not_booked`): not booked and the Melbourne date today is after `addVicBusinessDays(batchSentAt, 5)` (was 2).
- **PIESA** (`in_house_piesa_overdue`): not **booked** (no non-cancelled `assessment` booking) and the Melbourne date today is after `addVicBusinessDays(piesaUnlockedAt, 10)` (was: not completed, 10 calendar days from `quotes.accepted_at`). `piesaUnlockedAt` is when the job last moved into `piesa_and_install_window_pending`, which only happens once the $349 clears, so a slow-paying owner doesn't flag the partner. `inHouseNeedsFacts` adds `piesaBooked` and `piesaUnlockedAt`, and its bookings read includes `"assessment"`.
- **Install** (`in_house_install_not_booked`): rule unchanged (not booked, ≤7 days left on the 30-day clock, from `job_piesa_deadlines`). It flags whether or not the deposit is paid. `inHouseNeedsFacts` adds `depositPaid: boolean | null` from `installDepositPaidForJobs`.

Office lines:
- "Ready Check not booked after 5 business days"
- "PIESA not booked 10 business days after quote accepted"
- "Install not booked · N days left · deposit paid" / "… · deposit not paid" (and "30-day window expired" in place of "N days left" once it's below 0, as now). If the deposit can't be read, the deposit part is left off.

Each flag keeps its current kind, rank, group and "Open job" button.

- `office-needs.server.ts`: the block that sets `bookingOverdue` for in-house jobs (around line 312) is removed, so in-house jobs never get the 2-business-day row. Jobs not with an in-house partner keep the 48-hour `bookingOverdue` rule as it is today.
- `bookingOverdue` in `in-house-booking.core.ts` is removed if nothing else uses it.

### 3. Follow-up fixes (Jo, 2 Nov 2026)

- **Finished PIESA:** `in_house_piesa_overdue` never shows once the PIESA is completed (`piesaCompleted`), even with no booking row.
- **Message after giving jobs** (`in-house-handoff.tsx`):
  - all given: "3 jobs given to Rapid." ("1 job given to Rapid.")
  - some refused: "2 jobs given to Rapid. Not given: HV-1234 (Outside this partner's coverage)." (several refused are joined with "; ")
  - none given: "Not given: HV-1234 (…)."
- The stale "exactly five" comment on `readyInHouseBatch` is corrected.

## Not changing

- Owner messages: the owner still gets the email only when a job goes to a partner.
- Reinsulate can't choose HIV's electrician on in-house jobs (left out).
- No flag for electrical upgrades (rectification) bookings.
- No emails to partners about stalls.
- Where flags show in the office.

## Testing

- Unit tests for `readyInHouseBatch` (0, 1, 3, 7 ids; duplicates).
- `buildNeedsRows` tests for the `ih` block: each rule just before and just after its limit, weekends and public holidays for the business-day rules, install with the deposit paid / not paid / unknown, booked visits never flag, and no deadline never flags.
- Test that an in-house job with an unbooked visit gets no "not booked after 2 business days" row.
- Component test: the button is greyed out with nothing ticked, the label counts the ticks, and ticking 1 job sends 1 id.
- The existing in-house tests still pass. TEST jobs stay excluded, as now.

## After it's live

Update the partner guide doc (section 6, "If something changes") to the 5/10/7 rule, and section 3 to remove "5 at a time".
