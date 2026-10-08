# Final published PIISA validation — 8 October 2026

Fresh read-only GET through the existing Mitti integration confirmed revision `19-a7ea04e7fa3b45b18937ee1d09b8d129`. Revision IDs alone are insufficient: the full items/conditions/order/required-flag fingerprint is pinned in `piisa-final-postwork-published.data.json`. Prior snapshots remain intact.

- Installer company `dc12088c-8316-461e-91e2-53b1db0dc558` is first on AP Before Work, before direct lead/crew and installer photos; crew IDs and conditional certificate structure preserved.
- Sole date `78e550a4-1c8b-4b59-be77-64a5c09ba848` remains on Title Page; removed expected/duplicate signing/metadata dates absent.
- Required signature `83caffa2-e9c8-4315-885f-5337a4389372` follows declaration; historical `805…` responses remain audit-owned, with no blank-current fallback.
- Non-answer category `d11eaa63-198b-471f-b57c-d3717bce551c` immediately follows signature with the exact requested signing-does-not-finish notice.
- Last page contains only required completed video `86b3772c-6227-4b6f-8011-b7ed288e734e` and required final roof-space plan `344e863b-3af3-44f5-b1b8-966941f0e667`.

## Preview activation and output safeguards

Current resolver version: `a3-final-postwork-2026-10-08`. Audit creation records this version; final requirements use that audit-owned version or observed new section, not today's company preferences. Current final media cannot be replaced by an old matching plan. Prestart capture remains separate and does not advance a job or produce final output.

Current-audit originals are fetched, type/empty-file checked, stored privately with content hashes and stable per-media IDs, and placed in existing installer-owned evidence requirements. Both must have recorded human verification, matching current file paths, before final declaration/official output. Changed originals reset review before replacement; failed persistence throws, retry retains stable identity. Existing signed copies are never rewritten. Original capture time/GPS remain null when absent. Product-review hunks unchanged.

## Autofill status

Installation date and approved company-scoped crew text prefill remain enabled in the checked resolver. Official expected completion derives only from captured PIISA signature day in Australia/Sydney; actual completion remains separate. Signature Full name is a Mitti limitation: it cannot be hidden/linked, documented prefillable types exclude Signature, and no unsupported signature prefill is implemented. Captured name must still match the lead personally.

No native edits, portal publication, audits/signatures, communications, worker approvals or live data mutations occurred. Final tests include real helper execution with sealed storage/database substitutes; no synthetic media is represented as physical-device evidence.

Existing release limitation remains: signed-in current-intake save/reopen replay has no active approved canonical TEST fixture; production publication awaits root review. Preview compilation is checked through the harness, not a separately run production build.

## Final verification

Nine isolated focused files: 56 tests passed, 0 failed, 214 assertions. Latest harness compile/typecheck entry: build OK at 22:18:08 UTC. Implementation revision `9aaa97168346904ac97337b84a8065138b009314` (final completion-metadata guard); earlier same-turn changes include the pinned definition, resolver, post-work helpers and regression tests. No live TEST rows created or changed; no cleanup mutation required.