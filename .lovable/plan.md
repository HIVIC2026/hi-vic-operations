# Current-status cleanup and Bulk job upload

## Outcome
Remove stale project notes so there is one trustworthy status list, then restyle and repair the existing Bulk job upload. Keep all work preview-only; no messages are sent, no switches change, and no real jobs are created during testing.

## 1. Clean current guidance
- Delete completed, superseded or contradicted plan, audit, review and memory files from the requested folders; do not create an archive.
- Keep the workflow source of truth, official forms, SQL migrations, final portal design memory and AGENTS rules.
- Update the workflow source of truth where current code has superseded old wording.
- Replace the roadmap with a concise current task list.
- Create `docs/STATUS.md` as the single feature inventory, with Built / Partly built / Not built and the route or page for each feature.
- Reduce the memory index to links for `docs/STATUS.md` and the workflow source of truth.

## 2. Restyle Bulk job upload
- Rework `/partner/bulk-import` into the approved phone-first upload, reading, review and done screens inside the normal trade frame.
- Keep all existing file-reading and matching capabilities while adding camera capture, pasted lists, card-based review and Past uploads.
- Preserve the one batch permission confirmation and show only actionable exceptions under “Your move”.

## 3. Fix import behavior
- Make explicit duplicate skip/remove actions work and prevent duplicate creation.
- Keep `office_review` rows out of live jobs until office clearance, showing them as “With our office to check”.
- Process large photo sets in batches instead of stopping at 60, within safe request limits.
- Correct the single-job import copy to reflect that PDFs and photos are read.
- Preserve the approved six-month supplied-photo rule, install-day photo date rule, 50 m GPS rule and zero lead fee.
- Let the installer correct each row's progress as Not visited, Visited, Quoted or Installed; show the planned electrician.
- Add a batch-wide safety-check rule (My electrician / Home Insulation Victoria electricians / job by job), with saved-preference change/add controls and per-row toggles when needed.
- On confirm, create complete owner/property/provenance records, permanent installer attribution, installer assignment, preferred-electrician plan, correct workflow placement, installer-handled quote, queued owner confirmation, missing-evidence list and exact batch/person history.
- Preferred electricians receive the later PIESA offer exclusively for the normal window. Decline or no response never reassigns automatically: it creates the approved office and installer actions, and only the installer or office with a reason can switch to Home Insulation Victoria allocation.
- Unknown electricians use the existing queued invite and the job waits visibly until approval; this path also never auto-switches.
- When “My electrician” has no approved selection, require name and mobile (business and email optional), create the pending electrician and queued sign-up invite on confirm, aggregate the approved office Needs me message, and block every PIESA offer until approval.
- Apply picker privacy across Bulk upload, single-job intake and preferred-electrician settings: list only that business’s saved electricians, silently match mobile/email, link approved matches without revealing details, reuse pending invites and never expose the network or counts.
- Keep Installed and unresolved office-review rows visible in the batch but out of live jobs.

## 4. Prove it
- Add focused tests for duplicate handling, office-review holds, permission propagation, photo batching and existing photo/GPS/lead-fee rules.
- Prove any required database change on PGlite with rollback before applying it.
- Run Scenario E end to end with a realistic isolated TEST batch: 25 messy rows, PDFs, mixed-GPS photos, handwritten-list photo and zip; repair every exception; verify every placement requirement for each row type, privacy, matching, quote creation and no sends; then clean it up or retain it only as `qa_test`.
- Capture the resulting installer My work and office job views as part of Scenario E.
- Exercise all three safety-check choices in Scenario E, including a preferred electrician who is not yet on the platform, and prove neither timeout path reassigns automatically.
- For the new-electrician case, prove required-field validation, pending records, queued-but-unsent invite, waiting wording, office Needs me, blocked PIESA and no reassignment.
- Prove the picker cannot reveal another installer’s electricians or counts, and that approved/pending silent matches neither duplicate nor disclose relationships.
- Time 300 rows and 60+ photos, repeat as office uploading for a TEST installer, and capture upload, reading, review, done and Past uploads at 390px.
- Confirm the preview build, focused tests and retired-wording scan.

## Deferred sequence
After this higher-priority cleanup and Bulk job upload task:
1. Update the launch campaign email, plain text, one-tap save confirmation and preview. Add postcode-level Ready Check availability, default off, and hide time picking until enabled.
   - Group B video uploads also save the spot, mark video priority, sort first in office, and use the approved “jump the queue” copy.
   - Add office review for videos that appear likely ineligible, without notifying the owner automatically.
   - Report missing active-link counts for both groups and generate links only when the campaign is prepared.
2. Continue the approved electrician and installer trade screens.