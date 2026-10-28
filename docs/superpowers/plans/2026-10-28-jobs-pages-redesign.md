# Jobs pages redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Jobs › Active with two pages, Our jobs and Installer jobs, each a clean sortable, filterable table (cards on phone) with Next step, Days at stage, m², Insulation and Total cost; Closed jobs on its own page.

**Architecture:** New pure module `jobs-columns.core.ts` holds every rule (lane, next step, insulation yes/no, days, cost, column list, filter matching, saved view parsing). `loadActiveJobsList` gains `lane` and `needsUs`, works out status for every row, and adds the new fields. One new screen component draws the table (computer) and cards (phone) using the existing `ColumnHead` pop-up from Enquiries.

**Tech Stack:** TanStack Start/Router, React Query, Supabase, Tailwind, shadcn (`popover`, `sheet`), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-jobs-pages-redesign-design.md`

## Global Constraints

- Plain wording only, exactly as the spec: "Our jobs", "Installer jobs", "Closed jobs", "Needs us", "Mitti sync problems", "Waiting on installer", "Waiting on owner", "Waiting on electrician", "Nothing yet", "On hold", "est.".
- Column order: Job · Next step · Owner · Suburb · Stage · Days at stage · m² · Insulation · Total cost · Installer · Last heard.
- A job is on exactly one of Our jobs / Installer jobs / Closed jobs. Installer jobs = `channel = "installer_sourced"`.
- Insulation: `some` → Yes, `not_sure` → Yes, `no` → No.
- Installer jobs never show the website estimate; only their quote (built from the installer's price card).
- Must work at phone width (cards) and computer width (table). No horizontal page scroll on phone.
- Add nothing the spec doesn't list.

## Review Focus

1. A spot-saved job while Ready Check booking is off must read "Nothing yet", never red and never in Needs us (otherwise ~384 jobs go red). → Task 1 test `nextStep: spot saved with booking off`.
2. A job whose status can't be worked out (`officeStatus` returns null) must still show, reading "Nothing yet", not crash. → Task 1 test `nextStep: null status`.
3. Saved view in the browser that is missing, broken JSON, or from an older shape must fall back to the default view. → Task 1 test `parseSavedView`.
4. Rows with no area, no estimate and no quote must show "—" and drop out of any min–max filter, not show "$0". → Task 1 tests `costCell` / `matchesJobsFilters ranges`.
5. Old bookmarks `/admin/jobs/active?stage=quote` must still land somewhere sensible (Our jobs, Stage filtered to Quote). → Task 4 test.

---

### Task 1: Pure rules — `jobs-columns.core.ts`

**Files:**
- Create: `src/lib/jobs-columns.core.ts`
- Test: `tests/jobs-columns.core.test.ts`

**Interfaces:**
- Consumes: `OfficeStatus` (`src/lib/office-status.core.ts`), `InsulationChip`, `LastHeardChip`, `LAST_HEARD_LABEL` (`office-filters.core.ts`), `ListColumn`, `Range`, `inRange`, `textHit` (`enquiry-columns.core.ts`), `JobsStage`, `JOBS_STAGES` (`office-jobs.core.ts`).
- Produces:
  - `type JobsLane = "ours" | "installer"`; `laneOf(channel: string | null): JobsLane`
  - `type YesNo = "yes" | "no"`; `insulationYesNo(c: InsulationChip): YesNo`
  - `type NextStep = { text: string; ours: boolean; late: boolean }`
  - `nextStep(s: OfficeStatus | null, o: { onHold: boolean; readyCheckBookingOn: boolean }): NextStep`
  - `daysAtStage(enteredStageAt: string | null, createdAt: string, now: number): number`
  - `type CostCell = { dollars: number | null; est: boolean }`
  - `costCell(o: { lane: JobsLane; quoteTotal: number | null; estimateTotal: number | null }): CostCell`; `costLabel(c: CostCell): string`
  - `areaCell(measured: number | null, estimated: number | null): number | null`
  - `JOBS_COLUMNS(o: { nextSteps: string[]; installers: string[] }): ListColumn[]` (keys: `job,next,owner,suburb,stage,days,area,insulation,cost,installer,heard`)
  - `type JobsColumnFilters = { job?: string; owner?: string; suburb?: string; next?: string[]; stage?: JobsStage[]; insulation?: YesNo[]; installer?: string[]; heard?: LastHeardChip[]; days?: Range; area?: Range; cost?: Range }`
  - `type JobsColumnRow = { jobNumber: string; owner: string; suburb: string | null; next: NextStep; stage: JobsStage; insulation: YesNo; installer: string | null; heard: LastHeardChip; days: number; areaM2: number | null; cost: CostCell }`
  - `matchesJobsFilters(r: JobsColumnRow, f: JobsColumnFilters, needsUs: boolean): boolean`
  - `type SavedView = { filters: JobsColumnFilters; sort: string; dir: "asc" | "desc"; needsUs: boolean }`; `DEFAULT_VIEW: SavedView`; `parseSavedView(raw: string | null): SavedView`; `savedViewKey(lane: JobsLane): string` → `"hiv:jobs:" + lane`

- [ ] **Step 1: Write the failing tests** in `tests/jobs-columns.core.test.ts` (`import { expect, test } from "bun:test"`):
  - `laneOf`: `"installer_sourced"` → `"installer"`; `null`, `"website"` → `"ours"`.
  - `insulationYesNo`: `some` → `yes`, `not_sure` → `yes`, `no` → `no`.
  - `nextStep: ours with action`: status `{ waitingOn: "Us", action: "Send the quote", late: true, key: "quote.held", … }` → `{ text: "Send the quote", ours: true, late: true }`.
  - `nextStep: waiting on others`: `waitingOn: "Installer"` → `"Waiting on installer"`, `ours: false`; `"Owner + Electrician"` → `"Waiting on owner and electrician"`; `"System"` and `"Nobody"` → `"Nothing yet"`. `late` carried from status.
  - `nextStep: spot saved with booking off`: key `enquiry.spot_saved` (and `enquiry.spot_saved_video`), `waitingOn: "Us"`, `late: true`, `readyCheckBookingOn: false` → `{ text: "Nothing yet", ours: false, late: false }`. With `readyCheckBookingOn: true` → its action, `ours: true`.
  - `nextStep: on hold` → `{ text: "On hold", ours: false, late: <status.late> }`.
  - `nextStep: null status` → `{ text: "Nothing yet", ours: false, late: false }`.
  - `daysAtStage`: entered 3 days 5 hours before now → `3`; `enteredStageAt` null → counts from `createdAt`; future date → `0`.
  - `costCell`: ours with quote 4200 and estimate 3900 → `{ dollars: 4200, est: false }`; ours with only estimate 3900 → `{ dollars: 3900, est: true }`; installer with only estimate → `{ dollars: null, est: false }`; nothing → `{ dollars: null, est: false }`. `costLabel` → `"$4,200"`, `"$3,900 est."`, `"—"`.
  - `areaCell(120, 95)` → `120`; `(null, 95)` → `95`; `(null, null)` → `null`; `(0, 95)` → `95`.
  - `JOBS_COLUMNS`: keys in the spec order; `stage` options are the six `JOBS_STAGES` keys; `next` and `installer` options are the passed lists; `insulation` labels `{ yes: "Yes", no: "No" }`.
  - `matchesJobsFilters ranges`: a row with `areaM2: null` fails `area: { min: 50 }`; passes when `area` unset. Cost range reads `cost.dollars`.
  - `matchesJobsFilters needsUs`: `needsUs: true` keeps only `next.ours === true`.
  - `matchesJobsFilters picks`: ticks within a column are OR, across columns AND (stage `["quote"]` + insulation `["yes"]`).
  - `parseSavedView`: `null`, `"not json"`, `"{\"sort\":5}"` → `DEFAULT_VIEW`; a valid JSON round-trips; unknown keys dropped.

- [ ] **Step 2: Run** `bun test tests/jobs-columns.core.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/jobs-columns.core.ts`** with the signatures above. Pure, no I/O. `daysAtStage` = `Math.max(0, Math.floor((now - Date.parse(start)) / 86_400_000))`. `nextStep` "ours" = `waitingOn === "Us"` (or starts with "Us"); spot-saved keys are `enquiry.spot_saved` and `enquiry.spot_saved_video`. `costLabel` uses `toLocaleString("en-AU")`. `parseSavedView` validates each field's type and falls back per field to `DEFAULT_VIEW` (`{ filters: {}, sort: "", dir: "desc", needsUs: false }`).

- [ ] **Step 4: Run** `bun test tests/jobs-columns.core.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `git add src/lib/jobs-columns.core.ts tests/jobs-columns.core.test.ts && git commit -m "Jobs pages: pure column rules"`

