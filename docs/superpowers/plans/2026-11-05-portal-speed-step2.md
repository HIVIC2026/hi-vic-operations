# Portal speed Step 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the number of browser→server and server→database trips every screen makes so the portal's waits drop to about a second, without changing what any screen shows or does.

**Architecture:** A test-only "round counter" wraps the Supabase admin client and counts sequential database rounds per server function, so every screen's trips are measured before and after and pinned by a test. Each screen then gets ONE server function (all reads in `Promise.all`), the job pages get the Step 1 last-copy behaviour, sign-in fetches role + first screen together, and actions become write-and-return with the screen refreshing in the background. Domain guards are never moved or weakened; trade reads stay inside `trade-view.server.ts`.

**Tech Stack:** TypeScript, TanStack Start/Router/Query, Supabase JS, bun:test, Playwright timing script (`scripts/qa-timing.ts`).

**Spec:** `docs/superpowers/specs/2026-11-05-portal-speed-step2-design.md`

## Global Constraints

- Read root `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md` first. Trade screens read only through `trade-view.server.ts`, business-scoped; labels stay in pure cores.
- No behaviour, wording, rule or guard changes. A guard that ran before an action still runs before it; a check that refused still refuses.
- Target per screen: **1 browser→server call for the first draw** and **≤ 3 sequential database rounds** inside it. The round-counter test fails above that.
- Instant (optimistic) actions: notes, filters, ticks, folds, status labels only. **Send, Give to installer, Pay, Book, Cancel wait for the real save** before "Done".
- Last copy: per signed-in user, 24 h, "Updating…" line, money/send buttons wait for the fresh copy (reuse `src/lib/trade-cache.ts` and `src/lib/office-last-copy.ts`; do not write a third cache).
- Every task's PR body shows before/after: server calls per screen, sequential rounds (from the counter), and a timed run at 390 px and 1280 px.
- No SQL changes, no new tables, no dependency changes, nothing goes live without Jo.

## Review Focus

1. **Parallelised reads whose later read depended on an earlier result** (e.g. business id from the assignment, then rows by business) → still correct; the counter test uses real fixture data so a wrong merge returns empty rows and fails the existing screen tests. Pin: each screen task runs its existing screen tests.
2. **Optimistic action fails on the server** → screen reverts and shows the error; nothing else on the screen is lost. Pin: Task 7 test.
3. **Last copy shown to a different user on the same phone** → cache is keyed by user id; sign-out clears it. Pin: Task 5 test.
4. **Sign-in for a user with no role / a suspended partner** → still lands on the same screen as today with the same message. Pin: Task 6 test.
5. **A screen's merged function leaks data across businesses** (one read no longer business-scoped after merging) → Task 2–4 tests assert every row returned belongs to the signed-in business.

---

### Task 1: Round counter + baseline

**Files:**
- Create: `tests/helpers/round-counter.ts`
- Create: `scripts/qa-timing.ts` (Playwright, TEST sessions only, 390/1280, time-to-usable per route, writes `/mnt/documents/portal-qa/timing-<stamp>.json`; refuses non-TEST emails like `qa-session.ts`)
- Create: `tests/speed-rounds.test.ts`
- Create: `docs/superpowers/speed-baseline-2026-11-05.md`

**Interfaces:**
- Produces: `countRounds<T>(fn: () => Promise<T>): Promise<{ result: T; rounds: number; queries: number }>` — wraps `supabaseAdmin` so queries awaited concurrently count as one round (a round = the set of queries started before the first of them resolves), sequential ones add rounds. `ROUND_LIMIT = 3`.

- [ ] **Step 1: Failing test:** `countRounds(() => Promise.all([q(), q()]))` → `rounds 1, queries 2`; `countRounds(async () => { await q(); await q(); })` → `rounds 2`.
- [ ] **Step 2:** `bun test tests/speed-rounds.test.ts` → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Baseline.** Using existing PGlite/TEST fixtures, record rounds + queries for: `tradeHome`, `tradeJobBundle`, `tradeMoney`, `tradeBusiness`, the Team loader, Add a job loader, office Enquiries/Active jobs/Choose installer/Needs me/Jobs loaders, `loadJobPage`, and the sign-in path. Write the table to the baseline doc (these numbers are the "before" in every later PR).
- [ ] **Step 6: Commit** `test: database round counter and speed baseline`

---

### Task 2: Installer My work, Money, My business, Team in one trip each

**Files:**
- Modify: `src/lib/trade-view.server.ts` (`tradeHome`, `tradeMoney`, `tradeBusiness`, team loader: every independent read in one `Promise.all`; the `moneyP`/`depositsP` chains join round 2)
- Modify: `src/routes/_authenticated/field.index.tsx`, `field.money.tsx`, `field.business.tsx`, `field.business_.team.tsx` (one query each; remove any second `useQuery` the screen makes for its first draw)
- Test: `tests/speed-rounds.test.ts` (add one `it` per screen asserting `rounds ≤ ROUND_LIMIT`), existing trade-view tests

- [ ] **Step 1:** Add the four round assertions → FAIL with the baseline numbers.
- [ ] **Step 2:** Implement. **Step 3:** PASS; run `bun test tests/trade-view*.test.ts tests/installer-*.test.ts` → no new failures. Business-scope assertion: every job/row returned has the signed-in business id.
- [ ] **Step 4:** `bun scripts/qa-timing.ts --routes /field,/field/money,/field/business,/field/business/team` on a TEST installer (if sessions available; else NOT RUN) → paste into the PR.
- [ ] **Step 5: Commit** `perf: installer My work, Money, My business, Team load in one trip`

---

### Task 3: Installer job page, day page, Add a job

