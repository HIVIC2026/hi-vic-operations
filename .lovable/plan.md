# 48-hour escalation fix (plan only)

## 1. Real bug or out-of-date test?

It's a real bug, and it has two parts.

**The rule** (workflow source of truth and the workflow settings): "48h without confirmed booking → office Needs attention", for all four visits: Ready Check, PIESA, rectification and installation. A reply or a suggested time does not count as a booking.

**Part A: the job-page timer stops the clock too early.**
- The timer on the job page that decides when "Request another electrician" appears treats any first reply as enough.
- So an electrician who replied at hour 40 but never booked shows "Electrician made contact". There is no 48-hour flag and no "request another" option.
- Two tests disagree about this:
  - One says a first reply stops the clock. It is out of date and matches neither the written rule nor the workflow settings.
  - The other expects the 48-hour flag, which matches the rule. That is the one failing.

**Part B: the office check skips Ready Checks.**
- The office check that fills the Needs Home Insulation Victoria list (and sends the 24h reminders) only looks at PIESA, rectification and installation visits. Ready Check visits are left out.
- Database evidence: 10 Ready Check visits have contacts shared, no booking, and are more than 48 hours old. They have never been flagged. All 10 are TEST jobs.
- PIESA, rectification and installation are already handled correctly, using 48 hours since contacts were shared with no confirmed booking.

## 2. Smallest fix

**Part A:**
- After 48 hours with no confirmed booking, the job shows the exception "No booking confirmed after 48 hours — request another electrician", whether or not anyone replied.
- With no reply at all, it keeps the existing message "No meaningful contact after 48 hours — request another electrician".
- The 24-hour "monitoring" message stays as it is: a reply still clears that one.
- A confirmed booking, or "can't attend", behaves as it does today.

**Part B:**
- Add Ready Check to the visits the office check covers, so it gets the same 24h reminder and 48h Needs Home Insulation Victoria entry as the others.
- Ready Check bookings match Ready Check proposals.
- The reminder stays queued only, because sending stays off.

**Tests:**
- Correct the out-of-date test.
- Add tests for every visit type: a reply with no booking after 48 hours is flagged, and a confirmed booking is never flagged.
- Add a Ready Check case to the office check.

**Not changing:** no database change, no new reminder types, no changes to job stages, payment, PIESA times or switches.

## 3. Existing records

- No stored record changes. Both parts only change what's worked out when a job is looked at, or when the office check runs.
- **Part A:** no job is affected right now. No active electrician has replied, not booked, and passed 48 hours.
- **Part B:** the 10 TEST Ready Check visits will appear on the Needs Home Insulation Victoria list, and get a queued (not sent) reminder record, the next time the check runs. No real jobs are affected.

## 4. Undo

Put back the old version of the two rules, or roll back to the current version in History. Nothing in the database needs undoing. The only lasting trace is the office-list entries and queued reminders on the TEST jobs, which nobody receives.

## Technical details

- `src/lib/pilot.core.ts` `appointmentSla`: the 48h branch uses `!a.booking_confirmed_at` instead of `!responded`, with the message chosen by `responded`. The order stays: cannot_attend, then booked, then 48h exception, then 24h attention.
  - Keeps the existing test case where an office-entered booking doesn't count as REC contact.
- `src/lib/allocation.server.ts` `sweepCoordination`: the `visit_kind` filter includes `ready_check`. Map `ready_check` to the matching proposal kind (check the `booking_kind` enum value `ready_check`, or the assessment kind used by the Ready Check flow, before building). The reminder outbox key is unchanged.
- Tests:
  - `tests/scheduling.test.ts`: update the "meaningful first contact" case.
  - `tests/pilot.test.ts`: should then pass.
  - `tests/allocation*.test.ts`: add the Ready Check case and the four-visit cases.
- Checks: focused tests, typecheck, wording scan, build, and the full suite one file at a time.
