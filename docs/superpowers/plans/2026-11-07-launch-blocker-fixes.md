# Launch Blocker Fixes (7 Nov 2026) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 9 must-fix problems found by the 7 Nov QA run, plus Jo's 3 rule decisions, before the Mon 9 Nov launch.

**Architecture:** Small, targeted server-side fixes in existing files. No redesign. Five independent pull requests (A–E), one per group, so each can be checked and merged on its own. Every fix is test-first.

**Tech Stack:** TypeScript, TanStack Start server functions, Supabase (Postgres), Stripe, Xero, `bun test`.

**Spec:** Jo's decisions in chat on 7 Nov 2026 (listed under "Decisions" below) plus the QA reports `docs/qa/2026-11-07-payments.md`, `docs/qa/2026-11-07-messages.md` and `docs/qa/2026-11-07-gates.md` (file:line references and reproductions are in those).

## Decisions (Jo, 7 Nov 2026)

1. Fix all 9 must-fix problems now.
2. A quote only counts as **accepted once the $349 is paid** (card = straight away; bank transfer = "waiting for payment" until it arrives). Matches her 1 Nov rule.
3. **DON'T START is a hard lock:** an install can't be marked done without Part C + Certificate of Electrical Safety uploaded and checked.
4. **Unsubscribe cancels the job,** the same way a STOP text does (her 27 Oct rule).

## Global Constraints

- Nothing goes live until Jo says. Every group is its own branch and pull request into `main`; don't merge.
- No live database change without asking Jo first. Any migration or data fix is written as a file and listed in the PR for her OK.
- Firm-quote switch `workflow_settings.firm_quote_flow_live_at` stays NULL. Don't touch it.
- No new owner-facing or installer-facing wording unless it already exists as approved words in the code. If a fix seems to need new words, stop and ask (Jo approves wording one at a time).
- Wording rules: never "about" or "You pay about"; never "save your spot" or "spot" in firm-quote messages; "electrical upgrades", never "fixes"; "Lead Installer" in full; 50% deposit.
- Each task proves no regressions by running its changed and nearby test files on the base commit (`git stash -q -u`) and then on the change, and diffing the sorted `(fail)` lines. The suite already has known failures, so only NEW failures count.
- Commits end with the session's Co-Authored-By / Claude-Session trailers.

## Review Focus

- A Stripe webhook that is retried many times over days must never record the money twice or send "You're in" twice → Task 1 test `retry after partial apply is idempotent`.
- A refund for a payment the portal never saw (paid outside the portal) must not make Stripe retry forever in a way that floods the logs → Task 1 test `refund with no matching payment returns 500 and logs once per event`.
- An owner who pays by card at the same moment the office opens the job must see the job move on, not "waiting for payment" → Task 4 test `card payment marks quote accepted immediately`.
- An installer with an approved bank account who submits a change must keep being paid to the OLD approved account until the office approves → Task 7 test `payout uses last approved account while change pending`.
- A Mitti install form arriving for a job with no GO must not lose the evidence → Task 11 test `mitti install sync without GO keeps evidence and flags`.

---

## PR A — Payments (branch `fix/launch-payments`)

### Task 1: Stripe webhook never loses or strands a payment

**Files:**
- Modify: `src/lib/stripe.server.ts:63-77` (handleStripeWebhook), `:94-128` (recordStripePayment), `:131-140` (recordStripeRefund)
- Modify: `src/lib/payments.server.ts:300-302` (once-check read errors)
- Test: `tests/stripe-webhook-recovery.test.ts` (new)

**Interfaces:**
- Produces: `handleStripeWebhook()` now returns `{ status: 500, outcome: "retry:<reason>" }` for any thrown error or retryable outcome.

- [ ] **Step 1: Write the failing tests** (use the fake-db style from `/home/claude/qa/pay-scratch/stripe-ab.test.ts`):
  - `invoice read error returns 500 not unknown_invoice`: invoice select returns `{ error }` → `status === 500`, nothing in the ledger.
  - `retry after partial apply is idempotent`: first delivery inserts the ledger row then `afterPaymentsChanged` throws; second delivery returns status 200, `afterPaymentsChanged` called again, ledger still has exactly 1 row, `total_paid` updated.
  - `refund with no matching payment returns 500 and logs once per event`: `recordStripeRefund` with an unknown PaymentIntent → webhook `status === 500`; the internal log is written once per `eventId`.
  - `refund lookup error returns 500`.
