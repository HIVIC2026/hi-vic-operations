# Finish the ESC Registry robot – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the install notice go live on its own, email info@ when the robot fails, show failures in Active jobs, then set the robot up, check it on the real Registry with Jo, and schedule it.

**Architecture:** Split the single `SELECTOR_MAP_VERIFIED` gate into one mark per task, applied by a pure `taskMode` helper everywhere the mode is decided (runner, server helpers, robot API cap). Add a robot failure alert that copies the existing lock-then-send pattern of `office-alert-email.server.ts`. Add one folded pile to Active jobs fed by the existing `openRobotFailureRows`. Tasks 4–6 are setup and supervised runs, not product code.

**Tech Stack:** TypeScript, TanStack Start (Cloudflare worker), Supabase, Resend via Lovable gateway, Bun tests (`bun scripts/test-isolated.ts 8 tests/<file>`), Playwright only in `scripts/`.

**Spec:** `docs/superpowers/specs/2026-10-29-esc-robot-finish-design.md`

## Global Constraints

- No live database change except turning on `workflow_settings.esc_registry_robot_enabled`, and only after Jo says yes at that moment.
- Never import Playwright under `src/`. The robot never holds the database key; the Registry login never reaches the portal or a log.
- TEST jobs (`source = qa_test`) are never live and never send the failure email to info@.
- Failure email goes to `info@homeinsulationvictoria.com.au`, from the existing `jobs@` sender, at any hour, once per failure event.
- Schedule: 8:30am and 2:30pm Melbourne time, Monday–Friday.
- VEEC creation stays dry run until Jo says go.
- Plain wording on anything Jo or staff read. Work goes in as a pull request from branch `esc-robot-finish`; this chat never merges.

## Review Focus

- Notice verified, VEEC not: a VEEC "submitted" record or live VEEC attempt through the robot API must be refused (test in Task 1).
- Failure email when the master comms switch is off: no email, failure still recorded and shown (test in Task 2).
- Email service down: `recordRobotFailure` still records the failure and does not throw (test in Task 2).
- One email per failure event: the same alert key sent twice gives one email (test in Task 2).
- A failure later done by hand (notice sent / VEEC lodged): it leaves the Active jobs pile (covered by existing `openRobotFailures`; Task 3 asserts the pile uses it).

---

### Task 1: One verified mark per task

**Files:**
- Modify: `src/lib/esc-registry-selectors.ts` (replace `SELECTOR_MAP_VERIFIED`)
- Modify: `src/lib/esc-registry-robot.core.ts` (add `taskMode`; `robotMode` live reason no longer mentions the selector map)
- Modify: `src/lib/esc-registry-robot.server.ts` (`robotSettings`, `noticeWork`, `veecWork` use `taskMode`)
- Modify: `src/lib/esc-robot-api.server.ts` (`serverModeCap(task)`, `capped`, `assertLive` per task)
- Modify: `scripts/esc-registry-robot.ts` (logs per-task mode), `src/AGENTS.md`, `src/lib/AGENTS.md`, `docs/esc-robot-cloud-setup.md` (rename the flag in text)
- Test: `tests/esc-registry-robot.test.ts`, `tests/esc-robot-api-server.test.ts`

**Interfaces:**
- Produces: `export const SELECTORS_VERIFIED: Record<RobotTask, boolean>` (both `false`); `export function taskMode(mode: RobotMode, task: RobotTask, verified: Record<RobotTask, boolean>): RobotMode` — `live` → `dry_run` when `verified[task]` is false, otherwise unchanged. `robotMode` input drops `selectorsVerified`. `serverModeCap(task: RobotTask): Promise<RobotMode>`.
- `WorkItem.effectiveMode` = `jobMode(taskMode(mode, task, SELECTORS_VERIFIED), job.source)`.

- [ ] **Step 1: Write failing tests** in `tests/esc-registry-robot.test.ts`:
  - `taskMode("live","install_notification",{install_notification:true,veec_creation:false})` → `"live"`; same for `"veec_creation"` → `"dry_run"`; `taskMode("off", …)` → `"off"`; `taskMode("dry_run", …, all true)` → `"dry_run"`.
  - `SELECTORS_VERIFIED` deep-equals `{ install_notification: false, veec_creation: false }`.
  - `robotMode({switchOn:true, envOn:true, modeEnv:"live", credentials:true}).mode` → `"live"`.
  In `tests/esc-robot-api-server.test.ts` (mock the selectors module with notice `true`, VEEC `false`, switch on):
  - `recordRobotVeecSubmitted` on a real job → refused with message containing `not in live mode`.
  - `recordRobotAttempt` with `task:"veec_creation", mode:"live"` → recorded as `dry_run` (capped).
  - `recordRobotNotificationSubmitted` path is not refused by the cap.
