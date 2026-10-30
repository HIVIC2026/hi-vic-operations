# Activity 48 Batch 2 — Area Batches, Quick Taps and Installer Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Website owners are screened by quick taps in area batches Jo sends with one tap, and the installer gets each passing batch as a back-to-back run they book (portal-booked or by their own team).

**Architecture:** Pure cores for eligibility, clustering and routing; append-only workflow_events for batch/run state; existing guarded senders, owner token pages, `ensurePropertyCoordinates`, `verifiedServiceAreaMatch`, `cancelJobFully`, `bookAgreedTime`/`confirmBooking`; sweeps on the existing 15-minute tick.

**Tech Stack:** TypeScript, TanStack Start, Supabase admin client, Bun test.

**Specs:** part 1 `docs/superpowers/specs/2026-10-29-a48-batch2-eligibility-design.md`; part 2 `docs/superpowers/specs/2026-10-30-a48-batch2-part2-runs-design.md`.

## Global Constraints

- Branch `fix/a48-batch2-eligibility`; never push to `main`; never rewrite pushed commits. Ends with an open PR — no merge, no publish. No live database change without Jo's yes.
- Website owners only (`channel = hivic_sourced`); installer-added jobs never batched.
- Owner and installer wording exactly as in the two specs (Jo approved). No other new owner/trade wording. Nothing lands in Needs me.
- Numbers: batch 8–10 homes within 10 km; smaller batch only when every home waited ≥ 14 days since spot saved; answer window 3 days, reminder day 2, no-answer close day 14; installer reply 24 h; run day ≥ 2 days ahead, default start 08:00, 1-hour arrival windows, max 8 per day; owner confirm 24 h, reminder 12 h; team-booking 5 days.
- Every new text type is a new SMS switch (starts off; Jo switches on at go-live). TEST (`qa_test`) → test-send. Quiet hours as existing.
- Server functions: literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)`; owner fns resolve the job from the token only; installer fns check the run's business. `bun scripts/scan-retired-terms.ts` → 0.

## Review Focus

1. A job already in an open batch is never put in a second batch (Task 2 `one batch at a time`).
2. Owner answers twice / on two devices → one outcome, one message (Task 3 `double answer`).
3. Two runs for the same installer on the same day → windows never overlap (Task 7 `same day twice`).
4. Installer removes every home from a run → run ends, nothing sent to owners (Task 6 `empty run`).
5. Owner whose job was cancelled/closed meanwhile is skipped by every sweep and never texted (Tasks 4, 8).

---

### Task 1: Pure cores — likely eligible, batch suggestions, garage areas

**Files:** Create `src/lib/area-batch.core.ts`. Test `tests/a48-b2-area-batch-core.test.ts`.

**Interfaces — Produces:** `likelyEligible(f: { propertyType: string|null; topFloor: string|null; overFiveYears: string|null; insulation: string|null; insulationThickness: string|null; roofForm: string|null }): boolean`; `type BatchHome = { jobId: string; lat: number; lng: number; postcode: string; spotSavedAt: string }`; `suggestBatches(homes: BatchHome[], nowIso: string): BatchHome[][]` (densest-first greedy, radius 10 km, cap 10, keep clusters ≥ 8, smaller only if every home waited ≥ 14 days); `excludedAreaName(name: string): boolean` (garage, carport, car port, shed — case-insensitive word match).

- [ ] Failing tests: likelyEligible true for house/over5 yes/insulation none/roof pitched; true for top-floor apartment with "thin"; true with roof unknown; false for flat roof, over5 no/blank, insulation present without "thin", apartment not top floor, property type blank. suggestBatches on fixed points: 12 homes within 10 km → one batch of 10 (+2 left); 5 homes, waited 10 days → none; same 5 waited 15 days → one batch; homes 12 km apart never together. excludedAreaName("Garage")/("double carport")/("Shed 1") true; ("Shedding room") false (whole word only); ("Lounge") false.
- [ ] RED → implement → GREEN → commit `feat(batches): likely eligible, batch suggestions, garage areas (pure)`.

### Task 2: Office suggestions + Send

**Files:** Create `src/lib/area-batch.server.ts` (`batchCandidates()`, `sendBatch(jobIds, installerBusinessId, actorId)`), `src/lib/area-batch.functions.ts`; Modify the Choose installer page (`src/components/portal/choose-installer.tsx` and its route) to show suggestions (homes, suburbs, distance span, covering installers via `verifiedServiceAreaMatch` / `covers_all_victoria`) with a Send button; `src/lib/sms.core.ts` new type `quick_taps` (+ `quick_taps_reminder`) switch off by default. Test `tests/a48-b2-send.test.ts`.

**Interfaces — Consumes:** Task 1. **Produces:** event `area_batch_sent {batch_id, installer_business_id, job_ids}` per job; `openBatchFor(jobId): Promise<string|null>`.

- [ ] Failing tests: candidates = waiting website jobs with a saved spot, `likelyEligible`, not in an open batch, not closed; coordinates filled via `ensurePropertyCoordinates` before clustering (stubbed); installers listed only if they cover every home; Send writes one event per job and sends the exact quick-taps text once per job (TEST → test-send); `one batch at a time` (Send including a job already in an open batch → refused, nothing sent); installer-sourced job never a candidate.
- [ ] RED → implement → GREEN (+ `tests/*choose-installer*`, `tests/*spot-release*`) → commit `feat(batches): office suggestions and one-tap Send`.

### Task 3: Owner quick taps on My job

**Files:** Modify `src/lib/owner-myjob.core.ts` (screen `taps`), `src/routes/my-job.$token.tsx` (one question per screen, big buttons, exact wording), Create `src/lib/quick-taps.core.ts` (`tapOutcome(answers): "pass" | "decline_access" | "decline_5yr" | "no_thanks" | "incomplete"`), `src/lib/quick-taps.server.ts` (`saveQuickTaps(token, answers)`), `src/lib/quick-taps.functions.ts`. Test `tests/a48-b2-quick-taps.test.ts`.

**Interfaces — Produces:** event `quick_taps_answered {answers, consent_share, outcome}`; on pass also records the existing `trade_contact_share` owner gate; declines call `cancelJobFully` with reasons "Quick taps: no roof access", "Quick taps: built or ceiling replaced in last 5 years", "Quick taps: owner not going ahead" and send the matching approved email.

- [ ] Failing tests: tapOutcome — hatch No → decline_access; roof Flat → decline_access; 5 yrs Yes → decline_5yr; "No thanks" → no_thanks; all "Not sure" + yes → pass; blank website answers asked (e.g. property type blank → extra question appears; answered → stored on `enrichment.base44.declared`); pass screen shows the exact "lining up" line; decline screens + emails exact wording; `double answer` (second save → same outcome, no second email/cancel); job not in an open batch → screen not shown.
- [ ] RED → implement → GREEN (+ `tests/owner-myjob*`, `tests/my-job*`, `tests/owner-gates*`) → commit `feat(quick-taps): owner screening on My job`.

### Task 4: Batch sweeps and retiring "It's your turn"

**Files:** Modify `src/routes/api/public/hooks/allocation-tick.ts` (call `sweepAreaBatches(nowIso)`), `src/lib/area-batch.server.ts`; `src/lib/spot-release.server.ts` / Choose installer page (website owners no longer released one by one; history kept). Test `tests/a48-b2-batch-sweep.test.ts`.

**Interfaces — Produces:** `sweepAreaBatches(nowIso): Promise<void>`; event `area_batch_closed {batch_id, pass_job_ids, freed_job_ids}`; `run_offered` handoff to Task 6.

- [ ] Failing tests: day 2 → reminder once to non-answerers; day 3 → `area_batch_closed` with passers; non-answerers freed (eligible for the next batch, no new text until re-sent in a new batch); day 14 from first send with no answer → closed quietly (no message); passers handed to Task 6's `offerRun`; closed/cancelled jobs skipped; batch with zero passers → no run; spot-release Release button gone for website owners (still works for history read).
- [ ] RED → implement → GREEN (+ `tests/*spot-release*`, `tests/*allocation-tick*`) → commit `feat(batches): reminders, close after 3 days, hand passers to the installer`.

### Task 5: Garage areas out of eligible m²; previous upgrade "no" at intake

**Files:** Modify where eligible m² is totalled (quote lines builder `src/lib/quotes.server.ts`, VEEC area facts `src/lib/veec*.core.ts` — find with `rg "area_m2|eligible.*m2"`), `src/lib/enquiry.server.ts` (`declared_previous_upgrade` stored as "no"). Test `tests/a48-b2-garage-areas.test.ts`.

- [ ] Failing tests: Ready Check areas [Lounge 60, Garage 30] → quote and VEEC m² = 60, event `excluded_area {name:"Garage", m2:30}` once; no garage → unchanged; new enquiry with previous_upgrade "unknown" → stored "no".
- [ ] RED → implement → GREEN (+ `tests/*quote*`, `tests/*veec*`, `tests/enquiry*`) → commit `feat(eligibility): garage areas excluded; previous upgrade stored as no`.

### Task 6: Run core + installer offer and run page

**Files:** Create `src/lib/run-route.core.ts`, `src/lib/installer-run.server.ts`, `src/lib/installer-run.functions.ts`, installer route page (`src/routes/_authenticated/trade.run.$runId.tsx` or the existing trade route pattern); `sms.core.ts` type `run_offered` (switch off). Test `tests/a48-b2-run-offer.test.ts`.

**Interfaces — Consumes:** Task 4 handoff. **Produces:** `orderRun(homes: {jobId; lat; lng}[]): string[]` (start at home furthest from centroid, nearest-neighbour); `windowsFor(startHHMM: string, count: number): {start: string; end: string}[]` (60 min, max 8, overflow returned separately); `offerRun(batchId)`; events `run_offered`, `run_home_removed`, `run_declined`, `run_expired`.

- [ ] Failing tests: orderRun deterministic order on fixed points; windowsFor("08:00", 10) → 8 windows 08:00–16:00 + 2 overflow; offerRun sends the exact installer text once; run page shows per home address, owner name + phone, m² with source label ("owner's estimate" / "aerial roof outline, approx."), tap answers, roof shape; remove home → back to pool (candidate again), owner not told; `empty run` (all removed) → run ends, nothing to owners; decline / 24 h no reply → batch back in Jo's suggestions (owners not re-asked).
- [ ] RED → implement → GREEN → commit `feat(runs): installer run offer and run page`.

### Task 7: Portal-books flow

**Files:** `src/lib/installer-run.server.ts` (`chooseRunDay(runId, dayIso, startHHMM, secondDayIso?)`), owner confirm screen on My job (reuse `OwnerReadyCheckTimes` patterns), `sms.core.ts` types `run_time` + `run_time_reminder` (switch off); sweep hooks. Test `tests/a48-b2-run-portal-books.test.ts`.

- [ ] Failing tests: day < 2 days ahead refused; windows by route order, exact owner text with window "between 9:00 and 10:00am"; confirm → `bookAgreedTime` → `confirmBooking("ready_check")` called once; "can't make it" → choose another free window that day; none suit / 24 h no confirm → released to pool; 12 h reminder once; > 8 homes needs a second day; `same day twice` (second run same installer same day → windows start after the first run's last window).
- [ ] RED → implement → GREEN (+ `tests/*ready-check-times*`, `tests/*booking*`) → commit `feat(runs): portal books back-to-back windows`.

### Task 8: Team-books, move run, owner cancel

**Files:** `src/lib/installer-run.server.ts` (`chooseTeamBooks(runId)`, `enterTeamTime(runId, jobId, startIso)`, `moveRun(runId, newDayIso, startHHMM)`, owner-cancel hook), run page buttons; `sms.core.ts` type `run_slot_cancelled` (installer) switch off. Test `tests/a48-b2-run-team-move-cancel.test.ts`.

- [ ] Failing tests: team-books → no limits on time; each entered time sends the owner confirm text; 5 days with unbooked homes → those back to Jo's suggestions; moveRun → every confirmed owner gets a new window to confirm (old booking released); owner cancels a confirmed window → installer told once + "Fill from nearby waiting owners" offers the slot to the nearest passed owner within 10 km; not tapped → slot untouched; cancelled/closed jobs never texted.
- [ ] RED → implement → GREEN → commit `feat(runs): own-team booking, move run, cancellations`.

### Task 9: Whole-branch check
- [ ] Full suite per file vs baseline; tsc (only xlsx); retired scan 0; final whole-branch review + one fix wave; push; ask Jo (box) to switch on the new texts live; open the PR (REST). Stop — no merge, no publish.
