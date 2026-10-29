# Plan: HIV leads' Mitti Ready Check form never dropped (HV-3542)

Spec: `docs/superpowers/specs/2026-10-30-hiv-lead-ready-check-form-design.md` (approved by Jo, 30 Oct 2026)
Branch: `hiv-lead-ready-check-form` · Pull request only, not merged here.

Each task is test-first: write the failing test, see it fail, make it pass, then commit.

## Task 1: backup rule (pure), `src/lib/mitti-autoform.core.ts`
1. Tests in `tests/mitti-autoform.test.ts`:
   - Change the existing case `{ channel: "hivic_sourced" }` so it expects skip "HIV lead not booked yet".
   - HIV lead at `ready_check_scheduled` with `bookedAt` set and everything else ok gives create.
   - HIV lead with `bookedAt` set but stage `ready_check_ready_to_schedule` gives skip "HIV lead not booked yet".
   - HIV lead created 60 days ago but booked yesterday gives create. HIV lead booked 31 days ago gives skip "older than 30 days".
   - HIV lead with the form already made (`hasCurrentMeasurement`) gives skip "already has a Ready Check record".
   - Every existing installer case is unchanged.
2. Add an optional `bookedAt: string | null` to `AutoFormFacts`. In `autoFormDecision`:
   - `installer_sourced`: works as now.
   - `hivic_sourced`: needs stage `ready_check_scheduled` and `bookedAt`, otherwise skip "HIV lead not booked yet". The
     30-day window counts from `bookedAt`. The provisional-size grace doesn't apply. Then the same switch, installer and
     back-off checks as installer jobs.
   - Any other channel: skip "not an installer job or HIV lead".
3. Commit.

## Task 2: backup sweep, `src/lib/mitti-autoform.server.ts`
1. Test (PGlite, same style as the existing sweep tests in `tests/mitti-autoform.test.ts`): a dry run finds a
   booked HIV lead with no form. An HIV lead with no confirmed booking is left out. An installer job is still found.
2. Run a second jobs query for `hivic_sourced` at `ready_check_scheduled` (not deleted or archived; no created-date
   filter). Read confirmed `ready_check` bookings for those ids and use the latest `created_at` as `bookedAt`. Merge
   with the installer jobs and keep the 5-per-tick cap.
   - For HIV leads, business = the active installer assignment's business (as today).
   - TEST assignee only for `qa_test` / TEST partner (as today).
3. Commit.

## Task 3: first try keeps going, `src/lib/mitti-create.server.ts`
1. Tests in a new file `tests/ready-check-booked-form.test.ts`, with `mock.module` for `mitti.server` / `workflow.server`:
   - `onReadyCheckBooked` awaits creation, so the claim exists when it returns.
   - With a `requestContext` that has `waitUntil`, the promise is handed to `waitUntil`.
   - Not booked / form already there / Mitti not invited: returns "skipped" and logs one
     `mitti_ready_check_booked_skipped` note with the reason.
   - A Mitti error doesn't throw and is logged as `mitti_access_needed` "could not be created" (picked up by the retry sweep).
2. Rewrite `onReadyCheckBooked` on the `onReadyCheckJobAdded` pattern: facts → reason (reuse `immediateSkipReason`
   plus "the Ready Check isn't booked yet") → `runReadyCheckFormCreation(…, { delaysMs: [] })` inside a promise
   registered with `waitUntil` and awaited. Add `BOOKED_SKIP_EVENT = "mitti_ready_check_booked_skipped"` to
   `mitti-immediate.core.ts`.
3. Callers keep their `.catch(...)`. No changes are needed in them.
4. Commit.

## Task 4: check everything
1. `bun run test`, then typecheck (`bunx tsc --noEmit`). Everything must pass.
2. Dry run of the sweep logic against the test cases above. No live database writes.
3. Push the branch and open the pull request with a short plain summary. Stop, because the coordinating chat merges.
