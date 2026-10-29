# Daily Full Journey Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## For Jo — the plan in plain words

1. One command runs every test path in one go and saves each result (Tasks 1–2).
2. Fix the main test so it follows your current rules (Task 3).
3. Add the 10 missing processes, one task each (Tasks 4–14).
4. Add the "keep tests current" rule, then Lovable runs the whole thing once on TEST jobs to prove it (Task 15).
5. Set up the 4:30am task and the "Test run" part of your 6am report (Task 16).

Code is written and checked here, saved as a pull request, and merged only by your coordinating chat. Nothing changes for real customers. Some new tests will fail at first because the portal doesn't do that rule yet (for example the 15% quote hold) — your report will say "not built yet", not "broken".

---

**Goal:** One command runs the main journey plus every path on fresh TEST jobs, stores one result row per path, and a 4:30am scheduled task runs it daily for Jo's 6am report.

**Architecture:** Add a `--all` mode to `scripts/journey.ts` that runs the main journey, every PHASE3/PHASE4 path and a new PHASE5 map of paths (new file `src/lib/journey-paths.server.ts`), storing each in `journey_runs` with a new `path` column. Each new path drives existing server functions as the TEST persona, like the existing branches. Lovable's sandbox runs it (it holds the secrets); two Claude scheduled tasks start it and report it.

**Tech Stack:** Bun, TypeScript, TanStack Start server functions, Supabase/Postgres, PGlite tests (`bun:test`), Playwright (`e2e/journey/shoot.py`).

**Spec:** `docs/superpowers/specs/2026-10-29-daily-full-journey-test-design.md`

## Global Constraints

- TEST only: every path uses a fresh `jobs.source = 'qa_test'` job and TEST-PARTNER businesses / `@hivic-test.example` people; never touches real jobs, live switches or settings.
- No new test mode; use the existing guards (Stripe test key, Xero Demo Company, Mitti simulator + `armMittiGuard`, test sender, allowlist check s10).
- No change to how the portal behaves for real customers. If a rule isn't built, the path reports `blocked` with reason `NOT BUILT: <rule>` — never patch portal behaviour in this plan.
- Time rules move time by backdating this job's own rows and calling sweeps with an explicit `now` (existing pattern in p6); never real waiting.
- Screens at 390px and 1280px for each affected person.
- Wording checks: "Your estimated quote based on what you've told us" present; "You pay about" absent; no HIV phone number; no link to estimate.homeinsulationvictoria.com.au in owner emails.
- Merge only through the coordinating chat; this chat opens the PR and stops.

## Review Focus

1. A path crashes before cleanup → its TEST job must still be archived (cleanup in `finally`) and the run continues with the next path.
2. A rule not built yet must show as `blocked` + `NOT BUILT`, not `failed`, so Jo isn't sent chasing a "bug".
3. Two runs on the same morning (manual + scheduled) → the 6am report reads only today's latest run per path.
4. Quiet-hours path run at 4:30am real time → must use explicit `now`, not the real clock, so it doesn't pass/fail by accident.
5. Anything delivered outside the allowlist on any path → whole run marked failed, even if every other check passed.

Tests for each are added in Tasks 1, 2 and 7.

---

### Task 1: Store one result per path

**Files:**
- Create: `drizzle/migrations/0178_journey_runs_path.sql`, `docs/pending-migrations/0178_journey_runs_path.sql`
- Modify: `drizzle/schema.ts` (journey_runs), `src/lib/journey.server.ts:783-787` (`storeJourneyRun`)
- Test: `tests/journey-runs-db.test.ts`

**Interfaces:**
- Produces: `journey_runs.path text null`, `journey_runs.run_group uuid null`, `journey_runs.status text null check (status in ('passed','failed','blocked'))`; `storeJourneyRun(mode, ctx, result, opts?: { path?: string; runGroup?: string; status?: "passed"|"failed"|"blocked" })`.

- [ ] **Step 1:** Add tests: `stores path, run_group and status`; `status rejects 'unknown'`; existing rows with null path still read.
- [ ] **Step 2:** Run `bun ./scripts/test-isolated.ts 1 tests/journey-runs-db.test.ts` — expect FAIL (column missing).
- [ ] **Step 3:** Write the migration (add the 3 columns, check constraint, index on `(run_group, path)`), mirror into schema.ts, extend `storeJourneyRun`.
- [ ] **Step 4:** Rerun — expect PASS.
- [ ] **Step 5:** Commit `feat(journey): store path, group and status per run`.

### Task 2: `bun run journey --all`

**Files:**
- Create: `src/lib/journey-all.server.ts`
- Modify: `scripts/journey.ts` (add `--all` before the `--branch` handling)
- Test: `tests/journey-all.test.ts`

