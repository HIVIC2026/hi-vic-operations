# Finished Mitti Ready Check marks the installer job as visited — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On installer-added jobs, a finished Mitti Ready Check sets "attended" to Yes (with the Mitti finish date) and a typed installer price sets "prepared a quote" to Yes; correct the 5 existing jobs.

**Architecture:** A pure helper decides the attended write; `finishMittiReadyCheck` applies it once per job before its auto-prep switch. `setInstallerPrice` logs the existing `installer_quote_answer` event and sets `installer_quoted`. The 5 old jobs get a staged SQL file proven on PGlite, run live only after Jo says go.

**Tech Stack:** TypeScript, Bun test, PGlite, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-11-01-mitti-ready-check-attended-design.md`

## Global Constraints

- Installer-added jobs only (`jobs.channel = 'installer_sourced'`); HIV leads unchanged.
- Never derived from price, area or files — attended comes only from a completed Mitti Ready Check.
- No change to quote holds, electrician rules, prices, emails or texts.
- Read `src/AGENTS.md` and `src/lib/AGENTS.md` before edits; run `bun scripts/scan-retired-terms.ts` first.
- Live DB SQL lives in `docs/pending-migrations/`, proven on PGlite; ask Jo again just before running it live.
- Pull request only — never merge.

## Review Focus

- Installer later changes the answer to "No" by hand, then Mitti re-syncs → their answer must not be overwritten (write only once per audit, recorded by event).
- `modifiedAt` null or not a date → attended still Yes, date left null (never today).
- Auto-prep switch off (`READY_CHECK_AUTO_PREP_ENABLED` false) → attended still recorded.
- Job already `installer_site_check = 'yes'` → no write, no event.
- Price typed when the answer is already "have_quote" → no duplicate event.

---

### Task 1: Finished Mitti Ready Check → Attended Yes

**Files:**
- Create: `src/lib/mitti-attended.core.ts`, `tests/mitti-attended.test.ts`
- Modify: `src/lib/mitti-complete.server.ts` (`finishMittiReadyCheck`, before the `enabled` check)
- Modify: `tests/installer-own-job-e2e-db.test.ts` (section 3)

**Interfaces:**
- Produces: `mittiAttendedPatch(f: { channel: string | null; siteCheck: string | null; completed: boolean; modifiedAt: string | null; alreadyRecorded: boolean }): { installer_site_check: "yes"; installer_site_check_date: string | null } | null`
- Produces: event `installer_attended_from_mitti` (internal), details `{ audit_id, completed_at }`.

- [ ] **Step 1: Failing unit tests** in `tests/mitti-attended.test.ts`:
  - installer_sourced, siteCheck "no", completed, modifiedAt `2026-10-27T21:17:53.631Z` → `{ installer_site_check: "yes", installer_site_check_date: "2026-10-28" }` (Melbourne date)
  - channel `hivic_sourced` → `null`; completed false → `null`; siteCheck "yes" → `null`; alreadyRecorded true → `null`
  - modifiedAt null or `"bad"` → `{ installer_site_check: "yes", installer_site_check_date: null }`
- [ ] **Step 2:** `bun test tests/mitti-attended.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `mittiAttendedPatch` using `melbourneToday(new Date(modifiedAt))` from `melbourne-time.core.ts`.
- [ ] **Step 4:** `bun test tests/mitti-attended.test.ts` → PASS.
- [ ] **Step 5: Failing DB tests** in section 3 of `tests/installer-own-job-e2e-db.test.ts`:
  - after `syncMittiAssessment` completes: `installer_site_check = "yes"`, `installer_site_check_date` not null, ONE `installer_attended_from_mitti` event
  - set `installer_site_check='no'` by hand, sync again → stays `"no"`, still ONE event
  - with `enabled: false` passed to `finishMittiReadyCheck` on a fresh installer job → still `"yes"`
- [ ] **Step 6:** In `finishMittiReadyCheck`, insert before the `if (!enabled)` line: when `i.completed`, read `jobs.channel, installer_site_check` and whether an `installer_attended_from_mitti` event exists for the job; if `mittiAttendedPatch` returns a patch, update `jobs` (guard `.neq("installer_site_check","yes")`) then `logEvent(jobId, null, "installer_attended_from_mitti", "Attended: Yes — from the finished Mitti Ready Check", { audit_id, completed_at }, { internal: true })`. A failure logs and never blocks the rest.
- [ ] **Step 7:** `bun test tests/installer-own-job-e2e-db.test.ts tests/mitti-attended.test.ts tests/mitti-sync-overlap.test.ts tests/journey-a1-complete-route-db.test.ts` → PASS.
- [ ] **Step 8:** Commit `fix: finished Mitti Ready Check marks installer job as attended`.

### Task 2: Typed price → Quote Yes

**Files:**
- Modify: `src/lib/installer-price-set.server.ts` (`setInstallerPrice`, after the price event)
- Test: `tests/installer-own-job-e2e-db.test.ts` (the "Jo 27 Oct completed Ready Check edit recovery" section)

**Interfaces:**
- Consumes: `intakeQuoteAnswers(jobIds)` from `installer-intake.server.ts`.
- Produces: event `installer_quote_answer` `{ answer: "have_quote", previous, source: "installer_price" }`.

- [ ] **Step 1: Failing DB tests:** after `setInstallerPrice` on a job answered "not_quoted": `installer_quoted = "yes"`, `intakeQuoteAnswers` gives `"have_quote"`, ONE new `installer_quote_answer` event with `source: "installer_price"`; a second `setInstallerPrice` adds no further answer event.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `setInstallerPrice`, if the current answer isn't `"have_quote"`, update `jobs.installer_quoted = "yes"` and log the event (summary "Installer answered: quote prepared").
- [ ] **Step 4:** `bun test tests/installer-own-job-e2e-db.test.ts tests/installer-price.test.ts tests/boss-price-link.test.ts tests/auto-quote-send.test.ts` → PASS.
- [ ] **Step 5:** Commit `fix: typed installer price marks quote prepared`.

### Task 3: Correct the 5 existing jobs (staged SQL)

**Files:**
- Create: `docs/pending-migrations/mitti-ready-check-attended-backfill.sql`, `tests/mitti-attended-backfill-db.test.ts`

- [ ] **Step 1: Failing PGlite test:** seed an installer job with a `measurement_completed` event (`details.basis='mitti_complete'`) and `installer_site_check='no'`, an HIV-lead job with the same, an installer job with a price event and `installer_quoted='no'`. After running the SQL: installer job → `yes` + date = Melbourne date of the event, one `installer_attended_from_mitti` event; HIV lead untouched; priced job → `installer_quoted='yes'` + one `installer_quote_answer` (`source: "backfill"`); running the SQL twice changes nothing more.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Write the SQL in one transaction, scoped to `channel='installer_sourced'`, `deleted_at is null`, `installer_site_check is distinct from 'yes'`, with a completed-Mitti event; header comment names HV-3117, HV-3197, HV-3385, HV-3497, HV-3666 and "run only after Jo says go".
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `chore: staged backfill for installer jobs with finished Mitti Ready Checks`.

### Task 4: Check and open the pull request

- [ ] **Step 1:** `bun run test` and `bunx tsc --noEmit` → all pass.
- [ ] **Step 2:** Add one line to `src/lib/AGENTS.md` (rule + why).
- [ ] **Step 3:** Push branch `fix/mitti-ready-check-attended`, open the PR (body via supermatt:pr shape). Do NOT merge.
- [ ] **Step 4:** Ask Jo before running the backfill live; after it runs, check HV-3497 shows Attended Yes and Quote Yes.
