# Portal speed — Step 1 (quick wins) — design

Date: 3 Nov 2026 · Agreed in chat by Jo ("Yes, but finish saved spots first" — saved spots shipped as #132)

## Why

Jo: the portal is "incredibly slow … not usable". Measured on 3 Nov (read-only):
- The database is in **AWS Ireland (eu-west-1)**; users are in Australia, so every database round trip costs ~300 ms. Lovable can't move an existing project's region.
- The database is idle and small (2,709 jobs) — not overloaded.
- **First open: 12–18 s**, loading 137–170 separate code files. The sign-in page loads code for Mitti, trade jobs, allocation, etc.
- **Each page's data: 2–4 s** (installer My work, Money, My business, job page; office lists 0.6–1.8 s per database request, several in a row).
- Login token is ES256 (checked locally) — not a cause.

## What Step 1 changes (no new features, nothing users see except speed)

### 1. First open loads only what the page needs
- `src/routes/__root.tsx` imports `isStaleChunkError` from `../router`; the same function lives in `@/lib/page-recovery.core`. Import it from there, so the root no longer pulls the whole route tree into the first load.
- The root's auth-change path (`lib/auth-change.ts` → `lib/trade-route-prefetch.ts`) imports every trade server function; make that import lazy (dynamic) so it loads only when a trade page is opened.
- `SignInCard` imports `TradeShell` only for class strings; copy the three class strings so the sign-in page doesn't pull the trade shell.
- Router: `defaultPreload: "intent"` so a page's code and data start loading when a finger/mouse touches the link.

### 2. Office pages check who you are once
- Every server call already runs the office boundary middleware, which fetches the user and their roles. `requireOfficeIdentity` then fetches them again in 3 sequential round trips. Reuse the boundary's result (pass it through the request context); fall back to the current check only if it's missing.

### 3. Run lookups at the same time, not one after another
- **Choose installer › To release** (`installer-waiting.server.ts`): rounds that need only job ids start alongside `installerFacts`; `spotReleaseStates` and the saved-spot facts read join the same round.
- **Installer My work** (`trade-view.server.ts` `tradeHome`): the deposits and Mitti electrician questions start with the main rounds, not after.
- **Installer job page** (`trade-job-bundle`): sections reuse the bundle's one access check instead of re-checking (`requireJobRole`, install-days, my-owner-quote, installer price).

- **Installer Money** (`tradeMoney` / `tradeMoneyRows`) and **My business** (`tradeBusiness`): independent reads join one round; `workerRolesFor` and the `usualEarly` chain start with round 2; `loadTeamWorkers` stops doing a second full read when the `declarations_due` column is missing (detect once, not every call).
- **Installers check who they are once** (Jo, 3 Nov): every trade server call reuses the boundary middleware's user and roles for the trade context (`ctxOrThrow`) instead of re-reading them; only the business link is read if not already known.

### 4. Office pages start fetching straight away
- Office list routes (Active jobs, Enquiries, Choose installer) get a route `loader` that starts the server call when the route matches, like the trade routes already do — not after the screen draws.

### 5. Show the last copy instantly (Jo, 3 Nov: "very fast — people use it all day")
- Office lists (Active jobs, Enquiries, Choose installer › To release) and every installer page draw **instantly from the last copy kept on this device**, then refresh in the background and update in place. Installer pages already keep a last copy (`src/lib/trade-cache.ts`: per signed-in user, 24 h max age, cleared on sign-out); office pages get the same, reusing that module (generalised, same rules).
- A small "Updating…" line shows while the fresh copy loads; actions (buttons) wait for the fresh copy where acting on old data could be wrong (e.g. Send on To release is enabled only once fresh).
- No last copy (first visit, after sign-out, older than 24 h) → today's behaviour.

## Rules
- Behaviour must not change: same data, same permissions, same wording. Every access check that exists today still happens (reused, not removed).
- Measured before and after with the same Playwright script (installer account Jo provided, read-only): first open, My work, Money, My business, a job page; office pages with the TEST office login if Jo provides it.
- Ships as its own pull request; Jo chooses who merges. Another chat is building "Deep's first job" — check open PRs/branches for file overlap before starting and before the PR.

## Out of scope (Step 2, only if still slow)
- Bundle/chunk packaging (`vite.config` manualChunks), server rendering for signed-in pages, moving to an Asia-Pacific Lovable project.

## Success
- First open well under half of today's 12–18 s; return visits show data instantly (<0.5 s) from the last copy; fresh data ~1–1.5 s (from 2–4 s). Reported to Jo as before/after numbers.

## Step 2, part A (added 3 Nov 2026, 9pm — Jo: "faster ASAP, urgent"): the job page asks the database once

### Why
The installer job page takes ~10 s. The bundle is already parallel (4 rounds), but it makes ~150 small database reads. The portal's server (Cloudflare Workers) allows only **6 outgoing requests waiting at a time** (Cloudflare docs, "Simultaneous open connections"), so 150 reads at ~300 ms each queue up to ~7–8 s. Fewer reads is the only fix on this side.

### What changes
- One **job-facts read** per page: a single database function (`trade_job_facts(job_id)`, SECURITY INVOKER so row-level security still applies, or a set of ≤3 batched reads) returns every row the bundle's sections read today for that job: the job + property + owner, its assignments, bookings, workflow events, quotes/items, PIESA records, documents, rate/pay rows, Mitti form state. The bundle hands the sections these rows instead of each section reading its own.
- Sections keep their logic and their output exactly; they only change where the rows come from (a `JobFacts` object passed in, with today's reads as the fallback when it's absent, like `SharedJobReads` in Task 6).
- Target: **≤ 10 database reads per job page load** (from ~150), so the 6-at-a-time limit no longer matters.
- Same access rules: the facts read runs only after today's access check passes, for this verified user and job; nothing from another job or business is read.
- Measured before/after with the same script; output snapshot identical.

### Not in part A
Office job page, Active jobs and Enquiries consolidation (part B, after measuring).
