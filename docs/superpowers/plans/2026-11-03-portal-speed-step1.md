# Portal Speed Step 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the portal fast for people using it all day: small first load, one identity check per call, parallel reads, data starting at route match, and instant last copy.

**Architecture:** No behaviour changes. (1) Cut the root's static import graph. (2) Pass the boundary middleware's user+roles through request context and reuse it in office and trade checks. (3) Flatten sequential awaits into `Promise.all` rounds. (4) Route loaders for office lists. (5) Generalise `trade-cache.ts` into a device last-copy cache used by office lists too.

**Tech Stack:** TanStack Start/Router, React Query, Supabase, bun test, Playwright (measurement).

**Spec:** `docs/superpowers/specs/2026-11-03-portal-speed-step1-design.md`
**Findings (file:line evidence):** `/home/claude/speed-findings.md`

## Global Constraints
- Same data, same permissions, same wording. Every access check that exists today still happens — reused, never dropped. If a reused value is missing, fall back to today's check.
- Server functions run on Cloudflare Workers; DB is ~300 ms per round trip away — count round trips, not CPU.
- Last copy: per signed-in user, max 24 h, cleared on sign-out, never written from an error, storage failure = no cache. Send on To release enabled only after the fresh copy.
- Another chat ("Deep's first job", Parts 1–2 merged) edits trade/office files: before each task `git fetch origin main` and rebase; stop and report if a file you need was changed upstream in a conflicting way.
- Tests: run each touched test file in its own `bun test <file>` process (mock.module leaks). Pre-existing failures on main: templates-hub (2), trade-route-prefetch (1), journey-a2-complete-route-db (4), portal-qa-screen-rules (3), postintake-health (1), intake-sequence (1).

## Review Focus
1. A user who signs out and another signs in on the same phone must never see the first user's last copy. (Task 9 test.)
2. An office user without admin role must still be refused by every office function after the identity reuse. (Task 2 test.)
3. A trade user from business A must never get business B's data after the ctx reuse. (Task 3 test.)
4. To release Send must not act on a stale last copy. (Task 9 test.)
5. The sign-in page must still recover from a stale-chunk error after the root import change. (Task 1 test.)

---

### Task 0: Baseline measurement
- [ ] Run `/tmp/perf3.js`-style Playwright script (installer account from env U/P; read-only; visible-link clicks; time to data = last `/_serverFn` response for the page) against production; record first open, My work, Money, My business, one job page into `docs/superpowers/plans/2026-11-03-speed-baseline.md`. Also record JS file count on `/auth`. Commit.

### Task 1: First load only loads the page
**Files:** `src/routes/__root.tsx:12`, `src/lib/auth-change.ts`, `src/lib/trade-route-prefetch.ts`, `src/components/**/SignInCard.tsx`, `src/router.tsx`; tests: existing `tests/trade-route-prefetch.test.ts` + new `tests/first-load-graph.test.ts`.
- [ ] Failing test: `__root.tsx` source does not import from `../router`; `auth-change.ts` has no static import of `trade-view.functions` (via trade-route-prefetch); `SignInCard` does not import `TradeShell`; `router.tsx` sets `defaultPreload: "intent"`.
- [ ] Implement: import `isStaleChunkError` from `@/lib/page-recovery.core`; make trade prefetch a dynamic `import()` at use time; inline the 3 class strings in SignInCard; add `defaultPreload: "intent"` (keep `defaultPreloadStaleTime: 0` behaviour reviewed — set to 30_000 for intent preloads).
- [ ] `bun run build` and count `dist` client chunks referenced by `/auth` HTML (modulepreload links) before vs after; record in the report.
- [ ] Commit `perf: first load imports only the page`.

### Task 2: Office identity checked once
**Files:** `src/lib/qa-office-boundary.ts`, `src/start.ts:46`, `src/lib/qa-office-access.server.ts:12-22`, `src/integrations/supabase/auth-middleware.ts`; test `tests/office-identity-reuse.test.ts`.
- **Produces:** request context field `boundary: { userId: string; roles: string[] } | undefined` set by `testOfficeBoundary`; `requireOfficeIdentity(ctx?)` uses it when present (0 extra round trips) else today's 3-step check.
- [ ] Failing tests: with boundary context present, `requireOfficeIdentity` makes no `getUser`/`user_roles`/`is_admin` calls and returns the same identity; non-admin roles → same refusal as today; context missing → today's path.
- [ ] Implement; thread the context into office server functions that call `requireOfficeIdentity` (grep all callers).
- [ ] Commit `perf: office identity reuses the boundary check`.

### Task 3: Trade context checked once
**Files:** `src/lib/trade-view.server.ts:60-70` (`ctxOrThrow`), callers; test `tests/trade-ctx-reuse.test.ts`.
- **Consumes:** Task 2's boundary context. **Produces:** `ctxOrThrow(boundary?)` reads only `business_members` (+`profiles` if needed) when boundary roles/user are given.
- [ ] Failing tests: with boundary, no `user_roles` read; business scoping unchanged (user in business A gets A only); missing boundary → today's path.
- [ ] Implement; commit `perf: trade context reuses the boundary check`.

