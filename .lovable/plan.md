# Step 10: ESC pre-install notification and day-before pre-start check

## What exists today
- **ESC notification details are already prepared automatically** when an install is booked: address, owner, installer, lead installer name, business, ABN, date and so on.
- **The 5-day / 24-hour rule** is already checked when a submission is recorded.
- **"Submitted"** is already recorded by hand, with a reference and date. It is never marked sent without one.
- **If the install date or address changes**, the old notification is marked out of date and a new one is prepared.
- **There is one general needs-attention entry** ("PIESA copy / ESC notice not done in time"). It only appears after the 24-hour deadline has passed or an error happened. There is nothing when the window opens, no "urgent at 2 days", and no "update in Registry" or "withdraw and resubmit" wording.
- **An install can't move to evidence** until the 24-hour conditions are met: consent, ESC notification, PIESA copies delivered, and the PIESA still valid.
- **Installer certification:** the office records "verified" or "rejected", but not full or provisional, and not an expiry date.
- **The installer's safety form (PIISA)** can only be sent to Mitti once the install is booked. It does not check the 30-day rule or the certification.

## What changes

### 1. ESC notification as an AP task
The details are still prepared automatically. Everything below is worked out from the stored dates.
- **Window opens** (5 days before install): needs-attention shows "Submit ESC notification by <date, 24h before install>". The ready-to-copy details are on the job's Installation section.
- **The AP taps "Submitted"** and enters the date and reference. This already exists; it now also clears the entry.
- **2 days before install and still not submitted:** the entry turns urgent.
- **Install date moves after it was submitted:**
  - New date still inside the 5-day / 24-hour window from the original submission: "Update notification in Registry".
  - New date more than 5 days after the submission: "Withdraw and resubmit".
  - In both cases the AP records the update or new submission the same way.
- The general "ESC notice not done in time" entry is replaced by these clearer ones for the ESC part. The PIESA-copy part stays as it is.

### 2. Day-before pre-start check (hard gate)
The existing 15-minute timer runs it from 24 hours before the install start. It is also re-run whenever a related record changes. All of these must pass:
- electrical clearance is valid
- the 30-day clock is valid on the install day
- the ESC notification is marked submitted, within its window, for the current date
- the lead installer has a **full** EEC CII certification (not provisional) that is still current on the install day
- the owner consent is signed
- the install day (when the PIISA is done) is within 30 days of the PIESA

**If anything fails:**
- The installer safety form can't be sent to Mitti for that job, and installation evidence uploads for that job are locked. Both are refused on the server.
- Owner and installer messages are queued only. Sending stays off.
- The job goes on needs-attention with "Pre-start check failed: <reasons>".

**When it passes:** a "Cleared to start" record is saved and the form and uploads unlock. Each run is kept as a permanent record.

### 3. Mitti itself is not changed
The portal only decides whether the job is cleared before it sends the form or accepts evidence.

### 4. Certification detail (needed for the check)
- The office's certification record gains two optional fields: "Full" or "Provisional", and an expiry date. New records only.
- **Lead installer for a job:** the installer person assigned to the job, matched to their worker record by email.

### 5. Task list
Note the accepted limit from Part B: two different jobs booked for the same installer at almost the same moment could exceed that day's m².

## Parts touched
- ESC rules and the readiness check
- the needs-attention list
- the job's Installation section (the details to copy, Submitted, and the pre-start result)
- the 15-minute timer
- the installer safety form send to Mitti, and evidence upload
- the office certification form
- queued owner and installer messages
- tests

## Database changes (practice database first, then apply)
Additive only:
- two empty fields on certification records: level (full / provisional) and expiry date
- a new pre-start check record (job, booking, when checked, passed or failed, reasons), office-only and never edited
- no change to existing ESC notifications

The practice proof covers: existing rows unchanged, running it twice is safe, check records can't be edited, and undo is clean.

## Effect on existing jobs and records
- No backfill and nothing changed.
- Installs already booked get the new needs-attention entries and the pre-start check from now on.
- Until the office re-records certifications with "Full", any booked install would fail the certification check (see question 1).

## Undo
Roll back to the previous version in History. The database change has a ready undo file. The new fields and table can stay empty and unused.

## Questions
1. Existing "verified" certifications have no full/provisional level or expiry. Should the check treat them as **not confirmed**, so the office must re-record them as Full with an expiry (safest), or accept them as full until re-recorded?
2. Should the pre-start check be done 24 hours before start, or at a fixed time the day before (for example 12pm Melbourne)?
