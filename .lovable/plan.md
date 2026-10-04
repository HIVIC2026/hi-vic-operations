# Step 9: Installer capacity, install holds and install booking

This is too big to build safely in one go, so it is split into two parts. Each part gets its own practice-database proof, build and test, and you say "go" before each one.

## What exists today
- Installers pick a rough "weekly capacity" band during onboarding. Nothing uses it, and there is no daily m² capacity.
- There is a per-job install-window record (planned PIESA date, planned install date, the 7–21 day buffer, PIESA completed date). It is empty for every job (0 rows).
- Installs are booked the old way: the installer is assigned, contact details are shared, a time is proposed and then confirmed, with the 24h reminder and 48h flag.
- The 30-day rule is already enforced: a date after the PIESA deadline is refused, and an expired PIESA blocks booking with "reassessment first". There is no 10-days-left flag, and the message doesn't say "New PIESA needed".
- No install holds exist.

## Part A: capacity and install holds (no booking changes)
1. **Capacity:** an optional "m² per day" setting for each lead installer. The installer sets it at onboarding and the office can edit it. Empty means no limit. The weekly band stays for history.
2. **Hold created** when the owner has accepted the quote and the payment gate passes. It uses the job's quoted m² against the quoted installer's capacity for a target week. A hold is not an appointment: no contact details are shared, the owner doesn't see it as a booking, and it never allows installation.
3. **Hold moves:**
   - When the PIESA is booked, the hold moves so the install falls 7–21 days after the PIESA date.
   - When rectification is needed, it moves to after the expected rectification date, which comes from the electrician's chosen window in step 8.
   - It is released if no PIESA is booked within 10 days of being created.
   - Every change is recorded in the job history.
4. The office sees the hold on the job page ("Install hold: week of …, X m²"). It is office-only.
5. The 15-minute timer releases expired holds.

## Part B: owner install days and installer acceptance
1. **After electrical clearance**, the owner picks 3–5 install days. Only days that meet all of these are offered:
   - inside the 30-day window (the clock starts at PIESA completion, or at Section C sign-off when rectification was needed)
   - business days at least 24 hours away
   - days where the quoted installer still has enough m² capacity, counting other holds and bookings
2. **The quoted installer** gets an offer page with the days as buttons, like the PIESA one, sent by text when sending is on (queued only for now). Tapping a day books the install in one locked step, so it can't be double-booked. Contact details are shared then, for the install visit only.
3. **"None of these work"** (owner or installer) uses the old propose/confirm path with the 24h reminder and 48h flag.
4. **The 30-day hard gate stays.** A day outside the window can never be booked, on any path.
5. **New flags:**
   - 10 days left with no install booked: the job goes on the needs-attention list.
   - Clock expired: the job shows "New PIESA needed".
6. **The installer is never replaced automatically.** If they decline all the days, the job goes on the needs-attention list.

## Parts touched
- **Part A:** installer onboarding (one new field), the office business settings, the quote-accepted / payment-gate step, PIESA booking, the rectification window pick, the 15-minute timer and the office job page.
- **Part B:** the owner job page (a new install-days card), the installer partner workspace (offer buttons), the install booking step, the needs-attention list, the PIESA expiry message and the 15-minute timer.
- Tests for each part.

## Database changes (practice database first, then apply)
Additive only. Nothing is deleted or renamed.
- **Part A:**
  - an empty "daily m² capacity" field on the installer business
  - a new install holds table (job, installer, m², target week, status, created and released dates, reason)
  - one locked step that places or moves a hold
- **Part B:**
  - install-day options saved in the existing appointment times table, tagged "installation"
  - one locked step that books the install so it can't be double-booked
  - an empty "10-days-left flagged" date

Each part is proven on a practice database before the live change: existing rows unchanged, running it twice is safe, capacity is respected, two taps can't double-book, a day outside the window is refused, and undo is clean.

## Effect on existing jobs and records
- 11 jobs are between PIESA and install today. All are TEST jobs.
- They get no holds and keep the old booking path. Holds only start for quotes accepted after Part A goes live.
- No backfill and no records changed. Sending stays off and the payment gate stays off, so in practice no holds are created until the gate is switched on.

## Undo
Roll back to the previous version in History. Each database change has a ready undo file. The new fields and the table can stay empty and unused, and without holds or install-day options everything falls back to today's flow.

## Questions
1. If the installer has no capacity set, should a hold still be created (always fits), or skipped?
2. Target week for a new hold before the PIESA is booked: assume about 3 weeks out (the PIESA within 10 days plus a 7–21 day buffer)?
