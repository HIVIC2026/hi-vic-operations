# Operations preview — phase 1

## Baseline and isolation
Observed HEAD before edits: `ff6c590e01840d17c9154a2f05bf81f8a9263f2f` (8 October 2026). Working tree clean before this work. Existing no-size email variation in `estimate-email.ts` and `step3-emails.ts` preserved; neither edited.

Direct admin-only route: `/admin/operations-preview`. No production navigation change. No database writes, migration, customer/job mutation, send, integration call, cron, setting enablement or publish. Database backup availability **unverified**; no backup claimed. No database restoration required for this phase.

## Read model
One pure classifier provides every unique-job bucket/stage/count/list/detail. Saved spot / legacy scheduling label alone does not release Leads into operations. Operational acceptance, offer, booking, accepted measurement or attended/submitted Ready Check takes precedence. On hold is not closed. Unknown/conflicting records stay in Needs classification. Responsible-party job/task counts may overlap; stage job totals do not.

Existing admin route guard and authenticated GET server guard both apply. Reads follow the existing paged explicit-error admin-read pattern, scoped to `business_unit=hivic`, excluding `qa_test`, with child reads bounded by scoped IDs. Existing `loadOffice` is not called because its unscoped partner scans and retired saved-spot alerts are inappropriate here. Pure `officeStatus`, `insulationOnly`, `normaliseInsulation`, and `verificationStale` are reused without changes. No attachments or signed links load into the overview.

## Rollback by file
Remove only newly added `src/lib/operations-preview.core.ts`, `src/lib/operations-preview.server.ts`, `src/lib/operations-preview.functions.ts`, `src/components/portal/OperationsPreview.tsx`, `src/routes/_authenticated/admin.operations-preview.tsx`, `tests/operations-preview.test.ts`, `tests/operations-preview-loader.test.ts`, `tests/operations-preview.browser.tsx`, `tests/operations-preview.html`, and this document. Let route generation remove the route; never edit `routeTree.gen.ts`. Remove the preview rules from root `AGENTS.md` and `src/lib/AGENTS.md`, preserving the full original presentation-only guard, and remove the phase-1 section in `docs/STATUS.md` and task block in `roadmap.md`. Preserve subsequent edits; never reset the project or replace entire existing files. Preview memory can be removed independently; no operational records require rollback. Browser fixtures use the existing isolated test-only Vite server, not public routes.

## Acceptance corrections — 8 October
Unrelated recovery changes in `src/router.tsx` and `tests/page-recovery.test.ts` were restored to `ff6c590e` only; both compare identically with that baseline. Original presentation-only guard restored; preview rule appended separately. No-size email files untouched.

Evidence retains its gate; future requirements stay in details, unknown applicability is explicit. Legacy stage ordering is not completion proof. Action-specific email purpose/key metadata drives waiting tasks; generic messages remain history. Latest action outcome supersedes old failure alerts without deleting history. Null-source rows are included and reconciled. Draft/historic quotes do not create handoff. Payment uses its own recorded due date; commencement has a separate deadline task. Both global sending locks compose with insulation-email approval. Notified ineligible leads have no invented closure action. Otherwise-eligible insulation wording requires `insulationOnly` to pass.

Actual schema/data validation used 123 SELECT statements through a SQL adapter invoking the preview loader/classifier: 708 unique = 671 Leads + 1 Active + 23 Closed + 13 Needs classification; stage total 708, duplicate IDs 0, missing source 0. This proves actual columns/data and reconciliation, not the authenticated RPC/PostgREST app path. Counts are a point-in-time snapshot, not fixed expectations. No credentials changed. No writes performed.

## Limits / next phase
Labels only; never eligibility rechecks, stage changes, capacity release or automation runs. Settings show permissions, not live health. Missing timestamps are not sending proof. Full compliance/electrical readiness remains on the existing job page; unavailable facts aren't guessed. Email/Mitti/Compliance automation and Templates reorganisation are next phase, not implemented.
Verification outcomes recorded in `docs/STATUS.md` after checks.
