# Retire two reminders and clarify the free visit

## Changes
- Keep only the unopened three-day reminder in previews, rendering, scheduling, and delivery.
- Retain legacy reminder values only so historical records can be recognized and safely suppressed.
- Suppress the three-day reminder when a reliable open or stronger engagement already exists.
- Make delivery reject retired reminder kinds before any provider call.
- Check for pending retired queue rows and suppress only those rows if any exist, preserving history.
- Update the free visit confirmation wording to the four approved activities without changing its behavior or styling.
- Apply the two specifically approved service-description sentences to likely and onsite emails only.

## Verification
- Run only reminder, email-copy, and confirmation tests.
- Confirm the preview exposes only the first reminder.
- Capture true 640px and 390px confirmation screenshots plus likely and onsite email crops.
- Record viewport and overflow measurements in `design-review/free-check-copy-reminder-cleanup.json`.
- Confirm whether database queue rows were changed or only code safeguards were added.

## Technical details
- The legacy reminder union remains for reading historical rows, while the renderer accepts only the active unopened kind.
- The pure scheduling guard decides suppression before delivery; the worker adds a second explicit retired-kind fail-closed check.
- No email sending, publishing, deployment, pricing, workflow-state, or destructive database changes.
