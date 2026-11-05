# Recovery Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the portal reporting success while a card payment follow-up, refund, Spot saved email or Mitti form is still unfinished, by adding one still-to-finish list that the 15-minute tick works through.

**Architecture:** A new `recovery_work` table (pending SQL, PGlite-proven) with a pure rules core and a server module. The Stripe, Spot saved and tick paths add to it, tick items off and retry from it. The Mitti sweep pages its reads. `needs_office` items become derived Needs me rows and a read for the 6am report.

**Tech Stack:** TypeScript, TanStack Start, Supabase (PostgREST + RPC), Bun test, PGlite.

**Spec:** `docs/superpowers/specs/2026-11-05-recovery-paths-design.md`

## Global Constraints

- Read `AGENTS.md`, `src/AGENTS.md` and `src/lib/AGENTS.md` before editing. Run `bun scripts/scan-retired-terms.ts` before workflow work.
- No change to prices, payment steps, invoices, Xero, message wording, recipients or send timing.
- The ledger keeps one row per `receipt_key`. Money is never counted twice.
- Pending SQL lives in `docs/pending-migrations/recovery-work.sql` + `.rollback.sql`. It is proven on PGlite and never applied live without Jo's yes at that moment.
- Backoff is 5, 15, then 30 min. The 3rd failed attempt sets `status='needs_office'`.
- Needs me copy, exactly:
  - "Card payment saved but job not updated – {jobNumber}"
  - "Refund not matched to a payment – Stripe ref {paymentIntentId}"
  - "Spot saved email not sure it sent – {jobNumber}"
  - "Spot saved email not sent after 3 tries – {jobNumber}"
- Spot saved result details, exactly: "Already sent to this owner", "Not sent yet, will retry", "Not sure it sent", "Couldn't check".
- Joined reads page in 200-row pages / 200-id scopes. Any page error throws, with no partial results.
- TEST jobs (`source='qa_test'`) are left out of the 6am report lines.
- Every test uses mocks or PGlite. No network, no live database.

## Review Focus

1. Stripe delivers the same payment twice at the same moment while the follow-up is open → the follow-up runs once (claim via the RPC), one ledger row.
2. A refund for more than the recorded card amount arrives before the payment → once applied, it's capped at the paid amount (the existing `Math.min`), never negative money.
3. The `recovery_work` table is not deployed yet → webhook/email behave exactly as today (log only), no 500 loop.
4. The tick crashes mid-item → the item stays `open` with its lease expired and is picked up on the next tick, not lost.
5. An owner's email changes between the first try and the retry → the retry uses the current plan's address/key. A new key means a fresh item; the old item is marked done with `last_error='superseded'`.

---

### Task 1: The list's table, rules and SQL proof

**Files:**
- Create: `docs/pending-migrations/recovery-work.sql`, `docs/pending-migrations/recovery-work.rollback.sql`
- Create: `src/lib/recovery-work.core.ts`
- Create: `tests/helpers/pglite-recovery-work.ts`
- Test: `tests/recovery-work.core.test.ts`, `tests/recovery-work-practice-db.test.ts`

**Interfaces:**
- Produces:
  - `type RecoveryKind = "stripe_payment_followup" | "stripe_refund_waiting" | "spot_saved_email"`
  - `type RecoveryStatus = "open" | "done" | "needs_office"`
  - `RECOVERY_BACKOFF_MIN = [5, 15, 30]`
  - `RECOVERY_MAX_ATTEMPTS = 3`
  - `nextAfterFailure(attempts: number, now: Date): { status: RecoveryStatus; nextAttemptAt: string | null }`
  - SQL RPC `claim_recovery_work(p_limit int, p_lease_seconds int) returns setof recovery_work`. It uses `FOR UPDATE SKIP LOCKED` on `status='open' and next_attempt_at <= now()` and pushes `next_attempt_at` forward by the lease.

