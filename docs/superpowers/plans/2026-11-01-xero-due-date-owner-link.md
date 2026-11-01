# Xero due date + owner link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Xero installation invoice is due on the install day, or 30 days after acceptance until one is booked. Owners no longer get a link to the Xero invoice.

**Architecture:** Change the pure rules in `invoice.lifecycle.ts`, switch on the existing guarded due-date update in `xero.core.ts` / `xero.server.ts` (the 15-minute Xero poll already runs it), and drop the owner Xero link from the shared invoice card.

**Tech Stack:** TypeScript, bun test, React (TanStack Start), Supabase, Xero API.

**Spec:** `docs/superpowers/specs/2026-11-01-xero-due-date-owner-link-design.md`

## Global Constraints
- Before an install day is booked: due date = **30 days after the quote was accepted** (`deposit_due_date + 30` calendar days, `YYYY-MM-DD`).
- Install day booked: due date = install day (existing `balance_due_date`).
- Invoices already in Xero: no backfill. Payment steps, amounts, gates: unchanged.
- Read `src/AGENTS.md` and `src/lib/AGENTS.md` before editing. Never force-push.
- Pull request only; Jo merges. Nothing published.

## Review Focus
- Month/year rollover: accepted 2026-12-15 → due 2027-01-14 (Task 1 test).
- Install cancelled on an invoice not yet in Xero: no pending flag (Task 1 test).
- Fully paid invoice: no date changes either way (existing test kept, Task 1).
- Pending update with no install day must send acceptance + 30, not skip (Task 2 test).
- Office still has a Xero link after the owner link goes (Task 3 check: office-job.tsx / Money card links untouched).

---

### Task 1: Due-date rules (pure)

**Files:**
- Modify: `src/lib/invoice.lifecycle.ts` (`xeroDueDate`, `clearInstallDueDatePatch`)
- Test: `tests/xero.core.test.ts` ("installation date drives the same invoice's due date")

**Interfaces:**
- Produces: `xeroDueDate(row: Pick<InvoiceRow, "balance_due_date" | "deposit_due_date">): string | null` — `balance_due_date` if set, else `deposit_due_date` + 30 days, else null. Export `PRE_INSTALL_DUE_DAYS = 30`.
- Produces: `clearInstallDueDatePatch(row)` → `{ balance_due_date: null, xero_update_pending: !!row.xero_invoice_id }` (null when fully paid or already null, as now).

- [ ] **Step 1: Update failing tests**
  - "before booking": `expect(xeroDueDate(r)).toBe("2026-10-28")` (accepted 2026-09-28).
  - New: `xeroDueDate({ balance_due_date: null, deposit_due_date: "2026-12-15" })` → `"2027-01-14"`.
  - Cancellation: linked (`r.xero_invoice_id = "XI"`) → after `clearInstallDueDatePatch`, `r.xero_update_pending === true` and `xeroDueDate(r) === "2026-10-28"`; unlinked → `xero_update_pending === false`. Keep the fully-paid assertions.
- [ ] **Step 2: Run** `bun test tests/xero.core.test.ts` → the updated tests FAIL.
- [ ] **Step 3: Implement** date maths on the `YYYY-MM-DD` string in UTC (`Date.UTC` + 30 days, `toISOString().slice(0,10)`), no timezone shift.
- [ ] **Step 4: Run** `bun test tests/xero.core.test.ts` → PASS (except the `XERO_DUE_DATE_UPDATES_ENABLED` line, handled in Task 2).
- [ ] **Step 5: Commit.**

### Task 2: Send the date to Xero

**Files:**
- Modify: `src/lib/xero.core.ts:53` (`XERO_DUE_DATE_UPDATES_ENABLED = true`)
- Modify: `src/lib/xero.server.ts` `syncInvoiceFromXero` (the `xero_update_pending` block)
- Test: `tests/xero.core.test.ts`, new `tests/xero-due-date-sync.test.ts`

**Interfaces:**
- Consumes: `xeroDueDate` from Task 1.
- The update block runs when `inv.xero_update_pending && XERO_DUE_DATE_UPDATES_ENABLED`, sends `buildDueDateUpdate(id, xeroDueDate(inv), invoiceId)`, logs `Xero due date updated to <date>`. Skip (and clear the flag) only if `xeroDueDate(inv)` is null.

- [ ] **Step 1: Failing tests**
  - `xero.core.test.ts`: `expect(XERO_DUE_DATE_UPDATES_ENABLED).toBe(true)`.
  - `xero-due-date-sync.test.ts`: pure helper `pendingDueDateUpdate(inv)` (export from `xero.core.ts`): `{ xero_update_pending: true, balance_due_date: null, deposit_due_date: "2026-11-01", xero_invoice_id: "XI", id: "i1" }` → body DueDate `"2026-12-01"`; with `balance_due_date: "2026-11-20"` → `"2026-11-20"`; `xero_update_pending: false` → `null`.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement** `pendingDueDateUpdate(inv): ReturnType<typeof buildDueDateUpdate> | null` in `xero.core.ts` and use it in `syncInvoiceFromXero`; flip the switch.
- [ ] **Step 4: Run** both files + `tests/xero-poll-eligible.test.ts` + `tests/batch3b-*.test.ts` → PASS (compare any failure against main).
- [ ] **Step 5: Commit.**

### Task 3: Owner doesn't see the Xero invoice

**Files:**
- Modify: `src/lib/invoice.lifecycle.ts` (`CUSTOMER_INVOICE_COLUMNS`: remove `"xero_online_url"`)
- Modify: `src/components/portal/panels.tsx` (invoice card: remove the "View / pay invoice" `<a>`; drop `xero_online_url` from `CustomerInvoice`)
- Test: `tests/xero.core.test.ts` ("privacy and compliance")

- [ ] **Step 1: Failing test:** add `"xero_online_url"` to the forbidden list.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the two removals. Leave `office-job.tsx:239` and `panels.tsx` "Xero online invoice (office view)" untouched.
- [ ] **Step 4: Run** `bun test tests/xero.core.test.ts`, `grep -n "View / pay invoice" src` → no matches; type check the touched files (no new errors vs main).
- [ ] **Step 5: Commit.**

### Task 4: Finish
- [ ] Run the touched test files and compare against main; run `bun scripts/scan-retired-terms.ts` (0 customer-visible).
- [ ] Push branch `fix/xero-due-date-owner-link`, open the pull request (do not merge).
