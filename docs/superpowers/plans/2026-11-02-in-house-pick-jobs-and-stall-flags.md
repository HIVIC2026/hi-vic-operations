# In-house partners: pick any jobs + 5/10/7 stall flags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jo can give an in-house partner any number of ticked jobs, and stalled in-house jobs are flagged on her 5 / 10 / 7-day rules (no more 2-business-day flags for in-house jobs).

**Architecture:** Drop the 5-job minimum in `readyInHouseBatch` and the screens that use it, and turn the handoff list into tick boxes. Retune the existing `ih` stall block in `office-needs.core.ts`, give it two new facts (`piesaBooked`, `depositPaid`) from `inHouseNeedsFacts`, and stop feeding the duplicate `bookingOverdue` row for in-house jobs.

**Tech Stack:** TypeScript, React, TanStack Start, Supabase, bun:test + happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-02-in-house-pick-jobs-and-stall-flags-design.md`

## Global Constraints

- Office lines, exactly: "Ready Check not booked after 5 business days" · "PIESA not booked 10 business days after quote accepted" · "Install not booked · N days left · deposit paid" / "… · deposit not paid" (and "30-day window expired" in place of "N days left" when days remaining is below 0; no deposit part when the deposit is unknown).
- Button label: "Give 1 job to <partner>" / "Give N jobs to <partner>". Greyed-out line: "Tick at least one job to give."
- Server refusal with no eligible jobs: "No eligible jobs for this installer".
- Business days = `addVicBusinessDays` (Victorian public holidays, Melbourne dates). Flag when `melbourneToday(now) >` the returned date.
- Each stall row keeps its existing kind, rank, group and button.
- TEST jobs (`qa_test`, `isTest`) stay excluded, as now.
- Jobs not with an in-house partner keep the 48-hour `bookingOverdue` row unchanged.
- Nothing is merged: open a pull request and stop.

## Review Focus

- Job given on a Friday before Melbourne Cup (Tue 3 Nov 2026): 5 business days lands on Mon 9 Nov and the flag shows from Tue 10 Nov → Task 4 test.
- A cancelled PIESA booking must not count as booked → Task 3 test.
- Deposit read fails or there's no invoice yet → install line shows without a deposit part, never throws → Task 3 and Task 4 tests.
- Untick everything after ticking → button greys out again and sends nothing → Task 2 test.
- A partner with 0 waiting jobs → no tick boxes, button greyed out → Task 2 test.

---

### Task 1: Any number of jobs (core + server + old batches page)

**Files:**
- Modify: `src/lib/in-house-batch.core.ts:19-22` (`readyInHouseBatch`)
- Modify: `src/lib/in-house-batch.server.ts:95` (refusal text)
- Modify: `src/routes/_authenticated/admin.in-house-batches.tsx:57` (`checkedIds.length < 5` → `< 1`, and any "5" in its button label/help text → the Task 2 label rule)
- Test: `tests/in-house-handoff-task1.test.ts`, `tests/in-house-batch-server.test.ts`

**Interfaces:**
- Produces: `readyInHouseBatch(jobIds: string[]): string[]`: the distinct ids, in order, with no minimum and no maximum.

- [ ] **Step 1: Update the tests.** In `in-house-handoff-task1.test.ts`, replace the "five…" / "six…" tests with:
  - `readyInHouseBatch([])` → `[]`
  - `readyInHouseBatch(["1"])` → `["1"]`
  - `readyInHouseBatch(["1","2","3"])` → `["1","2","3"]`
  - `readyInHouseBatch(["1","2","3","4","5","6","7"])` → all 7
  - `readyInHouseBatch(["1","1","2"])` → `["1","2"]`
  - In the line-10 test (suggestions with fewer than 5), expect the ids rather than `[]`.
  In `in-house-batch-server.test.ts`: change any "Waiting for 5 eligible jobs for this installer" expectation to "No eligible jobs for this installer", and add a case where giving 1 eligible job calls `allocate_in_house_batch_job` once and returns `sent: [thatId]`.
- [ ] **Step 2: Run.** `bun test tests/in-house-handoff-task1.test.ts tests/in-house-batch-server.test.ts`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the `readyInHouseBatch` change, the refusal text and the admin page limit.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "In-house: give any number of jobs to a partner"`

