# Installer screens speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every installer screen shows its content in under 1 second (median) on a 4G phone, for the business owner and staff logins, with identical information.

**Architecture:** First a read-only Playwright timing script and a same-information capture script give a before baseline. Then each screen's server loader is flattened to one or two round trips (parallel reads, or one read-only database function where a chain can't be flattened), the trade screens keep a per-user last copy for instant return visits, and refreshes skip when nothing changed. Every change is re-timed and compared field-for-field with the baseline.

**Tech Stack:** TanStack Start server functions, TanStack Query, Supabase (Postgres, RLS), Bun test, PGlite, Playwright (Python, already used in `qa/`).

**Spec:** `docs/superpowers/specs/2026-10-30-installer-screens-speed-design.md`

## Global Constraints

- Speed only: no change to wording, layout, workflow, prices, permissions, or who can see what.
- Target: median under 1 second until content shows, 4G throttling, phone-sized screen (390 wide).
- Roles measured: TEST Reinsulate owner `deep-test@hivic.test` and staff `qa.staff.reinsulate@hivic-test.example`, business `17793408-bf5c-4ddd-9bec-64199f64f9fb`.
- TEST jobs and logins only; timing and capture scripts only read: no sends, no writes, no Mitti, no Xero.
- Database changes: `docs/pending-migrations/<name>.sql` + `<name>.undo.sql`, proven on PGlite (`tests/helpers/pglite-*.ts`) first; Jo approves before any live run.
- Follow `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md`, `scripts/AGENTS.md`: server functions stay literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chains; in-house and money paths keep propagating read errors; staff are still refused business-owner data on the server (`bossOrThrow`).
- New database functions are read-only, `SECURITY INVOKER` unless they must read across RLS, and re-check business membership with the same rules as `tradeContext`.
- Work on a branch, open a PR; never force-push or rewrite pushed history (Lovable sync).

## Review Focus

1. **Staff login sees owner-only data after the change** (money, rates, bank, team): staff must still be refused exactly as today. Each screen's parity test runs as staff, and the money/business tasks assert the staff refusal.
2. **Cached last copy shown to the wrong person** (shared phone, sign-out then a different sign-in): the cache is keyed by user id and cleared on both sign-out buttons. Task 3 tests this.
3. **A failed read now shows a partial screen as if complete** (one of the merged reads fails): money and in-house reads must still fail the request; only the existing display-only catches stay. Each flattened loader gets a "one read fails" test.
4. **TEST/real mixing** (`c.isTest` filters `source === 'qa_test'`): the merged reads keep the same filter. Covered by the parity capture on TEST plus a unit test per flattened loader with one real and one qa_test job.
5. **"Nothing changed" check misses a change** (new offer, booking moved, photo rejected): the refresh must fetch. Task 4 tests each listed table; any table without a trustworthy change time makes the check always fetch.

---

## File structure

- `scripts/installer-speed.py`: Playwright timing (4G, 390 wide, 5 runs per screen and role). Writes `qa/installer-speed/<date>-<label>.md`.
- `scripts/installer-speed-capture.ts`: calls each screen's server loader as the TEST owner and staff, normalises time-dependent fields, writes or compares `qa/installer-speed/baseline/<screen>-<role>.json`.
- `src/lib/trade-cache.client.ts`: per-user last-copy store for trade screens.
- `src/lib/trade-change-stamp.server.ts` + `docs/pending-migrations/trade-change-stamp.sql`: "has anything changed" check.
- Per-screen loader changes stay in their current files (`trade-view.server.ts`, `trade-job-bundle.server.ts`); any new database function goes in `docs/pending-migrations/trade-<screen>-read.sql`.

### Task 1: Timing script and before table

**Files:**
- Create: `scripts/installer-speed.py`
- Create: `qa/installer-speed/README.md` (how to run, one paragraph)

**Interfaces:**
- Produces: `python scripts/installer-speed.py --base <url> --label <before|after-<screen>> [--screens home,job,day,business,money]`. Output table columns: screen, role, median ms, slowest ms, server calls, slowest call (name, ms).

