# Mitti Form Retry and Alert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Mitti form (Ready Check, PIESA, fixes, install day) fails to be made, the portal checks Mitti, links or retries up to twice, 2 minutes apart, and emails info@ once if it still can't.

**Architecture:** Install-day forms join the existing claim guard (new `MittiFormKind` `"install_day"`). A new once-a-minute cron route runs `runMittiRetrySweep`. It reads failure events since go-live, decides per job+form with pure rules (`mitti-retry.core.ts`), searches Mitti before every retry, then links, releases and retries through the existing creators, or emails info@ through a new office-alert sender module.

**Tech Stack:** TanStack Start on Cloudflare Workers, Supabase (`supabaseAdmin`), `bun test`, existing `mittiApi`/`MittiCall`, Resend gateway.

**Spec:** `docs/superpowers/specs/2026-10-28-mitti-form-retry-design.md` (copy it into the repo in Task 1's commit).

## Global Constraints

- Read `AGENTS.md` and `src/lib/AGENTS.md` first and follow them.
- **Retry timing:** first retry no earlier than 2 minutes after the failed attempt; second retry no earlier than 2 minutes after the first. Never more than 2 retries per job+form.
- **Before every retry:** search Mitti. Never call a creator without that search in the same sweep run.
- **When the search finds:**
  - exactly 1 matching form: link it, no create.
  - more than 1, or a search error: no create, email info@ at once.
  - 0: release the claim, then retry.
- **"Not created" errors** (the claim was released, e.g. "trade not found in Mitti", template missing fields): no retry, email info@ at once.
- **Emails:** at most one per job+form+failure. The recipient is `info@homeinsulationvictoria.com.au`.
  - Subject: `Mitti form not made: HV-#### (Ready Check | PIESA | Electrical fixes | Install day)`.
  - Body: job number, address, form type, trade name and email, booking time if booked, the last error, and a portal job link.
  - Any time of day.
- **Master switch:** obey the comms master switch (`customerCommsEnabled()`), per AGENTS.md.
- **Test jobs:**
  - qa_test jobs and TEST partners use `mittiCallFor` (Mitti simulator).
  - Their alert email goes only to `TEST_ALLOWLIST`, via the existing test-send rules.
- **Never send** anything to owners or trades.
- **Go-live cutoff:** `MITTI_RETRY_FROM` (an ISO constant set to the deploy time). Events before it are ignored, so old flags stay as they are.
- **No new tables.** Retry state lives in `workflow_events`.
- **Migrations:** any migration is staged in `docs/pending-migrations/` with a rollback and is never auto-applied. The cron schedule is added through Lovable's authenticated-cron tooling at deploy, switched on together with the deployment.
- **Sender isolation:** sender modules stay out of the `autoAdvanceJob` import graph (tests/comms.test.ts must stay green).
- **Unchanged:** form creation when Mitti works normally. Add a job still creates immediately, with no delayed retries inside the request.

## Review Focus

1. **Mitti search sees a form that is modified but not new** (e.g. another job's form edited after the failure). The match must require same template + same Mitti owner + this job (job number, or address and owner name for A1). Test: `ignores other jobs' forms modified after the failure`.
2. **Mitti still down during the retry search.** It counts as "can't tell": no create, email. Test: `search error emails and does not create`.
3. **The office override button is used during the retry window.** The sweep must stop for that job+form once a later `mitti_audit_created`, `mitti_audit_linked` or override exists. Test: `skips when office already fixed it`.
4. **Cron runs twice at once.** The claim guard stops a second create, and the alert email has a deterministic event id so it is sent once. Test: `two sweeps at once make one form and one email`.
5. **An install-day form is already made with an old (pre-lock) event.** The existing `mitti_piisa_audit_created` check must still short-circuit before claiming. Test: `install_day with existing piisa event does not claim`.

---

### Task 1: Install-day forms use the claim guard

**Files:**
- Modify: `src/lib/mitti-create-claim.core.ts`, to add `"install_day"` to the `MittiFormKind` union.
- Modify: `src/lib/mitti.server.ts`, the `createPiisaMittiAudit` function (around lines 616–784).
- Test: `tests/piisa-claim-guard.test.ts`. Copy the fakes pattern from `tests/t3-mitti-async-claim.test.ts`.
- Add: `docs/superpowers/specs/2026-10-28-mitti-form-retry-design.md`.

**Interfaces:**
- Produces: `MittiFormKind = "ready_check" | "piesa" | "fixes" | "install_day"`.
- `createPiisaMittiAudit(jobId, actorId, call, opts?: { officeOverride?: boolean })` keeps its current return type. On a lost reply it throws `MittiOutcomeUncertain` after `recordMittiCreateUncertain(jobId, "install_day", claimId, actorId, detail)`.

- [ ] **Step 1: Write failing tests**
  - `install_day timeout records uncertain and a second call does not create`: `fakeMitti({create:"timeout"})`. Call twice. Expect `creates()` to be 1, one `mitti_audit_create_uncertain` event with `details.kind === "install_day"`, and the second call throwing `MittiClaimHeld`.
  - `install_day not_created releases claim`: the search for the user returns none. Expect a `mitti_audit_create_released` event with kind `install_day`, and `creates()` to be 0.
  - `install_day with existing piisa event does not claim`: seed `mitti_piisa_audit_created`. Expect no `mitti_audit_create_started` event.
  - `install_day success`: expect `mitti_piisa_audit_created` written as today. The claim stays held, the same as other kinds.
- [ ] **Step 2: Run** `bun test tests/piisa-claim-guard.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `createPiisaMittiAudit`, after the existing `mitti_piisa_audit_created` check:
  - Call `claimMittiCreate(jobId, "install_day", …, { officeOverride })`.
  - Wrap `api.createAudit` with the same `seen` tracker used in `createAssignMittiAudit`.
  - On error, branch on `createOutcome(seen)`, mirroring `createAssignMittiAudit` lines 185–211.
- [ ] **Step 4: Update the hourly sender.** In `sweepPiisaAutoSend` (`src/lib/piisa-autosend.server.ts`), treat `MittiClaimHeld` and `MittiOutcomeUncertain` as "skip, retry sweep owns it". Do not log a new failure each hour. Add a test case: `autosend skips held install_day claim`.
- [ ] **Step 5: Run** the new tests, then `bun ./scripts/test-isolated.ts 8`. Expected: all PASS.
- [ ] **Step 6: Commit.** Message: `feat(mitti): install-day forms use the claim guard`.

### Task 2: Pure retry rules

**Files:**
- Create: `src/lib/mitti-retry.core.ts` (no I/O)
- Test: `tests/mitti-retry-core.test.ts`

**Interfaces:**
- Produces:
  - `MITTI_RETRY_FROM: string` (ISO), `RETRY_DELAY_MS = 120_000`, `MAX_RETRIES = 2`.
  - Event names:
    - `RETRY_STARTED_EVENT = "mitti_create_retry_started"`
    - `RETRY_LINKED_EVENT = "mitti_create_retry_linked"`
    - `ALERT_SENT_EVENT = "mitti_create_alert_sent"`
  - `type FailureCase = { jobId: string; kind: MittiFormKind; failedAt: string; reason: "uncertain" | "not_created"; detail: string }`.
  - `collectFailureCases(events: WorkflowEventRow[], now: Date): FailureCase[]`. One case per job+kind, using the latest failure after `MITTI_RETRY_FROM`. Cases resolved by a later `mitti_audit_created`, `mitti_piisa_audit_created`, `mitti_audit_linked`, `RETRY_LINKED_EVENT`, `mitti_access_override` or `ALERT_SENT_EVENT` for that kind are dropped.
    - Uncertain sources: `mitti_audit_create_uncertain`.
    - Not-created sources: `mitti_access_needed` with "could not be created", `piesa_autoform_failed`, `fixes_form_held` (released reason) and `PIISA_AUTOSEND_FAILED_EVENT` when not held.
  - `nextAction(c: FailureCase, retriesSoFar: { at: string }[], now: Date): "wait" | "search_then_retry" | "alert"`.
  - `matchAudits(audits: ParsedAudit[], want: { templateId: string; mittiOwnerUserId: string; jobNumber: string; siteAddress: string; homeownerName: string }): "one" | "none" | "many"`. A1 forms (no job number field) match on address and owner name; normalise case and whitespace.
  - `alertEmail(input): { subject: string; text: string; html: string }`, using the exact subject from Global Constraints.

- [ ] **Step 1: Write failing tests**
  - `nextAction`:
    - waits under 2 min
    - `search_then_retry` at 2 min with 0 retries
    - waits 2 min after retry 1
    - `search_then_retry` for retry 2
    - `alert` after 2 retries
    - `alert` at once for `not_created`
  - `collectFailureCases`:
    - ignores events before `MITTI_RETRY_FROM`
    - drops cases resolved by linked, created or override (Review Focus 3)
    - one case per job+kind
  - `matchAudits`:
    - ignores other jobs' forms modified after the failure (Review Focus 1)
    - A1 address and name match
    - 2 matches gives `"many"`
  - `alertEmail`: the subject is exactly `Mitti form not made: HV-3519 (Ready Check)`, and the body contains the job number, address, trade email and error.
- [ ] **Step 2: Run** `bun test tests/mitti-retry-core.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(mitti): pure retry rules`.

### Task 3: Office alert email sender

**Files:**
- Create: `src/lib/office-alert-email.server.ts`. It is its own sender module, not imported by any auto-advance code.
- Test: `tests/office-alert-email.test.ts`. Also check that `tests/comms.test.ts` still passes.

**Interfaces:**
- Produces: `sendMittiFailureAlert(jobId: string, kind: MittiFormKind, alertKey: string, content: {subject, text, html}): Promise<"sent" | "already_sent" | "paused" | "test_routed">`.
- Behaviour:
  - It first inserts `ALERT_SENT_EVENT` with id `stableUuid("mitti-alert:" + alertKey)`. This acts as the lock: a unique violation returns `"already_sent"`, so two sweeps can't both send.
  - If the master switch is off, or the send fails, it deletes that row again and returns `"paused"` (or throws on a send failure). The next minute's sweep then tries again.
  - qa_test jobs or TEST partners go through `sendTestEmail` to `TEST_ALLOWLIST` and return `"test_routed"`.
  - Real jobs send through the Resend gateway, from jobs@ to info@.

- [ ] **Step 1: Write failing tests**
  - `sends once`: two calls give 1 send and `"already_sent"`.
  - `paused when master switch off`: no send, no event left behind, and a later call with the switch on sends.
  - `send failure leaves no event`: the next call retries the send.
  - `test job goes to allowlist only`.
  - `never addresses owner or trade`: the recipient is always info@ or the allowlist.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** this test and `tests/comms.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(email): Mitti failure alert to info@`.

### Task 4: Retry sweep

**Files:**
- Create: `src/lib/mitti-retry.server.ts`
- Test: `tests/mitti-retry-sweep.test.ts`. Use the in-memory admin and `fakeMitti` from the t3 test, extended with `search: "ok" | "error"` returning chosen audits.

**Interfaces:**
- Consumes: Task 2's rules, Task 3's sender, `releaseMittiCreate`, `mittiApi(...).searchAudits/getAudit`, `parsePickupAudit`, `linkMittiReadyCheckToJob`, and the creators:
  - `createAssignMittiAudit` (ready_check / piesa)
  - `createFixesForm`
  - `createPiisaMittiAudit`
- Produces: `runMittiRetrySweep(opts?: { now?: Date; callFor?: (jobId) => MittiCall }): Promise<{ checked: number; linked: number; retried: number; alerted: number }>`.
- Per case:
  1. `"wait"`: skip.
  2. `"alert"`: build the content and call `sendMittiFailureAlert`, with key `${jobId}:${kind}:${failedAt}`.
  3. `"search_then_retry"`:
     - Search with `searchAudits(failedAt)`, then `getAudit` and `parsePickupAudit` each result.
     - `matchAudits` gives:
       - `"one"`: adopt it.
         - ready_check: `linkMittiReadyCheckToJob`.
         - piesa, fixes, install_day: store the id the same way each creator does on success, via a small `adoptExistingAudit(jobId, kind, auditId)` that reuses those writers.
         - Log `RETRY_LINKED_EVENT`.
       - `"many"`, or a search error: alert.
       - `"none"`:
         - Log `RETRY_STARTED_EVENT` `{kind, attempt}`.
         - `releaseMittiCreate(jobId, kind, claimId, null, "retry_after_search_found_nothing")`.
         - Call the creator.
         - A new uncertain or failure becomes the next attempt's `failedAt`.
- Clearing the office flag: a successful retry also logs `mitti_access_override` with summary `Retry made the form automatically`, so `mittiOfficeItems` clears it.

- [ ] **Step 1: Write failing tests** (the spec's testing list):
  1. `fail then retry works`: one form, flag cleared, no email.
  2. `lost reply`: search finds 1 form, it is linked, `creates()` is 0.
  3. `both retries fail`: exactly one email, flag still open.
  4. `trade not found`: no retry, email at once.
  5. `two sweeps at once make one form and one email` (Review Focus 4).
  6. Each of ready_check, piesa, fixes and install_day passes case 1.
  7. `search error emails and does not create` (Review Focus 2).
  8. `skips when office already fixed it` (Review Focus 3).
  9. `test job uses simulator and allowlist`.
- [ ] **Step 2: Run** `bun test tests/mitti-retry-sweep.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `runMittiRetrySweep` and `adoptExistingAudit`.
- [ ] **Step 4: Run** this test, then `bun ./scripts/test-isolated.ts 8`. Expected: all PASS.
- [ ] **Step 5: Commit.** Message: `feat(mitti): retry sweep`.

### Task 5: Cron route and go-live

**Files:**
- Create: `src/routes/api/public/hooks/mitti-retry.ts`. Copy `mitti-pull.ts`: `authenticateCronRequest`, then `runMittiRetrySweep()`, then return JSON counts.
- Test: `tests/mitti-retry-route.test.ts`. Expect 401 without the bearer, and 200 with counts when the bearer is right.

- [ ] **Step 1: Write the failing route test.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the route.** Set `MITTI_RETRY_FROM` to the deploy time.
- [ ] **Step 4: Run the full suite.** Expected: PASS.
- [ ] **Step 5: Practice run on the TEST Reinsulate job only.**
  - Force a simulator 500 on Ready Check creation.
  - Call the route by hand.
  - Confirm one form, flag cleared, no email.
  - Then force failures twice and confirm one email reaches the test allowlist only.
- [ ] **Step 6: Commit, then register the cron.** Commit message: `feat(mitti): retry cron route`. Then register the cron `hivic-mitti-retry`, `* * * * *`, with `/* lovable:authenticated-cron:v1 */ net.http_post` to `/api/public/hooks/mitti-retry`, through Lovable cron tooling. Do this only after Jo okays going live.
- [ ] **Step 7: Verify live.** Check that `cron.job` lists `hivic-mitti-retry` as active, and that the first run returns `checked: 0` (old flags ignored).
