# Ready Check 48-hour Flag Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the "Ready Check time not confirmed after 48 hours" flag on installer jobs, and on any job whose Ready Check is already done.

**Architecture:** Add one pure rule, `readyCheckOverdueApplies`, to `src/lib/allocation.core.ts`. Both office lists call it: the current Needs me (`office-needs.server.ts`) and the older office queue (`buildNeedsHivic`). Don't touch `VISIT_STAGES` / `visitIsCurrent`. They mirror SQL `visit_is_current()` and control whether the installer can still see the owner's contact details.

**Tech Stack:** TypeScript, Bun tests (`bun test <file>`; full suite `bun run test`), Supabase. The repo is HIVIC2026/hi-vic-operations, synced to Lovable.

**Spec:** `docs/superpowers/specs/2026-10-28-ready-check-48h-flag-design.md` (approved by Jo, 28 Oct 2026)

## Global Constraints
- Installer job = `jobs.channel = 'installer_sourced'`. Never use `installer_led`.
- Ready Check done = stage `ready_check_complete`, `measured_estimate_ready` or `measured_quote_accepted`.
- Only the Ready Check visit changes. PIESA, fixes and install 48-hour rules stay exactly as they are.
- No texts, emails, screen wording or installer screens change.
- Work on a branch. Nothing reaches the live portal until Jo approves the merge.

## Review Focus
1. A website job, 48+ hours since release, no time booked, Ready Check not done → must still be flagged (Task 1 test).
2. A PIESA, fixes or install visit on an installer job → must still be flagged after 48 hours (Task 1 test).
3. A job with `channel` null or missing → treated as a website job, still flagged (Task 1 test).
4. A website job at `ready_check_complete` with an old unconfirmed release → not flagged (Task 1 test).
5. The older queue's existing filter (`rcTalking`: times going back and forth) still applies. Don't remove it in Task 1.

---

### Task 1: The rule and the older office queue

**Files:**
- Modify: `src/lib/allocation.core.ts` (add the rule near `coordinationState`; `NeedsInput.jobs` gains optional `channel`; one check inside `buildNeedsHivic`'s releases loop)
- Modify: `src/lib/needs.server.ts` (`jobs:` map passes `channel: j.channel`; the select already reads it)
- Test: `tests/allocation.core.test.ts`

**Interfaces:**
- Produces: `export const READY_CHECK_DONE_STAGES: ReadonlySet<string>` and `export function readyCheckOverdueApplies(visit: VisitKind | string, job: { stage: string | null | undefined; channel: string | null | undefined }): boolean`. It returns `true` for every visit except `ready_check`. For `ready_check` it returns `false` when the channel is `installer_sourced` or the stage is in `READY_CHECK_DONE_STAGES`.

- [ ] **Step 1: Write the failing tests** in `tests/allocation.core.test.ts`, inside a new `describe("Ready Check 48h flag scope", …)`:
  - `readyCheckOverdueApplies("ready_check", { stage: "ready_check_scheduled", channel: "installer_sourced" })` → `false`
  - `readyCheckOverdueApplies("ready_check", { stage: "ready_check_scheduled", channel: "hivic_sourced" })` → `true`
  - `readyCheckOverdueApplies("ready_check", { stage: "ready_check_scheduled", channel: null })` → `true`
  - for each of `ready_check_complete`, `measured_estimate_ready`, `measured_quote_accepted` with `channel: "hivic_sourced"` → `false`
  - for each of `piesa`, `rectification`, `installation` with `channel: "installer_sourced"` → `true`
  - `buildNeedsHivic` with the existing `input("ready_check", null)` helper, but `jobs: [{ id: "j", job_number: "HV-T", stage: "ready_check_scheduled", channel: "installer_sourced" }]` → `[]`
  - the same with `stage: "measured_estimate_ready", channel: "hivic_sourced"` → `[]`
  - the same with `stage: "ready_check_scheduled", channel: "hivic_sourced"` → codes `["ready_check_booking_overdue"]`
  - `input("piesa", null)` with `channel: "installer_sourced"` → codes `["piesa_booking_overdue"]`

- [ ] **Step 2: Run** `bun test tests/allocation.core.test.ts`. Expected: FAIL (`readyCheckOverdueApplies` is not exported).

- [ ] **Step 3: Implement** `READY_CHECK_DONE_STAGES` and `readyCheckOverdueApplies` in `allocation.core.ts`. Add `channel?: string | null` to the `NeedsInput.jobs` item type. In `buildNeedsHivic`'s releases loop, skip a release when `!readyCheckOverdueApplies(r.visit_kind, jobs.get(r.job_id) ?? { stage: null, channel: null })`. Put that before the `coordinationState` call, with a one-line comment citing "Jo 28 Oct: installers book the Ready Check outside the portal".

- [ ] **Step 4: Pass `channel`** in `src/lib/needs.server.ts`'s `jobs: jobRows.map(...)` object.

- [ ] **Step 5: Run** `bun test tests/allocation.core.test.ts`. Expected: PASS, including the existing "each visit: 48h…" tests, unchanged.

- [ ] **Step 6: Commit** — `fix: Ready Check 48h flag skips installer jobs and done Ready Checks (older queue)`

### Task 2: Needs me uses the same rule

**Files:**
- Modify: `src/lib/office-needs.server.ts`, the "Same 48h rule as the legacy exceptions queue" block (around lines 134–145)
- Test: `tests/office-needs-me.test.ts` (a source-level guard, as `allocation.core.test.ts` already does with `readFileSync`)

**Interfaces:**
- Consumes: `readyCheckOverdueApplies` from Task 1. The installer flag is `j.facts.ownJob` on `OfficeJob` (set from `channel === 'installer_sourced'` in `office.server.ts`).

- [ ] **Step 1: Write the failing test** `"Needs me 48h booking rule uses readyCheckOverdueApplies"`. Read `src/lib/office-needs.server.ts` and assert it contains `readyCheckOverdueApplies(`.

- [ ] **Step 2: Run** `bun test tests/office-needs-me.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Import `readyCheckOverdueApplies` with `coordinationState`. In the releases loop, `continue` when `!readyCheckOverdueApplies(visit, { stage: j.stage, channel: j.facts.ownJob ? "installer_sourced" : null })`. Leave `visitIsCurrent` and everything else as is.

- [ ] **Step 4: Run** `bun test tests/office-needs-me.test.ts tests/allocation.core.test.ts`, then the full `bun run test`. Expected: all PASS. `bunx tsc --noEmit` shows no new errors.

- [ ] **Step 5: Commit** — `fix: Needs me skips Ready Check 48h flag for installer jobs and done Ready Checks`

### Task 3: Check it live (after Jo approves the merge)

- [ ] **Step 1:** Merge the branch only after Jo says yes. Then wait for Lovable to sync and publish.
- [ ] **Step 2:** Read-only check that the rule now leaves out HV-3066, HV-1538, HV-3116, HV-3117, HV-3118, HV-3119 and HV-3136. Use the same `contact_releases` + `jobs.stage/channel` query the investigation used, and apply the new rule.
- [ ] **Step 3:** Ask Jo to open Needs me on her phone and confirm those 7 are gone. Test jobs don't count.
