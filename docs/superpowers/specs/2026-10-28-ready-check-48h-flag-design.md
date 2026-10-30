# Spec: fix the "Ready Check time not confirmed after 48 hours" flag

Date: 28 Oct 2026. Status: waiting for Jo's approval.

## The problem
Needs me shows jobs under "Waiting on the owner or electrician" with "Ready Check time not confirmed after 48 hours" when nobody is actually holding them up:

- Installer jobs (e.g. Deep's HV-3066, HV-1538, HV-3116, HV-3118, HV-3119, HV-3136). The installer offers the owner times directly, outside the portal, so the portal never gets a time.
- Jobs where the Ready Check is already done (e.g. HV-3117).

## What changes
1. **Installer jobs never get this check.** They're the jobs that show on the "Added by installers" list.
2. **The check stops once the Ready Check is done**, on every job: Ready Check complete, measured estimate ready, or quote accepted.

Website jobs where the Ready Check isn't done yet keep the 48-hour check as they do now.

## What doesn't change
- No new flag for an unfinished Mitti form. Jo chases installers from the "Added by installers" list.
- No texts or emails change. This check never sends anything.
- No other lists or screens change, including the installer's screens. Three small gaps in the installer's wording (price not in his to-do list, electrician question not in it, misleading "Press Complete" note) are a separate fix for later.

## How we'll know it worked
- All 7 jobs above are gone from Needs me.
- A website job that's 48+ hours past release, with no time booked and the Ready Check not done, still shows.
- Test jobs aren't used to judge the result.

## Builder notes
- Rule: `coordinationState()` in `src/lib/allocation.core.ts`. It's used by Needs me (`office-needs.server.ts` / `office-needs.core.ts`, row type `booking_overdue`) and the older office queue (`buildNeedsHivic`, `ready_check_booking_overdue`). Apply the change in both places so they agree.
- Installer job = `jobs.channel = 'installer_sourced'` (the same test the "Added by installers" list uses). Don't use `installer_led`, because it isn't set reliably.
- Ready Check done = stage `ready_check_complete`, `measured_estimate_ready` or `measured_quote_accepted`. Those are currently in the Ready Check stage list (`VISIT_STAGES`), which is why done jobs still count.
- Only the Ready Check visit changes. PIESA visit rules stay as they are.
