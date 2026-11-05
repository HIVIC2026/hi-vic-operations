# 50% Install Deposit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner pays a 50% deposit (of what's left after the $349) to book the install and the other 50% on install day, and every message, page, PDF and invoice says so.

**Architecture:** One rate constant drives every amount (`paymentPlan()` in `src/lib/payments.core.ts`). Wording is plain strings spread over ~59 `src/` files; each task owns one group of them and updates the tests that pin that wording. Database copy (Customer Agreement 1.4, 2 AI answers) goes in `docs/pending-migrations/`, proven on PGlite, run live only after Jo says yes.

**Tech Stack:** TypeScript, TanStack Start, Supabase/Postgres, bun test, PGlite.

**Spec:** `docs/superpowers/specs/2026-11-05-fifty-percent-deposit-design.md`

## Global Constraints

- Deposit = remaining × 0.50, rounded half up to the cent; balance = remaining − deposit. remaining = quote total after rebate − safety check.
- Owner-facing words: "50%" wherever the deposit said "10%", and wherever the balance said "90%". No other wording changes.
- Never change "10% a year" (penalty interest) or any non-deposit "10%".
- Customer Agreement version string `1.4` (`customer-agreement-1.4`); signed 1.3 rows are never edited.
- Refund rule unchanged: deposit refunded if cancelled at least 2 business days before install day.
- Read `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md` before editing; run `bun scripts/scan-retired-terms.ts` before and after.
- No live database change and no merge without Jo's yes. Commits to branch `deposit-50-percent` only; never force-push.

## Review Focus

1. Odd-cent remaining (e.g. $3,000.01) → deposit $1,500.01, balance $1,500.00, sum exact — Task 1 test.
2. Owner pays the deposit by card: the Stripe amount equals the page amount — Task 3 test.
3. Bank transfer of exactly 50% clears the deposit gate; one cent short does not (`minimumNotExact`) — Task 1 test.
4. Agreement 1.4 still says "10% a year" interest and the 2-business-day refund — Task 5 test.
5. An open job created under 1.3 (HV-3238-style, accepted) shows 50% on My job and the confirm-and-pay page — Task 2 test.

---

### Task 1: Rate and maths

**Files:**
- Modify: `src/lib/payments.core.ts` (`INSTALL_DEPOSIT_RATE`, `PAYMENT_STEP_LABELS` "Install deposit (50%)", doc comments, `INSTALL_DEPOSIT_BLOCKER`, payment-statement lines ~483)
- Modify: `src/config/workflow-decisions.ts` (`deposit.installPct: 50`, comments; add "10% install deposit" to `retired`)
- Test: `tests/payments.core.test.ts`, `tests/payments-jo-26oct.test.ts`, `tests/payment-gate.test.ts`, `tests/balance-on-install-day.test.ts`

**Interfaces:** Produces `INSTALL_DEPOSIT_RATE = 0.5`; `paymentPlan()` signature unchanged.

- [ ] Step 1: Add tests `"50% deposit: $3,349 quote → 349 / 150000 / 150000"`, `"odd cent: remaining 300001 → deposit 150001, balance 150000"`, `"gate: deposit threshold = 349 + 50%; one cent short not cleared"`.
- [ ] Step 2: `bun test tests/payments.core.test.ts` → FAIL (expects 150000, gets 30000).
- [ ] Step 3: Set rate to 0.50 and labels/blocker wording to 50%; update existing 10%/90% expectations in the listed tests.
- [ ] Step 4: `bun test tests/payments.core.test.ts tests/payments-jo-26oct.test.ts tests/payment-gate.test.ts tests/balance-on-install-day.test.ts` → PASS.
- [ ] Step 5: Commit "50% deposit: rate and maths".

### Task 2: Owner emails, texts and pages

**Files (modify):** `acceptance-email.core.ts`, `deposit-request-email.core.ts`, `deposit-request.server.ts`, `deposit-paid-inputs.core.ts`, `deposit-release-notice.core.ts`, `upgrades-needed.core.ts`, `owner-quote-email.core.ts`, `owner-pages.core.ts`, `owner-myjob.core.ts`, `owner-myjob.server.ts`, `owner-gates.core.ts`, `confirm-sign-pay.core.ts`, `components/owner/OwnerConfirmSignPay.tsx`, `sms.core.ts`, `install-booked-email.server.ts`, `install-days.server.ts`, `piesa-delivery.core.ts`, `piesa-delivery.server.ts`, `piesa-complete.server.ts`, `piesa-result-route.core.ts`, `email-reply.core.ts`, `template-hub.core.ts`, `journey*.server.ts`, `booking.server.ts`, `in-house-booking.server.ts` (all under `src/lib/` unless shown)
- Test: `tests/deposit-messages-v2.test.ts`, `clear-to-install-email.test.ts`, `confirm-sign-pay.test.ts`, `quote-page-v2.test.ts`, `youre-in-email.test.ts`, `upgrades-needed.test.ts`, `approved-email-designs.test.ts`, `piesa-delivery.test.ts`, `new-flow-inflight-p4.test.ts`

- [ ] Step 1: Add test `"accepted 1.3 job shows 50% on My job and confirm-and-pay"` in `tests/confirm-sign-pay.test.ts` (fixture: accepted job, agreement 1.3, $3,349 → "$1,500.00 deposit (50%)").
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Replace deposit "10%" → "50%" and balance "90%" → "50%" in owner strings only; update the listed tests' expected copy.
- [ ] Step 4: Run the listed tests → PASS.
- [ ] Step 5: Commit "50% deposit: owner emails, texts, pages".