- [ ] **Step 2: Run** `bun test tests/stripe-webhook-recovery.test.ts`. Expected: 4 FAIL.
- [ ] **Step 3: Implement.**
  - In `recordStripePayment`, check `error` on the invoice select and throw.
  - On `"duplicate"` (both the fast path and the insert race), look up the invoice and still `return applyAfterStripeChange(inv)`. It is safe to repeat because it reads the reconciled total.
  - `recordStripeRefund`: throw on read errors; return `"unknown_payment"` as a retryable outcome.
  - `handleStripeWebhook`: wrap the record calls in try/catch → `{ status: 500, outcome: "retry:…" }`; map `unknown_payment` to 500.
  - In `payments.server.ts:300-302`, throw on `error`.
- [ ] **Step 4: Run** the new test plus `tests/*stripe*.test.ts tests/*payment*.test.ts`. Expected: new tests PASS and no new failures against the baseline.
- [ ] **Step 5: Commit** `fix(payments): Stripe webhook retries instead of losing or stranding a payment`

### Task 2: Xero bank payments always finish the follow-up steps

**Files:**
- Modify: `src/lib/xero.server.ts:356-358`
- Test: `tests/xero-payment-recovery.test.ts` (new)

- [ ] **Step 1: Failing test** `xero sync reruns follow-up after an earlier failure`: the ledger is unchanged on the second sync, but the job is still at the pre-payment stage → `afterPaymentsChanged` is called.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Call `afterPaymentsChanged` whenever `paidCents > 0`, not only when `ledgerChanged`. It is idempotent (its once-checks are fixed in Task 1).
- [ ] **Step 4: Run** the Xero tests against the baseline.
- [ ] **Step 5: Commit** `fix(payments): Xero sync finishes unfinished payment steps`

### Task 3: A card payment is never counted twice with Xero

**Files:**
- Modify: `src/lib/payments.core.ts:292, 361, 383` (pair matching)
- Test: `tests/payments-double-count.test.ts` (new); cases from `/home/claude/qa/pay-scratch/money-pure.test.ts`

**Rule:** on the same invoice, an unmatched Xero payment (no shared Stripe id) that arrives **any time after** a card payment, with an amount between `card − 5%` and `card` (Stripe fee net), is treated as the same money. It counts once at the card amount and is raised for the office to confirm (the existing `flagUnclearPaymentMatches` path). There is no 10-day limit.

- [ ] **Step 1: Failing tests:**
  - `card then same xero 15 days later counts once`
  - `card 34900 then xero 34240 (fee net) counts once`
  - `3000 job with deposit card + xero copy shows 1325.50 still owed`
  - `two genuinely different payments (xero > card) both count`
- [ ] **Step 2: Run.** Expected: first 3 FAIL.
- [ ] **Step 3: Implement** the pairing rule above in the reconcile function. Keep the existing same-amount path.
- [ ] **Step 4: Run** the new test plus `tests/*ledger*.test.ts tests/*payments*.test.ts` against the baseline.
- [ ] **Step 5: Commit** `fix(payments): card + Xero copy of the same money counts once`

## PR B — Emails (branch `fix/launch-emails`)

### Task 5: Office Send buttons send email 1 (not Save my spot) to firm-quote owners

**Files:**
- Modify: `src/lib/hot-leads-send.server.ts:115` (sendSaveMySpot entry) and `:499`
- Check the callers: `hot-leads.functions.ts:20`, `enquiry-dispatch.functions.ts:33/:61`, `reviewed-insulation-offer.server.ts:44-45`, `enquiry-groups.functions.ts:78`
- Test: `tests/office-send-firm-quote.test.ts` (new); reproduction in `/home/claude/qa/msg-scratch/dbl.test.ts`