### Task 4: To release reads in parallel
**Files:** `src/lib/installer-waiting.server.ts` (~:101-183), `src/lib/readycheck-booking.server.ts:91-99` (`installerFacts` chain); test: extend `tests/installer-waiting-rank.test.ts` with a round-trip counter fake.
- [ ] Failing test: a fake client that counts sequential "waves" (await boundaries) shows ≤3 waves for the loader (today ~6+ after identity).
- [ ] Implement: start round-2 reads and `spotReleaseStates` with the jobs read's ids alongside `installerFacts`; inside `installerFacts` run creds/workers/notice-acks/certs/levels in one `Promise.all` after `businesses`.
- [ ] Commit `perf: To release reads in parallel`.

### Task 5: Installer My work tail in parallel
**Files:** `src/lib/trade-view.server.ts` `tradeHome` (~:101-215); test `tests/trade-home-waves.test.ts`.
- [ ] Failing wave-count test (≤3 waves after ctx); same output as before for a fixture.
- [ ] Implement: start `installDepositPaidForJobs` and `openMittiElectricianQuestions` in round 2. Commit `perf: My work reads in parallel`.

### Task 6: Job page shares one access check
**Files:** `src/lib/trade-job-bundle.server.ts`, `src/lib/workflow.server.ts:82-93` (`requireJobRole`), `src/lib/install-days.server.ts:55,68`, `src/lib/my-owner-quote.server.ts:12-15`, installer price view; test `tests/job-bundle-access.test.ts`.
- **Produces:** bundle computes access once (`{ role, businessId, userId }`) and passes it into section readers via an optional param; each reader keeps its own check when called standalone.
- [ ] Failing tests: bundle makes one `my_job_role`/`can_access_job` call total; a user without access to the job is still refused; standalone section calls still check.
- [ ] Implement; commit `perf: job page shares one access check`.

### Task 7: Money and My business in parallel
**Files:** `src/lib/trade-view.server.ts` `tradeMoney`/`tradeMoneyRows` (~:519-630), `tradeBusiness` (~:664-725), `loadTeamWorkers` (~:659); tests `tests/trade-money-waves.test.ts`, `tests/trade-business-waves.test.ts`.
- [ ] Failing wave-count tests (Money ≤3, Business ≤3 waves after ctx); `loadTeamWorkers` does one read when `declarations_due` exists, and remembers (module-level) when it doesn't.
- [ ] Implement; commit `perf: Money and My business read in parallel`.

### Task 8: Office lists start at route match
**Files:** office list routes (grep routes using `getActiveJobsList`, `getEnquiriesList`, `getInstallerWaitingList`), mirroring `field.tsx` `loader` + `startTradeScreen` pattern; test `tests/office-route-loaders.test.ts` (source pin like trade-route-prefetch).
- [ ] Failing source-pin test: each office list route declares a `loader` that starts its list query via the query client.
- [ ] Implement with `queryClient.ensureQueryData`/prefetch keyed exactly as the component's query; commit `perf: office lists start loading at route match`.

### Task 9: Instant last copy everywhere
**Files:** rename/generalise `src/lib/trade-cache.ts` → keep exports, add `readLastCopy/writeLastCopy` (same rules, prefix `hiv-last:v1:`), office list screens (Active jobs, Enquiries, Choose installer To release), `InstallerWaitingScreen.tsx` Send bar; tests `tests/last-copy.test.ts`, extend `tests/saved-spots-by-area.test.tsx`.
- [ ] Failing tests: office list renders immediately from a stored copy and shows "Updating…" until fresh; sign-out clears all `hiv-last` and `hiv-trade` keys and a different user never reads another's copy; error responses never written; To release Send disabled with text "Updating…" until the fresh copy arrives.
- [ ] Implement using React Query `initialData` + `initialDataUpdatedAt` (as `useTradeJobBundle` does); commit `perf: show the last copy instantly`.

### Task 10: Measure, review, ship
- [ ] Re-run Task 0 script; add after-numbers to `2026-11-03-speed-baseline.md`.
- [ ] Final whole-branch review; fix wave; rebase on latest main; run touched tests; `tsc --noEmit`.
- [ ] Push `perf/portal-speed-step1`, open PR with before/after table. **Stop — Jo chooses who merges.**

### Task 11: Job page asks the database once (spec Step 2 part A)
**Files:** `src/lib/job-facts.server.ts` (new), `src/lib/trade-job-bundle.server.ts`, the section readers it calls (trade-view.server.ts tradeJobPage + its facts helpers, mitti-job-presentation, install-days.server, my-owner-quote.server, installer price view, job-overview), optional `supabase/migrations/<ts>_trade_job_facts.sql`; tests `tests/job-facts.test.ts`, extend `tests/job-bundle-waves.test.ts` (reads count).
**Interfaces:** `type JobFacts = { job, property, owner, assignments[], bookings[], events[], quotes[], quoteItems[], piesa[], documents[], pay[], mitti… }` loaded by `loadJobFacts(jobId, access)` after the access check; `SharedJobReads` gains `facts: JobFacts`; each section reader takes `facts?` and uses it when present (same user/job), else today's reads.
- [ ] Inventory: list every distinct table/filter read in the bundle path with counts (from the wave test's read log) — commit the inventory as the test fixture doc.
- [ ] Failing test: bundle reads ≤ 10 for owner/staff/electrician fixtures; snapshot output identical to Task 6's.
- [ ] Implement `loadJobFacts` as ≤ 3 batched reads (by job id) — a DB function only if a plain batched read can't express it; sections consume facts. Keep each section's standalone path.
- [ ] Commit per section group; report reads before → after and waves.