**Files:**
- Modify: `src/lib/trade-job-bundle.server.ts` (`tradeJobBundle` ≤ 3 rounds), `src/lib/trade-view.server.ts` day loader, Add a job loader
- Modify: `src/routes/_authenticated/field.$jobId.tsx` (the 3 `useQuery`s → one bundle query; the role query reads from the bundle), `field.day.$jobId.tsx`, `partner.import.tsx`; components under `src/components/trade/` that run their own `useQuery` on first draw (NextStepBox, OwnerQuoteCard, InstallerPriceCard, SafetyPlanCard, InstallAttendanceCard, FieldLayout, TradeShell) read from the bundle via props/context instead
- Test: `tests/speed-rounds.test.ts`, existing trade-job-bundle and component tests

- [ ] Steps as Task 2 (failing round assertions → implement → PASS → timing → commit `perf: installer job, day and Add a job pages load in one trip`).
- [ ] Extra test: no-login SWMS and Mitti links (`swms-link`) still open in ≤ 2 rounds.

---

### Task 4: Office lists and office job page

**Files:**
- Modify: `src/lib/office-job-page.server.ts` (`loadJobPage`: the ~20 sequential awaits become ≤ 3 `Promise.all` rounds; `loadJobMoney` joins the same call), office list loaders (`office-needs.server.ts`, `installer-waiting.server.ts`, enquiries/jobs loaders)
- Modify: `src/routes/_authenticated/admin.jobs.$jobId.tsx` and `src/components/portal/JobsLaneScreen.tsx`, `JobsScreen.tsx`, `job-peek.tsx`, `JobDeleteControls.tsx` (first-draw data from the one page query)
- Test: `tests/speed-rounds.test.ts`, existing office tests, `tests/enquiry-piles-one-pile-practice-db.test.ts`

- [ ] Steps as Task 2; commit `perf: office lists and job page load in one trip`.

---

### Task 5: Last copy on job pages

**Files:**
- Modify: `src/routes/_authenticated/field.$jobId.tsx` (use `trade-cache.ts` seed like My work), `src/routes/_authenticated/admin.jobs.$jobId.tsx` (use `office-last-copy.ts`)
- Test: `tests/job-page-last-copy.test.tsx`

**Interfaces:** Consumes `useTradeSeed`/`headStartOr` (`src/lib/use-trade-seed.ts`) and `office-last-copy.ts` as they are.

- [ ] **Step 1: Failing tests:** second visit within 24 h draws from the last copy before the fetch resolves and shows "Updating…"; Send/Pay/Book/Give buttons disabled until fresh; a different user id on the same device gets no seed; sign-out clears it; copy older than 24 h ignored.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `perf: job pages draw from the last copy instantly`

---

### Task 6: Sign-in opens the first screen in one go

**Files:**
- Modify: `src/routes/auth.tsx` sign-in handler, `src/lib/auth-change.ts`, `src/lib/trade-route-prefetch.ts`, `src/lib/office-route-prefetch.ts`
- Create: `src/lib/first-screen.server.ts` with `firstScreenAfterSignIn(userId): Promise<{ to: "/field" | "/admin/enquiries" | "/field/welcome" | "/auth"; data: unknown }>` — one call returning the role-based destination (same rules as today's redirect) AND that screen's first-draw data, seeded into the query cache before navigation
- Test: `tests/first-screen.test.ts`

- [ ] **Step 1: Failing tests:** installer → `/field` with `tradeHome` data; office → `/admin/enquiries` with its loader data; no role → today's destination and message; suspended partner → today's screen; total rounds ≤ 3.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** timing of sign-in → first usable screen before/after. **Step 6: Commit** `perf: sign-in lands on the first screen in one trip`

---

### Task 7: Instant actions

**Files:**
- Create: `src/lib/optimistic.core.ts` — `OPTIMISTIC_ALLOWED: readonly string[]` (notes, filters, ticks, folds, status labels — the exact mutation names, listed in the task brief after Task 1's audit) and `WAITS_FOR_SAVE: readonly string[]` (every Send, Give, Pay, Book, Cancel mutation); `isOptimistic(name): boolean`
- Create: `src/lib/use-instant-action.ts` — TanStack Query mutation wrapper: `onMutate` applies the change to the cached screen, `onError` reverts and shows the server message, `onSettled` refetches the screen's one query in the background
- Modify: the listed action call sites in `src/components/trade/*` and `src/components/portal/*`; their server functions return `{ ok: true }` after the write instead of re-reading the screen
- Test: `tests/optimistic.core.test.ts`, `tests/use-instant-action.test.tsx`

- [ ] **Step 1: Failing tests:** `isOptimistic("tradeSaveNote")` true; `isOptimistic("tradeSendQuote")` false; a name in both lists → test fails (lists must be disjoint); a mutation failing on the server → cache reverted, error shown, one background refetch; a WAITS_FOR_SAVE button → "Done" only after the promise resolves.
- [ ] **Step 2–4:** FAIL → implement → PASS; run every touched component's tests. **Step 5: Commit** `perf: instant actions with write-and-return server functions`

---

### Task 8: Whole-flow check

- [ ] `bun scripts/scan-retired-terms.ts` → no new hits.
- [ ] `bun test tests/speed-rounds.test.ts` → every screen ≤ 3 rounds; update `docs/superpowers/speed-baseline-2026-11-05.md` with the after column.
- [ ] `bun run portal-qa` → no new failures vs the 5 Nov run; gaps NOT_RUN.
- [ ] `bun scripts/qa-timing.ts` full run (TEST sessions) → before/after table for Jo.
- [ ] One PR per task (Tasks 2–7), each with its before/after; none merged until Jo says.
