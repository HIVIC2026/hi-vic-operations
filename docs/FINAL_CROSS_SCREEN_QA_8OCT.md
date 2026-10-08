# Final cross-screen upload/save release review

Jo's request: 8 Oct 2026, 22:05 UTC. Preview only; root publication review required.

## Exact implementation revisions

- `2f0e2c37258034774b8249728c663f216c001324`: job cache refresh, save wiring and explicit progress Retry.
- `71df2e5f753076b598b40e2c99970a97cfd8aa5a`: sealed cross-screen browser regression coverage.

Changed files:

- `src/components/trade/job-cache.ts` (new): invalidate job-keyed queries plus `trade-home`; active readers refetch, inactive readers become stale. No direct stage/status updates.
- `src/components/trade/intake-details-editor.tsx`: successful save refreshes related readers while preserving editor identity, inputs and Saved feedback.
- `src/components/trade/ReadyCheckDraft.tsx`: retains saved response in cache and refreshes related readers while keeping pending/dirty protections.
- `src/components/trade/intake-progress.tsx`: failed reads show Retry, including failed background reads with cached data; legacy tracker only renders after successful `applies=false`.
- `tests/installer-job-cache.test.ts` (new).
- `tests/save-feedback.vite.mjs` (new).
- `tests/save-feedback.browser.tsx`, `tests/save-feedback.browser.py`, `tests/installer-intake-functions-stub.ts`.
- `AGENTS.md`, `roadmap.md`; this report added after the implementation revisions above.

Evidence confirmation already invalidates all existing readers on success in `src/components/portal/panels.tsx`; no change needed and PIISA product-review controls preserved.

## Results

- 83 isolated tests passed, 0 failed, 300 assertions across seven files: cache, persistence, upload safety/revisions, intake repairs/edit database, installer progress.
- 13 sealed desktop/phone save browser groups passed: successful details and Ready Check saves immediately update Next action without reload; Saved feedback survives; dirty answers survive failed reads; interrupted progress read hides the tracker and Retry recovers without querying the legacy reader; original-file removal remains hidden; reopen and mobile tab clearance pass.
- 10 sealed evidence browser groups passed: read Retry, invalid/empty file refusal, same-file retry, confirmation retry without reupload, file-open busy/error/retry, location refusal without invented GPS.
- Signed-in existing TEST evidence PDF private View/Download matched exact uploaded bytes on desktop and phone, with no runtime errors or overflow. No new live upload in this final turn.
- Harness build log: `build OK` at 22:07:59 UTC. No separate manual production build or standalone typecheck was run; project instructions reserve builds/typechecks to the harness. Do not claim a separate production-build/typecheck pass.

## Signed-in save limitation and cleanup

Read-only database checks found **no unarchived intake TEST job** for the approved Reinsulate business carrying the canonical `installer_evidence_acknowledged` event. Existing active legacy TEST jobs correctly do not render the intake editor; they were not converted into intake jobs. Therefore the final real save → Next action/reopen replay remains unverified; sealed actual-component coverage passes. Earlier real-save proof remains in `docs/FINAL_SAVE_QA_8OCT.md` and is not represented as a new run.

- Prior save fixture `69c0f4a6-232b-49da-9425-86e28b3004ad` remains archived, stage `new_enquiry`, zero files, zero outbox.
- Prior evidence fixture `769e2675-5695-48e6-ab04-d90857e05ac5` remains active at `ready_check_ready_to_schedule`, one file, zero verified requirements and zero outbox.
- No TEST records, stages, approvals, signatures, dates, original-media provenance or outbound records changed in this turn. No new accounts or audits; nothing published.
- Existing legacy tracker wording seen on legacy TEST fixtures is outside this narrow cache-refresh change; no domain/tracker rewrite performed.

Screenshots and raw test logs retained under `/tmp/browser/cross-screen`, `/tmp/browser/evidence-final` and `/tmp/browser/final-save`. This report is the archived QA summary for root review.