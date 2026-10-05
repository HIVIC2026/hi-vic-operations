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

## 4. Prove it
- Add focused tests for duplicate handling, office-review holds, permission propagation, photo batching and existing photo/GPS/lead-fee rules.
- Prove any required database change on PGlite with rollback before applying it.
- Browser-check upload, reading, review, Past uploads and done states at 390px.
- Confirm the preview build, focused tests and retired-wording scan.

## Deferred sequence
After this higher-priority cleanup and Bulk job upload task:
1. Update the launch campaign email, plain text, one-tap save confirmation and preview. Add postcode-level Ready Check availability, default off, and hide time picking until enabled.
2. Continue the approved electrician and installer trade screens.