# Firm quote Task 11 — With photos

## Changes
- First Enquiries category: With photos, with Jo's exact hint.
- Only jobs classified by the existing firm-quote rule move there. Pre-live photo enquiries retain their previous category.
- Recorded Proceed requests remain in With photos after entering the saved release queue, until ordinary installer allocation/quote progression or the existing terminal scope removes them. Opted-out rows retain Opted out.
- The existing recorded request due date appears on phone and desktop rows; no request means no tag. Counts, filtering, returned IDs and pagination all use the same exclusive classified rows.
- No database views, SQL, delivery, settings, pricing or workflow writers changed. The null switch avoids all new media/request/assignment/quote reads.

## Files changed
- `src/lib/enquiry-categories.core.ts`
- `src/lib/office-lists.server.ts`
- `src/components/portal/EnquiriesScreen.tsx`
- `tests/enquiry-categories.test.ts` (adds the new zero-valued count to existing expected totals)
- New `tests/firm-quote-enquiry-categories.test.ts`
- New `tests/firm-quote-enquiries-list.test.ts`
- New `tests/firm-quote-enquiries-screen.test.tsx`
- `roadmap.md` and this report

## Tests (each file separately)
New Task 11 category 4/4, list 4/4 and rendered screen 1/1 pass. Category/list tests ran before production changes: 3 passed, 5 failed; after changes 8/8 passed. The screen test was added after the screen change, not test-first; it exercises the actual With photos button and due tags using synthetic read data, without any delivery or writes.

All 15 firm-quote test files: **150 passed, 0 failed**. Existing enquiry-categories 11/11, enquiries-screen 6/6, QA office-entrypoints 7/7 and QA office-lists 3/3: **27 passed, 0 failed**. Total passing checks: **177**.

An additional legacy `tests/office-enquiry-page-concurrency.test.ts` fails (0/1): its fake query lacks `.in()` used by the unchanged legacy `office-enquiry-page.server.ts`. That test, its reader and detail-loader dependencies are unchanged by Task 11; this is not the category-screen path. No assertions or production code were changed to hide it.

Retired-terms scan: exit 0, 978 advisory matches, **0 customer-visible failures**. Preview build/type checking: **build OK**. Diff whitespace check passed.

## Preservation and limits
Tasks 1–7, 9 and 10 remain unchanged: firm cores/emails/token request, 12 restored spot-message boundaries, photos-only Give, held quote and day-4 hook remain in place. Calculator sentence is still absent. Size-check worker and photo size-check reads/display remain removed. No sync, merge or history rewrite occurred.

The screen was tested in a synthetic rendered DOM; the activation/request SQL remains pending and switched off, so an activated signed-in hosted journey and phone screenshots were not tested. No SQL run, sends, switches changed or publication. Stopped after Task 11.