- [ ] **Step 1: Write failing core tests.** `nextAfterFailure(0, t)` → open, +5 min. `(1, t)` → open, +15 min. `(2, t)` → needs_office, null.
- [ ] **Step 2: Run** `bun test tests/recovery-work.core.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `recovery-work.core.ts`.
- [ ] **Step 4: Write the SQL.** Table columns as in the spec. Unique `(kind, work_key)`. RLS on with no user policies, granted to `service_role` only. Plus the claim RPC and the rollback.
- [ ] **Step 5: Write failing PGlite tests.** Apply then roll back cleanly. A duplicate `(kind, work_key)` insert → 23505. Two concurrent `claim_recovery_work(10, 120)` calls return disjoint rows. An expired lease is claimable again (Review Focus 4). `authenticated` can't select.
- [ ] **Step 6: Run** `bun test tests/recovery-work-practice-db.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `feat: recovery_work list (pending SQL, practice-proven)`.

### Task 2: List server module

**Files:**
- Create: `src/lib/recovery-work.server.ts`
- Test: `tests/recovery-work.server.test.ts`

**Interfaces:**
- Consumes: Task 1 core + RPC.
- Produces:
  - `addWork(kind: RecoveryKind, workKey: string, jobId: string | null, payload: Record<string, unknown>, opts?: { status?: RecoveryStatus; lastError?: string }): Promise<"added" | "exists" | "unavailable">`
  - `workStatus(kind, workKey): Promise<RecoveryStatus | null | "unavailable">`
  - `markDone(kind, workKey, note?: string): Promise<void>`
  - `markFailed(kind, workKey, error: string, now?: Date): Promise<RecoveryStatus>`
  - `runRecoveryWork(handlers: Record<RecoveryKind, (item: RecoveryItem) => Promise<void>>, now?: Date): Promise<{ done: number; failed: number; needsOffice: number }>`
  - `RecoveryItem = { kind; work_key; job_id; payload; attempts }`
- Table missing (PostgREST `42P01` / `PGRST205`) → `"unavailable"` and a `console.error`. Any other error throws (Review Focus 3).

- [ ] **Step 1: Write failing tests (mocked Supabase).**
  - `addWork` twice → "added" then "exists".
  - Table-missing error → "unavailable", no throw.
  - Other error → throws.
  - `runRecoveryWork`: handler resolves → done. Handler throws on attempt 3 → needs_office. A handler throwing does not stop the other items.
- [ ] **Step 2: Run** `bun test tests/recovery-work.server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Wire `markFailed` to `nextAfterFailure`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: recovery-work server module`.

### Task 3: Card payment follow-up resumes

**Files:**
- Modify: `src/lib/stripe.server.ts` (`recordStripePayment`, `applyAfterStripeChange`)
- Test: `tests/stripe-payment-followup-resume.test.ts`

**Interfaces:**
- Consumes: `addWork`, `workStatus`, `markDone` (Task 2).
- Produces: `finishStripePaymentFollowup(f: StripePaymentFact): Promise<"recorded">`. It runs the invoice lookup, `flagUnclearPaymentMatches`, `applyAfterStripeChange`, then `markDone("stripe_payment_followup", stripeReceiptKey(stripePaymentKey(f)))`. Task 7 uses it as the tick handler.

- [ ] **Step 1: Write failing tests** (pattern: `tests/stripe-webhook-modes.test.ts` mocks).
  - `followup_cut_off_then_redelivered`: first call throws inside `afterPaymentsChanged` after the ledger insert. The second call with the same fact returns "recorded", `afterPaymentsChanged` ran on the second call, and the ledger has exactly 1 row.
  - `followup_done_then_redelivered`: returns "duplicate" and `afterPaymentsChanged` is not called again.
  - `concurrent_redelivery`: two parallel calls while open → `afterPaymentsChanged` completes once (`workStatus` re-read after the claim; Review Focus 1).
  - `rerun_is_harmless`: running `finishStripePaymentFollowup` twice leaves the same `once` events and the same `applyPaidAmount` total.
- [ ] **Step 2: Run** `bun test tests/stripe-payment-followup-resume.test.ts`. Expected: FAIL on the first test (duplicate skips follow-up).
- [ ] **Step 3: Implement.**
  - `addWork` before `insertLedgerEvent`. "unavailable" carries on as today.
  - On a fast-path or 23505 duplicate: check `workStatus`. If open/needs_office → `finishStripePaymentFollowup`. Otherwise → "duplicate".
  - Then call `applyWaitingRefunds(paymentIntentId)` (Task 4) after a fresh record.
- [ ] **Step 4: Run** the new tests plus `bun test tests/stripe-webhook-modes.test.ts tests/stripe.core.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: card payment retries finish invoice and job updates`.

