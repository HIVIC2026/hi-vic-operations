# Batch 3b — Separate Invoices for Fixes and Repeat Safety Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Electrical fixes and repeat safety checks each get their own Xero invoice, paid before that work is booked; the install invoice is never edited.

**Architecture:** `invoices` holds several rows per job, one per kind (`installation`, `rectification` = fixes, `repeat_safety_check`). Each payment step reads its own invoice. Existing core/server pairs (xero, payments, stripe, repeat-piesa, office-needs).

**Tech Stack:** TypeScript, TanStack Start, Supabase, Xero API, Stripe Checkout, PGlite, Bun test.

**Spec:** `docs/superpowers/specs/2026-10-29-batch3b-separate-invoices-design.md`

## Global Constraints

- Branch `fix/batch3b-separate-invoices`; never push to `main`; never rewrite pushed commits. Ends with an open PR — no merge, no publish.
- The SQL goes in `docs/pending-migrations/separate-invoices.sql` (+ `.rollback.sql`), proven on PGlite. **Never run it on the live database** — the controller asks Jo first.
- References exactly: `Home Insulation Victoria HV-1234 fixes`; `Home Insulation Victoria HV-1234 safety check 2` (3, 4… for later repeats).
- The install quote/invoice keeps the $349 safety check (PIESA) and $349 AP fee as today; it never includes fixes; never edited after it's sent.
- No new owner wording besides those references. Payment methods unchanged (fixes and repeat: card, bank transfer or PayID).
- Repeat invoice only when the repeat payer is `owner`; `installer` / `hivic` payers unchanged.
- Server functions: literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)`. `bun scripts/scan-retired-terms.ts` → 0.

## Review Focus

1. Order (Jo): $349 paid before the safety check (PIESA) → if the PIESA finds fixes, ALL the fixes paid before the fixes day and time is confirmed → once the fixes are done, 10% to book the install date → balance on install day. Fixes money (card or bank) lands on the fixes invoice only and never counts toward the 10% deposit or balance (Task 4 `fixes card stays on fixes`).
2. A newer fixes quote replaces an accepted one → one invoice per quote; the gate follows the newest; an older unpaid fixes invoice raises one Needs me row (Task 2 `superseded fixes`).
3. Xero create fails for a fixes/repeat invoice → retried on sync, one `invoice_failed` Needs me row naming the kind (Tasks 2, 3).
4. Second reopen → a separate "safety check 3" invoice; the first repeat invoice untouched (Task 3 `second repeat`).
5. A refund on a fixes invoice never counts as "the safety check was refunded" at reopen (Task 5 `reopen refund install only`).

---

### Task 1: Database change (pending SQL, PGlite-proven)

**Files:** Create `docs/pending-migrations/separate-invoices.sql`, `docs/pending-migrations/separate-invoices.rollback.sql`, `tests/helpers/pglite-separate-invoices.ts` (follow `tests/helpers/pglite-*.ts`); Modify the Supabase generated types file for `invoices` (`kind`, nullable `quote_id`, `repeat_key`). Test `tests/batch3b-invoices-db.test.ts`.

- [ ] Failing tests (PGlite with the real `invoices` DDL from 0001/0002/0006/0008/0079/0144 + the new SQL): old installation row still valid; `repeat_safety_check` row with `quote_id` null and `repeat_key` set → ok; `rectification` row with null `quote_id` → rejected; repeat row without `repeat_key` → rejected; two repeat rows same `(job_id, repeat_key)` → rejected; second invoice on one quote → rejected; `invoice_status` view returns the new row; rollback restores the old constraints when no repeat rows exist.
- [ ] SQL: `ALTER TYPE quote_kind ADD VALUE IF NOT EXISTS 'repeat_safety_check'`; `invoices.quote_id DROP NOT NULL`; check `(kind = 'repeat_safety_check') = (quote_id IS NULL)`; `repeat_key text` + check `(kind = 'repeat_safety_check') = (repeat_key IS NOT NULL)`; unique index `(job_id, repeat_key) WHERE repeat_key IS NOT NULL`. Idempotent (re-runnable).
- [ ] RED → write → GREEN → commit `db(invoices): fixes and repeat safety check invoices (pending SQL, PGlite-proven)`.

### Task 2: Fixes get their own invoice

**Files:** Modify `src/lib/xero.core.ts:13-14,82,104-127` (reference with suffix; exact-match `findInvoiceByReference`; no VEEC line for `rectification`), `src/lib/xero.server.ts:149-206,437` (`createInvoiceForQuote` handles a rectification quote; remove `addRepairsToXeroInvoice`/`repairsStep`), `src/lib/portal.functions.ts:~677,~793` (fixes acceptance → `createInvoiceForQuote(rectQuoteId)` via the same once-only path as `invoice-after-acceptance.server.ts`), `src/lib/quotes.server.ts:95-101,165,177` (stop folding accepted fixes into the install quote); delete `src/lib/xero-repairs.core.ts` and its tests. Test `tests/batch3b-fixes-invoice.test.ts`.

**Interfaces — Produces:** `xeroReference(jobNumber: string, kind: "installation" | "rectification" | "repeat_safety_check", repeatNo?: number): string`; `createInvoiceForQuote(quoteId)` now valid for `kind = rectification`.

- [ ] Failing tests: `xeroReference("HV-1234","rectification")` = `Home Insulation Victoria HV-1234 fixes`; installation unchanged; accepting a fixes quote creates ONE `rectification` invoice (twice → still one) with only the fixes lines, total = fixes quote total; the install invoice row and Xero invoice are untouched; `findInvoiceByReference` for the install reference never returns the fixes invoice; generating an install quote after accepted fixes → no `electrical fixes:` lines; `superseded fixes` → newer accepted fixes quote gets its own invoice and an older UNPAID fixes invoice raises one Needs me row "Old fixes invoice unpaid — void it in Xero"; Xero failure → one `invoice_failed` row naming fixes, retried on sync.
- [ ] RED → implement → GREEN (+ `tests/*xero*`, `tests/*fixes*`, `tests/*quote*`, `tests/owner-fixes-flow.test.ts`) → commit `feat(invoices): electrical fixes get their own Xero invoice`.

### Task 3: Repeat safety check gets its own invoice

**Files:** Modify `src/lib/repeat-piesa.server.ts:100-160` (`acceptRepeatPiesa` → `createRepeatInvoice`; `repeatPaidFromInvoice` reads the repeat invoice), `src/lib/repeat-piesa.core.ts:121-127,159-164` (remove `repeatLineDue`; keep line description), `src/lib/xero.server.ts:455-510` (remove `repeatPiesaStep`/`addRepeatPiesaToXeroInvoice`, add `createRepeatInvoice`), sync call sites `xero.server.ts:240,276,469`. Test `tests/batch3b-repeat-invoice.test.ts`.

**Interfaces — Produces:** `createRepeatInvoice(jobId: string, repeatKey: string, priceIncGst: number): Promise<{ invoiceId: string }>` (once-only per `(jobId, repeatKey)`; `repeatKey` = the reopen tag already used by repeat-piesa; repeat number = count of earlier repeat invoices on the job + 2).

- [ ] Failing tests: owner accepts → one `repeat_safety_check` invoice, reference `Home Insulation Victoria HV-1234 safety check 2`, one line, total = price; accept twice → one; `second repeat` after another reopen → `… safety check 3`, first untouched; payer `installer`/`hivic` → no invoice; repeat counts paid when ITS invoice is fully paid (Xero) or the card row names its invoice; Xero failure → `invoice_failed` row naming the repeat check.
- [ ] RED → implement → GREEN (+ `tests/*repeat*`, `tests/batch1-*`) → commit `feat(invoices): repeat safety check gets its own Xero invoice`.

### Task 4: Payments per invoice

**Files:** Modify `src/lib/payments.core.ts:55-185` (plan per invoice; remove `repeatCreditCents`, `planQuoteTotalCents`, `fixesCountedCents`), `src/lib/payments.server.ts:149-282` (`jobPaymentView` loads install + newest fixes + current repeat invoice; gates; `afterPaymentsChanged`; bank reference per step), `src/lib/stripe.server.ts:29-56,85-141` (checkout `invoice_id` = the step's invoice), `src/lib/owner-myjob.server.ts:20-94`, `src/lib/payments.functions.ts` (`getOwnerPaymentPlan` unchanged shape). Test `tests/batch3b-payments.test.ts`.

**Interfaces — Produces:** `type JobInvoices = { install: InvoiceRow | null; fixes: InvoiceRow | null; repeat: InvoiceRow | null }`; `paymentSteps(plan, paid: { install: number; fixes: number; repeat: number }, facts, nowIso)`; `stepInvoice(view, step: PaymentStepKey): InvoiceRow | null`.

- [ ] Failing tests: safety check / deposit / balance thresholds from install money only (same numbers as today without fixes); fixes step paid ⇔ fixes invoice paid in full; repeat step paid ⇔ repeat invoice paid in full; `fixes card stays on fixes` → checkout for `fixes` carries the fixes invoice id and amount = fixes outstanding; afterwards the 10% deposit is still unpaid and only requested once the install is being booked; `deposit waits for fixes done` → a job with paid but not-yet-done fixes has the 10% step `not_yet` (never requested), and it becomes requested only after the fixes are done; fixes scheduling gate opens only when the newest fixes invoice is paid; repeat visit booking waits for the repeat invoice; bank reference for fixes = fixes invoice number; owner pay card lists each step with its own amount.
- [ ] RED → implement → GREEN (+ `tests/payments*`, `tests/stripe*`, `tests/*my-job*`, `tests/batch3a-*`) → commit `feat(payments): each step is paid on its own invoice`.

### Task 5: Readers that assumed one invoice

**Files:** `src/lib/assignment.server.ts:319` (limit 1 newest installation), `src/lib/office-needs.server.ts:127,163,471,524` (unpaid alert: one row per kind), `src/components/portal/panels.tsx:466-509` (card labelled Install / Electrical fixes / Safety check 2 with its reference), `src/lib/trade-view.core.ts:93-95` + `src/lib/installer-pay-timing.server.ts:14` + `src/lib/trade-view.server.ts:434,1001` (installer "paid in full" = install invoice; electrician fixes pay = fixes invoice), `src/lib/workflow.server.ts:318` (install invoice only), `src/lib/office-actions.server.ts:226` (refund check on the install invoice only), office Money / job page listing (`office-money.server.ts:236-244`, `office-job-page.server.ts:90-157`). Any other reader found by `rg "from\(\"invoices\"\)"` that would mix kinds. Test `tests/batch3b-readers.test.ts`.

- [ ] Failing tests: job with install + fixes + repeat rows → assignment read doesn't throw; Needs me shows the install unpaid row AND a fixes unpaid row; installer pay released when the install invoice is paid even with an unpaid fixes invoice; electrician fixes pay waits for the fixes invoice; `reopen refund install only` → a fixes refund doesn't trigger a repeat charge; office Money lists three invoices with their references.
- [ ] RED → implement → GREEN (+ `tests/*needs*`, `tests/*trade-view*`, `tests/*installer-pay*`, `tests/office-*`) → commit `fix(invoices): every reader picks the right invoice`.

### Task 6: Docs and clean-up
- [ ] `src/AGENTS.md`, `AGENTS.md` and `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` payment bullets: one invoice per kind; retired-scan entries for "added to the Xero invoice" fixes/repeat wording; no dead references to removed functions (`rg` clean). Commit `docs(invoices): separate invoices for fixes and repeat checks`.

### Task 7: Whole-branch check
- [ ] Full suite per file vs baseline; tsc (only xlsx); retired scan 0; final whole-branch review + one fix wave; push. Ask Jo (box) before running `separate-invoices.sql` live; then open the PR (REST API) noting the SQL must be live before merge. Stop — no merge, no publish.
