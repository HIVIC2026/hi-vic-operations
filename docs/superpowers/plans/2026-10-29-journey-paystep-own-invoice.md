# Plan: test tool pays each step on its own invoice

Spec: `docs/superpowers/specs/2026-10-29-journey-paystep-own-invoice-design.md`

### Task 1: pick the step's invoice (test first)
**Files:** Create `tests/journey-paystep-invoice.test.ts`; Modify `src/lib/journey.server.ts` (`payStep`, ~line 297).
**Produces:** `export function payStepInvoiceId(view: { invoices: JobInvoices }, step: PaymentStepKey): string` in
`src/lib/journey.server.ts` (pure; uses `stepInvoice` from `./payments.server`; throws
`No <step> invoice on this TEST job yet` when null).

- [ ] Step 1: Write failing tests (bun:test): view `{ invoices: { install: {id:"inst"}, fixes: {id:"fix"}, repeat: {id:"rep"} } }`
  - `fixes` → `"fix"`; `safety_check`, `install_deposit`, `balance` → `"inst"`; `repeat_safety_check` → `"rep"`
  - fixes null → throws; never returns `"inst"`
- [ ] Step 2: `bun test ./tests/journey-paystep-invoice.test.ts` → FAIL (not exported)
- [ ] Step 3: Add `payStepInvoiceId`; in `payStep` replace `v!.invoiceId` with `payStepInvoiceId(v!, step)`.
  If importing `stepInvoice` pulls the server module into the test, put `payStepInvoiceId` in `src/lib/journey.core.ts`
  using `stepInvoiceKind` from `./payments.core` instead (same result).
- [ ] Step 4: Run → PASS. Also run `tests/batch3b-*.test.ts`, `tests/payments.core.test.ts`, `tests/journey.core.test.ts`.
- [ ] Step 5: Commit.

### Task 2: final checks and pull request
- [ ] Type check (`NODE_OPTIONS=--max-old-space-size=6000 node node_modules/typescript/bin/tsc --noEmit -p .`); only known xlsx errors allowed.
- [ ] Independent review of the diff.
- [ ] Open PR; merge (Jo's merging chat); Lovable syncs.
- [ ] Ask Lovable to rerun `m11-fixes-payment` on TEST jobs (same rules as before). Report to Jo; then ask about publishing.
