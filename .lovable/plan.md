# Step 6: Owner picks PIESA times, and the electrician's tap is the booking

New standing rule (I'll save it to project memory on "go"): every database change is proven on a practice database before it touches the real one. Step 5's change went straight onto the real database. On "go" I'll also run it on a practice database and tell you the result.

## 1. What I would add or change

**Owner side**
- A new last step in the owner's acceptance flow, after the quote is accepted, the consents are signed and a payment option is chosen: "Pick 3–5 times for your electrical safety check (PIESA)."
- The owner must choose 3 to 5 times, on at least 3 different days.
- Allowed times start at least 2 business days ahead and fall within the next 21 days. There are no capacity holds yet, so this simpler rule applies. Weekends and Victorian public holidays don't count as business days.
- Times are morning or afternoon slots in Melbourne time.
- The times are saved in the existing appointment-times list as owner-proposed times for the PIESA.

**Electrician side**
- Each PIESA offer shows the owner's times as buttons, plus the electrician's own agreed rate (unchanged).
- Tapping a time, if they're first, does three things in one locked step:
  - accepts the offer
  - confirms the booking for that time
  - closes all other offers for the job
- If someone else got there first, they see "This job has just been taken." Nothing else changes.
- The tapped time is marked accepted and the owner's other times are closed.
- Owner contact details are released only at that moment, for the PIESA visit only. This uses the existing release record.
- Booking confirmation reuses the existing booking step, so the PIESA payment check, the PIESA window rules and the installer planning notice all still apply.

**When nobody accepts**
- Offers expire as they do now and the next batch goes out with the same times.
- If every approved electrician has been tried and no one accepted, the owner is asked for more times. That request is queued only, because sending stays off. Earlier times that have passed are closed, and the offers restart with the new times.
- If the second round also gets no acceptance, the job goes on the Needs Home Insulation Victoria list as "No electrician could take the owner's times."

**Fallback (old path kept)**
- On an offer, the electrician can tap "None of these times work — accept and arrange a time."
- This is the current path: accept, contact details released, then a time is agreed afterwards with the existing 24h reminder and 48h exception.
- It's also used automatically when a job has no owner-picked times, which covers every job already in progress.

## 2. Existing parts it touches
- Owner acceptance flow: one extra step at the end.
- The appointment-times list: reused, with one new optional link to the offer round.
- Electrician offer cards on the partner dashboard: new time buttons and the fallback button.
- The locked "accept offer" step in the database: a new version that also takes a chosen time. The old version stays for the fallback.
- Existing booking confirmation, contact release, next-batch and coverage-exhausted logic: reused.
- The 15-minute timer: also checks for the "ask the owner for more times" case.
- The Needs Home Insulation Victoria list: one new reason.
- Database: additions only. That's one new optional column, one new database step and one new owner request type. Nothing is renamed or deleted.
- It is proven on a practice database first, then applied for preview.

## 3. Jobs already mid-PIESA under the old flow
- Today there are 4, all TEST jobs:
  - 3 waiting on the PIESA, with 2 electricians already assigned and 1 open offer
  - 1 PIESA already booked
- No real jobs are affected.
- They have no owner-picked times, so they carry on exactly as now through the old "accept then arrange a time" path. I won't change or backfill any existing record.
- New times are only asked for on quotes accepted after this goes live.

## 4. How to undo it
- Hide the time-picker step and the time buttons, and offers fall back to the old path straight away. Or roll back to this version in History.
- The new column and database step can stay unused without harm. A rollback script is tested on the practice database as well.

## Checks after building (preview only, no publish)
- Practice database tests:
  - first tap wins
  - two electricians tapping at once leaves only one booked
  - expired, wrong-area and unapproved electricians are refused
  - contacts are released only to the winner, for the PIESA only
  - the fallback still works
  - the ask-for-more-times and needs-attention order is right
- Rule tests for the time limits: at least 3 different days, between 3 and 5 times, 2 business days to 21 days ahead.
- Browser check on TEST jobs as a TEST owner and TEST Delta Electrical.
- Then typecheck, wording scan, build and the full test suite.
- Sending, the payment gate, Xero and Mitti stay off. Nothing else changes.

## Questions to confirm
- Slot shape: morning (8am–12pm) and afternoon (12pm–4pm) windows, or exact start times? I'd assume windows.
- The second "no acceptance" goes straight to the needs-attention list, with no third request to the owner. I'd assume yes.