### Task 2: Tick-box picker on the In-house installers section

**Files:**
- Modify: `src/components/portal/in-house-handoff.tsx`
- Test: `tests/in-house-handoff-ui-task1.test.tsx`

**Interfaces:**
- Consumes: `readyInHouseBatch` (Task 1), `allocateInHouseBatch({ data: { businessId, jobIds } })` (unchanged).
- Produces: nothing new.

- [ ] **Step 1: Update the tests** (keep the existing mocks; `count` sets how many jobs are waiting for "Rapid"):
  - `"no ticks: button greyed out and says why"`: render; the button named "Give 0 jobs to Rapid" is disabled; the text "Tick at least one job to give." is shown; clicking it leaves `calls` as `[]`.
  - `"ticking 1 job sends exactly that job"`: tick the checkbox labelled "HV-…" for job "3" (give the jobs in the `jobs` mock job numbers and addresses); the button reads "Give 1 job to Rapid"; clicking it gives `calls` = `[{ data: { businessId: "p", jobIds: ["3"] } }]`.
  - `"ticking 3 of 7 sends those 3 in list order"`: `count = 7`; tick "1", "4" and "7"; the button reads "Give 3 jobs to Rapid"; it sends `["1","4","7"]`.
  - `"untick all greys it out again"`: tick then untick one; the button is disabled and nothing is sent.
  - `"partner with 0 waiting"`: `count = 0`; no checkboxes for Rapid; the button is disabled.
  - `"ticks clear after giving"`: after a successful give, no checkbox is checked.
  Remove the old "Give 5 jobs to Rapid" / "four waiting" tests.
- [ ] **Step 2: Run.** `bun test tests/in-house-handoff-ui-task1.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Per partner: list every id in `waiting` as `<label><input type="checkbox"/> {job_number} · {address}</label>`, nothing ticked to start. Keep the ticks in component state keyed by partner id. Button label: `Give ${n} ${n === 1 ? "job" : "jobs"} to ${partner.name}`. The button is disabled when `busy` or `n === 0`, and when `n === 0` it shows "Tick at least one job to give." under it. On click, send `readyInHouseBatch(ticked in waiting order)` through the existing `give()`, then clear that partner's ticks.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "In-house: tick which jobs to give a partner"`

### Task 3: New facts for the stall rules

**Files:**
- Modify: `src/lib/office-needs.server.ts:50-75` (`inHouseNeedsFacts`)
- Modify: `src/lib/office-needs.core.ts:57` (the `inHouse` fact type)
- Test: `tests/in-house-needs-server.test.ts`

**Interfaces:**
- Produces: `NeedsFacts.inHouse` gains `piesaBooked: boolean` and `depositPaid: boolean | null`.

- [ ] **Step 1: Write tests** in `in-house-needs-server.test.ts`:
  - `"assessment booking confirmed → piesaBooked true; cancelled → false"`
  - `"depositPaid comes from installDepositPaidForJobs: true / false / null"` (mock `@/lib/install-deposit-list.server`)
  - `"deposit read throwing → depositPaid null, facts still returned"`
- [ ] **Step 2: Run.** `bun test tests/in-house-needs-server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `"assessment"` to the in-house bookings `.in("kind", …)` read. Set `piesaBooked` from a non-cancelled `assessment` row. Read `installDepositPaidForJobs(held)` alongside the others, with `.catch(() => new Map())`, and set `depositPaid` to `map.get(id) ?? null`. Add both to the type.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "In-house stall facts: PIESA booked and deposit paid"`

### Task 4: Retune the `ih` stall rules and lines

**Files:**
- Modify: `src/lib/office-needs.core.ts:220-225`
- Test: `tests/in-house-needs.core.test.ts`

**Interfaces:**
- Consumes: `piesaBooked`, `depositPaid` (Task 3); `addVicBusinessDays`, `melbourneToday` (existing).

