# Recovery paths: payments, refunds, Spot saved emails, Mitti sweep

Date: 5 Nov 2026 · Approved design: Jo (chat, 5 Nov 2026) · Base: GitHub main `a274d76`

## In plain words (for Jo)

The portal must never say "done" when part of a job is still unfinished. Four places can do that today:

Order of fixing (Jo, 5 Nov 2026): VEEC assignment → quotes → estimates → payments → emails → Mitti → SMS.

1. **VEEC assignment:** the portal can say "signed copy stored" when the PDF upload failed. "Signed" can be logged when a signature didn't save. A failed variation check counts as "no variations". The signed-copy email can get stuck after one failure, and "emailed" can be logged when the sent date didn't save.
2. **Quotes:** a rejected office edit still saves the line, and a database hiccup can save a $0 total.
3. **Estimates:** a timeout can switch the owner's estimate back to their own guess, and a failed refresh can leave no current estimate.
4. **Payments:** a card payment is saved, but the job and invoice updates get cut off. When it comes again, they're skipped. A refund that arrives before its payment is thrown away, and a database hiccup is treated as "unknown invoice, all good".
5. **Emails:** a Spot saved email can show "Already sent to this owner" when nothing was sent.
6. **Mitti:** the sweep only looks at the oldest 500 booked Ready Checks, so job 501 can be missed.
7. **SMS:** a reply can be filed on the wrong job. A text that never reached the provider can't be retried. "Delivered" can go back to "sent".

The fix: one **still-to-finish list**. Anything not finished goes on it. The 15-minute check finishes it. After 3 failed tries it shows as one Needs me row and in the 6am report. Every save that has to happen together happens together.

**Live check (read-only, 5 Nov 2026, TEST jobs left out):** no real job has reached final VEEC assignment. The 8 real "signed" history entries all have saved signatures. All 8 real quotes (1 sent, none hand-edited) add up correctly. So no real owner has been affected yet.

**Not changing:** prices, payment steps, invoices, Xero, message wording, who gets what, or when.

## Shared piece: the still-to-finish list

New table `recovery_work` (pending SQL in `docs/pending-migrations/recovery-work.sql` + rollback, proven on PGlite first, applied live only after Jo says yes at that moment):

| column | meaning |
|---|---|
| `id` | uuid |
| `kind` | `veec_final_copy` · `veec_copy_email` · `stripe_payment_followup` · `stripe_refund_waiting` · `spot_saved_email` |
| `work_key` | unique per kind (the receipt key, the refund receipt key, or the owner email idempotency key) |
| `job_id` | nullable (early refunds may have no job yet) |
| `payload` | jsonb: what's needed to redo the work (e.g. the Stripe payment/refund fact) |
| `status` | `open` · `done` · `needs_office` |
| `attempts`, `last_error`, `next_attempt_at`, `created_at`, `done_at` | retry bookkeeping |

- Unique `(kind, work_key)`, so the same piece of work is listed once.
- Service-role only (RLS on, no user policies). Office reads go through an admin server function.
- Pure rules live in `src/lib/recovery-work.core.ts`: when an item is due, backoff (5, 15, 30 min), and when it becomes `needs_office` (3rd failed attempt).
- `src/lib/recovery-work.server.ts`: `addWork`, `markDone`, `markFailed` and `runRecoveryWork(now)`. It claims due items with `FOR UPDATE SKIP LOCKED` through an RPC, so two ticks never run the same item. It is called from the existing 15-minute allocation tick.
- A failed read of the list logs an error and does nothing. It never reports success.

## A. VEEC assignment (`assignment.server.ts`, `veec-copy-email.server.ts`)

