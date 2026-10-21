# Exclusive pending-photo pile — applied and DB-verified

## Status
Practice-tested and **APPLIED, DB-VERIFIED** by the main assistant, as reported on 21 Oct 2026 at 09:25 UTC. Before application via `query_database`, the current `pg_get_functiondef` was rechecked and exactly matched the saved pre-change definition. No frontend publication is required for this DB-only function replacement; nothing was deployed/published. No customer records, media, audit events, templates, prices, permissions or eligibility were changed; no email/SMS/provider actions ran. Prior customer-preview and concurrent Office work are preserved. Browser verification of this applied RPC remains **PENDING / NOT_RUN** because browser tabs stalled.

## Exact files
- `docs/pending-migrations/0216_photos_exclude_offered.sql` — reviewed replacement of existing `public.office_enquiry_page(text,text,integer)` only; now applied by the main assistant.
- `docs/pending-migrations/0216_photos_exclude_offered.rollback.sql` — exact previous 0215 definition, matching read-only live introspection.
- `tests/office-photos-exclusive-practice-db.test.ts` — new focused practice regression checks.
- `AGENTS.md` — compact shared-predicate rule.
- `roadmap.md` — scope and verified evidence.
- Project memory updated to retain Jo's exclusive-pile requirement.

The original 0216 correction did not change `src/lib/office-enquiry-page.server.ts` or `EnquiriesWorkspace.tsx`; subsequent combined Office review presentation/read work is separate and preserved. No client-side post-pagination filtering or fake empty results were added by 0216. Historical 0215 files and the exact rollback are unchanged.

## Functional diff
```diff
+ ), pending_photos AS (
+ SELECT * FROM scope WHERE office_bucket='enquiry' AND media_to_review
+ AND NOT spot_offered AND enquiry_status NOT IN ('offered_spot','spot_saved','ineligible')
+ AND NOT spot_saved AND NOT removed AND deleted_at IS NULL AND NOT owner_progressed
  ), filtered AS (
- WHEN 'photos' THEN office_bucket='enquiry' AND media_to_review
+ WHEN 'photos' THEN id IN (SELECT id FROM pending_photos)
- 'photos',(SELECT count(*) FROM scope WHERE office_bucket='enquiry' AND media_to_review)
+ 'photos',(SELECT count(*) FROM pending_photos)
```

The recorded `spot_offered` fact protects against later media/attention labels as well as `enquiry_status='offered_spot'`. It is not created or updated here. All enquiries remains aggregate. Spot offered, other queue predicates, ordering, search, page size, responses, function security and existing grants are unchanged. CREATE OR REPLACE preserves existing grants; no tables, roles or new RPC are introduced.

## Focused verification
Command: `bun test tests/office-photos-exclusive-practice-db.test.ts tests/office-review-photos-practice-db.test.ts tests/office-enquiry-page-concurrency.test.ts`

**17 PASS, 0 FAIL, 44 assertions.** New 14 checks prove actual offers stay outside photos; later media cannot reopen the pile; saved/ineligible/removed/deleted/progressed/active/closed/TEST/partner rows are excluded; failed unsent offers with pending media remain reviewable; aggregate unchanged; search/pagination rows and count agree; rollback/reapply changes no stored fixture facts. Existing 0215 practice and concurrent detail/fact-load tests retained and passed. No production build was run (SQL/test/document changes only).

Read-only live query at **2026-10-21 09:16:31.788413 UTC**, real Base44/Home Insulation Victoria scope:
| Measure | Count |
|---|---:|
| Current pending photos | 105 |
| Current offered/photo overlap | 20 |
| Proposed pending photos | 85 |
| Proposed offered/photo overlap | 0 |
| Proposed saved/ineligible/removed/deleted/progressed leaks | 0 |
| Spot offered (unchanged) | 313 |

At that pre-apply snapshot, all 313 actual offered enquiries had `enquiry_status='offered_spot'`. The proposed query above was SELECT-only against live facts, not execution of the replacement function.

### Post-apply database verification (main assistant evidence reported 09:25 UTC)
The actual `office_enquiry_page('photos','',page)` was called for **every page**, and returned IDs were joined back to stored facts:
| Measure | Count |
|---|---:|
| RPC photo total | 85 |
| Actual returned photo rows, all pages | 85 |
| Offered/photo overlap | 0 |
| Other state leaks | 0 |
| All enquiries | 1355 |
| Spot offered | 313 |
| Spot saved | 123 |
| Insulation requested | 1013 |
| Ineligible | 21 |
| New | 0 |
| Needs attention (RPC) | 0 |
| Removed | 51 |

This is verification of the applied function, not merely a proposed predicate. Browser UI verification remains **PENDING / NOT_RUN** due to stalled tabs; no browser PASS is claimed. This documentation update ran no additional queries, migrations or tests.

## Review revision
Base revision: `174d2a8f` (prior preview correction). Reviewed 0216 revision: `175c3ac3b5f6eeec7ac7e737263d632ca4592e7f`, now applied by the main assistant. No commit was manually created; Git is platform-managed. SQL, exact rollback and focused test remain preserved independently of the prior customer-preview and subsequent Office-review work.