### Task 3: PDFs, Xero and Stripe

**Files (modify):** `src/lib/receipt-pdf.core.ts`, `receipt-pdf.server.ts`, `tax-invoice-pdf.core.ts`, `signed-acceptance.core.ts`, `xero.server.ts`, `stripe.core.ts`, `invoice.lifecycle.ts`, `payments.server.ts`, `payments.functions.ts`, `portal.functions.ts` (acceptance record line)
- Test: `tests/receipt-pdf.test.ts`, `tax-invoice-pdf.test.ts`, `signed-acceptance-pdf-v2.test.ts`, `xero.core.test.ts`, `batch3a-card-deposit.test.ts`, `retired-payment-wording.test.ts`

- [ ] Step 1: Add test `"card deposit amount equals page amount"` in `batch3a-card-deposit.test.ts` ($3,349 → Stripe 150000 cents).
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Update line descriptions/receipt titles to 50%; acceptance line becomes "…50% install deposit to book the install; balance on installation day."; update tests.
- [ ] Step 4: Run listed tests → PASS.
- [ ] Step 5: Commit "50% deposit: PDFs, Xero, Stripe".

### Task 4: Office and installer screens, AI answers in code

**Files (modify):** `components/portal/panels.tsx`, `routes/_authenticated/admin.money.tsx`, `office-job-page.server.ts`, `office-needs.server.ts`, `office-stage-cards.core.ts`, `office-settings.core.ts`, `installer-screens.core.ts`, `installer-home.core.ts`, `installer-accepted-email.core.ts`, `trade-view.server.ts`, `prestart.core.ts`, `prestart.server.ts`, `payment-stall.core.ts`, `ai-answers.core.ts`, plus any remaining deposit comments (`allocation.core.ts`, `providers.core.ts`, `workflow.server.ts`, `ready-check-chase.core.ts`, `own-customer-portal-ready-check.core.ts`, `job-facts.columns.ts`)
- Test: `tests/installer-states.test.ts`, `installer-accepted-email.test.ts`, `my-work-job-page-agree.test.ts`, `payment-stall.test.ts`, `ai-answers.test.ts`, `ai-style.test.ts`

- [ ] Step 1: Update expected copy in listed tests to 50% → run → FAIL.
- [ ] Step 2: Change the strings.
- [ ] Step 3: Run listed tests → PASS. Commit "50% deposit: office, installer, AI answers".

### Task 5: Customer Agreement 1.4

**Files:**
- Modify: `src/lib/customer-agreement.core.ts` (`CUSTOMER_AGREEMENT_VERSION = "1.4"`, summary line, payment terms row "50% deposit to book your install day"), `customer-agreement-pdf.server.ts`
- Create: `docs/pending-migrations/customer-agreement-v1-4.sql` + `.rollback.sql` (copy of 1.3's pattern: retire active 1.3, insert 1.4 body with only the deposit % changed)
- Test: `tests/customer-agreement.core.test.ts`, `payment-terms-v1-3.test.ts` → rename/extend as `payment-terms-v1-4.test.ts`, `tests/customer-agreement-template-db.test.ts` (PGlite)

- [ ] Step 1: Tests: 1.4 body contains "50% to book your install day", contains "10% a year", contains "at least 2 business days before your install day", has no other "10%"; PGlite: after migration exactly one active `customer_agreement` = 1.4 and the 1.3 row still exists unchanged.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: `bun test tests/customer-agreement.core.test.ts tests/payment-terms-v1-4.test.ts tests/customer-agreement-template-db.test.ts` → PASS. Commit "Customer Agreement 1.4 (50% deposit), pending SQL".

### Task 6: AI answers in the database

**Files:** Create `docs/pending-migrations/ai-answers-50-deposit.sql` + rollback (updates the 2 `ai_reply_answers` rows containing deposit "10%"); PGlite test `tests/ai-answers-50-deposit-db.test.ts`.

- [ ] Step 1: Read the 2 rows (SELECT only) and write the SQL that changes only the % words.
- [ ] Step 2: PGlite test: after → no deposit "10%"; rollback restores. Run → PASS. Commit.

### Task 7: Guard and full check

**Files:** Modify `scripts/scan-retired-terms.ts` (retire deposit "10%"/"90% balance" phrases; allow "10% a year").

- [ ] Step 1: `bun scripts/scan-retired-terms.ts` → no hits.
- [ ] Step 2: `grep -rnE "10 ?%|90 ?%" src | grep -i -E "deposit|balance|book"` → only "10% a year".
- [ ] Step 3: `bun run test` → all pass. Commit "Retire 10% deposit wording".

### Task 8: Samples for Jo, website check, staff guide

- [ ] Step 1: Render every changed owner email, text, page and PDF for a TEST $3,349 job into `docs/approved-samples/2026-11-05-deposit-50/` with an INDEX.md; send to Jo.
- [ ] Step 2: Search the Base44 website for "deposit"/"10%"; list findings for Jo (no changes).
- [ ] Step 3: Update the Tom & Dad guide doc: money table, Step 7 and refunds say 50%.
- [ ] Step 4: Open the pull request (no merge). Ask Jo, one at a time, before running the 1.4 and AI-answer SQL live.
