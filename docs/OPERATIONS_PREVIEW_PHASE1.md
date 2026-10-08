# Operations preview — phase 1

## Baseline and isolation
Observed HEAD before edits: `ff6c590e01840d17c9154a2f05bf81f8a9263f2f` (8 October 2026). Working tree clean before this work. Existing no-size email variation in `estimate-email.ts` and `step3-emails.ts` preserved; neither edited.

Direct admin-only route: `/admin/operations-preview`. No production navigation change. No database writes, migration, customer/job mutation, send, integration call, cron, setting enablement or publish. Database backup availability **unverified**; no backup claimed. No database restoration required for this phase.

## Read model
One pure classifier provides every unique-job bucket/stage/count/list/detail. Saved spot / legacy scheduling label alone does not release Leads into operations. Operational acceptance, offer, booking, accepted measurement or attended/submitted Ready Check takes precedence. On hold is not closed. Unknown/conflicting records stay in Needs classification. Responsible-party job/task counts may overlap; stage job totals do not.

Existing admin route guard and authenticated GET server guard both apply. Reads follow the existing paged explicit-error admin-read pattern, scoped to `business_unit=hivic`, excluding `qa_test`, with child reads bounded by scoped IDs. Existing `loadOffice` is not called because its unscoped partner scans and retired saved-spot alerts are inappropriate here. Pure `officeStatus`, `insulationOnly`, `normaliseInsulation`, and `verificationStale` are reused without changes. No attachments or signed links load into the overview.

## Rollback by file
Remove only newly added `src/lib/operations-preview.core.ts`, `src/lib/operations-preview.server.ts`, `src/lib/operations-preview.functions.ts`, `src/components/portal/OperationsPreview.tsx`, `src/routes/_authenticated/admin.operations-preview.tsx`, `tests/operations-preview.test.ts`, `tests/operations-preview.browser.tsx`, `tests/operations-preview.html`, and this document. Let route generation remove the route; never edit `routeTree.gen.ts`. Remove the preview rule from `src/lib/AGENTS.md`, restore only the presentation rule in root `AGENTS.md` from the baseline, and remove the phase-1 section in `docs/STATUS.md` and task block in `roadmap.md`. Preserve subsequent edits; never reset the project or replace entire existing files. Preview memory can be removed independently; no operational records require rollback. Browser fixtures use the existing isolated test-only Vite server, not public routes.

## Limits / next phase
Labels only; never eligibility rechecks, stage changes, capacity release or automation runs. Settings show permissions, not live health. Missing timestamps are not sending proof. Full compliance/electrical readiness remains on the existing job page; unavailable facts aren't guessed. Email/Mitti/Compliance automation and Templates reorganisation are next phase, not implemented.
Verification outcomes recorded in `docs/STATUS.md` after checks.
