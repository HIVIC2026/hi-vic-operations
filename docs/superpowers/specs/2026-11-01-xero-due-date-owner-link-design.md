# Xero invoice due date + owner link — design

Date: 1 Nov 2026 · Asked by: Jo · Status: approved in chat, spec waiting for Jo's OK

## Why
HV-3666: the Xero installation invoice (INV-1905, $5,988) shows the full amount due on the day the quote was accepted.
The owner's My job page links to it ("View / pay invoice"), so it looks like everything is due now. Only the $349 is due
now. Jo decided to keep one full invoice per job (1 Nov), and not to use separate invoices or Xero's deposit request.

## What Jo asked for (stated, 1 Nov 2026)
1. Owners don't see the Xero invoice. They keep paying each step from their portal page: $349 → 10% → balance.
2. Xero due date = install day. Before an install day is booked: **30 days after the quote was accepted**.

## Current behaviour (evidence)
- `xeroDueDate(row)` (`invoice.lifecycle.ts`) = `balance_due_date ?? deposit_due_date`. `deposit_due_date` = acceptance day.
- `setInstallDueDate` sets `balance_due_date` to the install day and flags `xero_update_pending`. `syncInvoiceFromXero`
  sends the update only when `XERO_DUE_DATE_UPDATES_ENABLED` (`xero.core.ts`) is true. It is `false`.
- `clearInstallDueDatePatch` (install cancelled) sets `balance_due_date: null, xero_update_pending: false`, so Xero keeps
  the old install date.
- Owner link: `panels.tsx` invoice card shows `View / pay invoice` (`xero_online_url`) to non-admin viewers.
  `xero_online_url` is in `CUSTOMER_INVOICE_COLUMNS`.
- The 15-minute Xero payment poll calls `syncInvoiceFromXero`, so pending date updates go out within 15 minutes.

## Design

### 1. Due date rule (pure, `invoice.lifecycle.ts`)
- `xeroDueDate(row)` = `balance_due_date` when set; otherwise `deposit_due_date + 30 days` (calendar days, date only).
- New invoices get this date when first pushed.
- Install cancelled: `clearInstallDueDatePatch` keeps `balance_due_date: null` and sets `xero_update_pending: true` when
  the invoice is linked to Xero, so Xero goes back to acceptance + 30 days.
- `syncInvoiceFromXero` sends `xeroDueDate(inv)`, not `inv.balance_due_date`, so the fall-back date is sent too.

### 2. Switch on due-date updates
- `XERO_DUE_DATE_UPDATES_ENABLED = true`. Existing guards stay (HIV reference check, idempotency key per date).
- Fully paid invoices are untouched (existing rule).

### 3. Owner doesn't see the Xero link
- `panels.tsx` invoice card (shared by owner and office): remove the "View / pay invoice" link.
- Remove `xero_online_url` from `CUSTOMER_INVOICE_COLUMNS` (the only reader is that card), so the owner's data never carries it.
- The office keeps its own Xero links on the job page and Money card ("Xero invoice (office view)"), unchanged.

### Not changing
- Invoices already in Xero (incl. INV-1905). No backfill.
- Payment steps, amounts, gates, card/bank options, office screens.

## Testing
- Unit: `xeroDueDate` — no install day → acceptance + 30 (incl. month/year rollover); install day set → install day.
- Unit: `clearInstallDueDatePatch` on a linked invoice → pending update; unlinked → no pending flag.
- Unit: a pending update with no install day sends acceptance + 30.
- Owner columns no longer include `xero_online_url`; the owner invoice card renders no Xero link.
- Existing invoice/Xero tests still pass (compared against main).
- Pull request only. Jo merges; nothing is published by Claude.