---

### Task 2: Server list — lanes, new fields, Needs us, counts

**Files:**
- Modify: `src/lib/office-lists.server.ts` (`JobsListParams`, `JobsListRow`, `loadActiveJobsList`, reuse `estimateMap`)
- Modify: `src/lib/office-screens.functions.ts` (`getActiveJobsList` input; new `getJobsLaneCounts`)
- Modify: `src/lib/office-needs-snapshot.core.ts` (`LIST_SNAPSHOT_KEYS`)
- Modify: `src/lib/office-needs-snapshot.server.ts` (`getActiveJobsListServed`, `refreshListSnapshots`)
- Test: `tests/jobs-list-lanes.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces; `readAutoOfferSwitches()` from `auto-offer.server.ts` (`.readyCheckBooking`); `loadOffice(..., { statusOnly: true, onlyIds })` (`o.jobs[i].status`, `o.jobs[i].facts.enteredStageAt`).
- Produces:
  - `JobsListParams = { lane: JobsLane; search: string; sort: string; dir: SortDir; page: number; filters: JobsColumnFilters; needsUs: boolean; includeTest?: boolean }`
  - `JobsListRow = JobsColumnRow & { id: string; ownJob: boolean; onHold: boolean; lifeSupport: boolean; isTest: boolean; lastHeardAt: string | null; lastHeardChannel: string | null }`
  - `loadActiveJobsList(p, testJobIds?)` returns `{ rows: JobsListRow[]; page; totalPages; total; all: number; nextSteps: string[]; installers: string[] }` (`all` = rows in this lane before filters)
  - `getActiveJobsList` input adds `lane` (`z.enum(["ours","installer"])`, default `"ours"`), `needsUs` (`z.boolean().default(false)`), `filters` = zod schema for `JobsColumnFilters`
  - `getJobsLaneCounts()` → `{ ours: number; installer: number }` (non-test active jobs, from `office_job_list` with `office_bucket = "active"`, split by `channel`)
  - `LIST_SNAPSHOT_KEYS.jobsOurs = "jobs_ours:first"`, `LIST_SNAPSHOT_KEYS.jobsInstaller = "jobs_installer:first"` (the old `jobs` key removed)

- [ ] **Step 1: Write the failing tests** in `tests/jobs-list-lanes.test.ts`. Follow the existing source-check style (`readFileSync`, as in `tests/office-jobs-piles.test.ts`) plus the pure pieces:
  - `isDefaultListView({ lane: "ours", search: "", sort: "", page: 1, filters: {}, needsUs: false })` → `true`; with `needsUs: true` → `false` (add `needsUs` to `ListView` and the rule).
  - `LIST_SNAPSHOT_KEYS` has `jobsOurs` and `jobsInstaller`, and no `jobs`.
  - Source of `office-lists.server.ts`: `loadActiveJobsList` reads `channel` and calls `laneOf`, `nextStep`, `daysAtStage`, `costCell`, `areaCell`, `insulationYesNo`, `matchesJobsFilters`; no remaining reference to `matchesChips` in that function.
  - Source of `office-screens.functions.ts` exports `getJobsLaneCounts`.

- [ ] **Step 2: Run** `bun test tests/jobs-list-lanes.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** in `office-lists.server.ts`:
  - Filter `base` rows to `laneOf(channel) === p.lane` before anything else.
  - Always work out status for every row in the lane (one `loadOffice(..., { statusOnly: true, onlyIds })` call); keep `status` object and `facts.enteredStageAt` per id. Read `readyCheckBooking` once.
  - Measured area: one `byIds` read of `ceiling_measurements` (`job_id, measured_area_m2, verified_area_m2`, `is_current = true`), prefer `verified_area_m2` then `measured_area_m2`; estimated area from `jobs.estimated_area_m2` (add to the "job facts" select).
  - Totals: reuse `estimateMap`'s two reads but return `{ quoteTotal, estimateTotal }` separately (split the helper: `estimateTotals(ids)` → `(id) => { quoteTotal, estimateTotal }`; `estimateMap` keeps its current output by calling it).
  - Build `JobsListRow` with Task 1 helpers. Search matches job number, owner, suburb, installer, next step text.
  - Sort keys: `job, next, owner, suburb, stage (stage order), days, area, insulation, cost (cost.dollars), installer, heard`. Default (empty sort): Last heard, newest first — same as today.
  - Return `nextSteps` (distinct `next.text`, sorted) and `installers`.
  - Drop `stageCounts`, `ownCount`, `region`, `source` fields (nothing reads them after Task 3).
  In `office-screens.functions.ts`, update the `getActiveJobsList` schema and add `getJobsLaneCounts` (office identity required, same middleware). In the snapshot files, serve/refresh one copy per lane.

