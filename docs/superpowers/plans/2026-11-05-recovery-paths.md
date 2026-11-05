# Recovery Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portal never report "done" or "all clear" while a VEEC copy, signature, quote total, estimate, stage check, Xero balance or link, card payment, refund, email, Mitti form or text is unfinished, unreadable or wrong.

**Architecture:** There's one `recovery_work` list (pending SQL, PGlite-proven) that the 15-minute tick works through, with a pure rules core. Writes that must happen together move into single-transaction RPCs (VEEC completion, quote adjustment, estimate replacement). Every read on these paths checks its error, and a failure throws, pauses or blocks; it never counts as empty or zero. Problems become derived Needs me rows and 6am report lines.

**Tech Stack:** TypeScript, TanStack Start, Supabase (PostgREST + RPC), Bun test, PGlite.

**Spec:** `docs/superpowers/specs/2026-11-05-recovery-paths-design.md`

## Global Constraints

- Read `AGENTS.md`, `src/AGENTS.md` and `src/lib/AGENTS.md` (plus any nested `AGENTS.md`) before editing. Run `bun scripts/scan-retired-terms.ts` before workflow work.
- No change to prices, payment steps, invoice content, Xero payloads, message wording, recipients or send timing.
- The ledger keeps one row per `receipt_key`. Money is never counted twice. A message whose outcome is unclear is never re-sent.
- Every pending SQL file goes in `docs/pending-migrations/<name>.sql` + `<name>.rollback.sql`, is proven on PGlite, and is never applied live without Jo's yes at that moment. Files: `recovery-work`, `complete-veec-assignment`, `apply-quote-adjustment`, `replace-current-estimate` (+ `sms-not-sent-status` only if `sms_messages.status` has a check constraint).
- Backoff is 5, 15, then 30 min. The 3rd failed attempt sets `status='needs_office'`.
- Needs me copy, exactly:
  - "Card payment saved but job not updated – {jobNumber}"
  - "Refund not matched to a payment – Stripe ref {paymentIntentId}"
  - "Spot saved email not sure it sent – {jobNumber}" / "Spot saved email not sent after 3 tries – {jobNumber}"
  - "Signed VEEC copy couldn't be saved – {jobNumber}"
  - "Signed VEEC copy email not sure it sent – {jobNumber}" / "Signed VEEC copy email not sent after 3 tries – {jobNumber}"
  - "Quote totals don't add up – {jobNumber}"
  - "Estimate refresh failed – {jobNumber}"
  - "Xero invoice match unclear – {jobNumber} ({invoiceNumbers joined ', '})"
  - "Text reply – which job? {jobNumbers joined ' or '}"
- Person-facing text, exactly:
  - "Your signature didn't save – please try again."
  - "Couldn't check for changes – try again."
  - "This quote was changed by someone else – reload"
  - Stage blocker: "Couldn't verify {what}. {Stage name} is paused. Please try again." (e.g. "Couldn't verify outstanding electrical fixes. Installation booking is paused. Please try again.")
  - Xero: "Xero gave no usable invoice – balance not changed"
- Spot saved details, exactly: "Already sent to this owner", "Not sent yet, will retry", "Not sure it sent", "Couldn't check".
- Settled invoices stay in the Xero poll for 90 days after `balance_paid_at`.
- Joined reads page in 200-row pages / 200-id scopes. Any page error throws, with no partial results.
- TEST jobs (`source='qa_test'`) are left out of 6am report lines.
- Tests use mocks or PGlite only. No network, no live database.

## Review Focus

1. Two deliveries/ticks hit the same item at once → the work runs once (RPC claim / conditional update), and there's one ledger/send/event.
2. The new SQL isn't deployed yet → each path behaves exactly as today and logs. No 500 loop, nothing half-on.
3. A refund larger than the card payment arrives early → when applied, it's capped at the paid amount.
4. A tick crashes mid-item → the lease expires and the next tick picks it up.
5. An owner's email/phone changes between attempt and retry → the retry uses the current key. The old item is marked done with `last_error='superseded'`.

