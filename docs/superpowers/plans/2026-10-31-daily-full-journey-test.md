# Daily Full Journey Test Implementation Plan (updated 31 Oct)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: waiting for Jo's approval. Replaces `2026-10-29-daily-full-journey-test.md`.

## For Jo — the plan in plain words

1. Saving one result per path is already done (Task 1).
2. One command runs every test path in one go (Task 2).
3. Fix the side paths that still use old rules (Task 3).
4. Add the 11 missing processes, one task each (Tasks 4–15).
5. Add the "keep tests current" rule, then Lovable runs the whole thing once on TEST jobs to prove it (Task 16).
6. Set up the morning task and the "Test run" part of your 6am report (Task 17).

Code is written and checked here, saved as a pull request, and merged only by your coordinating chat. Nothing changes for real customers. Some new checks may fail at first because the portal doesn't do that rule yet — your report will say "not built yet", not "broken".

---

**Goal:** One command runs the main journey plus every path on fresh TEST jobs, saves one result row per path, and a morning scheduled task runs it daily for Jo's 6am report.

**Architecture:** Add `--all` to `scripts/journey.ts`. It runs the main journey, every PHASE3/PHASE4 path and a new PHASE5 map (new file `src/lib/journey-paths.server.ts`), saving each with `storeJourneyRun(..., { path, runGroup, status })`. New paths drive existing server functions as the TEST person, like the existing branches. Lovable's sandbox runs it (it holds the secrets); two Claude scheduled tasks start it and report it.

**Tech Stack:** Bun, TypeScript, TanStack Start server functions, Supabase/Postgres, PGlite tests (`bun:test`), Playwright (`e2e/journey/shoot.py`).

**Spec:** `docs/superpowers/specs/2026-10-31-daily-full-journey-test-design.md`

## Facts checked on origin/main, 31 Oct

- Main journey: 10/10 passed 31 Oct 2026 05:08 UTC (`journey_runs`, mode `browser`).
- 22 side paths: `not-eligible`, `piesa-fixes`; `p1`–`p8`; `m7`, `m8`, `m9`, `m10`, `m11`, `m22`, `m23`, `m24`, `m42`, `m43`, `m158-repeat-piesa`, `m158-owner-pays`.
- `journey_runs.path`, `run_group`, `status` exist (migration 0178); `storeJourneyRun` already takes `opts`. Side paths don't call it yet.
- Live switches (read only, never changed): `trade_messages_paused = true`, `ai_email_auto_send_enabled = false`, `customer_comms_enabled = true`, `quote_estimate_variance_tolerance_pct = 15`.
- Scheduled tasks: "HIV 6am portal check" (5:54am Sydney daily) and "HIV daytime check" (10am, 1pm, 4pm weekdays). No morning test task yet.

## Global Constraints

