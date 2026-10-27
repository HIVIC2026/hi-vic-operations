# TEST office A/B status — 27 Oct 2026

## Completed in preview
- Separate server job capability verifies the authenticated, confirmed TEST email and persisted sole qa_office role. Admin continues through requireAdmin; mixed qa_office/admin is refused.
- Database capability must return true before any privileged graph read. It currently fails closed because the SQL is intentionally pending.
- Job page, job Money card and recorded call/note entrypoints now use that capability. Route remains admin-only until all other paths are converted.
- Practice SQL proves TEST-only reads for jobs, owners, properties, businesses and 17 job/quote child tables. Shared real owner/property/business links refuse the graph. Writes remain quarantined.
- Foundation identity check now uses Auth's verified email, not a mutable profile email.
- Focused checks: 52 passed (44 core/practice + 8 server). This is NOT complete office-area or live RLS proof.

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