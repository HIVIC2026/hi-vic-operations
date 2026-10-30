# Batch 1 — money and cancels (design)

Date: 28 Oct 2026 · Owner: Jo · Source: `qa/2026-10-28-workflow-audit/report.md` (stop-launch 1–5, fix-soon 12–13)
Status: **waiting for Jo's OK**. Built on a branch; nothing goes live until Jo says so.

## In plain words

| # | Problem today | After the fix |
|---|---|---|
| 1 | Owner can tap "Cancel my job" after paying $349; trades aren't told, you aren't told | Button gone once the $349 is paid — owner emails you. Before that, cancel does the same full clean-up as your office Cancel (trades released, installer told, Mitti form closed) and remembers the stage so you can reopen |
| 2 | Reopening a cancelled job can show "booked" when nothing is | Ready Check booked → back to "choose installer". Safety check or later → back to "needs a new safety check"; the old check no longer counts. Owner pays again only if a check was actually done. Payments already made stay counted |
| 3 | A failed Xero invoice is invisible | One Needs me row "Invoice didn't reach Xero" with Retry |
| 4 | Electrician's pay only shows at Final check | Safety check marked done when the electrician completes it, so Approve shows then |
| 5 | A card payment can count twice | Card + same-amount Xero payment with no Stripe number = counted once; Needs me asks you to confirm |
| 6 | STOP text after the installer accepted leaves the installer attached | Same full clean-up as a cancel; installer told and released |

Not changing: prices, the $349 amount, who chooses the electrician, any wording you've approved.

## Technical detail (for the build)

**1 Owner cancel** — `owner-myjob.core.ts` `ownerCanCancel`: also false when the safety-check payment step is paid (`jobPaymentView` / payment gate cleared). `owner-myjob.server.ts` `cancelOwnerJob`: replace the direct stage write with `cancelJobFully(jobId, reason "Owner cancelled from My job", actor null, { tell: { owner: false, installer: true } })` so assignments, offers, proposals, ESC notices, install holds are released and `prior_stage` is kept. My job copy when blocked: existing "reply to any of our emails" line, reworded to say the payment is made.

**2 Reopen** — `office-jobs.core.ts` `reopenPlan`: map `priorStage` to a safe stage instead of writing it back:
- `ready_check_scheduled` / Ready Check stages → `ready_check_ready_to_schedule` (back on Choose installer; existing release flow).
- `piesa_scheduled` and every later stage (fixes, installation, evidence) → `piesa_and_install_window_pending`-entry equivalent: "safety check to arrange". Mark existing `piesa_records` for the job as superseded for gating (new event `piesa_superseded_on_reopen`; nothing deleted) so the payment gate / 30-day rule / install gate need a new PIESA.
- New check payment: if a PIESA record existed (a check was done), record a repeat-PIESA owed by the owner through the existing `repeat-piesa` path (owner payer, quote's PIESA line) — the gate already joins `piesaRequestBlockers`. If no check was done, the original $349 still covers it.
- Earlier stages unchanged. Reopen still goes through `transition()`/`stageEntryBlockers` rather than a direct write.

**3 Failed invoice** — `office-needs.server.ts`: new row kind `invoice_create_failed` for jobs at/after `measured_quote_accepted` whose latest `invoice_create_failed` event is newer than any invoice with a Xero id. Retry button calls the existing guarded invoice creation (`invoiceAfterAcceptance` path). One row per job; cleared when the invoice reaches Xero.

**4 Electrician pay** — `piesa-complete.server.ts` (`completePiesaAssessment`) and the A3 Mitti completion path: set the job's confirmed `assessment` booking to `completed`, same as `piesa-record.server.ts` does for `rectification`. `office-money.server.ts` then lists the line before Final check (decision 410).

**5 Same money** — `payments.core.ts` `reconciledPaidCents`: a card row with no Stripe id match pairs with the closest same-amount Xero payment within 10 days (as legacy office rows do) and is counted once; keep the `payment_match_unclear` Needs me row so Jo confirms. Covers the deposit gate and `total_paid`.

**6 STOP** — `sms-stop.server.ts` `closeStoppedEnquiries`: when the matched job has an active assignment or pending offer, close it with `cancelJobFully(..., { tell: { owner: false, installer: true } })` instead of the direct update; otherwise unchanged.

## Testing

Each item: a test that fails on today's code and passes after (TDD), using the existing PGlite practice-DB helpers and core unit tests. Plus re-run of the payment, owner-cancel, reopen, money and STOP test files. Retired-term scan must stay at 0 customer-visible.

## Out of scope (later batches)

Messages (batch 2), expired quotes / reopen button / card deposit / fixes on invoice / repeat check bug / old wording (batch 3), rule book and old tests (batch 4).