- TEST only: every path uses a fresh `jobs.source = 'qa_test'` job and TEST-PARTNER businesses / `@hivic-test.example` people. Never touches real jobs or the DEMO jobs HV-3600 / HV-3601.
- Never changes any switch or setting, including `trade_messages_paused` and AI auto-send. A path that needs a switch changed reports `blocked` with the reason.
- No real sends, money, Xero books or Mitti. Use the existing guards (Stripe test key, Xero Demo Company, Mitti simulator + `armMittiGuard`, test sender, allowlist check s10).
- No change to how the portal works for real customers. Rule not built → `blocked` with `NOT BUILT: <rule>`. Never patch portal code in this plan. No automatic fixes.
- Time rules move time by backdating this job's own rows and calling sweeps with an explicit `now` (pattern in p6). Never real waiting.
- Screens at 390px and 1280px for each affected person. TEST office screens only on pages allowed by `qa-office-policy.core.ts`; other office checks read the saved records (see Question 1 in the spec).
- Installer screens show the last cached copy first on return visits (speed work, PR #105). Screens must wait for fresh data before checking text.
- Cleanup archives TEST jobs (`archiveQaJourney` / `cleanupJourney`); never deletes them.
- Wording checks: "Your estimated quote based on what you've told us" present; "You pay about" absent; no HIV phone number; no calculator link in owner emails.
- Merge only through the coordinating chat; this chat opens the PR and stops.

## Review Focus

1. A path crashes before cleanup → its TEST job is still archived (cleanup in `finally`) and the run goes on to the next path.
2. A rule not built yet shows as `blocked` + `NOT BUILT`, not `failed`.
3. Two runs on one morning (manual + scheduled) → the 6am report reads only the latest `run_group` per path.
4. Quiet-hours path run at 4:13am real time → uses explicit `now`, so it can't pass or fail by accident.
5. Anything delivered outside the allowlist on any path → whole run failed.
6. A paused trade message is reported as held, never as sent, and the switch is never written.

Tests: 1, 2 and 5 in Task 2; 6 in Task 11; 4 in Task 12; 3 is checked in Task 17.

---

### Task 1: Store one result per path — DONE

Already on main: migration `0178_journey_runs_path.sql`, `storeJourneyRun(mode, ctx, result, opts?)`, test `tests/journey-runs-db.test.ts`. Nothing to do.

### Task 2: `bun run journey --all`

**Files:**
- Create: `src/lib/journey-all.server.ts`
- Modify: `scripts/journey.ts` (add `--all` before the `--branch` handling)
- Test: `tests/journey-all.test.ts`

**Interfaces:**
- Consumes: `runServerJourney`, `runJourneyBranch`, `runPhase3`, `runPhase4`, `runPhase5` (Task 4), `storeJourneyRun`.
- Produces: `runAllPaths(opts: { shotDir: string; only?: string[] }): Promise<AllRunResult>`; `type AllRunResult = { runGroup: string; paths: { path: string; status: "passed"|"failed"|"blocked"; reason: string | null; person: string | null; step: string | null }[]; allowlistOk: boolean }`; `toStatus(res: Phase3Result): "passed"|"failed"|"blocked"`.

- [ ] **Step 1:** Tests (mock the run functions): runs main, the 2 older branches, every PHASE3, PHASE4, PHASE5 name once; one path throwing is stored `failed` and the next still runs; `NOT BUILT` stays `blocked`; any allowlist failure sets `allowlistOk` false and exit code 1; `--only` limits to named paths; no code path writes `workflow_settings`.
- [ ] **Step 2:** Run `bun ./scripts/test-isolated.ts 1 tests/journey-all.test.ts` — expect FAIL.
- [ ] **Step 3:** Implement: one `runGroup` uuid; each path in try/finally; store each row with `path` (`main` or the branch name); write `/mnt/documents/journey/<stamp>-all/report.md` (one line per path: status, person, step, plain reason). Exit 0 only if every path is `passed` or `blocked` with `NOT BUILT`, and `allowlistOk`.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(journey): run every path in one command`.

### Task 3: Side paths follow the 31 Oct rules

The main path already passes; keep it passing.

**Files:**
- Modify: `src/lib/journey-branches.server.ts` (`piesa-fixes` branch around :380-397; `m42CommsLock` :1435; office page list for the Jobs pages)
- Test: `tests/journey-live-runner-db.test.ts`, new `tests/journey-branches-rules.test.ts`

- [ ] **Step 1:** Tests: `piesa-fixes` accepts with two ticks only (no `signatoryName`, no `over18`) and expects the fixes on their own invoice; office pages use `/admin/jobs/ours`, `/admin/jobs/installers`, `/admin/jobs/closed`; Save my spot double tap gives one spot and one message; payment statement shows version `steps-2026-10-29b` wording; `m42` follows Jo's answer to Question 3 (until then it reports `blocked: waiting for Jo`).
- [ ] **Step 2:** Run — FAIL where rules changed.
- [ ] **Step 3:** Update the branches to the current server functions.
- [ ] **Step 4:** Run each branch once on the test copy (`bun run journey --branch <name>`). Expect PASS or a named `blocked`.
- [ ] **Step 5:** Commit `fix(journey): side paths follow current rules`.

### Task 4: PHASE5 map and helpers

**Files:**
- Create: `src/lib/journey-paths.server.ts`
- Modify: `src/lib/journey-branches.server.ts` (export `Recorder`, `answer`, `shoot`, `freshCtx`, `toQuoteAccepted`, `finish`, `ago`)
- Test: `tests/journey-paths.test.ts`

**Interfaces:**
- Produces: `type Phase5Name = "n1-installer-own-job" | "n2-crew-lead" | "n3-electrician-offers" | "n4-quote-expiry" | "n5-emails-tab" | "n6-opt-out" | "n7-trade-signup" | "n8-timing" | "n9-money-edges" | "n10-owner-messages" | "n11-area-batches"`; `PHASE5: Record<Phase5Name, PathFn>` (same signature as PHASE4); `runPhase5(name, shotDir): Promise<Phase3Result>`; `notBuilt(rule: string): never`.

- [ ] **Step 1:** Tests: every Phase5Name present; `notBuilt` gives `blocked`; `runPhase5` archives the job when the path throws.
- [ ] **Step 2–5:** FAIL → implement map (empty stubs calling `notBuilt("pending task")`) → PASS → commit `feat(journey): add path map for new processes`.

### Tasks 5–15: one path each

Each task: add the path in `journey-paths.server.ts`, a PGlite test `tests/journey-path-<n>.test.ts` for the checks below, FAIL → implement → PASS, screens for the listed people, commit `feat(journey): <path>`. Checks already covered by a side path are not repeated. Anything not built calls `notBuilt`.

| Task | Path | People | Checks | Server functions |
|---|---|---|---|---|
| 5 | n1-installer-own-job | installer boss, owner, office | required fields; door-knocked refused; other installer's open address refused; installer picks Ready Check time; installer types price; own electrician (agreed rate) or HIV $349; not-onboarded can't be picked; shows in Installer jobs; one-way "use HIV's electrician" switch | `submitInstallerJob`, `addJobOptions` |
| 6 | n2-crew-lead | boss, Lead, Crew | one picker; Lead from Team list only; Crew can't be install Lead; Crew can do Ready Check; "Who's on the crew today?"; SWMS signed on Lead's phone, re-signed when house facts change | `saveCrewSelection`, `crewStaff`, `getPiisaCrew` |
| 7 | n3-electrician-offers | 3 TEST electricians, office | one at a time, nearest first; 24h each (backdate `offered_at`); office after 2 misses; installer's electrician first (own jobs and HIV leads) | `startPiesaAllocation`, `nextOfferBatch`, `chooseTrade` |
| 8 | n4-quote-expiry | owner, installer, office | 14 days → closed with `QUOTE_EXPIRED_CANCEL_REASON`; installer cancel email; one "Your quote has expired" email with "Send me a new quote"; re-price; office presses Send | `sweepQuoteExpiry(now)`, `sendQuoteExpiredEmail` |
| 9 | n5-emails-tab | owner, office | lands in Emails; reply from info@ (to Jo's test inbox); Sent/Delivered/Bounced/Not sent; filed on job; no-job reply; AI reply stays a draft while auto-send is off (read `autoSendOn()`, never `switchAutoSend`) | `sendJobEmailReply`, `sendNoJobEmailReply`, `matchEmailToJob`, `autoSendOn` |
| 10 | n6-opt-out | owner, office | unsubscribe → cancelled "Opted out (unsubscribed)"; STOP text → same | `recordUnsubscribe`, `stopKeyword`, `closeStoppedEnquiries` |
| 11 | n7-trade-signup | new TEST installer, new TEST electrician, office | missing insurance blocks; missing/expired licence blocks (no override); welcome email "We'll invite you to Mitti"; worker signs 6 declarations first; paused trade message reported as held | `decidePartnerApplication`, `getApprovalChecklist`, `workerDeclarations`, `approvePartnerWorker` |
| 12 | n8-timing | owner, installer office | Save my spot reminder at 24h; text due 9pm held to 7am, skipped if no longer true (explicit `now`); 2pm-day-before crew email once | `runSaveSpotReminderBlast`, `sweepQuietHeldTexts`, `sweepCrewReminders(now)` |
| 13 | n9-money-edges | owner, office | no cancel on My job after $349; $100 fixes markup on HIV jobs only; card + same Xero amount without Stripe id counts once | `payStep`, m158 helpers |
| 14 | n10-owner-messages | owner | sign-in code text; time-change gets the right rebooking link; "if needed: up to" removal line | `requestOwnerCode`, `visitNewTimesLink`, `fixesTimesLink` |
| 15 | n11-area-batches | owner, installer boss, office | suggested batch; office Send; owner quick taps; day 2 reminder, day 3 close (explicit `now`); Send to installer; run page; owner confirms a time | `batchSuggestions`, `sendBatch`, `saveQuickTaps`, `sweepAreaBatches`, `offerRun`, `chooseRunDay`, `ownerConfirmRunSlot` |

### Task 16: Keep tests current + live proof

**Files:** Modify `AGENTS.md` (add one line under the journey rules, near line 20).

- [ ] **Step 1:** Add: "Any change to a portal rule updates its journey path in the same pull request; `bun run journey --all` must not get worse. Why: the daily morning run is Jo's only bug check."
- [ ] **Step 2:** Run `bun run test` — PASS (or the same failures as main, listed in the PR).
- [ ] **Step 3:** Push branch, open PR, stop. After the coordinating chat merges: ask Lovable to run `bun run journey --all` once and return report.md. Expect every path `passed` or named `blocked`; s10 allowlist OK.
- [ ] **Step 4:** Commit `docs: keep journey paths current`.

### Task 17: Scheduled tasks

Not code — Claude scheduled tasks.

- [ ] **Step 1:** Create "HIV 4:30am journey test", `CRON_TZ=Australia/Sydney 13 4 * * *`, no push. Prompt: send Lovable project `fb35adfe-10bf-4d4c-987d-28567ca1ddeb` one message to run `bun run journey --all` (TEST only, no publishing, no switches, no code changes, never HV-3600/HV-3601), wait with get_message until done (max 80 min, so it ends before 5:54am), confirm today's `journey_runs` rows exist. If Lovable is waiting on approval or fails, record nothing and stop.
- [ ] **Step 2:** Update "HIV 6am portal check": add section 10 — read the latest `run_group` after 3am Sydney; "Test run: all passed", or per failed path: person, step, plain reason, fix to send Lovable; `NOT BUILT` paths listed once as "not built yet"; no rows → "Test didn't run". Its own job filter (`source <> 'qa_test'`) stays for everything else. (Fix the "Added by installers" line only if Jo says yes to Question 4.)
- [ ] **Step 3:** Verify: fire the morning task once, then check the 6am report reads the rows. Done when 3 mornings in a row show a Test run section.