---

### Task 1: The list's table, rules and SQL proof

**Files:** Create `docs/pending-migrations/recovery-work.sql` (+ `.rollback.sql`), `src/lib/recovery-work.core.ts`, `tests/helpers/pglite-recovery-work.ts`. Test `tests/recovery-work.core.test.ts`, `tests/recovery-work-practice-db.test.ts`.

**Interfaces — Produces:**
- `type RecoveryKind = "veec_final_copy" | "veec_copy_email" | "stripe_payment_followup" | "stripe_refund_waiting" | "spot_saved_email"`
- `type RecoveryStatus = "open" | "done" | "needs_office"`
- `RECOVERY_BACKOFF_MIN = [5, 15, 30]`, `RECOVERY_MAX_ATTEMPTS = 3`
- `nextAfterFailure(attempts: number, now: Date): { status: RecoveryStatus; nextAttemptAt: string | null }`
- SQL table `recovery_work` (columns per spec), unique `(kind, work_key)`, RLS on, `service_role` only
- RPC `claim_recovery_work(p_limit int, p_lease_seconds int) returns setof recovery_work`: `FOR UPDATE SKIP LOCKED` on `status='open' and next_attempt_at <= now()`, bumping `next_attempt_at` by the lease

- [ ] **Step 1: Failing core tests.** `nextAfterFailure(0,t)` → open, +5 min. `(1,t)` → open, +15 min. `(2,t)` → needs_office, null.
- [ ] **Step 2: Run** `bun test tests/recovery-work.core.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the core and the SQL.
- [ ] **Step 4: Failing PGlite tests.** Apply/rollback is clean. A duplicate key → 23505. Two concurrent claims are disjoint. An expired lease is reclaimable (RF4). `authenticated` can't select.
- [ ] **Step 5: Run** both tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat: recovery_work list (pending SQL, practice-proven)`.

### Task 2: List server module

**Files:** Create `src/lib/recovery-work.server.ts`. Test `tests/recovery-work.server.test.ts`.

**Interfaces — Produces:**
- `addWork(kind, workKey: string, jobId: string | null, payload: Record<string, unknown>, opts?: { status?: RecoveryStatus; lastError?: string }): Promise<"added" | "exists" | "unavailable">`
- `workStatus(kind, workKey): Promise<RecoveryStatus | null | "unavailable">`
- `markDone(kind, workKey, note?: string): Promise<void>`
- `markFailed(kind, workKey, error: string, now?: Date): Promise<RecoveryStatus>`
- `type RecoveryItem = { kind: RecoveryKind; work_key: string; job_id: string | null; payload: Record<string, unknown>; attempts: number; status: RecoveryStatus; last_error: string | null }`
- `runRecoveryWork(handlers: Record<RecoveryKind, (item: RecoveryItem) => Promise<void>>, now?: Date): Promise<{ done: number; failed: number; needsOffice: number }>`
- A table-missing error (`42P01` / `PGRST205`) → `"unavailable"` + `console.error`. Other errors throw (RF2).

- [ ] **Step 1: Failing tests (mocked Supabase).** `addWork` twice → added/exists. Table missing → unavailable. Other error → throws. `runRecoveryWork`: resolve → done; throw on the 3rd attempt → needs_office; one throwing handler doesn't stop the others.
- [ ] **Step 2: Run** `bun test tests/recovery-work.server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: recovery-work server module`.

### Task 3: Signed VEEC copy, completion and variation check

**Files:** Modify `src/lib/assignment.server.ts` (`storeCopy`, `evaluateAndApply`, the variation count in `signFinalAssignment`). Create `docs/pending-migrations/complete-veec-assignment.sql` (+ rollback), `tests/helpers/pglite-veec-complete.ts`. Test `tests/veec-final-copy-recovery.test.ts`, `tests/veec-complete-practice-db.test.ts`.