- [ ] **Step 1: Update the tests** (the `job()` fixture gains `piesaBooked: false, depositPaid: null`; batch sent `2026-10-30T06:00:00Z`, a Friday):
  - `"Ready Check: not flagged Mon 9 Nov, flagged Tue 10 Nov (Cup Day skipped)"`: no row at `2026-11-09T12:00:00Z`; `["in_house_ready_check_not_booked"]` at `2026-11-09T13:30:00Z`, line "Ready Check not booked after 5 business days"; booked → no row.
  - `"PIESA: 10 business days after acceptance"`: `quoteAcceptedAt "2026-10-30T06:00:00Z"`; no row at `2026-11-16T12:00:00Z`; `["in_house_piesa_overdue"]` at `2026-11-16T13:30:00Z`, line "PIESA not booked 10 business days after quote accepted"; `piesaBooked: true` → no row; `piesaCompleted: true` but not booked → still flags (the rule is about booking).
  - `"Install line: deposit paid / not paid / unknown"`: `daysRemaining: 5` gives "Install not booked · 5 days left · deposit paid" (`depositPaid: true`), "… · deposit not paid" (`false`), and "Install not booked · 5 days left" (`null`); `daysRemaining: -1` gives "Install not booked · 30-day window expired · deposit paid"; `daysRemaining: 8` → no row; `installationBooked: true` → no row; `daysRemaining: null` → no row.
  - The existing TEST-job exclusion test still passes.
- [ ] **Step 2: Run.** `bun test tests/in-house-needs.core.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in the `ih` block: Ready Check uses `addVicBusinessDays(ih.batchSentAt, 5)`. PIESA uses `!ih.piesaBooked && ih.quoteAcceptedAt && melbourneToday(new Date(now)) > addVicBusinessDays(ih.quoteAcceptedAt, 10)`. The install condition stays the same. Set the three lines exactly as in Global Constraints. Kinds, ranks, groups, `since` and buttons stay as they are.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "In-house stall flags follow Jo's 5/10/7 rule"`

### Task 5: Remove the 2-business-day row for in-house jobs

**Files:**
- Modify: `src/lib/office-needs.server.ts:309-320` (delete the in-house `bookingOverdue` block)
- Modify: `src/lib/office-needs.core.ts:243-247` (the `booking_overdue` row keeps only the non-in-house wording "… time not confirmed after 48 hours"; drop the `held` branch)
- Modify: `src/lib/in-house-booking.core.ts` (delete `bookingOverdue`, which has no other users)
- Test: `tests/booking-overdue-needs.test.ts`, `tests/in-house-task7.core.test.ts`, `tests/sim-in-house-journey.test.ts`

- [ ] **Step 1: Update the tests.** In `booking-overdue-needs.test.ts`, replace the in-house "not booked after 2 business days" expectation with: an in-house job (`inHouseDispatch: "in_house"`) and an unbooked Ready Check gives no `booking_overdue` row. The non-in-house 48-hour test stays. In `in-house-task7.core.test.ts`, remove the `bookingOverdue` import and test. In `sim-in-house-journey.test.ts`, update any expected old line text to the new lines from Task 4.
- [ ] **Step 2: Run.** `bun test tests/booking-overdue-needs.test.ts tests/in-house-task7.core.test.ts tests/sim-in-house-journey.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three deletions. `grep -rn "bookingOverdue(" src` should then show no calls to the deleted function.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "In-house jobs no longer get the 2-business-day booking flag"`

### Task 6: Whole check and pull request

- [ ] **Step 1:** `bun install` (if needed), then `bun run test`. Expected: all pass.
- [ ] **Step 2:** `bunx tsc --noEmit` and `bun run lint`. Expected: no errors.
- [ ] **Step 3:** `grep -rn "Give 5\|Waiting for 5\|after 2 business days\|10 days ago or more" src` shows nothing.
- [ ] **Step 4:** Push the branch `in-house-pick-jobs-stall-flags` and open a pull request (body per the repo's PR template). **Do not merge.**