- [ ] **Step 2: Run** `bun scripts/test-isolated.ts 8 tests/esc-registry-robot.test.ts tests/esc-robot-api-server.test.ts` — expect FAIL (`taskMode` not exported).
- [ ] **Step 3: Implement** the interfaces above. Update every existing `SELECTOR_MAP_VERIFIED` import and the existing tests that referenced it (now `SELECTORS_VERIFIED`). Reason text for a downgraded task: `"<task label> form not yet checked on the real Registry – fill and screenshot only"`.
- [ ] **Step 4: Run** the two files, then `bun scripts/test-isolated.ts 8` and `bunx tsc --noEmit` — expect all PASS.
- [ ] **Step 5: Commit** `feat(esc-robot): separate verified mark for notice and VEEC forms`.

### Task 2: Failure email to info@

**Files:**
- Create: `src/lib/esc-robot-alert.core.ts`, `src/lib/esc-robot-alert.server.ts`
- Modify: `src/lib/esc-registry-robot.server.ts` (`recordRobotFailure` calls the alert after logging)
- Test: `tests/esc-robot-alert.test.ts`

**Interfaces:**
- Produces: `robotAlertContent(x: { jobNumber: string; address: string | null; task: RobotTask; step: string; jobUrl: string }): { subject: string; text: string; html: string }`.
  Subject exactly: `Robot couldn't lodge – ${jobNumber}` + ` (install notice)` or ` (VEECs)`.
  Next-step lines exactly — notice: `Lodge it by hand in the VEU Registry from the Registry block on the job, 24 hours to 5 days before the install.` VEECs: `Create them by hand from Final check.` No error text, no login, no Registry URL.
- Produces: `sendRobotFailureAlert(p: { jobId: string; eventKey: string; task: RobotTask; step: string }): Promise<"sent" | "already_sent" | "paused" | "test_skipped">` — reads job number, address, source; `qa_test` → `"test_skipped"` without sending; otherwise lock-then-send exactly like `sendMittiFailureAlert` (event `esc_robot_alert_sent`, id `stableUuid("esc-robot-alert:" + eventKey)`, unlock on pause or error, `Idempotency-Key` = id, master switch via `customerCommsEnabled`). HTML uses the existing office alert/email look.
- `recordRobotFailure` builds `eventKey` from task + notificationId (or jobId for VEEC) + the failure event's created time, calls the alert inside try/catch, `console.error` on error, never rethrows.

- [ ] **Step 1: Write failing tests** in `tests/esc-robot-alert.test.ts` (mock supabase admin and `fetch` as in `tests/office-alert-email.test.ts`):
  - content: subject for `HV-1234` notice is `Robot couldn't lodge – HV-1234 (install notice)`; VEEC text contains `Create them by hand from Final check.`; text never contains the step's raw error or the word `password`.
  - real job, comms on → one POST to the Resend gateway with `to: ["info@homeinsulationvictoria.com.au"]`, returns `"sent"`.
  - same `eventKey` twice → second call `"already_sent"`, still one POST.
  - `qa_test` job → `"test_skipped"`, no POST, no event row.
  - comms off → `"paused"`, no POST, lock event removed.
  - `recordRobotFailure` with fetch rejecting → resolves, the `esc_registry_robot_failed` event is written.
- [ ] **Step 2: Run** `bun scripts/test-isolated.ts 8 tests/esc-robot-alert.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** both modules and the call in `recordRobotFailure`.
- [ ] **Step 4: Run** the file, all robot tests, `bunx tsc --noEmit` — expect PASS.
- [ ] **Step 5: Commit** `feat(esc-robot): email info@ when the robot can't lodge`.

### Task 3: "Robot couldn't lodge" pile in Active jobs

