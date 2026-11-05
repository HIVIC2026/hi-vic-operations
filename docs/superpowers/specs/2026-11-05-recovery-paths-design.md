# Recovery paths: payments, refunds, Spot saved emails, Mitti sweep

Date: 5 Nov 2026 · Approved design: Jo (chat, 5 Nov 2026) · Base: GitHub main `a274d76`

## In plain words (for Jo)

The portal must never say "done" when part of a job is still unfinished. Four places can do that today:

1. A card payment is saved, but the job and invoice updates get cut off. When it comes again, they're skipped.
2. A refund that arrives before its payment is thrown away. A database hiccup is treated as "unknown invoice, all good".
3. A Spot saved email can show "Already sent to this owner" when nothing was sent.
4. The Mitti sweep only looks at the oldest 500 booked Ready Checks, so job 501 can be missed.

The fix: one **still-to-finish list**. Anything not finished goes on it. The 15-minute check finishes it. After 3 failed tries it shows as one Needs me row and in the 6am report.

**Not changing:** prices, payment steps, invoices, Xero, message wording, who gets what, or when.

## Shared piece: the still-to-finish list

New table `recovery_work` (pending SQL in `docs/pending-migrations/recovery-work.sql` + rollback, proven on PGlite first, applied live only after Jo says yes at that moment):

| column | meaning |
|---|---|
| `id` | uuid |
| `kind` | `stripe_payment_followup` · `stripe_refund_waiting` · `spot_saved_email` |
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

## Needs me and the 6am report

- A `needs_office` item makes one Needs me row (derived, not stored, clears when the item is `done`):
  - "Card payment saved but job not updated – HV-xxxx"
  - "Refund not matched to a payment – Stripe ref pi_…" (no job link when there's no job)
  - "Spot saved email not sure it sent – HV-xxxx" / "Spot saved email not sent after 3 tries – HV-xxxx"
- Office actions on the row: **Try again** (resets attempts) and **Mark sorted** (sets `done` with an audit event).
- The 6am report lists the open `needs_office` items (count + one line each). TEST jobs (`qa_test`) are left out.

## Testing (TDD, practice only)

Each review finding gets a test that fails on `a274d76` and passes after the fix:
1. Follow-up cut off after the ledger insert → a repeat delivery finishes the invoice/job updates, with one ledger row.
2. Refund before payment → saved, then applied once the payment arrives. A database timeout on the invoice lookup → 500, not 200.
3. Database timeout before the Spot saved send → "Not sent yet, will retry", not "Already sent". The tick then sends it once.
4. 501 booked jobs where only #501 needs a form → the sweep creates #501.

Plus: tick claim safety (two runs, one attempt), the 3-tries → Needs me rule, Mark sorted / Try again, and the SQL proven on PGlite. Run `bun scripts/scan-retired-terms.ts` and `bun test ./tests/`.

## Release

1. Code in a pull request (Jo chooses who merges).
2. Ask Jo, then apply `recovery-work.sql` live.
3. If the code goes live before the table exists, the payment/refund/email paths act exactly as they do today (the list is skipped and an error is logged). The new behaviour starts once the SQL is applied. Nothing is half-on.
4. A list write that fails while the table exists throws. The webhook returns 500 and Stripe retries.