**Interfaces:**
- Consumes: `addWork` (Task 2).
- Produces:
  - `storeCopy(...)` (same params) → `Promise<{ ok: true; path: string } | { ok: false; reason: string }>`. An upload error **or** a `documents` insert error → `ok: false`.
  - RPC `complete_veec_assignment(p_assignment_id uuid, p_job_id uuid, p_path text, p_effective_at timestamptz, p_delivery text, p_sha256 text, p_actor uuid) returns boolean` (false if already complete).
  - `evaluateAndApply` keeps its signature. Task 18's `veec_final_copy` handler calls `evaluateAndApply(item.job_id, null)` and throws unless the assignment is now `effective_complete`.

- [ ] **Step 1: Failing tests.**
  - `upload_fails_no_pass`: status unchanged, no compliance update, no `VEEC_ASSIGNMENT_EFFECTIVE`, `addWork('veec_final_copy', assignmentId, …)`.
  - `documents_insert_fails_no_pass`.
  - `rpc_error_records_nothing`.
  - `variation_count_error_sign` → "Couldn't check for changes – try again.".
  - `variation_count_error_complete` → status unchanged + work added.
  - `nonfinal_status_update_error_throws`.
- [ ] **Step 2: Failing PGlite tests.** The RPC writes all three or none (force a compliance failure → no assignment change). A second call → false, nothing duplicated.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.** If the RPC is missing (`PGRST202`): log and keep today's three writes, but check each error (RF2).
- [ ] **Step 5: Run** the new tests plus `bun test tests/a48-b1-*.test.ts tests/activity48-agreement-signing.test.ts`. Expected: no new failures vs baseline.
- [ ] **Step 6: Commit** `fix: VEEC assignment only completes with a stored signed copy`.

### Task 4: Signatures must save before "signed"

**Files:** Modify `src/lib/assignment.server.ts` (`signCustomerAgreement`, `signInstallerDecl`, `signFinalAssignment`, `writeApSignature`, `reconfirmVariation`). Test `tests/signature-save-check.test.ts`.

**Interfaces:** No new exports. Each signature write uses `.select("id")`. An error or 0 rows → `WorkflowError("Your signature didn't save – please try again.")` before any `logEvent`.

- [ ] **Step 1: Failing tests.** One per function: a write error → that exact error, no signed event. A 0-row write → same.
- [ ] **Step 2: Run** `bun test tests/signature-save-check.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests plus `bun test tests/acceptance-signature.test.ts tests/activity48-agreement-signing.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: only log signed when the signature saved`.

### Task 5: Signed-copy email retries and repair

**Files:** Modify `src/lib/veec-copy-email.server.ts`. Test `tests/veec-copy-email-recovery.test.ts`.

**Interfaces:**
- Consumes: `addWork`, `markDone` (Task 2). `sendGuardedOwnerEmail({ …, retryAfterDefiniteFailure: true })`.
- Produces: `repairVeecCopyEmail(jobId: string): Promise<"repaired" | "needs_office" | string>`. It reads `customer_email_sends` for key `veec-copy:v1:<assignmentId>`:
  - sent → set `copy_sent_at` = row `sent_at` + log `veec_copy_email_sent` once
  - failed / no row → `sendVeecCopyEmail`
  - unclear → `addWork(..., { status: "needs_office", lastError: "uncertain" })`
- `markSent` checks the `copy_sent_at` update error before logging. On error → `addWork('veec_copy_email', assignmentId, jobId, {})`.

- [ ] **Step 1: Failing tests.**
  - `rejected_then_retried`.
  - `date_save_fails_no_event`.
  - `repair_sets_date_without_send`.
  - `unclear_flags_office_no_send`.
- [ ] **Step 2: Run** `bun test tests/veec-copy-email-recovery.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `fix: signed VEEC copy email retries and repairs safely`.

### Task 6: Quote edits save whole, totals checked before sending

**Files:** Modify `src/lib/quotes.server.ts` (`adjustQuote`) and every owner-send point for quotes (office Send, `releaseQueuedQuotes`, auto-send; find them with `grep -rn "sent_at:" src/lib/*quote*.server.ts`). Create `src/lib/quote-totals.core.ts`, `docs/pending-migrations/apply-quote-adjustment.sql` (+ rollback), `tests/helpers/pglite-quote-adjust.ts`. Test `tests/quote-adjust-atomic.test.ts`, `tests/quote-totals.core.test.ts`, `tests/quote-adjust-practice-db.test.ts`.

