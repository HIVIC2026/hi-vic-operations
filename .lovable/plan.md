# Plan update: Deep's first job — additions from Jo (4 Nov)

Plan only. This turn I won't build, publish or send anything. Once Jo approves, I'll make one change: add the items below to `docs/superpowers/specs/2026-11-03-deep-first-job-design.md`. I'll do that after the Mitti A1–A5 work.

## What's already built (checked)

- **Part 2** (the electrician books the PIESA) and **Part 2b** (My electricians) are already in the current portal. Their work went in as changes #130, #131 and #134. The branches named `part2-…` and `part2b-…` aren't in this project.
- **Part 3** (upgrades and certificate): I can't find a `part3-upgrades-and-certificate` branch or matching work here.
- So nothing needs merging for Parts 2 and 2b. Before building Part 3, I'll ask Jo where that work is (see Questions).

## ADD 1 — Home Insulation Victoria leads given to in-house partners (Reinsulate, Rapid, INSolation)

These jobs follow the same Part 5 install rules as installers' own jobs:
- The Lead Installer and the install day lock 2 days before the install, so Home Insulation Victoria has time to lodge or update the ESC notice.
- **3 days before:** if no Lead Installer has been picked, the partner's office gets a reminder email.
- **2 days before:** if there's still none, a red flag shows in Needs me for the Home Insulation Victoria office.
- Crew aren't on the ESC notice. Only the Lead Installer is, with name, phone and EEC number. So crew can be changed right up to the start.
  - Anyone newly added gets their SWMS text straight away and must sign before starting.
  - The Mitti install form keeps updating crew names and EEC numbers automatically, as it does now.
- **GO / DON'T START email** to the partner's office at 2pm the day before and again at 6:30am:
  - every blocker is listed in plain words;
  - a copy of DON'T START goes to info@;
  - today a failed pre-start check only goes to the Home Insulation Victoria office.
- The owner gets the "You're clear to install" email: confirm the PIESA, sign the ESC consent, pay the 10% deposit.
- This replaces the 2pm day-before "Keep or change Lead Installer" email for these jobs.

## ADD 2 — Crew fix and Ready Checks

- **Bug (confirmed in the code):** the in-house booking screen judges every person by the install-day Lead rule. So Crew show "Crew can't be the install-day Lead" and can't be ticked as crew or picked for a Ready Check.
- **Fix:** only the Lead Installer slot needs a Lead. Crew can be ticked as crew.
- Anyone on the partner's team, Lead or Crew, can be picked for a Ready Check.
- If the person has no Mitti login, the Ready Check form goes to the partner office's Mitti login.

## ADD 3 — Partner "Owner accepted – HV…" email

- Today it says "The licensed electrician offers … times" and "Offer … 3 install days". Both are out of date.
- I'll rewrite it to match the new flow. I'll show Jo the new wording one message at a time, and nothing goes live until she approves it.

## Kept as already planned

Partner logo on own-customer quotes (Part 4), 30-day quotes, balance due on install day.

## Wording rules

All new owner and trade wording is shown to Jo and approved first. Always write "Home Insulation Victoria" and "Lead Installer" in full, and "electrical upgrades", never "fixes".

## Questions for Jo (not added to the plan)

1. Part 3: the `part3-upgrades-and-certificate` branch isn't in this project. Where is that work? Choices: (a) another project or copy, please share it; (b) it was never saved, so rebuild it; (c) not sure.
2. Does the 3-days-before reminder email also apply to installers' own jobs, or only to in-house partners? Choices: (a) partners only, as written; (b) both.
3. Where should ADD 2 (the Crew fix) go in the build order? Choices: (a) first, because it's a bug blocking bookings now; (b) with Part 5.

## Technical notes

- Crew bug: `in-house-booking.server.ts` calls `allocationBlocker('install', …)` for every installer. `visit-allocation.core.ts` returns the Crew refusal. The fix is to apply the Lead check only to the Lead Installer slot and use the Ready Check rule for Ready Check picks.
- The email text is in `installer-accepted-email.core.ts` (lines 29–30).
- Tests will cover the lock and reminder timing (3 days and 2 days), GO versus DON'T START reasons and the info@ copy, Crew tickable for crew and Ready Check, and the fallback to the office's Mitti login.
