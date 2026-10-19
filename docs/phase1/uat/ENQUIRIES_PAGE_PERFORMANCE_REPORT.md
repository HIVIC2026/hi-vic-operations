# /admin/enquiries — read-path performance report

Date: 20 Oct 2026 · Base: `origin/main` `ff18bca2` · Branch: `perf/enquiries-first-page`

**Verdict: PARTIALLY OPTIMISED — DATABASE CHANGE PROPOSAL REQUIRED.**
Paging, search, view tiles and page-size changes no longer touch the database (served from a 20-second server
snapshot), and the cold load is lighter and bounded. But the **first load still reads and classifies every
website enquiry**, because an enquiry's tile/status/duplicate state is derived in application code from twelve
related tables and from other enquiries (duplicate suppression). True database-side paging needs the schema
change proposed in §P, which was **not** executed.

Evidence labels: **[M]** measured here · **[C]** code-level evidence · **[S]** synthetic benchmark (modelled
latency — not production timing) · **[U]** unverified.

## A/C. Bottleneck analysis and root cause

Load path: `admin.enquiries.tsx` → `EnquiriesWorkspace` (React Query, key = all controls) → `getEnquiryPage`
(server fn, `requireAdmin`) → `loadEnquiryPage` → `websiteEnquiries` + `classifyWebsiteEnquiries`
(`src/lib/enquiry-groups.server.ts`) → filter/search/count/paginate in JS → 20 wire rows.

| # | Finding | Evidence |
|---|---|---|
| 1 | **Every** request — page 2, a new search term, a tile click, a page-size change — re-read and re-classified the whole dataset. The search fix (`f1fe67c0`) made this the path for every keystroke-debounced search. | [C] `loadEnquiryPage` called `classifyWebsiteEnquiries(await websiteEnquiries())` unconditionally; [S] 30 requests / 2,662 rows per request at 685 enquiries, identical for every scenario |
| 2 | Enquiry rows paged **sequentially** (1,000 at a time). | [C] `all()` loop |
| 3 | Whole `properties.enrichment` JSON selected per enquiry; only `enrichment.base44.raw` is used. | [C] `ENQUIRY_SELECT`, row mapper |
| 4 | Unbounded fan-out: 12 tables × every 500-id chunk at once (122 requests in flight at 5,000 enquiries) — queues behind PostgREST's pool. | [S] `maxInFlight` 26 @685, 122 @5,000 |
| 5 | Outside-scope head counts ran **after** the related reads (an extra serial round trip). | [C] |
| 6 | Server-function module statically imported email renderers, retail settings and file signing. | [M] static import closure 32 modules / 438 KB source |
| 7 | Classification depends on the whole set (duplicates via `primaryByContact`, all tile counts), and status is derived in JS from 12 tables. No existing view/RPC exposes it. | [C] `classifyEnquiry`, `enquiryStatus`, `primaryByContact` |

Lovable's diagnosis is **partly confirmed**: the whole set is loaded and classified before page 1 (true), with
many related reads in parallel (true). "Secondary details" (media files, signed URLs, email bodies) were already
loaded on demand only (`getLeadMedia`, `prepareEnquiryEmailsFn`) — **not** part of the first page. The related
tables read on the first page are needed to classify (category B), not to display details.

Dependency classification: measurements, area estimates, intake evidence, intake documents, media reviews,
post-intake work, email sends, consents, opt-outs, suppressing events, saved spots, removals → **B (classification /
counts)**; signed media URLs, draft email rendering, retail settings, location variables → **C/D (on demand)** —
already lazy, now also not statically imported; calculator registrations, delivery settings, outside counts →
**A (scope line)**.

## B. Baseline measurements

No authenticated Preview session and no database credentials were available, so **no production or Preview
timings were measured**. The historical 10–17 s figure is unverified here. A recorded production size is
685 website enquiries (P1_UAT_COMPLETION_REPORT, P1-S01).