**Interfaces:**
- Consumes: the batched firm-quote check added in commit e12ef0ff3 (reuse it; don't do one lookup per job).

- [ ] **Step 1: Failing tests:**
  - `auto email 1 then office Send sends nothing more`: one email in total, key `preliminary_estimate`.
  - `office Send first sends email 1 not save my spot`: email key and template are email 1, no `/campaign` link.
  - `non-firm job office Send unchanged`.
  - `firm jobs left out of dispatch backlog`.
- [ ] **Step 2: Run.** Expected: first 2 and the 4th FAIL.
- [ ] **Step 3: Implement.** In `sendSaveMySpot`, split the jobs with the batched firm check. Firm jobs go through the email-1 sender with the same send key, so an already-sent email 1 is skipped. Non-firm jobs are unchanged. Leave firm jobs out of the dispatch backlog query.
- [ ] **Step 4: Run** `tests/*hot-leads*.test.ts tests/*firm-quote*.test.ts tests/*enquiry*.test.ts` against the baseline.
- [ ] **Step 5: Commit** `fix(emails): office Send uses email 1 for firm-quote owners`

### Task 6: Automatic owner-email replies never give spot answers to firm-quote owners

**Files:**
- Modify: `src/lib/owner-email-auto-reply.core.ts:189-193, 237`; `owner-email-auto-reply.server.ts:83`
- Test: `tests/auto-reply-firm-quote.test.ts` (new); reproduction in `/home/claude/qa/msg-scratch/autoreply.ts`

**Rule:** for a firm-quote job, the AI never auto-sends. It leaves an office draft on the job (the existing "tricky" path). No new wording.

- [ ] **Step 1: Failing tests:**
  - `firm job before Proceed: no auto-send, draft left`
  - `firm job after Proceed: no auto-send, no 'spot' or 'Ready Check' text`
  - `non-firm job unchanged`
- [ ] **Step 2: Run.** Expected: first 2 FAIL.
- [ ] **Step 3: Implement.** Pass `isFirmQuote` into the core decision. If it is true, return the draft-for-office outcome.
- [ ] **Step 4: Run** the auto-reply tests against the baseline.
- [ ] **Step 5: Commit** `fix(emails): no auto spot answers to firm-quote owners`

## PR C — Installer safety (branch `fix/launch-installer-safety`)

### Task 7: Bank detail changes need the office's OK

**Files:**
- Modify: `src/lib/pilot.functions.ts:195-208` (setBankDetails)
- Create: office approve server function `approveBankDetails({ businessId })`, admin only, in `src/lib/pilot.functions.ts`
- Modify: the payout reader (find where `business_bank_details` is read for payouts) so it uses the approved values only
- Modify: Partners › People business row: a "Bank change waiting" chip and an Approve button (reuse existing chip and button styles)
- Migration (Jo OKs before it runs live): add `pending_account_name`, `pending_bsb`, `pending_account_number` to `business_bank_details`
- Test: `tests/bank-change-approval.test.ts` (new)

- [ ] **Step 1: Failing tests:**
  - `first bank details need office approve before payout`
  - `change keeps old approved account until approved`
  - `payout uses last approved account while change pending`
  - `only admin can approve`
  - `approve moves pending to approved and logs event`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** When an approved account already exists, an installer change writes the `pending_*` fields only. The office Approve copies pending → live and sets `review_status: "approved"`. Payout export and Mark paid refuse a business with no approved account and show the existing "waiting" style text. Needs me gets a "Bank change to check" row, using the existing Needs me row component.
- [ ] **Step 4: Run** the bank, payout and partner tests against the baseline.
- [ ] **Step 5: Commit** `fix(installers): bank changes need office approval before pay`

### Task 8: Installers can't read the owner's price in job history

**Files:**
- Modify: `src/lib/xero.server.ts:158`, `src/lib/portal.functions.ts:1991, 2077`: pass `{ internal: true }` to these logEvent calls (and any other logEvent whose title holds a $ owner amount; grep `logEvent(` for `$`)
- Data fix file (Jo OKs before it runs live): `docs/pending-migrations/2026-11-07-hide-owner-prices-from-trades.sql`, which sets `internal = true` on existing workflow_events whose title matches the owner-price patterns
- Test: `tests/trade-history-no-prices.test.ts` (new)

- [ ] **Step 1: Failing tests:**
  - `invoice raised event is internal`
  - `quote accepted event with amount is internal`
  - `no non-internal logEvent title contains a dollar owner amount` (a static scan of `src/lib` for logEvent calls with `$` and no `internal: true`, with a short allowlist for installer-pay amounts)
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the flags and write the SQL file. Read it back with a SELECT count in the PR description.
- [ ] **Step 4: Run** the new test plus the trade-view tests against the baseline.
- [ ] **Step 5: Commit** `fix(installers): owner prices never visible in trade job history`

### Task 9: Only ESC-registered Lead Installers can be picked in the crew picker

**Files:**
- Modify: `src/lib/piisa-crew.core.ts:41-58` (crewSelectionProblems); make sure `StaffOption` carries `escRegistered` from the loader in `visit-allocation.server.ts:178`
- Test: add to `tests/piisa-crew*.test.ts`

- [ ] **Step 1: Failing test** `lead not ESC registered is refused`: `problems` contains the same message the in-house booking uses (`in-house-booking.core.ts:34`; reuse that exact string).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** After the EEC check, add `else if (lead.escRegistered !== true) p.push(<same message>)`.
- [ ] **Step 4: Run** the crew and in-house booking tests against the baseline.
- [ ] **Step 5: Commit** `fix(installers): crew picker requires an ESC-registered Lead Installer`

## PR D — Installer home (branch `fix/launch-installer-home`)

### Task 10: No "Ready Check – Do it in Mitti" for installers; the count matches the list

**Files:**
- Modify: `src/lib/next-step-box.core.ts:197-200`: own customers without photos get `box("enter_price", W.enterPriceTitle, { yours: true })` (existing approved words "Enter your price"), never `own_ready_check`
- Modify: `src/lib/my-work.core.ts:27, 31-35, 75`: "N jobs need you today" counts exactly the cards shown under "Your turn"
- Modify: `src/components/trade/NextStepBox.tsx:168-169`: remove the `own_ready_check` Mitti button branch
- Test: update `tests/next-step-box*.test.ts`, `tests/my-work*.test.ts`

- [ ] **Step 1: Failing tests:**
  - `own customer no photos shows Enter your price`
  - `no box ever says Do it in Mitti`
  - `needYou count equals your-turn cards` (fixture: 6 action cards + 1 booked PIESA → the count equals the cards in the Your turn list)
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** as listed under Files.
- [ ] **Step 4: Run** the trade, next-step and my-work tests against the baseline. Take a phone screenshot of /field on the preview for the PR.
- [ ] **Step 5: Commit** `fix(installers): desktop quote wording on home, count matches list`

## PR E — Jo's rule decisions (branch `fix/launch-rules`)

### Task 4: A quote is accepted only once the $349 is paid

**Files:**
- Modify: `src/lib/portal.functions.ts:2034-2047, 2098-2101` (owner Accept); `:1714` (office accept for owner)
- Modify: payment follow-up (`afterPaymentsChanged` in `src/lib/payments.server.ts`) so it marks the quote accepted when the $349 safety-check payment lands
- Test: `tests/quote-accept-after-payment.test.ts` (new)

**Rule:** the owner's tap records the ticks and the agreement (unchanged) and sets the quote to "waiting for $349 payment". When the safety-check payment is recorded (card or bank), the quote becomes accepted, and everything that used to run on accept runs then. Card goes straight through because the payment lands in the same flow. Screens use the existing "waiting for payment" words.

- [ ] **Step 1: Failing tests:**
  - `tap Accept without payment: quote not accepted, waiting for payment`
  - `card payment marks quote accepted immediately`
  - `bank transfer arrives later: quote accepted then`
  - `accept side effects run once`
  - `office accept follows the same rule`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** a new quote status value only if no existing one fits (check the quote status enum first). If a DB enum change is needed, write it as a migration file for Jo's OK.
- [ ] **Step 4: Run** the quote, accept, payment and owner my-job tests against the baseline.
- [ ] **Step 5: Commit** `fix(rules): quote accepted only once the $349 is paid`

### Task 11: DON'T START is a hard lock

**Files:**
- Modify: every path that marks an install complete (`src/lib/workflow.server.ts:400-411` and the office/installer "install done" functions; grep for the install-complete stage write). Require a GO (Part C + certificate checked, from `prestart.server.ts:68-100`) for **all** jobs, not only installer-intake jobs.
- Test: `tests/dont-start-lock.test.ts` (new)

**Rule:** manual "install done" without a GO is refused, with the existing DON'T START reason text. An automatic Mitti install-form sync without a GO **keeps all the evidence**, does not move the job to installed, and adds a red flag on the job and a Needs me row, using the existing flag/row components and words.

- [ ] **Step 1: Failing tests:**
  - `manual install done without GO is refused`
  - `install done with GO works`
  - `mitti install sync without GO keeps evidence and flags`
  - `HIV lead and own customer both require GO`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** the prestart, workflow and mitti tests against the baseline.
- [ ] **Step 5: Commit** `fix(rules): DON'T START blocks marking an install done`

### Task 12: Unsubscribe cancels the job like STOP

**Files:**
- Modify: `src/lib/emailsafety.server.ts:36-52` (recordUnsubscribe): after recording the opt-out, apply the same cancel rule as STOP (`sms-stop.server.ts:10` closeStoppedEnquiries): jobs at the enquiry or saved-spot stage are cancelled as "Opted out (unsubscribed)"; later jobs are marked do-not-contact.
- Test: `tests/unsubscribe-cancels.test.ts` (new)

- [ ] **Step 1: Failing tests:**
  - `unsubscribe at enquiry stage cancels job with Opted out (unsubscribed)`
  - `unsubscribe after $349 paid does not cancel, marks do not contact`
  - `second unsubscribe click does nothing more`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Extract a shared `closeOptedOutJob(db, jobId, reason: "sms_stop" | "email_unsubscribe", now)` from the STOP code and call it from both places.
- [ ] **Step 4: Run** the STOP, unsubscribe and email-safety tests against the baseline.
- [ ] **Step 5: Commit** `fix(rules): unsubscribe cancels the job like STOP`

---

## After all PRs

- Run the whole-job TEST journey again (Lovable) on a preview that has all five branches merged into a test branch.
- Jo approves the listed migration and data-fix files before they run live.
- Jo merges and publishes on Monday morning together with the website update and the firm-quote switch.
