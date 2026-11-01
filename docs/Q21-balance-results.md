# Q21 balance — partial, not ready to publish

No settings, secrets, live records, database changes, sends or publishing occurred.

## Implemented so far
- Recorded completion +7 calendar days at Melbourne end of day, with DST pure tests.
- Balance enabled for card and bank on the existing invoice; Stripe mode/receipt paths retained.
- Captured day5/due-day email sweep through existing guarded owner sender; existing tick, no new schedule.
- Derived next-day overdue office row; receipt wording and payment links updated.
- Completion no longer stops halfway because invoice due-date update fails; tick retries that date.

## Verification
Six focused Q21 tests pass, zero failures. Automatic checks reported build OK; latest minor template/link changes have not received a fresh entry yet.
Full bounded comparison against untouched eb1e889f: 1006 files, 10077 passing / 243 failing / 5 TODO, 97 failing files. Provisional after: 1008 files, 10068 passing / 258 failing / 5 TODO, 103 failing files. Two known stallers excluded as previously. This is NOT a clean comparison.

Increased failures:
- ai-reply-answers-db.test.ts
- approved-email-designs.test.ts
- batch3a-card-deposit.test.ts
- guide-fix-o33-deposit.test.ts
- in-house-atomic-booking.test.ts
- owner-email-triggers.test.ts
- owner-pages.core.test.ts
- piesa-fee-onboarded-rec.test.ts

Some are deliberately superseded balance copy/card expectations, but have not all been reconciled; the atomic booking proof needs its isolated dependency updated. Do not treat these as acceptable without checking.

## Wording changed
- “the rest on install day” → “the rest 7 days after your install is recorded complete”.
- Balance summary → “7 days after recorded install completion · card or bank transfer”.
- Deposit emails now state seven days after recorded completion and card/bank options.
- O45: balance due on its calculated date; card on My job plus existing bank details.
- Reminder subjects: “Your balance is due in 2 days” and “Your balance is due today”; body names due date and both payment methods.
- Office overdue line: “Installation balance overdue”.
- Existing saved AI answers overlay retired balance timing/bank-only wording; stored audit remains unchanged.

## Still required
Repair every increased failure and rerun comparison; harden durable reminder retries across missed-day/blocked/uncertain delivery; prove completion-to-payment with actual Stripe/Xero handlers and readback, no double charge; verify office overdue without stale payment facts/duplicate rows and completed-job exclusion; finish all remaining active template/owner wording and preview O45 card button; authenticated TEST UI and two-user isolation checks. No live verification has occurred.

## Changed files
- `AGENTS.md`
- `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`
- `docs/templates/mjml/invoices_O45.mjml`
- `docs/templates/mjml/owner_O33.mjml`
- `docs/templates/mjml/owner_O35.mjml`
- `roadmap.md`
- `src/components/portal/office-job.tsx`
- `src/components/portal/panels.tsx`
- `src/config/workflow-decisions.ts`
- `src/lib/acceptance-email.core.ts`
- `src/lib/ai-answers.core.ts`
- `src/lib/approved-owner-emails.server.ts`
- `src/lib/assignment.server.ts`
- `src/lib/balance-q21.core.ts`
- `src/lib/balance-q21.server.ts`
- `src/lib/completion-emails.core.ts`
- `src/lib/deposit-request-email.core.ts`
- `src/lib/final-invoice-email.core.ts`
- `src/lib/install-booked-email.core.ts`
- `src/lib/install-complete.server.ts`
- `src/lib/install-days-email.core.ts`
- `src/lib/invoice-dates.server.ts`
- `src/lib/office-needs.server.ts`
- `src/lib/owner-pages.core.ts`
- `src/lib/payment-stall.core.ts`
- `src/lib/payments.core.ts`
- `src/lib/payments.server.ts`
- `src/lib/stripe.core.ts`
- `src/routes/_authenticated/admin.money.tsx`
- `src/routes/api/public/hooks/allocation-tick.ts`
- `tests/balance-q21.core.test.ts`
- `tests/balance-q21.server.test.ts`
- `tests/final-invoice-email.test.ts`
- `tests/payments.core.test.ts`
- `tests/stripe.core.test.ts`