- [ ] **Step 4: Run** `bun test tests/jobs-list-lanes.test.ts tests/jobs-columns.core.test.ts` and `bunx tsc --noEmit` — Expected: PASS, no type errors outside `JobsScreen.tsx` (fixed in Task 3).

- [ ] **Step 5: Commit** `git commit -am "Jobs pages: lane-aware list with next step, days, area, cost"` (add the new test file).

---

### Task 3: The screen — table, cards, filters, Needs us, saved view

**Files:**
- Create: `src/components/portal/JobsLaneScreen.tsx`
- Modify: `src/components/portal/JobsScreen.tsx` (delete `ActiveJobs`, `Piles`, `Tabs`; keep `ClosedJobs`; add `JobsSwitcher`)
- Test: `tests/jobs-lane-screen.test.ts`

**Interfaces:**
- Consumes: `getActiveJobsList`, `getJobsLaneCounts` (Task 2); `JOBS_COLUMNS`, `costLabel`, `parseSavedView`, `savedViewKey`, `DEFAULT_VIEW` (Task 1); `ColumnHead`, `ActionsMenu`, `ReasonDialog`, `Pager`, `heardLabel` (`office-lists.tsx`); `getMittiSyncProblems` + `MittiSyncProblems` (`mitti-piles.tsx`); `Sheet` (`@/components/ui/sheet`).
- Produces: `JobsLaneScreen({ lane, initialStage }: { lane: JobsLane; initialStage?: JobsStage })`; `JobsSwitcher({ current }: { current: "ours" | "installer" | "closed" })`; `JobsScreen` now `({ mode }: { mode: "closed" })` for Closed only.

