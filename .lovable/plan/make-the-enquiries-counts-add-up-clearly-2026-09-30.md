# Make the Enquiries counts add up clearly

## What the data shows
No enquiries are missing. The portal holds 47 real website enquiries:
- 33 are eligible and waiting for a Ready Check to be scheduled. They are counted under "Active enquiries".
- 14 are still new and waiting for someone to review eligibility. They are counted under "Needs review".
- 32 more are dummy test records. They are filed under "Test records" and never mixed in with live work.

The problem is that no card shows the total. The cards also don't make it obvious that "Needs review" is only part of the list.

## Changes
1. Add an "All live enquiries" card at the start of the row showing the total (47 today). Clicking it lists every real enquiry together.
2. Rename the "Active enquiries" card to "In progress" so it doesn't read like the full list.
3. Add a line under the cards that shows how the total breaks down, e.g. "47 live = 33 in progress + 14 needs review + 0 ineligible/hold + 0 finalised + 0 cancelled (32 test records filed separately)".
4. Add a check that shows a red warning if the parts ever stop adding up to the total. That way no enquiry can quietly drop out of view.

## Technical details
- `src/routes/_authenticated/admin.index.tsx`: add an `all` group (every job where `source !== "qa_test"`) and a `WorkView` key for it, and put it first in the cards array. Add the breakdown line. Make the warning check that `review ∪ active ∪ ineligible ∪ finalised ∪ cancelled` covers every job in `all` (a job can sit in both "ineligible" and another group, so compare unique job IDs, not the sum of counts).
- Nothing changes in the database or in how jobs move through stages.