Synthetic benchmark [S] — the real loader against an in-memory PostgREST-like fake (`tests/helpers/enquiry-fake-db.ts`);
latency model = 60 ms per request + 0.15 ms/enquiry row + 0.02 ms/related row; each enquiry carries a 4 KB
non-base44 enrichment blob (an **assumption**). Times are model output, not wall-clock production timings.

| Enquiries | Scenario | Before | After |
|---|---|---|---|
| 685 | first load | 327 ms · 30 req · 2,662 rows · 3,452 KB · 26 in flight | 317 ms · 30 req · 2,662 rows · 748 KB · 12 in flight |
| 685 | new / spot saved / search ×3 / page 2 size 50 / combo | ~315 ms · 30 req · 2,662 rows **each** | **0–1 ms · 0 req · 0 rows** |
| 2,000 | first load | 750 ms · 57 req · 7,762 rows · 10,085 KB · 50 in flight | 777 ms · 57 req · 2,190 KB · 12 in flight |
| 2,000 | any subsequent control change | ~725 ms · 57 req each | ≤2 ms · 0 req |
| 5,000 | first load | 1,589 ms · 134 req · 19,401 rows · 25,222 KB · 122 in flight | 1,184 ms · 134 req · 5,486 KB · 12 in flight |
| 5,000 | any subsequent control change | ~1,560 ms · 134 req each | ≤2 ms · 0 req |

Browser payload per page is unchanged (~21 KB for 20 rows, ~52 KB for 50). Static server-fn import closure
[M]: 32 modules / 438 KB → 25 modules / 322 KB.

## D. Architecture

**Before:** every request → read all enquiries (serial pages, full enrichment) → 12 related tables (unbounded) →
outside counts (serial after) → classify all → search/view/count/page in JS.

**After:**
1. First request (or Refresh, or after any Office write, or after 20 s): independent reads (calculator, settings,
   outside head counts) start immediately; enquiries are read with one counted request and the remaining pages
   in parallel, selecting only `enrichment->base44->raw` (automatic fallback to the full document if PostgREST
   rejects the JSON path); related reads go through a 12-wide pool; classify once → **snapshot**.
2. Every page / search / tile / page-size request inside 20 s slices that snapshot: 0 database requests.
   Concurrent requests share one in-flight read. Failed reads are never cached.
3. Snapshot dropped by: remove leads, photo review, Save-my-spot after review, existing-insulation follow-up,
   estimate-link refresh, the new **Refresh** link and **Try again**. Drafts and every sender still re-read the
   database themselves and never use the snapshot.
4. UI: unchanged layout; the scope line now shows "Updated hh:mm:ss · Refresh". Stale-response protection
   (query key = all controls) and `keepPreviousData` unchanged.

Status counts are computed from the same snapshot in the same response, so they cannot disagree with the list;
splitting them into a separate request would not be faster because both depend on the same classification.

## E. Files changed

`src/lib/enquiry-groups.server.ts`, `src/lib/enquiry-groups.functions.ts`, `src/lib/snapshot-cache.core.ts` (new),
`src/components/portal/EnquiriesWorkspace.tsx`, `tests/enquiries-page-performance.test.ts` (new),
`tests/helpers/enquiry-fake-db.ts` (new), `tests/office-final-uat.test.ts` (one structural regex updated for the
new batch shape), this report.

## F–H. Queries, records, requests before/after

Cold load: same tables, same filters; `jobs` select narrowed to `base44_raw:enrichment->base44->raw`; enquiry pages
fetched in parallel after a counted first page; outside counts/calculator/settings overlap the enquiry read;
in-flight requests capped at 12 for related reads. Request and row counts per cold load are unchanged
(30 req / 2,662 rows at 685 [S]); bytes from the database drop with the enrichment narrowing (size of the dropped
enrichment content in production is **[U]**). Warm requests: 0 database requests (was the full set every time).

## I–K. Initial load / search / pagination