**Interfaces:**
- Consumes: `runServerJourney`, `runPhase3`, `runPhase4`, `runPhase5` (Task 4), `storeJourneyRun` (Task 1).
- Produces: `runAllPaths(opts: { shotDir: string; only?: string[] }): Promise<AllRunResult>`; `type AllRunResult = { runGroup: string; paths: { path: string; status: "passed"|"failed"|"blocked"; reason: string | null; person: string | null; step: string | null }[]; allowlistOk: boolean }`; `toStatus(res: Phase3Result): "passed"|"failed"|"blocked"`.

- [ ] **Step 1:** Tests (mock the run functions): `runs main then every PHASE3, PHASE4, PHASE5 name once`; `one path throwing is stored failed and the next path still runs`; `blocked reason starting NOT BUILT stays blocked`; `any allowlist failure sets allowlistOk false and exit code 1`; `--only limits to named paths`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement: one `runGroup` uuid; each path in try/finally; store each row with `path` (`main` or the branch name); write `/mnt/documents/journey/<stamp>-all/report.md` (one line per path: status, person, step, plain reason). `scripts/journey.ts --all` exits 0 only if every path is `passed` or `blocked` with `NOT BUILT` and `allowlistOk`.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(journey): run every path in one command`.

### Task 3: Main journey follows the 29 Oct rules

**Files:**
- Modify: `src/lib/journey.server.ts` (s5 :366-372, s7 :454-482), `src/lib/journey-test.core.ts` (step labels)
- Test: `tests/journey-live-runner-db.test.ts`

- [ ] **Step 1:** Update tests: s5 accepts with tick + Accept only (no `signatoryName`, no `over18`) and signs no gate/rebate form; Owner accepted email to installer only after `$349` paid; s7 order is fixes paid → `install_deposit` → `installerOfferDays` → `ownerTakeDay` → install consent signed; rebate (VEEC) form after install; separate Xero invoice per fixes with reference `Home Insulation Victoria HV-<n> fixes`; 30-day clock from PIESA date; owner screens contain "Your estimated quote based on what you've told us" and not "You pay about".
- [ ] **Step 2:** Run — FAIL where rules changed.
- [ ] **Step 3:** Update s5/s7 calls to the current server functions. ESC notification still `configuration_required` → step marked `blocked` with reason `SETUP: ESC consent template not approved` (Jo-side setup, not a code bug).
- [ ] **Step 4:** Run — PASS (or the named blocked reason).
- [ ] **Step 5:** Commit `fix(journey): main path follows current owner and payment rules`.

### Task 4: PHASE5 map and helpers

**Files:**
- Create: `src/lib/journey-paths.server.ts`
- Modify: `src/lib/journey-branches.server.ts` (export `Recorder`, `answer`, `shoot`, `freshCtx`, `toQuoteAccepted`, `finish`, `ago`)
- Test: `tests/journey-paths.test.ts`

**Interfaces:**
- Produces: `type Phase5Name = "n1-installer-own-job" | "n2-crew-lead" | "n3-electrician-offers" | "n4-quote-expiry" | "n5-emails-tab" | "n6-opt-out" | "n7-trade-signup" | "n8-timing" | "n9-money-edges" | "n10-owner-messages"`; `PHASE5: Record<Phase5Name, PathFn>` (same signature as PHASE4); `runPhase5(name, shotDir): Promise<Phase3Result>`; `notBuilt(rule: string): never` (sets blocked `NOT BUILT: <rule>`).

- [ ] **Step 1:** Tests: every Phase5Name present; `notBuilt` gives blocked status; `runPhase5` archives the job when the path throws.
- [ ] **Step 2–5:** FAIL → implement map (paths empty stubs calling `notBuilt("pending task")`) → PASS → commit `feat(journey): add path map for new processes`.

### Tasks 5–14: one path each

Each task: add the path in `journey-paths.server.ts`, a PGlite test `tests/journey-path-<n>.test.ts` asserting the checks below, run FAIL → implement → PASS, screens for the listed people, commit `feat(journey): <path>`. Use the server functions named; anything marked NOT BUILT calls `notBuilt`.

| Task | Path | People | Checks (each one assertion) | Server functions |
|---|---|---|---|---|
| 5 | n1-installer-own-job | installer boss, owner, office | name/mobile/email/address required; door-knocked refused; other installer's open address refused; installer picks Ready Check time; installer types price; electrician = own onboarded (agreed rate) or HIV $349; not-onboarded can't be picked; shows in "Added by installers"; installer pay waits for owner paid in full; one-way "use HIV's electrician ($349)" switch | `submitInstallerJob`, `addJobOptions` |
| 6 | n2-crew-lead | boss, Lead, Crew | one picker on Job page; Lead from Team list only; Crew can't be install Lead; Crew can do Ready Check; Today's job shows "Who's on the crew today?" | `saveCrewSelection`, `crewStaff`, `getPiisaCrew` |
| 7 | n3-electrician-offers | 3 TEST electricians, office | offer to one at a time, nearest first; 24h each (backdate `offered_at`); back to office after 2 misses; installer's chosen electrician first on own jobs. Batch >1 → `NOT BUILT: one-at-a-time offers` | `startPiesaAllocation`, `nextOfferBatch`, `chooseTrade` |
| 8 | n4-quote-expiry | owner, installer, office | quote 14 days old → job closed `QUOTE_EXPIRED_CANCEL_REASON`; installer cancel email; one "Your quote has expired" email with "Send me a new quote"; re-price by HIV (HIV lead) / installer (installer lead); office presses Send | `sweepQuoteExpiry(now)`, `sendQuoteExpiredEmail` |
| 9 | n5-emails-tab | owner, office | email lands in Emails; reply from info@ (redirected to Jo's test inbox); status Sent/Delivered/Bounced/Not sent; filed on job and leaves tab; no-job email gets homeowner-page reply | `sendJobEmailReply`, `sendNoJobEmailReply`, `matchEmailToJob` |
| 10 | n6-opt-out | owner, office | unsubscribe → job cancelled "Opted out (unsubscribed)"; STOP text → same | `recordUnsubscribe`, `stopKeyword`, `closeStoppedEnquiries` |
| 11 | n7-trade-signup | new TEST installer, new TEST electrician, office | missing insurance blocks approval; missing/expired licence blocks approval; welcome email says "We'll invite you to Mitti"; boss-added worker must sign 6 declarations before jobs | `decidePartnerApplication`, `getApprovalChecklist`, `workerDeclarations`, `approvePartnerWorker` |
| 12 | n8-timing | owner, installer office | Save my spot reminder at 24h (name, total, rebate, link saves spot); text due 9pm held to 7am, skipped if no longer true (explicit `now`); 2pm-day-before crew email once; 30-day lapse needs fresh Mitti form | `runSaveSpotReminderBlast`, `sweepQuietHeldTexts`, `sweepCrewReminders(now)`, `runPrestart` |
| 13 | n9-money-edges | owner, office | no cancel on My job after $349; reopened job past electrical stage needs new PIESA, owner pays again only if a check was done or refunded; $100 fixes markup on HIV jobs only; card + same Xero amount without Stripe id counts once | `payStep`, existing m158 helpers |
| 14 | n10-owner-messages | owner | sign-in code text; time-change gets PIESA or install rebooking link; "if needed: up to" removal line with existing insulation; quote >15% off estimate held → `NOT BUILT: 15% quote hold` | `requestOwnerCode`, `visitNewTimesLink`, `fixesTimesLink` |

### Task 15: Keep tests current + live proof

**Files:** Modify `AGENTS.md` (after line 39).

- [ ] **Step 1:** Add rule: "Any change to a portal rule updates its journey path in the same pull request; `bun run journey --all` must not get worse. Why: the daily 4:30am run is Jo's only bug check."
- [ ] **Step 2:** Run the full local suite `bun run test` — PASS.
- [ ] **Step 3:** Push branch, open PR, stop. After the coordinating chat merges: ask Lovable (send_message) to run `bun run journey --all` once and return report.md. Expected: every path `passed` or named `blocked`; s10 allowlist OK.
- [ ] **Step 4:** Commit `docs: keep journey paths current`.

### Task 16: Scheduled tasks

Not code — Claude scheduled tasks.

- [ ] **Step 1:** Create "HIV 4:30am journey test", `CRON_TZ=Australia/Sydney 13 4 * * *`, no push notification. Prompt: send Lovable project `fb35adfe-10bf-4d4c-987d-28567ca1ddeb` one message to run `bun run journey --all` (TEST only, no publishing, no switches, no code changes), wait with get_message until done (max ~80 min), confirm today's `journey_runs` rows exist; if Lovable is waiting on approval or fails, record nothing and stop.
- [ ] **Step 2:** Update "HIV 6am portal check" prompt: add section 10 — read today's `journey_runs` (latest `run_group` after 3am Sydney); report "Test run: all passed" or per failed path: person, step, plain reason, fix to send Lovable; `NOT BUILT` paths listed once as "not built yet"; no rows → "Test didn't run".
- [ ] **Step 3:** Verify: `fire_trigger` the 4:30am task once; then check the 6am prompt reads the rows. Done when 3 mornings in a row show a Test run section.