**Signed copy (`storeCopy`, `evaluateAndApply`)**
- `storeCopy` returns `{ ok: true, path } | { ok: false, reason }`. A storage upload error **or** a failed `documents` insert gives `ok: false`.
- In `evaluateAndApply`, `ok: false` means no status change, no compliance pass and no event. It adds `addWork('veec_final_copy', assignmentId, jobId, {})` and returns the unchanged status. The tick re-runs `evaluateAndApply(jobId, null)`.
- Completion is one RPC `complete_veec_assignment(p_assignment_id, p_job_id, p_path, p_effective_at, p_delivery, p_sha256, p_actor)` (pending SQL). In one transaction it updates `customer_assignments` (status, effective_at, completed_at, final_copy_path, final_copy_at, delivery_status) only where status ≠ `effective_complete`, sets the `owner_authority` compliance check to pass, and inserts the `VEEC_ASSIGNMENT_EFFECTIVE` event. An error throws and nothing is written.
- A non-final status update (`r.status !== "effective_complete"`) checks its error and throws.

**Signatures (`signCustomerAgreement`, `signInstallerDecl`, `signFinalAssignment`, `writeApSignature`, `reconfirmVariation`)**
- Every signature write checks `error` (and that a row was updated) **before** its "signed" event. On failure it throws `WorkflowError("Your signature didn't save – please try again.")` and writes no event.

**Variation check (`signFinalAssignment`, `evaluateAndApply`)**
- An error on the pending-variation count throws `WorkflowError("Couldn't check for changes – try again.")` (in signing). In `evaluateAndApply` it returns the unchanged status and adds `veec_final_copy` work. It never counts as zero.

**Signed-copy email (`sendVeecCopyEmail`)**
- `sendGuardedOwnerEmail` is called with `retryAfterDefiniteFailure: true`. A confirmed provider rejection is retried, and an unclear outcome is still never re-sent.
- `markSent` updates `copy_sent_at` and checks the error. Only then does it log `veec_copy_email_sent`. If the date fails to save, it adds `veec_copy_email` work, and the retry repairs the date without re-sending.
- Repair (runs on the tick for every `effective_complete` assignment with blank `copy_sent_at`, and as the `veec_copy_email` handler), using the `customer_email_sends` row for key `veec-copy:v1:<assignmentId>`:
  - sent → set `copy_sent_at` from its `sent_at` and log the event once (no send)
  - definitely failed → send through the normal path
  - unclear (`delivered_unrecorded` / started with no outcome) → `needs_office`, no send
  - no row → normal send

## B. Quote editing (`quotes.server.ts` `adjustQuote`, send path)

- Validate the whole edit before writing: build the new lines in memory, compute subtotal, run `quoteAdjustmentDiscount`. Any error → `WorkflowError` and nothing saved. The reads of the quote, settings and GST rate check errors and throw.
- Save with one RPC `apply_quote_adjustment(p_quote_id, p_expected_version, p_items jsonb, p_totals jsonb, p_release jsonb, p_adjustment jsonb)` (pending SQL). In one transaction: update the items, update the totals with `version + 1` only where `version = p_expected_version` (otherwise "This quote was changed by someone else – reload"), apply the held/draft release change, and insert `quote_adjustments`. Events are logged after the RPC succeeds.
- Totals check before any owner send (`quoteTotalsMismatch(quote, items): string | null`, pure, ±$0.01): lines sum = `subtotal_inc_gst`, and `subtotal_inc_gst − veec_discount_inc_gst` = `customer_total_inc_gst`. It runs at every point a quote becomes owner-visible (office Send, queued release, auto-send). A mismatch holds the quote (`release_state='held'`, `release_hold_reason='Quote totals don't add up'`) and makes a Needs me row "Quote totals don't add up – HV-xxxx".

## C. Owner estimate refresh (`estimate.server.ts`)

- Every read the refresh depends on (job, measurement, area estimates, postcode row, settings, history) checks `error`. Any error throws `EstimateRefreshFailed`, and nothing is written.
- Replacing an estimate is one RPC `replace_current_estimate(p_job_id, p_expected_current_id, p_row jsonb)` (pending SQL). In one transaction it inserts the new `current` row and supersedes the old one (only if it is still current). There's always exactly one current estimate.
- Owner link callers catch `EstimateRefreshFailed`. They show the last current estimate unchanged and log `estimate_refresh_failed` (internal, once per job per hour). That makes one Needs me row "Estimate refresh failed – HV-xxxx", which clears after the next successful refresh.