### Task 4: Early refunds wait, database errors retry

**Files:**
- Modify: `src/lib/stripe.server.ts` (`recordStripeRefund`, `recordStripePayment` invoice read)
- Test: `tests/stripe-refund-waiting.test.ts`

**Interfaces:**
- Consumes: `addWork`, `markDone` (Task 2).
- Produces:
  - `applyWaitingRefunds(paymentIntentId: string): Promise<number>`
  - `retryWaitingRefund(item: RecoveryItem): Promise<void>`. It throws while the payment is still unknown. Task 7 uses it as the tick handler.

- [ ] **Step 1: Write failing tests.**
  - `refund_before_payment_is_kept`: unknown PaymentIntent → outcome "refund_waiting" and the item added with the refund fact.
  - `refund_applied_when_payment_arrives`: then record the payment → one `owner_payment_reversed` row, item done.
  - `refund_capped`: refund 50000 on a 34900 payment → reversal 34900 (Review Focus 2).
  - `invoice_lookup_timeout_is_500`: a Supabase `{ error }` on the invoice read in `recordStripePayment` → `handleStripeWebhook` throws → route 500.
  - `refund_lookup_timeout_is_500`: same for the `workflow_events` read in `recordStripeRefund`.
- [ ] **Step 2: Run** `bun test tests/stripe-refund-waiting.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check `error` on every read in both functions and throw. An unknown payment with no error → `addWork("stripe_refund_waiting", stripeRefundReceiptKey(pi, refundedCents), null, fact)` and return `"refund_waiting"`.
- [ ] **Step 4: Run** the new tests plus the Task 3 tests. Expected: PASS.
- [ ] **Step 5: Commit** `fix: keep early refunds and retry on database errors`.

### Task 5: Spot saved email tells the truth

**Files:**
- Modify: `src/lib/spot-saved-send.server.ts` (`sendEmail`, `alreadyCheck`, the `spotSavedEmailAlreadySent` call site)
- Test: `tests/spot-saved-send-truth.test.ts`

**Interfaces:**
- Consumes: `addWork`, `markDone` (Task 2).
- Produces: `retrySpotSavedEmail(item: RecoveryItem): Promise<void>`. It calls `sendSpotSavedConfirmation(item.job_id, { emailOnly: true })` and throws unless the email status is `sent`/`already`. If the plan's key ≠ `item.work_key` → `markDone(..., "superseded")` and a new item (Review Focus 5). Task 7 uses it as the tick handler.

- [ ] **Step 1: Write failing tests.**
  - `timeout_before_send_is_retry`: the reservation insert returns a non-23505 error → email status `retry`, detail "Not sent yet, will retry", the provider is not called, and the item is added.
  - `already_only_when_sent`: 23505 + existing row status `sent` → "Already sent to this owner".
  - `failed_row_resends_once`: 23505 + status `failed` → the provider is called once with the same key, and the row is updated to `sent`.
  - `started_no_outcome_is_uncertain`: 23505 + status null or `delivered_unrecorded` → no provider call, detail "Not sure it sent", item `needs_office`.
  - `dry_read_error`: `alreadyCheck` read error → "Couldn't check".
  - `tick_sends_once`: `retrySpotSavedEmail` after a timeout → one provider call, item done.
- [ ] **Step 2: Run** `bun test tests/spot-saved-send-truth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** For "Not sure it sent", call `addWork(..., { status: "needs_office", lastError: "uncertain" })`.
- [ ] **Step 4: Run** the new tests plus `bun test tests/spot-saved-send.test.ts tests/spot-saved-recovery-isolated.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: Spot saved email only says Already sent when it was`.

### Task 6: Mitti sweep sees every job

**Files:**
- Modify: `src/lib/mitti-autoform.server.ts` (`sweepReadyCheckForms`)
- Test: `tests/mitti-autoform-paging.test.ts`

**Interfaces:**
- Produces: no new exports. Same return shape `{ checked, results, wouldCreate }`.

- [ ] **Step 1: Write failing tests** (mocked Supabase honouring `.range`).
  - `job_501_is_found`: 501 booked HIV leads and only #501 has no current measurement → dry run `wouldCreate` = [#501].
  - `installer_jobs_page_too`: same with 501 installer-sourced jobs.
  - `page_error_throws`: an error on page 2 → throws, no results.
  - `cap_spent_on_needed_only`: `AUTOFORM_MAX_PER_TICK`+5 measured jobs before 1 unmeasured → the unmeasured one is created.