**Interfaces — Produces:**
- `quoteTotalsMismatch(q: { subtotal_inc_gst: number; veec_discount_inc_gst: number; customer_total_inc_gst: number }, items: { line_total_inc_gst: number }[]): string | null` (±0.01)
- RPC `apply_quote_adjustment(p_quote_id uuid, p_expected_version int, p_items jsonb, p_totals jsonb, p_release jsonb, p_adjustment jsonb) returns jsonb`. It raises `version_conflict` when the version moved.
- `holdForTotals(quoteId: string, jobId: string, reason: string): Promise<void>` sets `release_state='held'`, `release_hold_reason="Quote totals don't add up"` and logs `quote_totals_mismatch` (needs_office).

- [ ] **Step 1: Failing tests.**
  - `rejected_discount_saves_nothing` ($3,000 → $3,200, invalid discount → items unchanged).
  - `item_read_timeout_no_zero`.
  - `version_conflict_message`.
  - Core: match → null; lines ≠ subtotal → reason; subtotal − rebate ≠ owner price → reason.
  - `send_holds_on_mismatch` at each send point.
- [ ] **Step 2: Failing PGlite tests.** All-or-nothing (force the `quote_adjustments` insert to fail → items unchanged). Stale version → `version_conflict`.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.** Validate fully in memory, then one RPC call, then events.
- [ ] **Step 5: Run** the new tests plus `bun test tests/*quote*.test.ts`. Expected: no new failures.
- [ ] **Step 6: Commit** `fix: quote edits save lines and total together; totals checked before sending`.

### Task 7: Owner estimate refresh keeps the last good estimate

**Files:** Modify `src/lib/estimate.server.ts` (`refreshIndicativeEstimate`) and its owner-link callers (`grep -rn "refreshIndicativeEstimate" src`). Create `docs/pending-migrations/replace-current-estimate.sql` (+ rollback), `tests/helpers/pglite-estimate-replace.ts`. Test `tests/estimate-refresh-failsafe.test.ts`, `tests/estimate-replace-practice-db.test.ts`.

**Interfaces — Produces:**
- `class EstimateRefreshFailed extends Error`
- RPC `replace_current_estimate(p_job_id uuid, p_expected_current_id uuid, p_row jsonb) returns uuid` (null expected = none current)
- Callers: catch → show the current estimate + `logEvent(jobId, null, "estimate_refresh_failed", …, { needs_office: true })`, at most once per job per hour

- [ ] **Step 1: Failing tests.**
  - `measurement_timeout_keeps_140`: current 140 m², measurement read error, owner guess 90 → `EstimateRefreshFailed`, no write, the caller shows 140.
  - `insert_fails_old_stays_current`.
  - Area-estimate / postcode / settings / history read errors → `EstimateRefreshFailed`.
- [ ] **Step 2: Failing PGlite tests.** Exactly one current row after a replace. A stale expected id → error, nothing changed.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** the new tests plus `bun test tests/*estimate*.test.ts tests/my-job-spot-saved.test.ts`. Expected: no new failures.
- [ ] **Step 6: Commit** `fix: estimate refresh never loses or reverts the owner's estimate`.

### Task 8: Stage checks never pass on a failed read

**Files:** Modify `src/lib/autoadvance.server.ts` (`count` and the facts read) and `src/lib/workflow.server.ts` (`stageEntryBlockers`: every read). Create `src/lib/stage-read.core.ts`. Test `tests/stage-checks-unreadable.test.ts`.

**Interfaces — Produces:**
- `unreadableBlocker(what: string, stageName: string): string` → "Couldn't verify {what}. {stageName} is paused. Please try again."
- `count()` throws `StageFactsUnreadable(what)` on a query error. The auto-advance caller keeps the stage and logs `stage_check_unreadable` (needs_office, once per job per hour).
- Every read in `stageEntryBlockers` checks `error`. On error it pushes `unreadableBlocker(...)`.

