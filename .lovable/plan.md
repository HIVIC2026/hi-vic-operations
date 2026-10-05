# Booking control — answers to Jo's five questions (PLAN ONLY)

Checked the actual code. Plain answers first, then what's missing to make "not booked in the portal = can't happen / can't get VEECs" airtight.

## 1) Can the installer enter PIESA and install dates himself for his own jobs?
- **Install date: YES.** On his portal job page he gets a date box where he can type any install date and book it directly. The real rules still apply underneath — the booking is refused if the deposit/payment gate isn't cleared, if it's inside 24 hours, outside the 30-day PIESA window, or the government notification window isn't met.
- **PIESA date: NO.** PIESA times are picked by the owner (3–5 windows) and accepted by the electrician. The installer can't set a PIESA date; only the office can override one directly (with a recorded reason).

## 2) Is the install-day Mitti form locked unless booked in the portal and the 24h–5 day government window is met?
- **Effectively yes, but the lock is on the job, not the form.** There is no separate "Mitti install form" to lock — the lock is that the job **cannot move past installation** (into evidence/VEEC territory) unless: a confirmed install booking exists in the portal, the government (ESC) notification was sent inside the 24-hour-to-5-day window, PIESA copies went to owner and installer at least 24h before, and a passing PIESA is still inside its 30 days. An install booked less than 24h ahead is refused outright.
- So if Deep does the job off-book, the portal will not let that job progress — which is the outcome you want. The form itself isn't physically locked, but using it achieves nothing without a portal booking.

## 3) Does the electrician only get the PIESA form once a PIESA date is set?
- **No — this is a gap.** The PIESA Mitti form can be created and sent to the electrician as soon as the job reaches the "PIESA pending" stage and an electrician is assigned — **before** any PIESA time is booked. The booking date is only used to pre-fill the form if one exists.

## 4) Does a Ready Check submitted in Mitti update the portal even if never booked in the portal?
- **Yes for the data, no for the stage.** If a Mitti form was created for a job, its answers sync back into the portal's measurements/assessment records even if the visit was never booked — but only when someone clicks "Sync" (no automatic background sync). Syncing fills in data only; it never completes the assessment, moves the stage, or creates a quote by itself.

## 5) What's missing to make "not booked in the portal = can't happen / can't get VEECs" airtight, and how big?

**Already solid:**
- VEEC approval only happens through the AP queue, one job at a time, by a human — never automatic.
- Getting to "Ready for VEEC" requires the signed assignment to be effective, all evidence verified, all compliance checks passed.
- The job cannot pass installation without a confirmed portal booking + the government notification window (Q2).

**Gaps, smallest to biggest:**
1. **PIESA form before a booked date (Q3).** Fix: only create/send the PIESA Mitti form once a PIESA booking is confirmed. Small change — one extra check where the form is created. ~Half a day including tests.
2. **Installer's free-typing install date box.** It creates a real booking, so the gates hold — but it bypasses the "owner picks days, first tap books" model. Fix: for installer-sourced jobs, replace the free date box with the owner-picks-days flow. Medium — reuses the existing install-days code. ~1 day.
3. **No automatic Mitti sync.** Fix: add a timed sync (e.g. every 15 min, like the other timers) so portal data is fresh without anyone clicking. Small-medium. ~Half a day.
4. **VEEC lodgement isn't tied back to the specific confirmed install booking.** Once past installation, nothing re-checks that the booking that unlocked it is the one that was completed. Fix: record which booking unlocked installation and require it to be the completed one at AP review. Small. ~Half a day.
5. **Evidence/compliance "verified" marks are checked per job, not per booking.** If a row were ever marked verified by another path, the gate would still pass. Fix: verification actions require an active confirmed booking for that visit type. Medium — touches the evidence verification functions. ~1 day.

**Total to close all five: roughly 3–4 days of careful work**, each proven on the practice database first, preview only, nothing published.

## Recommendation
The two that matter most for Deep's situation are **gap 1** (PIESA form only after a booked date) and **gap 2** (installer picks from owner-offered days instead of free-typing) — together they make phone-booked work outside the portal visible and non-progressing. Gap 3 (auto-sync) keeps the portal up to date without anyone remembering to click.

## Awaiting Jo
- Go/no-go on any of gaps 1–5 (and in what order).
- The owner eligibility link plan (separate, already written).