Measured in production: **not available** (no access). [S] warm search and pagination drop from a full
classification per request to ≤2 ms server time; cold first load improves only modestly (−3 % at 685, −25 % at
5,000 in the model). The 3 s first-page target therefore depends on production latency that could not be
measured here.

## L. Count correctness

[M] Byte-for-byte identical results (rows, totals, every tile count, scope) between `ff18bca2` and this branch
for 21 control combinations (all tiles, searches incl. apostrophes/special characters/empty, page sizes 20/50/100,
out-of-range page, unknown view, three sort orders) at 685 and 2,000 synthetic enquiries, and snapshot results
equal a fresh classification for 16 combinations (test).

## M. Lazy-loading verification

[C/M] Test asserts the list load imports no file-signing module and reads no location variables; email renderers,
retail settings and file signing are dynamic imports used only by drafts/media.

## N. Automated tests

* New `tests/enquiries-page-performance.test.ts`: 18 pass, 0 fail (first page, page sizes, out-of-range, empty,
  zero-read warm requests, snapshot = fresh, sort snapshots, in-flight sharing, TTL, invalidation, failed reads,
  pool width, lean select + fallback, search over the whole set across every field, multi-word, apostrophes,
  special characters, missing params, PGRST100 regression, lazy details, Refresh/stale handling, pure cache).
* Full suite vs `ff18bca2` baseline: base 3,562 pass / 122 fail (38 failing files) → branch 3,580 pass / 122 fail
  (38 failing files, the **same** files and counts). 0 new failures.
* `tsc --noEmit`: clean. `vite build`: passes.

## O. Browser UAT

**Not performed.** `https://preview--hi-vic-operations.lovable.app/admin/enquiries` redirects to `/auth`; there is
no authenticated session and credentials must not be entered by the agent. Required checks after merge (Office
user): the six URLs in the brief, first-page timing, Refresh, and that the "Updated" time advances.

## P. Remaining limitation and database change proposal (NOT executed)

The first load still reads every website enquiry and twelve related tables, because status, tile membership and
duplicate suppression are computed in application code. Making page 1 cost O(page) needs those facts in the
database. Proposed (requires owner approval and a migration; not applied):

```sql
-- 1) Indexes that serve the existing reads today (safe, additive)
create index concurrently if not exists jobs_website_created_idx on public.jobs (source, channel, created_at desc, id);
create index concurrently if not exists customer_email_sends_job_created_idx on public.customer_email_sends (job_id, created_at);
create index concurrently if not exists owner_contact_consents_job_created_idx on public.owner_contact_consents (job_id, created_at);
create index concurrently if not exists customer_engagement_events_job_type_idx on public.customer_engagement_events (job_id, event_type);

-- 2) One read for all per-enquiry facts instead of twelve table scans (read-only, security definer, admin only)
create or replace function public.enquiry_list_facts(_job_ids uuid[])
returns table (job_id uuid, last_send jsonb, sent_purposes text[], campaign_keys text[], consent text,
               opted_out boolean, bounced boolean, spot_saved boolean, intake_work boolean, removed boolean,
               media_docs jsonb, media_review text, measured_m2 numeric, estimates jsonb)
language sql stable security definer set search_path = public as $$ /* aggregates per job_id */ $$;

-- 3) Full DB-side paging: a maintained enquiry_list_state (status, view flags, primary-for-contact,
--    search text with pg_trgm) refreshed by triggers on the twelve source tables, so
--    `select … where view_flag order by … limit 20 offset …` and `select view, count(*) … group by view`
--    return page 1 and the tiles directly.
```

Option 2 alone would cut the cold load from ~30 requests to ~4 without changing semantics; option 3 removes the
whole-dataset read. Both must reproduce `classifyEnquiry` / `enquiryStatus` / `primaryByContact` exactly and be
verified against this test suite before use.

## Q. Final commit

Recorded in the merge commit message on `origin/main` (see git log).

## R. Database writes

None. No SQL, DDL, migration, RLS change, email, Production publish or environment change was made. All
measurements used an in-memory fake; no database was contacted.
