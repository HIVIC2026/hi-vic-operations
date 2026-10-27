# TEST office deny-by-default status — 27 Oct 2026

## Current result (supersedes earlier A/B status below)
- Exact route/function allowlists permit Needs me, Enquiries, Active Jobs, Choose installer, a TEST job page/Money card/notes, release/offer, Final check approval and payouts. Other office capabilities remain denied, not individually converted.
- Authentication and persisted sole qa_office role, verified reserved-domain email, database job/business capability and independent graph checks precede privileged work. Lists use server-derived TEST IDs and avoid admin snapshots. Search is TEST-only.
- Three PGlite-proven migrations applied: 0172 foundation, 0173 job graph, 0174 API/role/storage boundary. Live catalog confirms the pre-request boundary and zero public tables without RLS. Existing admin predicates/helpers remain unchanged.
- Exactly one qa.office@hivic-test.example account exists with sole qa_office role; password is held in project secret QA_OFFICE_PASSWORD and never printed.
- Read-only browser check at 390×844: Needs me, Enquiries, Active Jobs, Choose installer and Payouts loaded; three visible jobs are TEST jobs with reserved-domain owners. Five denied pages display the required refusal. Direct real job opens an access refusal; direct API returns zero real jobs and rejects settings, owner-context views and has_role RPC. No browser page errors.
- Existing TEST job HV-3219 opened; Money and contact history read TEST facts. Private File/export and AI reply panels remain unavailable. Stage-specific nested panels outside the exact allowlist still refuse their functions; no mutation was exercised. Final-check evidence/private-file opening is not enabled.
- Focused security and existing regressions pass; the complete historic portal suite was not run. No real customer/partner records were changed, no delivery/publishing/switch changes performed.
- Phase 2 NOT STARTED: full multi-person browser runner still does not implement the journey; website-created TEST submission and serving-process no-send/simulated-Mitti/Demo proof are not established. No run job created or archived; TEST trade flags untouched.

## Earlier A/B status (historical, no longer current)

## Completed in preview
- Separate server job capability verifies the authenticated, confirmed TEST email and persisted sole qa_office role. Admin continues through requireAdmin; mixed qa_office/admin is refused.
- Database capability must return true before any privileged graph read. It currently fails closed because the SQL is intentionally pending.
- Job page, job Money card and recorded call/note entrypoints now use that capability. Route remains admin-only until all other paths are converted.
- Practice SQL proves TEST-only reads for jobs, owners, properties, businesses and 17 job/quote child tables. Shared real owner/property/business links refuse the graph. Writes remain quarantined.
- Foundation identity check now uses Auth's verified email, not a mutable profile email.
- Focused security checks: 59 passed (44 core/practice + 8 server + 7 entrypoint checks). Existing office-header/consent regressions: 20 passed. Preview build OK. This is NOT complete office-area or live RLS proof.

## Uncovered — A remains incomplete
- Needs me: saved global snapshots, partner/system folds, Mitti pickups and sync-problem readers.
- Enquiries: list/count/filter/search readers, global saved copy, unmatched email readers and response/review actions.
- Jobs: active/closed/choose-installer lists, counts, search and legacy pipeline/board/status readers.
- Job buttons: Cancel/bulk Cancel, Reopen, Hold, mark TEST, deletion/restoration, quote actions, assignment/allocation, eligibility/compliance/AP/VEEC, payment overrides, invoice sync and installation completion.
- Partners: board/application/business file, People, Rates, Coverage, private credentials/bank, approvals, change requests and associated counters.
- Money: margins/payouts/invoices/VEEC lists and totals, electrician Approve and Mark paid. Global pricing must remain refused.
- Emails/Communications: history, queued/sent/failed rows, Outlook/unmatched reads, drafts/matching and send buttons.
- Exports and private Job File: pack export, document index/read/signing, partner files and bulk exports.
- Global pages/actions remain admin-only: Settings/switches, Templates/wording approvals, Users/roles, Save My Spot rules/blasts, electrician global rates, Interests, Test Centre and catch-all legacy tools.
- All public views/RPCs need exhaustive coverage. In particular office_enquiry_index and office_job_list are owner-context views in the current database; changing their security mode could affect existing admin behaviour and has not been done.
- Pending SELECT-only policy inventory is not an exhaustive public-table/storage/RPC quarantine proof. It does not enable TEST writes or office access.

## B gate
No migration applied, login created, secret created, browser session or screenshots. A is incomplete, so B is blocked by Jo's condition. No walk-through started. Nothing sent, published or switched.