- [ ] **Step 1:** Sign in using the same TEST session mechanism as `qa/installer-test` (reuse its login helper, don't copy secrets into the file). Pick the first active qa_test job assigned to the TEST business for the job and day screens; stop with a clear message if there is none.
- [ ] **Step 2:** Per screen: Chromium context at 390×844, CDP network throttling (download 1.6 Mbps, upload 750 kbps, latency 150 ms), cold load, timed until the screen's main content selector is visible (home: job list group; job: job header; day: visit header; business: business name; money: month totals). Record `/_serverFn/` requests and their durations. 5 runs, median and max.
- [ ] **Step 3:** Run against the published portal: `python scripts/installer-speed.py --base https://portal.homeinsulationvictoria.com.au --label before`. Expected: a table with 10 rows (5 screens × 2 roles). Staff rows for money/business pages show the existing refusal; the script records that as "refused (expected)", not a failure.
- [ ] **Step 4:** Commit the script, README and `qa/installer-speed/<date>-before.md`. Send Jo the before table in plain words.

### Task 2: Same-information capture

**Files:**
- Create: `scripts/installer-speed-capture.ts`
- Test: `tests/installer-speed-capture.test.ts`

**Interfaces:**
- Produces: `normaliseForParity(value: unknown, now: Date): unknown` (exported, pure), and CLI `bun scripts/installer-speed-capture.ts --write | --compare [--screen <name>]`. `--compare` exits 1 and prints the first differing path.

- [ ] **Step 1: Failing test** `normaliseForParity`: replaces values under keys `week`, `expiresAt`, `goneIn` and any ISO timestamp within the last 2 minutes of `now` with `"<time>"`; sorts arrays of objects with `jobId` by `jobId`; leaves everything else byte-identical. Assert on a fixture with each case.
- [ ] **Step 2:** Run `bun test tests/installer-speed-capture.test.ts`, expect FAIL (not defined).
- [ ] **Step 3:** Implement. The CLI calls `tradeHome`, `tradeJobPage`, `tradeJobBundle`, `tradeDayView`, `tradeDayExtras`, `tradeBusiness`, `tradeMoneyView`, `tradeMoneyExtras`, `tradeMoneyJob` directly with the TEST owner and staff user ids. A thrown error is captured as `{ error: message }` so staff refusals are part of the baseline.
- [ ] **Step 4:** Test passes. Run `--write` against live (read-only); commit the baseline JSON (TEST data only).

### Task 3: Instant return visits

**Files:**
- Create: `src/lib/trade-cache.client.ts`
- Modify: the trade screens' `useQuery` calls in `src/routes/_authenticated/field.index.tsx`, `field.$jobId.tsx`, `field.day.$jobId.tsx`, `field.business.tsx`, `field.business_.team.tsx`, `field.money.tsx`, `field.money_.$jobId.tsx`
- Modify: `src/components/trade/TradeShell.tsx:59`, `src/components/portal/NoAccess.tsx:17` (sign-out clears cache)
- Test: `tests/trade-cache.test.ts`

**Interfaces:**
- Produces: `readTradeCache<T>(userId: string, key: string): { data: T; at: number } | null`, `writeTradeCache(userId: string, key: string, data: unknown): void`, `clearTradeCache(): void`. Storage: `localStorage`, prefix `hiv-trade:v1:<userId>:`, all calls wrapped in try/catch (a storage failure means no cache, never an error). Entries older than 24 h are ignored.

- [ ] **Step 1: Failing tests:** write then read returns data for the same user; another user id returns null; `clearTradeCache` removes every `hiv-trade:` key and no others; an entry older than 24 h returns null; a throwing storage returns null and doesn't throw.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement. In each screen: `initialData` and `initialDataUpdatedAt` from `readTradeCache` (so TanStack Query refetches straight away), and `writeTradeCache` after a successful fetch. Both sign-out handlers call `clearTradeCache()` before `signOut()`.
- [ ] **Step 4:** Tests pass; `bunx tsc --noEmit` clean. Commit.

### Task 4: Skip refreshes when nothing changed

**Files:**
- Create: `docs/pending-migrations/trade-change-stamp.sql`, `trade-change-stamp.undo.sql`
- Create: `src/lib/trade-change-stamp.server.ts`; add `getTradeChangeStamp` to `src/lib/trade-view.functions.ts`
- Test: `tests/trade-change-stamp.pglite.test.ts`

**Interfaces:**
- Produces: SQL `public.trade_change_stamp(p_business uuid) returns text` (read-only), server fn `getTradeChangeStamp(): Promise<string | null>` (null = unknown, always refetch).
- Consumes: Task 3's screens.

- [ ] **Step 1:** Check on the live schema (read-only) which of these have a change time that updates on every write: `jobs`, `job_assignments`, `partner_offers`, `bookings`, `evidence_requirements`, `evidence_files`, `documents`, `workflow_events`, `payouts`/money tables used by `tradeMoneyRows`. A table without one makes the function return null. Write the findings into the migration's header comment.
- [ ] **Step 2: Failing PGlite tests:** stamp changes after each of: a new pending offer, a booking time change, a photo requirement rejected, a new workflow event, an assignment ended; stamp is unchanged with no writes; returns null when the business has no membership for the caller.
- [ ] **Step 3:** Run, expect FAIL.
- [ ] **Step 4:** Implement the function as the greatest change time across the business's assigned jobs' rows in those tables, concatenated with row counts (so deletes change it). Screens with `refetchInterval` first call `getTradeChangeStamp`, and fetch only if it differs from the stamp stored with the last fetch or is null.
- [ ] **Step 5:** Tests pass. Commit. Ask Jo before running the migration live.

### Tasks 5–9: Flatten each screen (one task per screen, slowest first from the Task 1 table)

Screens: 5 home (`tradeHome`), 6 job (`tradeJobPage` + `tradeJobBundle` + `getMyMittiInvited`), 7 day (`tradeDayView` + `tradeDayExtras` + `onsiteFormStatus`), 8 money (`tradeMoneyView`, `tradeMoneyExtras`, `tradeMoneyJob`), 9 business (`tradeBusiness`). Run them in the order the before table gives, not this numbering.

**Files (per screen):** that loader in `src/lib/trade-view.server.ts` (or `trade-job-bundle.server.ts`); optionally `docs/pending-migrations/trade-<screen>-read.sql` + undo; test `tests/trade-<screen>-speed.test.ts`.

**Interfaces:** each loader keeps its exact name, parameters and return type. Screens may merge their calls into one server function only if the old functions stay for other callers.

- [ ] **Step 1: Failing tests** (with `tests/helpers/memory-postgrest.ts`): (a) the loader makes at most 2 sequential rounds of reads (count awaits via the fake client's call log grouped by tick); (b) with one real and one qa_test job, a TEST context returns only the qa_test job; (c) if any money or in-house read fails, the loader throws (where it throws today); display-only reads keep their current catch.
- [ ] **Step 2:** Run, expect (a) FAIL.
- [ ] **Step 3:** Restructure: start every read that only needs the sign-in context or job ids in one `Promise.all`; fold `ctxOrThrow`'s reads into that first round where `tradeContext` allows; move the dynamic `import()`s to module scope. If a chain still needs more than 2 rounds, write a read-only database function returning the screen's rows in one call with the same membership checks; prove it on PGlite first.
- [ ] **Step 4:** Unit tests pass. Run `bun scripts/installer-speed-capture.ts --compare --screen <name>`; expect exit 0 for owner and staff.
- [ ] **Step 5:** Independent code review (superpowers:requesting-code-review), focused on Review Focus 1, 3 and 4.
- [ ] **Step 6:** Commit. After Jo publishes: `python scripts/installer-speed.py --label after-<screen> --screens <screen>`; record the result.

### Task 10: Photo previews

**Files:** `src/lib/file-links.server.ts` (signed URLs), the photo lists in the job and day screens.

- [ ] **Step 1:** Check (read-only) whether Supabase storage image transforms work on this project: request one TEST photo's signed URL with `transform: { width: 320 }`. If it doesn't work, stop this task and list it in the report for Jo (it may need a plan upgrade). Don't add another image service.
- [ ] **Step 2: Failing test:** list views ask for `{ width: 320, resize: "contain" }` previews; tapping a photo opens the full-size URL; non-image files are unchanged.
- [ ] **Step 3:** Implement, tests pass, capture `--compare` passes (URLs are normalised as `"<signed-url>"` in parity). Commit.

### Task 11: Final timing and report

- [ ] **Step 1:** After the last publish, run `python scripts/installer-speed.py --label after` (all screens, both roles) and `bun scripts/installer-speed-capture.ts --compare`. Expect exit 0.
- [ ] **Step 2:** Write `qa/installer-speed/<date>-report.md`: before and after side by side; each screen under 1 second ✅ or not ❌ with the slowest remaining call, why, and Jo's options (for example a bigger database plan). Plain words, short.
- [ ] **Step 3:** Commit, open the PR, send Jo the report.
