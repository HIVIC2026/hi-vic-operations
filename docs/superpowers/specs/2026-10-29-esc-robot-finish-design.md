# Finish the ESC Registry robot – design

Date: 29 Oct 2026 · Approved in chat by Jo (design) · Status: spec for review

## Goal

The ESC Registry robot (decisions 195, 272, 385) lodges the ESC install notification (24 hours to 5 days before the
install) and creates the VEECs after the owner signs, so the office no longer does either by hand. The robot code, the
robot API and the switch column (`workflow_settings.esc_registry_robot_enabled`, applied live 25 Oct, currently off)
already exist. What is missing: the selector map has never been checked on the real VEU Registry, there is no robot
cloud environment, and failures only reach the Needs me screen, which the office no longer uses (23 Oct).

## What Jo decided (29 Oct 2026)

- Registry login is email + password only (no code step), so the robot can log in unattended.
- Runs twice a day on weekdays: 8:30am and 2:30pm Melbourne time.
- When the robot can't lodge something, info@ gets an email straight away, plus a flag on the job.
- The install notice goes live first. VEEC creation stays dry run (fill + screenshot, never Submit) until Jo says go.
- Everything else from decisions 272 and 385 is unchanged (separate Claude cloud session, no database key, Registry
  login only in the robot environment, TEST jobs never live, first run watched by Jo).

## Portal changes (code)

### 1. Separate "verified" marks per form

Today `SELECTOR_MAP_VERIFIED` in `src/lib/esc-registry-selectors.ts` gates live mode for both tasks. Replace it with
one mark per task:

```ts
export const SELECTORS_VERIFIED: Record<RobotTask, boolean> = { install_notification: false, veec_creation: false };
```

- `robotMode` keeps returning the run-level mode (off / dry_run / live) from switch, env flag, mode env and login.
  A new pure helper `taskMode(mode, task, verified)` downgrades `live` to `dry_run` for a task whose mark is false.
  `jobMode` (TEST jobs → dry run) still applies on top.
- The runner (`scripts/esc-registry-robot.ts`) and both server paths (`esc-registry-robot.server.ts`,
  `esc-robot-api.server.ts`) use the per-task mode. The API keeps refusing a "submitted" record for a task whose
  mark is false, exactly as it refuses today when the single flag is false.
- No database change. Going live for VEECs later is a one-line code change after Jo says go.

Rejected alternative: a second switch in Settings. It needs a database change for something flipped once.

### 2. Failure email to info@

When `recordRobotFailure` records `esc_registry_robot_failed` on a real (not TEST) job, the portal sends one email to
`info@homeinsulationvictoria.com.au` using the existing office email sender and look:

- Subject: `Robot couldn't lodge – HV-1234` (with the task: install notice or VEECs).
- Body: job number and address, what it was trying to do, the step it failed at, and the plain next step
  (install notice: "Lodge it by hand in the VEU Registry from the Registry block on the job, 24 hours to 5 days before
  the install"; VEECs: "Create them by hand from Final check"). Link to the job. No Registry login, no raw error dump.
- One email per failure event. The robot already never retries a failed target, so there are no repeats.
- Sent at any hour (it goes to the office, not an owner).
- If the email can't send, the failure is still recorded as today; the email problem is logged, never hides the failure.
- The job's flag in Active jobs comes from the same failure event. If Active jobs does not show it today, add the
  existing "Robot failed" flag there; nothing else about how failures are recorded changes.

## Setup (no portal code)

1. Jo allows `veu.esc.vic.gov.au` and `estimate.homeinsulationvictoria.com.au` in claude.ai › Settings › Capabilities.
2. Claude generates `ESC_ROBOT_TOKEN`; Jo adds it in Lovable › Settings › Secrets.
3. A robot cloud environment is set up as in `docs/esc-robot-cloud-setup.md`, with the token, Jo's Registry login,
   `ESC_REGISTRY_ROBOT_ENABLED=true`, and `ESC_REGISTRY_ROBOT_MODE` unset (dry run).
4. First look: `scripts/esc-registry-robot-explore.ts` logs in and dumps both forms. The selector map is corrected and
   every TODO removed. Nothing is submitted.
5. Practice run: `bun scripts/esc-registry-robot.ts --job <TEST job>` for the install notice and for VEEC creation.
   The screenshots are sent to Jo in chat; she compares them with the job and says yes.
6. Install notice live: Jo approves turning on Settings › Switches › ESC Registry robot, `install_notification` is
   marked verified (code), `ESC_REGISTRY_ROBOT_MODE=live` is set, and a scheduled task runs the robot at 8:30am and
   2:30pm Melbourne time on weekdays.
7. VEEC creation live: only when Jo says go – mark `veec_creation` verified (code).

The live database is not changed by this work, apart from turning the existing switch on at step 6, which Jo approves
at the time.

## Testing

- Test first for both changes: `taskMode` cases (each task verified or not, TEST job, off), the API refusing a
  submitted VEEC while only the notice is verified, and the failure email (sent once on a real job, not sent on a TEST
  job, failure still recorded when the email fails).
- Existing robot tests keep passing (`tests/esc-registry-robot*.test.ts`, `tests/esc-robot-api*.test.ts`).
- A separate reviewer checks the diff. The change goes in as a GitHub pull request; this chat opens it and stops
  (only the coordinating chat merges).

## Out of scope

Changing what the robot fills, the 24h–5 day rules, idempotency, the Needs me row, or any other switch.