- [ ] **Step 2: Run** `bun test tests/mitti-autoform-paging.test.ts`. Expected: FAIL on `job_501_is_found`.
- [ ] **Step 3: Implement.** Use a local `paged()` helper in the style of `upgrades-watch.server.ts`, ordered `created_at, id`, with fact reads in 200-id scopes. Drop measured jobs (same rule as `autoFormDecision`) before the loop.
- [ ] **Step 4: Run** the new tests plus `bun test tests/mitti-autoform.test.ts tests/owner-link-and-mitti-auto.test.ts tests/decision-398-piesa-autoform.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: Mitti sweep pages through every booked job`.

### Task 7: Tick, Needs me and 6am report

**Files:**
- Modify: `src/routes/api/public/hooks/allocation-tick.ts` (new try-block after `sweepReadyCheckForms`)
- Create: `src/lib/recovery-needs.core.ts`, `src/lib/recovery-needs.server.ts`
- Modify: `src/lib/office-needs.core.ts` (`NeedsFacts.recovery`, row add), `src/lib/office-needs.server.ts` (facts read), the Needs me page component that renders rows (add a "Not linked to a job" group for job-less rows)
- Modify: `src/lib/portal.functions.ts` (admin-only `recoveryTryAgain`, `recoveryMarkSorted`, `recoveryReportLines`)
- Test: `tests/recovery-needs.test.ts`, `tests/recovery-tick.test.ts`

**Interfaces:**
- Consumes: `runRecoveryWork` (Task 2), `finishStripePaymentFollowup` (Task 3), `retryWaitingRefund` (Task 4), `retrySpotSavedEmail` (Task 5).
- Produces:
  - `recoveryNeedsLine(item): string` (the exact Global Constraints copy; "not after 3 tries" vs "not sure" decided by `last_error === "uncertain"`)
  - `recoveryNeedsFacts(jobIds: string[]): Promise<Map<string, RecoveryItem[]>>`
  - `joblessRecoveryRows(): Promise<RecoveryItem[]>`
  - `recoveryReportLines(): Promise<string[]>` (needs_office only, `qa_test` excluded)
  - Admin server fns: `recoveryTryAgain({ kind, workKey })` → open, attempts 0, due now. `recoveryMarkSorted({ kind, workKey })` → done plus an `admin_config_events` row `recovery_marked_sorted`.

- [ ] **Step 1: Write failing tests.**
  - Each kind → its exact line. A done item → no row.
  - A job-less refund → "Not linked to a job" group with the Stripe ref.
  - `recoveryReportLines` leaves out a qa_test job's item.
  - The tick block calls `runRecoveryWork` with all 3 handlers, and a thrown sweep sets `out.recovery = "failed"` without stopping later sweeps.
  - Try again / Mark sorted refuse non-admins.
- [ ] **Step 2: Run** `bun test tests/recovery-needs.test.ts tests/recovery-tick.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Rows are derived (not stored), rank 9, group "today", button "Open job" (job rows) / "Try again" + "Mark sorted".
- [ ] **Step 4: Run** the new tests plus `bun test tests/office-needs-me.test.ts tests/office-needs-snapshot.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: still-to-finish items on the tick, Needs me and the 6am report`.

### Task 8: Whole check and hand-off

- [ ] **Step 1: Run** `bun scripts/scan-retired-terms.ts`. Expected: no new hits.
- [ ] **Step 2: Run** `bun test ./tests/`. Expected: no new failures against the `a274d76` baseline. Record the baseline failures first and list them in the PR.
- [ ] **Step 3: Run** `bunx tsc --noEmit` and `bun run lint`. Expected: clean for the changed files.
- [ ] **Step 4:** Open a PR with the spec, plan, SQL and evidence (use `supermatt:pr` body shape). Do not merge. Jo picks who merges.
- [ ] **Step 5:** Ask Jo before applying `recovery-work.sql` live. After she says yes, apply it, journal it in `drizzle/migrations/`, and archive it to `docs/applied-migrations/`.
- [ ] **Step 6:** Ask Jo before changing her 6am report so it calls `recoveryReportLines`.