## 1. Card payments (`stripe.server.ts` `recordStripePayment`)

- Before the ledger insert: `addWork('stripe_payment_followup', receiptKey, jobId, fact)`.
- After `flagUnclearPaymentMatches` + `applyAfterStripeChange` both finish: `markDone`.
- Duplicate delivery (fast path or 23505): if the follow-up item is still `open`/`needs_office`, run the follow-up now, then `markDone`. Return `"duplicate"` only when it's already `done`. The ledger row is never written twice.
- The tick runs the same follow-up function from the saved payload.
- The follow-up functions (`applyPaidAmount`, `repeatPaidByCard`, `afterPaymentsChanged`) are already guarded to run once. The plan checks each one is safe to run again, and adds a test proving a second run changes nothing.

## 2. Refunds and database errors (`recordStripeRefund`, `recordStripePayment`)

- Every Supabase read in both functions checks `error`. A read error throws, so the route returns 500 and Stripe retries. It never becomes `unknown_invoice` / `unknown_payment`.
- A refund whose payment isn't found (a real empty result, no error) is saved as `stripe_refund_waiting` (key = `stripeRefundReceiptKey(pi, refundedCents)`). The webhook answers 200 `refund_waiting`.
- Right after a card payment is recorded, any waiting refunds for that PaymentIntent are applied through the existing `recordStripeRefund` (same ledger/receipt rules, VEEC refund flag included).
- The tick also retries waiting refunds. After 3 failed tries it becomes `needs_office`.

## 3. Spot saved emails (`spot-saved-send.server.ts` `sendEmail`, `alreadyCheck`)

- Reservation insert error:
  - `23505`: read the existing `customer_email_sends` row for that key.
    - `sent` / delivered statuses → "Already sent to this owner".
    - `failed` → send again using the same row (same idempotency key to the email service).
    - Started with no outcome, or `delivered_unrecorded` → don't send. Status `uncertain`, "Not sure it sent". Goes on the list as `needs_office` straight away.
  - Any other error (timeout etc.) → status `retry`, "Not sent yet, will retry". `addWork('spot_saved_email', key, jobId)`. The tick calls `sendSpotSavedConfirmation(jobId, { emailOnly: true })`.
- `alreadyCheck` (dry run) uses the same rule: "already" only for a confirmed-sent row. A read error says "Couldn't check".
- `spotSavedEmailAlreadySent` keeps its "read error counts as sent" rule (it stops double sends). But a read error now also adds the item to the list, so it isn't silently dropped.
- Texts are not changed.

## 4. Mitti sweep (`mitti-autoform.server.ts` `sweepReadyCheckForms`)

- Both job reads (installer-added jobs and booked HIV leads) page to the end in 200-row pages, ordered `created_at, id`, using the repo's paged-read pattern. Any page error throws, and there are no partial results.
- Fact reads (`measurements`, `assignments`, `failures`, `bookings`) are batched in 200-id scopes.
- Jobs that already have a current measurement are dropped before the per-tick loop, so the `AUTOFORM_MAX_PER_TICK` cap is only spent on jobs that need a form.
- `AUTOFORM_MAX_PER_TICK`, `autoFormDecision` and all creation guards stay the same.

## 5. SMS (`sms.server.ts`)

**Reply matching (`recordInboundReply`)**
- Candidate texts are those to this number with status in `sent`, `delivered`, `queued`, `sent_unknown`, `undelivered`. `blocked`, `failed` and `not_sent` are excluded.
- Distinct open jobs (not deleted, not closed) with a candidate text in the last 30 days:
  - exactly 1 → file there, as now
  - 0 → file on the latest candidate's job (as now, so old jobs still get replies)
  - 2+ → file on none. Insert `sms_reply_unmatched` (job-less, in `admin_config_events`) with the body, sid and candidate job ids. Needs me row "Text reply – which job? HV-A or HV-B", with one button per job ("File on HV-A") that files it there and clears the row.
- STOP/START handling is unchanged.