**Files:**
- Modify: `src/lib/office-screens.functions.ts` (add `getRobotFailures` server fn, admin only, returns `{ rows: { jobId, jobNumber, task, at, text }[] }` from `openRobotFailureRows()` + job numbers)
- Create: `src/components/portal/robot-failures-pile.tsx` (`RobotFailuresPile`: one row per failure — job number link to the job's install section for a notice or final-check section for VEECs, the plain line, "since" time)
- Modify: `src/components/portal/JobsScreen.tsx` (fourth fold line `Registry robot couldn't lodge · N` next to the Mitti piles, red when N > 0; hidden from installers)
- Test: `tests/robot-failures-pile.test.ts`

**Interfaces:**
- Consumes: `openRobotFailureRows(onlyIds?: string[])` from `esc-registry-robot.server.ts` (already drops failures done by hand).

- [ ] **Step 1: Write failing tests:** `getRobotFailures` handler returns one row per open failure with `jobNumber`; a failure whose notice is now sent is not returned; non-admin is refused. Render test: pile shows `Registry robot couldn't lodge · 2` and links `HV-…` to `section=install` / `section=final-check`.
- [ ] **Step 2: Run** `bun scripts/test-isolated.ts 8 tests/robot-failures-pile.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the server fn, component and fold line following the `MittiSyncProblems` pattern.
- [ ] **Step 4: Run** the file, full suite, `bunx tsc --noEmit`, `bun run lint` — expect PASS.
- [ ] **Step 5: Commit** `feat(esc-robot): show robot failures in Active jobs`.
- [ ] **Step 6: Review + PR.** Fresh reviewer on Tasks 1–3 diff; fix findings test-first; push branch `esc-robot-finish`, open the PR, stop (coordinating chat merges; Jo publishes).

### Task 4: Robot setup and first look (needs Jo)

- [ ] **Step 1:** Jo allows `veu.esc.vic.gov.au` and `estimate.homeinsulationvictoria.com.au` in claude.ai › Settings › Capabilities. Check: `curl -sS -o /dev/null -w "%{http_code}" https://veu.esc.vic.gov.au/` returns a 2xx/3xx, not a proxy 403.
- [ ] **Step 2:** Generate the token (`openssl rand -hex 32`), give it to Jo once; she adds `ESC_ROBOT_TOKEN` in Lovable › Settings › Secrets. Check: robot API without the token → 401; with it → `robotSettings` answers.
- [ ] **Step 3:** Set the robot environment per `docs/esc-robot-cloud-setup.md` with Jo's Registry login, `ESC_REGISTRY_ROBOT_ENABLED=true`, mode unset. Check: `bun scripts/esc-registry-robot.ts --plan` first line says it is using the robot API; mode reads `off` only because the switch is off.
- [ ] **Step 4:** Run `bun scripts/esc-registry-robot-explore.ts`. Correct `LOGIN`, `INSTALL_NOTIFICATION`, `VEEC_CREATION` in `esc-registry-selectors.ts` from the dump; remove every `todo`. Check: `selectorGaps()` is empty and robot tests pass. Commit `fix(esc-robot): selector map from the real Registry`, add to the PR.

### Task 5: Practice run and install notice live (needs Jo)

- [ ] **Step 1:** Ask Jo (question box) to turn the switch on for practice runs. Then `bun scripts/esc-registry-robot.ts --job <TEST job at install-notice stage>` and `--job <TEST job at VEEC stage>`. Check: two dry-run events and two screenshots on the jobs; send both photos to Jo.
- [ ] **Step 2:** Jo confirms the notice photo matches the job. Set `SELECTORS_VERIFIED.install_notification = true`, commit, PR, merged by the coordinating chat, Jo publishes.
- [ ] **Step 3:** Set `ESC_REGISTRY_ROBOT_MODE=live`. Create the scheduled task: `CRON_TZ=Australia/Melbourne 30 8 * * 1-5` and `CRON_TZ=Australia/Melbourne 30 14 * * 1-5` running `bun scripts/esc-registry-robot.ts` in the robot environment. Check: next run's summary line shows notices `live`, VEECs `dry_run`.

### Task 6: VEEC creation live (only when Jo says go)

- [ ] **Step 1:** Send Jo the VEEC dry-run photos from real jobs as they come. On her go: set `SELECTORS_VERIFIED.veec_creation = true`, test, commit, PR. Check: next run summary shows VEECs `live`.
