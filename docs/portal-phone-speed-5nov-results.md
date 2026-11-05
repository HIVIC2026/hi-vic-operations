# Phone speed — 5 November

## Changes
- `office_enquiry_page` is the unnamed p_view RPC (743 ms historical mean).
- Existing property-facts job index and jobs last-activity index already exist; no duplicate indexes added.
- Applied practice-proven migration 0189: customer-email and specific photo-request partial indexes. No data, policy, permission or workflow changes.
- Single-job useAction saves mark every cached query stale, but do not reread whole office lists or another office job immediately. Active safety/payment panels retain the old refresh and waiting behaviour. The next list visit still refreshes.
- No shared/private server cache or materialized view added: it would require proven invalidation and access parity.

## Evidence
| Check | Before | After | Limitation |
|---|---:|---:|---|
| Enquiry facts for latest 50 job IDs | 179.814 ms | 147.566 ms | Same EXPLAIN ANALYZE, one sample each, read-tool role |
| Pending-photo count | 127.905 ms | 108.739 ms | Same EXPLAIN ANALYZE, one sample each, read-tool role |
| Property facts, 1000 rows on HV-1060 | — | 0.783 ms | Warm index already present; not a new improvement |
| Live sign-in, 390 × 844 | 3.006 s | 2.004 s | Unchanged code/network variation, not attributed to repair |
| Preview sign-in, 390 × 844 | 0.247 s | 0.198 s | Dev server, unchanged sign-in code |
| Needs me / job / Jobs / Enquiries phone timings | NOT RUN | NOT RUN | No available authorized session |

job_overview plans and office_enquiry_page RPC plan were refused EXECUTE by the read-only tool role. Grants were not widened. The alleged 1416 ms job-by-id statement is actually a five-column ILIKE search in pg_stat_statements, not an ID lookup.

Published index-1u8L8f8J.js contains #133's shared list keys, route-start prefetch, per-user last copy and matching list-loader wiring. Published use-me-BMviSBa0.js still calls global invalidateQueries after each save. Source change is not published.

Database healthy: 50% memory, 20/90 connections, no exhaustion alerts. No compute upgrade indicated.

## Verification
Tests run independently to avoid existing global test mock/DOM interference:
- New predicate: 2 passed.
- useAction integration: 4 passed (own job refreshed, other job and enquiry list not reread, both still invalidated; save/wait and failure behaviour retained).
- Practice indexes: 1 passed, identical before/after query results, idempotency and index usability.
- Existing office route loaders: 11 passed.
- Existing identity/access checks: 17 passed, including forged admin refusal.
- Existing job last copy: 8 passed, including different-user isolation.
- Existing broader last copy: 35 passed, 1 unrelated existing field.guide source assertion failed; not rewritten.
- Preview automatic compilation: build OK.

## Status
Speed repair is partial. Authenticated timing/action proof and all requested plans are not complete. Earlier full-suite and end-to-end publishability blockers remain. **Not ready to publish overall.** Nothing sent or published; experiment unchanged.