**Retry after never contacting the provider (`sendRealSms`)**
- When the portal knows Twilio was never contacted (not configured, recipient/sender missing after claim), the row is saved as `status='not_sent'`. It isn't left on `sending` or turned into `sent_unknown`.
- A later attempt with the same key and an existing `not_sent` row re-claims it with a conditional update (`status='not_sent'` → `sending`), then sends once.
- `failed` (Twilio 4xx) and `sent_unknown` stay as today: "Already handled", never re-sent.

**Status never goes backwards (`recordSmsStatus`)**
- Rank: queued 1 < sent 2 < delivered / undelivered / failed 3. The update only applies where the current status ranks lower (`.in("status", lower)`).

## Needs me and the 6am report

- A `needs_office` item makes one Needs me row (derived, not stored, clears when the item is `done`):
  - "Card payment saved but job not updated – HV-xxxx"
  - "Refund not matched to a payment – Stripe ref pi_…" (no job link when there's no job)
  - "Spot saved email not sure it sent – HV-xxxx" / "Spot saved email not sent after 3 tries – HV-xxxx"
  - "Signed VEEC copy couldn't be saved – HV-xxxx"
  - "Signed VEEC copy email not sure it sent – HV-xxxx" / "Signed VEEC copy email not sent after 3 tries – HV-xxxx"
- Rows from their own events (not the list): "Quote totals don't add up – HV-xxxx", "Estimate refresh failed – HV-xxxx", "Text reply – which job? HV-A or HV-B".
- Office actions on the row: **Try again** (resets attempts) and **Mark sorted** (sets `done` with an audit event).
- The 6am report lists the open `needs_office` items (count + one line each). TEST jobs (`qa_test`) are left out.

## Testing (TDD, practice only)

Each review finding gets a test that fails on `a274d76` and passes after the fix:
1. Follow-up cut off after the ledger insert → a repeat delivery finishes the invoice/job updates, with one ledger row.
2. Refund before payment → saved, then applied once the payment arrives. A database timeout on the invoice lookup → 500, not 200.
3. Database timeout before the Spot saved send → "Not sent yet, will retry", not "Already sent". The tick then sends it once.
4. 501 booked jobs where only #501 needs a form → the sweep creates #501.
5. PDF upload fails → assignment not complete, no compliance pass, no "signed copy stored". An assignment update failure → nothing recorded.
6. Signature write fails → error to the signer, no "signed" event.
7. Variation count error → signing and completion stop.
8. Signed-copy email rejected once → the next try sends. Sent date fails to save → no "emailed" event until the date is saved, and the repair sets it without re-sending.
9. $3,000 → $3,200 with a rejected discount → nothing saved. Item read timeout → no $0 total.
10. Measurement read timeout → the estimate stays at 140 m², not 90 m². Replacement insert fails → the old estimate is still current.
11. Delivered to Job A, blocked for Job B, then a reply → filed on A. Two open jobs with sent texts → "which job?" row.
12. Provider unavailable, then restored → the retry sends once. "delivered" then a late "sent" → stays delivered.

Plus: tick claim safety (two runs, one attempt), the 3-tries → Needs me rule, Mark sorted / Try again, and the SQL proven on PGlite. Run `bun scripts/scan-retired-terms.ts` and `bun test ./tests/`.

## Release

1. Code in a pull request (Jo chooses who merges).
2. Ask Jo, then apply the pending SQL live: `recovery-work.sql`, `complete-veec-assignment.sql`, `apply-quote-adjustment.sql`, `replace-current-estimate.sql`. Each comes with a rollback and a PGlite proof. The `not_sent` SMS status needs no SQL if `sms_messages.status` has no check constraint (the plan confirms this). If it does, add it to a `sms-not-sent-status.sql`.
3. If the code goes live before the table exists, the payment/refund/email paths act exactly as they do today (the list is skipped and an error is logged). The new behaviour starts once the SQL is applied. Nothing is half-on.
4. A list write that fails while the table exists throws. The webhook returns 500 and Stripe retries.
