# Speed audit — 25 Oct 2026 (decision 280)

Jo, 25 Oct: the live site is "unbearably slow"; target under 2 s on 4G for every trade screen.
This audit was done from the code and a production build (the live site is not reachable from the build
container), so it reports what the code makes the phone do: how many JavaScript kilobytes each page needs
before it can draw, and how many database round trips each page's server work makes in a row before it can
answer. The live timings themselves still need Jo's phone (see "What still needs a live measurement").

Every change on branch `speed` is behaviour-neutral: same rows, same wording, same guards, same workflow.
tsc clean; `bun scripts/scan-retired-terms.ts` → 0 customer-visible; tests for every touched module below.

## The five slow causes, in order

1. **Server waterfalls inside one request.** Each trade screen's server function made many database reads
   one after another instead of together. Every read is a round trip from the Lovable edge to the Supabase
   region (typically 50–150 ms), so a page waited for 9–17 sequential hops before the first byte came back.
   My work made 13 hops *plus one or two per Ready-Check-quoted job*; the installer job page 17; a job offer 9.
2. **One read per job on My work (N+1).** `tradeHome` called `loadInstallerQuote` for every job with a Ready
   Check quote — 5 queries each, in sequence. A boss with 12 such jobs paid ~60 extra queries per visit, and the
   page polls every 60 s.
3. **A fresh sign-in check before every navigation.** The signed-in layout's `beforeLoad` runs on *every* page
   change and did `supabase.auth.getUser()` (a network call to the auth server) and then roles + memberships —
   two round trips before any page data was even requested. Going Home → Job → Home cost that three times.
4. **Fan-out on the installer job page.** The page fires ~10 separate server calls on load (overview, role,
   job page, install days, Ready Check times, Mitti-invited, blockers, quote card, safety plan, worker links,
   messages). Each one re-derives the trade context (members/roles/profile, business, assignment = 3 hops) and
   two of them call `auth.getUser()` server-side as well: ~30 redundant queries per view.
5. **Shell weight and missing business-led indexes.** 911 KB of JavaScript (minified) loaded before *any*
   page: ~440 KB is react-dom + supabase-js + the router (unavoidable here), but ~175 KB was avoidable — the public
   calculator and its postcode table rode in through the `/` route's `head`, zod through two routes'
   `validateSearch`, the Radix dialog chain through the root file viewer, and `allocation.core` through the office
   job route's `validateSearch`. (A route's `component` is code-split; `head`, `validateSearch` and `beforeLoad` are
   not, and anything they import loads everywhere.) In the database, every trade read filters by *business*, but
   `job_assignments`, `partner_offers`, `bookings` and `business_members` only had job-/user-led indexes, so each
   My work / Money / job page read scanned the whole table.

## What changed (all behaviour-neutral)

Server (fewer round trips, same results)
- `trade-view.server.ts` `tradeHome`: month figures, status facts, Ready Check quote lines and ended assignments
  now run in one `Promise.all`; the quote lines come from the new batched `loadInstallerQuotes` (5 reads for all
  jobs instead of 5 per job; per job identical to `loadInstallerQuote`).
- `tradeJobPage`: boss pay rows join the first parallel block; the owner-ready read joins the second; the inline
  `await import(...)`s inside the array (which serialised it) are hoisted.
- `tradeOffer`: suggest-hours setting, PIESA windows, live assignment, owner's own answers and job number in one
  block (was five in a row). `tradeDay`: two trailing reads folded in. `tradeMoneyRows`: five follow-up reads in
  one block (was three in a row).
- `mitti-job-presentation.server.ts`: quote facts and status facts together (was two in a row).
- `install-days.server.ts` / `ready-check-times.server.ts`: the access check and the read-only context run
  together (a refused check still rejects the call).
- `workflow.server.ts` `nextStepBlockers`: entry blockers, PIESA status and assignment status together.
- `worker-links.functions.ts` `getWorkerJobView` (`/w/*`, polls every 20 s): business + contact releases join the
  main block (was three in a row).

Client
- `route-guards.ts`: `currentUser()` and `loadAccess()` are remembered for 60 s per tab and forgotten on any auth
  state change (sign-in/out, token refresh, user update). These guards are UI only — every server function still
  checks access — so the only visible difference is that a navigation no longer waits for the auth server.
