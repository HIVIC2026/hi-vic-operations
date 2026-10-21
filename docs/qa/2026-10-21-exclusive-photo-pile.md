# Exclusive pending-photo pile — review only

## Status
Prepared, practice-tested, **NOT APPLIED** to the live database and **NOT deployed/published**. The running portal still uses its existing RPC until the SQL is separately approved/applied. No customer records, media, audit events, templates, prices, permissions or eligibility were changed; no email/SMS/provider actions ran. Prior customer-preview work is preserved.

## Exact files
- `docs/pending-migrations/0216_photos_exclude_offered.sql` — proposed replacement of existing `public.office_enquiry_page(text,text,integer)` only.
- `docs/pending-migrations/0216_photos_exclude_offered.rollback.sql` — exact previous 0215 definition, matching read-only live introspection.
- `tests/office-photos-exclusive-practice-db.test.ts` — new focused practice regression checks.
- `AGENTS.md` — compact shared-predicate rule.
- `roadmap.md` — scope and verified evidence.
- Project memory updated to retain Jo's exclusive-pile requirement.

`src/lib/office-enquiry-page.server.ts` is unchanged: it already loads the authoritative RPC. `EnquiriesWorkspace.tsx` is unchanged: its tiles and Photos/videos navigation both consume the returned `counts.photos`. No client-side post-pagination filtering or fake empty results were added. Historical 0215 files are unchanged.

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

All 313 actual offered enquiries currently have `enquiry_status='offered_spot'`. The proposed query was SELECT-only against live facts, not execution of the replacement function. Browser verification of corrected live results is **NOT_RUN** because the requested SQL remains unapplied.

## Review revision
Base revision: `174d2a8f` (prior preview correction). No commit was manually created; Git is platform-managed. The unapplied SQL, rollback and focused test are the reviewable diff, independent of the prior customer-preview files.