- [ ] **Step 1: Write the failing test** `tests/jobs-lane-screen.test.ts` (source checks with `readFileSync`, as other screen tests do):
  - `JobsLaneScreen.tsx` renders, in order, the headings from `JOBS_COLUMNS` via `ColumnHead`; contains the strings `"Needs us"`, `"Mitti sync problems"`, `"Filter"`; has a `md:hidden` card list and a `hidden md:grid` table header.
  - Mitti line is only rendered when the count is `> 0` (source contains a `> 0` guard around it) and uses a red/danger class.
  - Reads and writes the saved view only inside `try { … } catch`, via `savedViewKey(lane)` and `parseSavedView`.
  - Actions offers exactly: Cancel · Put on hold · Mark as test · Delete (test jobs only).
  - `JobsScreen.tsx` no longer contains `"New from installers"`, `"Ready Checks started in Mitti"`, `"Installers’ own jobs"`, `"Choose installer list"`, `FilterPanel`, `ChipGroup`.
  - `JobsSwitcher` shows `"Our jobs"`, `"Installer jobs"`, `"Closed jobs"` with counts from `getJobsLaneCounts` for the first two.

- [ ] **Step 2: Run** `bun test tests/jobs-lane-screen.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `JobsLaneScreen`**:
  - Title ("Our jobs" / "Installer jobs"), `JobsSwitcher`, then one row: search box · "Needs us" switch · Actions. Under it, the red "Mitti sync problems · N ›" line when N > 0, expanding to `MittiSyncProblems` as today.
  - Computer (`hidden md:grid`): header of `ColumnHead`s (`JOBS_COLUMNS({ nextSteps, installers })` from the response), tick-box column first; rows click through to `/admin/jobs/$jobId`. Next step text red (`text-danger`) when `late`. Days shows `"N d"`. m² shows `"120 m²"` or `"—"`. Total cost via `costLabel`.
  - Phone (`md:hidden`): one card per job — Next step on top (red when late), then Job · Owner · Suburb, Stage · Days, m² · Insulation · Total cost, Installer · Last heard; tick box on the card. A "Filter" button opens a bottom `Sheet` listing the same `ColumnHead`s (sort + filter) and "Clear filters".
  - "Clear filters" link when any filter is on.
  - Saved view: on mount `parseSavedView(localStorage.getItem(savedViewKey(lane)))` inside try/catch; write on every change inside try/catch. `initialStage`, when given, overrides the saved stage filter once.
  - Query key `["office-jobs", lane, view, search, page]`; keep `placeholderData: keepPreviousData` and the 5-second refetch while `refreshing`, as now.
  - Reuse the four `ReasonDialog`s from the old `ActiveJobs` unchanged.

- [ ] **Step 4: Run** `bun test tests/jobs-lane-screen.test.ts` and `bunx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -am "Jobs pages: Our jobs / Installer jobs screen with cards on phone"` (add new files).

---

### Task 4: Routes, menu and old links

**Files:**
- Create: `src/routes/_authenticated/admin.jobs.ours.tsx`, `src/routes/_authenticated/admin.jobs.installers.tsx`
- Modify: `src/routes/_authenticated/admin.jobs.active.tsx` (redirect), `src/routes/_authenticated/admin.jobs.closed.tsx` (title "Closed jobs", switcher), `src/routes/_authenticated/admin.jobs.tsx` (redirect target), `src/config/office-nav.ts` (Jobs → `/admin/jobs/ours`), `src/lib/legacy-links.core.ts`, `src/lib/qa-office-policy.core.ts`, `src/components/portal/office-job.tsx:68`, `src/components/portal/InstallerWaitingScreen.tsx:139`
- Regenerate: `src/routeTree.gen.ts` (via the project's route generator / dev build)
- Test: `tests/jobs-routes.test.ts`

**Interfaces:**
- Consumes: `JobsLaneScreen`, `JobsScreen` (Task 3), `JOBS_STAGE_KEYS`.
- Produces: routes `/admin/jobs/ours` (accepts `?stage=`), `/admin/jobs/installers`, `/admin/jobs/closed`.

- [ ] **Step 1: Write the failing tests** `tests/jobs-routes.test.ts`:
  - `OFFICE_HEADINGS` Jobs entry `to === "/admin/jobs/ours"`; `sectionFor("/admin/jobs/installers")` and `sectionFor("/admin/jobs/ours")` → `"jobs"`.
  - Source of `admin.jobs.active.tsx` redirects to `/admin/jobs/ours` and passes `stage` through (Review Focus 5).
  - `legacy-links.core` targets for `board`, `list`, `pipeline`, `quotes`, `operations-preview` now point at `/admin/jobs/ours` (quotes keeps `stage: "quote"`).
  - `qa-office-policy` allows `/admin/jobs/ours` and `/admin/jobs/installers`.
  - No file under `src/` (except `routeTree.gen.ts` and the redirect route) still links to `/admin/jobs/active`.

- [ ] **Step 2: Run** `bun test tests/jobs-routes.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** the two new route files (copy the head/meta pattern of `admin.jobs.active.tsx`; titles "Our jobs — Home Insulation Victoria Office" and "Installer jobs — …"), turn `admin.jobs.active.tsx` into a `beforeLoad` redirect keeping `stage`, update the links listed above, regenerate the route tree.

