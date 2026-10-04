# Trades run their own diaries: remove capacity limits

## What changes
1. **Capacity limits stop being used.**
   - Installer "m² per day" is hidden on the installer onboarding form and in office business settings.
   - Electrician "Daily job limit" is hidden in office business settings.
   - Electrician matching (PIESA) and Ready Check offers no longer skip anyone for being "at their daily limit".
   - Owner install-day choices no longer hide days because the installer is "full". Any business day 24h+ away and inside the 30-day window can be picked.
   - At office approval, onboarding capacity is no longer copied onto the business.
   - Saves from the settings form and onboarding ignore these two values, so old forms can't set them again.
2. **Install hold becomes "Expected install week".** It's an office-only planning note. The week is still worked out the same way: about 3 weeks out, then moved after the PIESA or rectification, and released after 10 days if no PIESA is booked. It no longer looks at other jobs or capacity, so it never shifts weeks to "fit". It reserves and blocks nothing, and the over-capacity warning is removed. The card wording changes to match.
3. **Kept as is:** trades accept or decline offered times. If a trade can't make it, the owner is offered new times and the trade's reliability score drops. No-shows go to needs-attention. The quoted installer is never replaced automatically. If the installer declines all days, the job goes to needs-attention. The 30-day clock and the "New PIESA needed" step stay the same.
4. **Task list:** the note about two jobs being booked at almost the same moment is removed.

## Parts touched
- Matching for PIESA and Ready Check offers
- Install-day choices
- Install hold rules and the office card
- Office business settings form and its save action
- Installer onboarding form and its save action
- Copying capacity at partner approval
- Task list and rules notes

## Effect on existing records
- Nothing is deleted or changed. Both database fields stay with their current values, unused.
- Existing install holds stay as they are. Any old over-capacity flag is simply no longer shown.
- Past office history entries for limit changes stay.
- No database change. Sending and the payment gate stay off.

## Undo
Roll back this version in History. There's no database change to undo.

## Tests
- Matching and Ready Check offers include a trade whatever its old limit.
- Install days are offered whatever the stored capacity.
- The hold week is the earliest week and is never flagged.
- Both fields are hidden and ignored on save.
- Then the related existing tests, updated where they expected capacity behaviour, plus the code check, the wording scan and the preview build.

## Technical details
- `allocation.core.ts`: drop the `daily_limit` / `max_jobs_on_window_day` eligibility check. `allocation.server.ts:75` and `readycheck-booking.server.ts:139` stop passing them.
- `install-days.core.ts`: remove `dayHasCapacity` from `allowedInstallDays` (drop the `capacity`/`bookedM2ByDay` inputs). `install-days.server.ts` stops reading `daily_capacity_m2`.
- `install-holds.core.ts`: `chooseHoldWeek` returns `earliest` only (or is removed). `install-holds.server.ts` `place()` stops reading capacity or other holds, and always passes `_over: false`. Event text becomes "Expected install week ... (office planning note only)", with no capacity fields.
- `install-hold.tsx`: title becomes "Expected install week (office only)". Remove the over-capacity line.
- `business.tsx`: remove the `daily_capacity_m2` and `daily_job_limit` fields. `pilot.functions.ts`: strip both from every patch and remove the `electrician_daily_limit_set` event write. Keep the schema tolerant of old payloads.
- `installer-onboarding.tsx`: remove the field. `installer-onboarding.functions.ts`: tolerate the key but don't store it.
- `partner-activation.functions.ts`: remove the capacity copy at approval.
- `roadmap.md` line 75 removed. `src/lib/AGENTS.md`: capacity/limit rule replaced with "trades own availability; no capacity checks; hold = planning note".
- Update `tests/install-holds.test.ts`, `install-days.core.test.ts`, `daily-job-limit.test.ts`, `electrician-matching.test.ts`, and the ready-check tests.