- `staleTime` on the trade queries (My work 20 s, job page 20 s, install days / Ready Check times 20 s, day 15 s,
  offer 15 s, money / business / partner profile 30 s, role / Mitti-invited / own id 5 min, blockers 15 s). Coming
  back to a screen shows the last answer at once; the existing polls and every action's `invalidateQueries()`
  still refresh. No query was given a longer life than its poll.
- Bundle: `publicCalculatorHead` moved to a dependency-free module (`public-calculator-head.ts`);
  `my-job.$token.tsx` and `qa-access.tsx` validate their search params without zod (same accept/reject rules);
  the root `FileViewerHost` keeps its listener but lazy-loads the dialog (`file-viewer-dialog.tsx`) on first open;
  `parseJobSection` moved to `job-section.core.ts` (re-exported from `allocation.core`, so nothing else changes).

Database (NOT applied — pending, proven on PGlite)
- `docs/pending-migrations/0227_trade_speed_indexes.sql` (+ `.rollback.sql`): `job_assignments(business_id, active)`,
  `partner_offers(business_id, status)`, `bookings(business_id, status)`, `business_members(user_id)`.
  `tests/speed-indexes-0227-practice-db.test.ts` proves identical rows before/after, planner use, re-run safety and
  clean undo. Apply through the usual pending-migration path with Jo's go.

## Per route: server round trips before → after

"Hops" = database round trips made one after another on the request's critical path (a `Promise.all` counts
as one). Auth middleware verifies the JWT locally (0 hops). Query counts in brackets where they changed.

| Screen | Server calls on load | Critical path before | After |
|---|---|---|---|
| Navigation guard (every page change) | — | 2 hops (auth server, then roles+memberships) | 0 within 60 s per tab |
| `/field` My work — `getTradeHome` | 1 | 13 + 1–2 per Ready-Check-quoted job [~30 + 5N queries] | 9 flat [~35 queries] |
| `/field/$jobId` installer — `getTradeJobPage` | ~10 | 17 | 10 |
| … `getInstallerInstallDays` / `getTradeReadyCheckTimes` | (in the 10) | 3 each | 2 each |
| … `getJobBlockers` | (in the 10) | 5–7 | 3–5 |
| `/field/day/$jobId` — `getTradeDayView` / `getTradeDayExtras` | 2–3 | 6 / ~7 | 4 / ~7 |
| `/field/offer/$offerId` — `getTradeOffer` | 1 | 8–9 | 4–5 |
| `/field/money` — `getTradeMoneyView` / extras | 2 | 6 / 3 | 4 / 3 |
| `/field/business` — `getTradeBusiness` | 1 | 6 | 6 (unchanged) |
| `/partner/import` — `getPartnerProfile` | 1 | not changed | not changed |
| `/w/$token` — `getWorkerJobView` (polls 20 s) | 1–2 | 6–7 | 4–5 |
| `/estimate/$token` — `getPublicEstimate` | 1 | not changed (already `staleTime: Infinity`) | — |
| Office `/admin/jobs/$jobId` blockers panel | shares `getJobBlockers` | 5–7 | 3–5 |

## Per route: JavaScript before → after (minified KB; gzip is roughly a third)

Shell = what every page loads before its own code. Route = the page's own extra. Measured on
`.output/public/assets` with the static import graph (dynamic imports such as pdf-lib, heic2any, xlsx, jszip,
exifr and onboarding were already lazy and are not counted).

| Page | Before (shell + route = total) | After | Change |
|---|---|---|---|
| Shell (every page) | 911 | 736 | −175 |
| `/field` My work | 911 + 60 = 971 | 736 + 67 = 803 | −168 |
| `/field/$jobId` | 911 + 358 = 1269 | 736 + 494 = 1230 | −39 (zod, dialog and allocation.core moved out of the shell into this page) |
| `/field/day/$jobId` | 911 + 389 = 1300 | 736 + 526 = 1262 | −38 (same) |
| `/field/offer/$offerId` | 911 + 79 = 990 | 736 + 88 = 824 | −166 |
| `/field/money` | 911 + 66 = 978 | 736 + 72 = 808 | −170 |
| `/field/business` | 911 + 36 = 947 | 736 + 46 = 782 | −165 |
| `/field/welcome` | 911 + 6 = 917 | 736 + 11 = 747 | −170 |
| `/partner/import` | 911 + 115 = 1026 | 736 + 147 = 883 | −143 |
| `/w/$token` | 911 + 12 = 923 | 736 + 17 = 753 | −170 |
| `/estimate/$token` | 911 + 210 = 1121 | 736 + 346 = 1082 | −39 |
| `/my-job/$token` | 911 + 104 = 1015 | 736 + 120 = 856 | −159 |
| Office `/admin/needs-me` | 911 + 25 = 936 | 736 + 31 = 767 | −169 |
| Office `/admin/jobs/$jobId` | 911 + 359 = 1270 | 736 + 497 = 1233 | −37 |
| Office `/admin/jobs/active` | 911 + 68 = 979 | 736 + 168 = 904 | −75 |
| Office `/admin/enquiries` | 911 + 59 = 970 | 736 + 158 = 894 | −76 |

