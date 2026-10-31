# Installer home: most urgent first in "Action needed"

Date: 31 Oct 2026 · Owner: Jo · Status: waiting for Jo's approval

## What Jo wants

On the installer home screen, the jobs under **Action needed** show the most urgent first. Today their order is whatever order the database hands back, so it can shuffle between visits.

Jo agreed the order (31 Oct, 17:08):
1. **Jobs with an install deadline first,** soonest deadline at the top.
2. **Then jobs with no deadline,** the one that has waited longest first, which means the one whose job record changed least recently.
3. If two jobs still tie, the lower job number goes first, so the order never shuffles.

## What changes

- Only the order of the **Action needed** list on the installer home screen (`/field`), for the business owner and for staff.
- Nothing else: no change to which jobs show, what they say, the other groups (Coming up, In progress, Done), job offers, the electrician screens or the office screens.

## How

- `installerHomeGroups` in `src/lib/installer-home.core.ts` sorts the action rows with a small pure function:
  - install deadline ascending, with jobs without a deadline after;
  - then "waited longest" (the job's `updated_at`, oldest first);
  - then job number.
- The home loader passes the job's `updated_at` into each home row. It's already read there (`HOME_JOB_COLS`), so there's no new database read.
- The saved "last copy" on the phone keeps working. The new order shows on the next refresh.

## Checks

- Tests for the sort: deadline before no deadline, soonest first, oldest wait first, job number tie-break, and the other groups untouched.
- The same-information capture (`installer-speed-capture --compare`) still matches, apart from the order of the action list. The compare already sorts by job, so it should match.
- In Lovable, after merge: the TEST owner's home screen shows Action needed in the new order.

## Not included

- No change to how urgent a job "is" (no new labels, colours or alerts).
- No change to the other lists.
