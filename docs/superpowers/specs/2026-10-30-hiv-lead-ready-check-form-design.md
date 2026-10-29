# HIV website leads: the Mitti Ready Check form must never be dropped

Date: 30 Oct 2026 · Asked for by Jo · Found on HV-3542

## What went wrong (HV-3542)

- 29 Oct, 8:30pm Sydney: the owner took one of the installer's Ready Check times. The booking was confirmed
  (`bookings` row `confirmed`, stage `ready_check_scheduled`).
- No Mitti form was made. No `mitti_audit_create_started` claim and no failure event were ever logged. All the
  switches passed: the installer was assigned and invited to Mitti, the template was set and `auto_send_mitti` was on.
- Why: `bookAgreedTime` → `onReadyCheckBooked` → `scheduleReadyCheckFormCreation` → `runAfterResponse`. That
  fire-and-forget step is lost when the request ends before it runs. Its "queue_only" fallback says a scheduled worker
  will pick it up, but there is no such queue for Ready Check forms. It failed silently.
- No backup: the 15-minute `sweepReadyCheckForms` only looks at `installer_sourced` jobs, and the Mitti retry sweep
  only acts after a logged failure.
- On 30 Oct a form was made by other means (audit_bbc08abe…). That job needs nothing more.

## Jo's decision (30 Oct 2026)

Fix both:
1. The first try must not be able to drop.
2. A 15-minute backup must also cover HIV's website leads.

## Change 1: the first try keeps going

Where: `onReadyCheckBooked` in `src/lib/mitti-create.server.ts`. This is used by every confirmed Ready Check booking:
the owner or installer agreeing a time, the office booking override, and installer / trade-view bookings.

- Run the form creation in the request itself instead of `runAfterResponse`. Register the same promise with
  `requestContext.getStore()?.waitUntil?.(…)` and then await it, so it finishes even if the phone drops the
  connection. This is the same pattern already used by `onReadyCheckJobAdded` and `tellBookedKeepGoing`
  (HV-3542 texts fix, 29 Oct).
- Use one quick attempt (`delaysMs: []`), like Add a job, so the owner isn't kept waiting on retries. A failure is
  logged as now (`mitti_access_needed` "could not be created"), and the existing Mitti retry sweep and Change 2 pick
  it up.
- The same checks as now decide whether to start: booking confirmed, no form yet, no complete measurement, installer
  assigned, Mitti invited, template set, auto-send on.
- Never undo or block the booking. Any error is caught, as today.
- When the checks say no, leave one plain internal note on the job saying why. Use the existing Add a job skip-note
  wording style, with a new event key `mitti_ready_check_booked_skipped`. A missing form can then always be traced.

## Change 2: the 15-minute backup covers HIV leads

Where: `sweepReadyCheckForms` (`mitti-autoform.server.ts`) and `autoFormDecision` (`mitti-autoform.core.ts`).

- Also read `hivic_sourced` jobs, not deleted or archived, at stage `ready_check_scheduled`.
- An HIV lead is a "create" only when it has a **confirmed Ready Check booking** and an active installer. Never
  before the booking: HIV leads only get a form once booked, and that rule stays.
- For HIV leads the 30-day window counts from the booking's confirmed date, not the job's created date.
- Everything else stays the same for both kinds of job: the switches, "already has a Ready Check record", the
  one-form claim lock, the 24-hour back-off after a Mitti error, the 5-per-tick cap and the office failure note.
- Installers' own jobs: no change in behaviour.
- `holdAtMittiReadyCheck` already refuses HIV leads. Leave it as is.

## Not changing

- No owner, installer or office emails or texts. Nothing new on screens.
- No change to what's in the form or who it's assigned to.
- No live database writes as part of this work.

## Tests

- `autoFormDecision`: an HIV lead booked with no form gives create. An HIV lead not booked, or at an earlier stage,
  gives skip. An HIV lead with a booking more than 30 days old gives skip. A recent booking on an old enquiry gives
  create. Installer job cases are unchanged (the existing `tests/mitti-autoform.test.ts` still passes).
- `onReadyCheckBooked`: it awaits the creation and registers it with `waitUntil`. A skip writes the
  `mitti_ready_check_booked_skipped` note. A Mitti error doesn't throw.
- Full test run and typecheck pass.

## Delivery

Branch `hiv-lead-ready-check-form`, pull request to `HIVIC2026/hi-vic-operations`. **Not merged by this chat**, because
only the coordinating chat merges.