Roughly a third of that survives gzip, so every trade list screen now ships ~55 KB less compressed JavaScript
before it can draw (about 0.3–0.5 s on a weak 4G link). What is left in the shell (736 KB): react-dom 171,
supabase-js 209, TanStack router/query ~75, sonner 32, tailwind-merge 27 and small pieces. The remaining big per-page items: `panels.tsx` (74 KB, shared by job
pages), zod 55 KB (pulled by every `*.functions.ts` input validator on job pages), `mitti.core` 36 KB,
`official-forms.core` + `piisa-a3.core` 80 KB on the day page.

## Checks run

- `bun x tsc --noEmit`: clean (needs `NODE_OPTIONS=--max-old-space-size=8192` in the container).
- `bun scripts/scan-retired-terms.ts`: 88 matches, 0 customer-visible.
- Pass: trade-view, installer-quote-status, installer-home, installer-states, install-days.core, install-days-db,
  ready-check-times.core, ready-check-times-link-db, ready-check-change-flow-db, trade-job-access,
  business-owner-only, t3-mitti-async-claim, job-deleted-guards, install-no-access, visit-allocation,
  office-build-b.core, worker-links, my-job-spot-saved, speed-indexes-0219, speed-indexes-0227 (new).
- Pre-existing failure, unrelated: `ready-check-times-flow-db` — its mock of `ready-check-offer-text.server`
  predates the `emailInstallerAboutOffer` hook added in 473fff69 and fails identically on the base commit.
- NOT_RUN: `brief-o-ready-check-delivery` and the `brief-n` suite need the local disposable Supabase (Docker),
  which this container does not have.
- Lint: no new errors on touched files beyond the repo's pre-existing prettier formatting state.

## What still needs a live measurement

The code tells us how much work each page does, not how long each hop takes on Lovable's edge → Supabase
path, how the CDN caches the assets, or what a real 4G link does with three Google font families. To get the
real numbers:

- **Jo, on the phone (one line):** open the page, pull down to refresh, and count the seconds until the first
  real row appears (not the "Loading…" line). Do it for My work, one job, one job offer and Money, twice each
  (second time is the warm cache). Anything over 2 s on the second try is still a server problem; a slow first
  try only is download.
- **Lovable analytics:** in the Lovable editor open the project → Analytics. It shows visitors, pageviews and
  session length per page, not load time, so use it to see *which* pages people sit on longest and pair that
  with the stopwatch above.
- Server timing per function (edge → Supabase hop latency, TTFB for `getTradeHome` and `getTradeJobPage`) from
  the Lovable logs once the branch is live.

## Follow-ups not done here (each changes behaviour or needs a wider pass)

1. One `getInstallerJobScreen` server function for the job page instead of ~10 calls (biggest remaining win:
   removes ~30 redundant context queries per view).
2. `tradeContext`: read the business through the membership row in one query (saves a hop on every trade
   server call). Not done because two tests fake those tables without embedded-select support.
3. `requireJobRole`: read `qa_test` from the verified JWT claims instead of `auth.getUser()` over the network
   (saves an auth round trip in `getJobOverview` and `getJobBlockers`).
4. zod in `*.functions.ts` input validators (55 KB on every job page) — hand validators or a lazy import.
5. A default `staleTime` on the QueryClient (today 0 everywhere) and a review of the 20–60 s polls.
6. Fonts: three Google font families as a render-blocking stylesheet; self-host and preload the one used above
   the fold.
7. Apply 0227 (indexes) with Jo's go.