- [ ] **Step 1: Failing tests.**
  - `fixes_count_timeout_blocks_booking`: 2 required items + read error → blockers include "Couldn't verify outstanding electrical fixes. Installation booking is paused. Please try again." and the stage doesn't move.
  - `compliance_read_timeout_blocks_veec`: → "Couldn't verify compliance checks. Ready for VEEC is paused. Please try again.".
  - `lodgement_read_timeout_blocks_complete`.
  - `readable_paths_unchanged` (existing blockers identical).
- [ ] **Step 2: Run** `bun test tests/stage-checks-unreadable.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The `{what}` labels per read live next to each read. Stage names come from the existing stage label helper.
- [ ] **Step 4: Run** the new tests plus `bun test tests/a4-clearance-guard.test.ts tests/a48-b1-piesa-enforce.test.ts tests/*stage*.test.ts tests/*autoadvance*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `fix: stage checks pause when records can't be read`.

### Task 9: Empty Xero answers change nothing

**Files:** Modify `src/lib/xero.server.ts` (`syncInvoiceFromXero`), `src/lib/payments.server.ts` / `payments.core.ts` (the reversal guard in `recordXeroPayments` / `xeroReversals`). Test `tests/xero-empty-answer.test.ts`.

**Interfaces — Produces:**
- `syncInvoiceFromXero(...): Promise<{ ok: true } | { ok: false; reason: string }>`. Existing callers that ignored the return still work.
- `usableXeroInvoice(x: unknown, expectedId: string): x is { InvoiceID: string; AmountPaid: number }`
- Reversals only when `Payments` is an array whose sum equals `AmountPaid` (±0.01).

- [ ] **Step 1: Failing tests.**
  - `no_invoice_no_change`: `{ Invoices: [] }` → `{ ok: false, reason: "Xero gave no usable invoice – balance not changed" }`, no `applyPaidAmount`, no reversal rows.
  - `wrong_invoice_id_no_change`.
  - `missing_amount_paid_no_change`.
  - `short_payments_list_no_reversal`.
  - `normal_answer_unchanged`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Records a sync failure (existing `syncLog`/`last_sync_error`) without touching `status`/`total_paid`.
- [ ] **Step 4: Run** the new tests plus `bun test tests/*xero*.test.ts tests/*payment*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `fix: an empty Xero answer never changes a balance`.

### Task 10: Xero invoice matching must be unambiguous

**Files:** Modify `src/lib/xero.core.ts` (`findInvoiceByReference`), `src/lib/xero.server.ts` (`pushInvoiceToXero`). Test `tests/xero-invoice-match.test.ts`.

**Interfaces — Produces:**
- `findInvoiceByReference(call, reference, excludeInvoiceIds, expect: { total: number; contactId: string | null })` → `{ kind: "none" } | { kind: "match"; invoice } | { kind: "conflict"; candidates: { invoiceId: string; number: string | null; contactId: string | null; total: number; status: string }[] }`
- `class XeroInvoiceConflict extends Error`. On a conflict `pushInvoiceToXero` logs `xero_invoice_match_unclear` (needs_office, candidates) once per candidate set, creates nothing and throws.

- [ ] **Step 1: Failing tests.**
  - `two_same_reference_conflict` ($500 other contact first, $3,500 correct → conflict, no link, no POST).
  - `single_wrong_total_conflict`.
  - `single_wrong_contact_conflict`.
  - `single_exact_match_links`.
  - `none_creates_as_today`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests plus `bun test tests/*xero*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `fix: only link a Xero invoice on an unambiguous match`.

### Task 11: Xero payment check counts failures and keeps settled invoices

**Files:** Modify `src/lib/xero.server.ts` (`pollXeroPayments`), `src/lib/xero.core.ts` (`xeroPollEligible`, `pickXeroPollBatch`). Test `tests/xero-poll-summary.test.ts`.

**Interfaces:**
- Consumes: `syncInvoiceFromXero` result (Task 9).
- Produces:
  - `pollXeroPayments(...)` → `{ enabled, checked, failed, failedInvoices: { invoiceId: string; jobNumber: string | null; reason: string }[] }`
  - `XERO_POLL_SETTLED_DAYS = 90`. The query includes `balance_paid_at is null or balance_paid_at >= now − 90d`. Unpaid invoices are ordered first, then settled ones.

- [ ] **Step 1: Failing tests.**
  - `timeout_counts_failed` (sync returns ok:false → failed 1, listed).
  - `throw_counts_failed`.
  - `old_fixes_voided_ok`.
  - `settled_invoice_still_checked` (paid 10 days ago is in the batch; 100 days ago is not).
  - `unpaid_before_settled`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests plus `bun test tests/*xero*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: Xero payment check reports every failure and still checks paid invoices`.

### Task 12: Card payment follow-up resumes

**Files:** Modify `src/lib/stripe.server.ts` (`recordStripePayment`, `applyAfterStripeChange`). Test `tests/stripe-payment-followup-resume.test.ts`.

**Interfaces:**
- Consumes: `addWork`, `workStatus`, `markDone` (Task 2). `applyWaitingRefunds` (Task 13).
- Produces: `finishStripePaymentFollowup(f: StripePaymentFact): Promise<"recorded">` (the invoice read with error check → `flagUnclearPaymentMatches` → `applyAfterStripeChange` → `markDone("stripe_payment_followup", stripeReceiptKey(stripePaymentKey(f)))`).

- [ ] **Step 1: Failing tests** (pattern: `tests/stripe-webhook-modes.test.ts`).
  - `followup_cut_off_then_redelivered` (1 ledger row, follow-up completes on the 2nd delivery).
  - `followup_done_then_redelivered` → "duplicate".
  - `concurrent_redelivery` (RF1).
  - `rerun_is_harmless`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `addWork` before `insertLedgerEvent` ("unavailable" → as today). On a duplicate while the item is open/needs_office → `finishStripePaymentFollowup`. After a fresh record → `applyWaitingRefunds`.
- [ ] **Step 4: Run** the new tests plus `bun test tests/stripe-webhook-modes.test.ts tests/stripe.core.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: card payment retries finish invoice and job updates`.

### Task 13: Early refunds wait, database errors retry

**Files:** Modify `src/lib/stripe.server.ts` (`recordStripeRefund`, the reads in `recordStripePayment`). Test `tests/stripe-refund-waiting.test.ts`.

**Interfaces — Produces:** `applyWaitingRefunds(paymentIntentId: string): Promise<number>`, `retryWaitingRefund(item: RecoveryItem): Promise<void>` (throws while the payment is unknown).

- [ ] **Step 1: Failing tests.**
  - `refund_before_payment_is_kept` → "refund_waiting".
  - `refund_applied_when_payment_arrives`.
  - `refund_capped` (50000 on 34900 → 34900, RF3).
  - `invoice_lookup_timeout_is_500`.
  - `refund_lookup_timeout_is_500`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Check every read's error and throw. Unknown payment → `addWork("stripe_refund_waiting", stripeRefundReceiptKey(pi, refundedCents), null, fact)`.
- [ ] **Step 4: Run** the new tests plus the Task 12 tests. Expected: PASS.
- [ ] **Step 5: Commit** `fix: keep early refunds and retry on database errors`.

### Task 14: Spot saved email tells the truth

**Files:** Modify `src/lib/spot-saved-send.server.ts` (`sendEmail`, `alreadyCheck`, the `spotSavedEmailAlreadySent` call site). Test `tests/spot-saved-send-truth.test.ts`.

**Interfaces — Produces:** `retrySpotSavedEmail(item: RecoveryItem): Promise<void>`. It calls `sendSpotSavedConfirmation(item.job_id, { emailOnly: true })` and throws unless the email status is sent/already. A key mismatch → `markDone(..., "superseded")` + a new item (RF5).

- [ ] **Step 1: Failing tests.**
  - `timeout_before_send_is_retry` → "Not sent yet, will retry", provider not called, item added.
  - `already_only_when_sent`.
  - `failed_row_resends_once`.
  - `started_no_outcome_is_uncertain` → "Not sure it sent", needs_office.
  - `dry_read_error` → "Couldn't check".
  - `tick_sends_once`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests plus `bun test tests/spot-saved-send.test.ts tests/spot-saved-recovery-isolated.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: Spot saved email only says Already sent when it was`.

### Task 15: Mitti sweep sees every job

**Files:** Modify `src/lib/mitti-autoform.server.ts` (`sweepReadyCheckForms`). Test `tests/mitti-autoform-paging.test.ts`.

**Interfaces:** No new exports, same return shape.

- [ ] **Step 1: Failing tests** (mock honouring `.range`).
  - `job_501_is_found`.
  - `installer_jobs_page_too`.
  - `page_error_throws`.
  - `cap_spent_on_needed_only`.
- [ ] **Step 2: Run.** Expected: FAIL on `job_501_is_found`.
- [ ] **Step 3: Implement.** Use a local `paged()` (style of `upgrades-watch.server.ts`), ordered `created_at, id`, fact reads in 200-id scopes, and drop measured jobs before the loop.
- [ ] **Step 4: Run** the new tests plus `bun test tests/mitti-autoform.test.ts tests/owner-link-and-mitti-auto.test.ts tests/decision-398-piesa-autoform.test.ts`. Expected: no new failures (`mitti-autoform.test.ts` "wired into the 15-minute tick" already fails at baseline).
- [ ] **Step 5: Commit** `fix: Mitti sweep pages through every booked job`.

### Task 16: Text replies go to the right job

**Files:** Modify `src/lib/sms.server.ts` (`recordInboundReply`). Create `src/lib/sms-reply-match.core.ts`. Test `tests/sms-reply-match.test.ts`.

**Interfaces — Produces:**
- `SMS_REPLY_CANDIDATE_STATUSES = ["sent","delivered","queued","sent_unknown","undelivered"]`
- `pickReplyJob(texts: { job_id: string; status: string; created_at: string }[], openJobIds: Set<string>, now: Date)` → `{ kind: "job"; jobId: string } | { kind: "ambiguous"; jobIds: string[] } | { kind: "none" }`. Candidates only, 30-day window for the open-job count. 1 open → that job; 0 open → latest candidate's job; 2+ → ambiguous.
- Ambiguous → `admin_config_events` `sms_reply_unmatched` `{ body, sid, phone, job_ids }`. Admin fn `fileSmsReply({ eventId, jobId })` files it on that job and records `sms_reply_filed`.

- [ ] **Step 1: Failing tests.**
  - `blocked_for_B_files_on_A`.
  - `two_open_jobs_ambiguous`.
  - `old_closed_job_still_gets_reply`.
  - `stop_still_processed_when_ambiguous`.
  - `fileSmsReply` admin-only.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests plus `bun test tests/*sms*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `fix: text replies only match texts that went out`.

### Task 17: Text retry after no provider contact; status never goes backwards

**Files:** Modify `src/lib/sms.server.ts` (`sendRealSms`, `settleStuckSending`, `recordSmsStatus`), `src/lib/sms.core.ts`. Optional `docs/pending-migrations/sms-not-sent-status.sql` (only if a status check constraint exists: check `drizzle/migrations` and `supabase/migrations`). Test `tests/sms-retry-and-status.test.ts`.

**Interfaces — Produces:**
- `SMS_STATUS_RANK = { queued: 1, sent: 2, delivered: 3, undelivered: 3, failed: 3 }`
- `smsStatusesBelow(s: string): string[]`
- Row status `not_sent` when Twilio was never contacted (not configured; recipient/sender missing after claim). A same-key retry re-claims it via `.update({ status: "sending" }).eq("idempotency_key", key).eq("status", "not_sent")`.

- [ ] **Step 1: Failing tests.**
  - `unavailable_then_restored_sends_once` (0 then 1 provider call).
  - `failed_4xx_not_resent`.
  - `sent_unknown_not_resent`.
  - `concurrent_reclaim_once` (RF1).
  - `delivered_then_late_sent_stays_delivered`.
  - `queued_then_delivered_updates`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests plus `bun test tests/*sms*.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `fix: retry texts that never reached the provider; keep confirmed delivery status`.

### Task 18: Tick, Needs me and 6am report

**Files:** Modify `src/routes/api/public/hooks/allocation-tick.ts` (one try-block after `sweepReadyCheckForms`), `src/lib/office-needs.core.ts`, `src/lib/office-needs.server.ts`, the Needs me page component (add a "Not linked to a job" group), `src/lib/portal.functions.ts`. Create `src/lib/recovery-needs.core.ts`, `src/lib/recovery-needs.server.ts`. Test `tests/recovery-needs.test.ts`, `tests/recovery-tick.test.ts`.

**Interfaces:**
- Consumes: `runRecoveryWork` (2), `evaluateAndApply` (3), `repairVeecCopyEmail` (5), `finishStripePaymentFollowup` (12), `retryWaitingRefund` (13), `retrySpotSavedEmail` (14). Events `quote_totals_mismatch` (6), `estimate_refresh_failed` (7), `stage_check_unreadable` (8), `xero_invoice_match_unclear` (10), `sms_reply_unmatched` (16). `pollXeroPayments().failedInvoices` (11).
- Produces:
  - `recoveryNeedsLine(item: RecoveryItem, jobNumber: string | null): string` (exact Global Constraints copy; "not sure" when `last_error === "uncertain"`)
  - `recoveryNeedsFacts(jobIds: string[]): Promise<Map<string, RecoveryItem[]>>`
  - `joblessNeedsRows(): Promise<{ line: string; actions: string[] }[]>` (refunds + unmatched texts)
  - `recoveryReportLines(): Promise<string[]>` (needs_office items, this plan's event rows, failed Xero invoices; `qa_test` excluded)
  - Admin fns: `recoveryTryAgain({ kind, workKey })` (open, attempts 0, due now) and `recoveryMarkSorted({ kind, workKey })` (done + `admin_config_events` `recovery_marked_sorted`)
  - The tick also runs `repairVeecCopyEmail` for every `effective_complete` assignment with blank `copy_sent_at` (paged).

- [ ] **Step 1: Failing tests.**
  - Each line is exact.
  - Done items → no row.
  - Job-less rows are grouped.
  - Event rows clear when resolved (quote re-checked OK, estimate refreshed, stage read OK, Xero linked, reply filed).
  - Report excludes qa_test.
  - The tick calls `runRecoveryWork` with all 5 handlers. A throw sets `out.recovery = "failed"` and later sweeps still run.
  - Admin-only fns.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Rows are derived, rank 9, group "today".
- [ ] **Step 4: Run** the new tests plus `bun test tests/office-needs-me.test.ts tests/office-needs-snapshot.test.ts`. Expected: no new failures.
- [ ] **Step 5: Commit** `feat: still-to-finish items on the tick, Needs me and the 6am report`.

### Task 19: Whole check and hand-off

- [ ] **Step 1: Run** `bun scripts/scan-retired-terms.ts`. Expected: no new hits.
- [ ] **Step 2: Run** `bun test` in chunks (the whole suite in one process was killed at 900 s at baseline). Expected: no new failures vs the SDD workspace `baseline-tests.txt`.
- [ ] **Step 3: Run** `bunx tsc --noEmit` and `bun run lint`. Expected: no new errors in changed files.
- [ ] **Step 4: Prepare the PR** (body per `supermatt:pr`) with the spec, plan, SQL and evidence. Do not merge. This session can't push, so hand the branch to a chat with push access or to Tom.
- [ ] **Step 5: Ask Jo** before applying each pending SQL file live. After she says yes: journal it in `drizzle/migrations/` and archive it to `docs/applied-migrations/`.
- [ ] **Step 6: Ask Jo** before changing her 6am report to include `recoveryReportLines`.
