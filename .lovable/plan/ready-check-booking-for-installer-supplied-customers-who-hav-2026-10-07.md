# Ready Check booking for installer-supplied customers who haven't been quoted (Jo, 6pm)

## Fit check: what already works
- A job with "Quoted? No" that the installer hasn't visited yet already sits at "Ready Check ready to schedule", and the installer is already assigned to it.
- **Button 1, "I'll book it with the owner",** can use the normal booking step with no database change. It records the booking for that installer at the agreed time, moves the job to "Ready Check booked", and sends nothing.
- After the visit, the Mitti form, measurements, photos, office review, owner acceptance and $349 steps all stay as they are.

## What doesn't fit yet (needs Jo's OK)
1. **The owner's pick-your-times page only exists inside the price estimate page.** Installer-supplied customers never get a Home Insulation Victoria estimate, because the price is the installer's. They need their own simple times page, using the same 3–5 times and the same rules.
   - **Database change:** let the existing secure owner link also be used for "Ready Check times". The database currently allows only one kind of link. This is a small change that adds to what's there; it would be tested on the practice database first.
2. **The normal offer step refuses jobs that already have an installer assigned.** For these jobs the installer is assigned from the start, so no offer is needed at all.
   - The installer taps one of the owner's times directly. The time is taken safely, so two taps can't both win, and the other times close.
   - **No other trade can ever be offered the job.** I'll add a last-line check that refuses any Ready Check offer on an installer-supplied job to a business other than the one that supplied it. This works like the existing TEST/real check.
3. **The owner email is new wording.** It names the installer's business. I'll write a DRAFT for Jo to approve, for example: "{Installer business} has asked Home Insulation Victoria to arrange your free Ready Check. Please choose 3 to 5 times that suit you." [Choose my times]
   - It follows the existing send switches. TEST jobs go only to Jo's inbox. Real owners get nothing until Jo approves the wording and turns sending on.
4. **Answering "Quoted?" after the Ready Check.** Today the answer can only be given once. If the answer was No, I'll let the installer enter their quoted price after the Ready Check is done. If they never do, the job goes to the office as usual.
5. **"Book a Ready Check" shows only when the job is still waiting for a Ready Check.** A job whose file already showed a visit or measurements goes straight to office review, as now, even when Quoted is No.

## Tests
- Unit tests:
  - the right jobs see "Book a Ready Check"
  - offers to any other trade are refused
  - a time can only be taken once
  - No can change to Yes with a price after the Ready Check
- Practice-database test for the link change.
- Installer test: both buttons on a TEST job. Book it myself leads to "Ready Check booked". Ask the owner leads to a test email to Jo, owner times, the installer taps a time, and "Ready Check booked". The test also confirms no other trade got an offer.

## Technical details
- Allow a new link purpose `ready_check_times` in the `customer_estimate_links` purpose check (widen the CHECK constraint, additive).
- New public page `/times/$token`. It reuses `ReadyCheckTimesPicker` and `submitReadyCheckWindows`, with an exception for installer-supplied jobs when the assigned installer asked for times.
- Taking a time: a conditional update on `ready_check_windows`, open to taken (`taken_by`), then the existing `confirmBooking(…, "ready_check", …)`.
- Guard: `assertOfferPairsAllowed` gains a ready-check check: on `installer_sourced` jobs, only `originating_installer_business_id`.
- Owner email is queued through the existing outbox (`enqueue_external_action`, customer_email, draft version).
- RPCs (`bookOwnReadyCheck`, `askOwnerForReadyCheckTimes`, `takeOwnerReadyCheckTime`) are for the business owner and members of the originating installer business only.