- [ ] **Step 4: Run** the full suite `bun run test` and `bunx tsc --noEmit` and `bun run lint` — Expected: all pass. Fix any old test that asserted the removed piles/chips (e.g. `tests/office-jobs-piles.test.ts`, `docs/testrigor/office.txt` references are docs — update only tests that fail, and only the removed-feature assertions).

- [ ] **Step 5: Commit** `git commit -am "Jobs pages: routes, menu and old links"` (add new files).

---

### Task 5: Check it in the running portal

**Files:** none changed unless a check fails.

- [ ] **Step 1:** Open the preview as an office user at computer width. Check on Our jobs: only search, Needs us, Actions above the table; 11 columns in spec order; each heading sorts and filters; switcher counts match the "N of N" total; no installer-sourced job appears; spot-saved jobs read "Nothing yet" and are not red.
- [ ] **Step 2:** Installer jobs: only installer-sourced jobs; Total cost never shows "est.".
- [ ] **Step 3:** Set a filter, leave, come back — still set. Needs us on → only jobs with our action.
- [ ] **Step 4:** Phone width (390 px): cards, no sideways scroll, Filter opens the sheet, tick boxes + Actions work.
- [ ] **Step 5:** `/admin/jobs/active?stage=quote` lands on Our jobs filtered to Quote. Closed jobs page works as before.
- [ ] **Step 6:** Record results (screenshots) and fix anything that fails with its own test first.
