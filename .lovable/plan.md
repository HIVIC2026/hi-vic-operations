# Xero integration audit and hardening plan

## Read-only findings (no Xero writes made)
- Connected organisation: DC Construction Solutions Pty Ltd (the only one).
- Tracking categories: one category, **"Projects"**, with an active option **"Home Insulation Victoria"** (and "DC Constructions"). Nothing needs creating.
- Existing Xero invoices with an `HV-` reference: **none**, so no duplicates exist today.

## What is already in place
| Requirement | Status |
|---|---|
| Accepted quote drives the invoice | Done. Lines come from `quote_items`; one invoice per quote (unique `invoices.quote_id`). |
| Deposit gate from Xero or audited override | Done. `invoice_deposit_cleared` = `deposit_paid_at` (set only from Xero `AmountPaid`) OR a `payment_overrides` row (reason, actor, before/after). Simulate button refuses when Xero is linked. |
| Balance due = installation date | Partly. `createBooking` writes `balance_due_date` from the start timestamp's UTC date. |
| PIESA 30-day and Owner Authority blockers | Done. Checked in `createBooking` and `stageEntryBlockers` before the deposit check. |
| Customer/trade exposure | Done. Owners read the `invoice_status` view (no Xero IDs or errors). Trades get no invoice rows. Xero IDs and errors show only when `isAdmin`. |
| Admin sync state and retry | Partly. Status, IDs and error are shown; "Retry Xero push" appears only when there's no Xero invoice ID. |

## Gaps (smallest fixes)
1. **Duplicate risk on retry (main gap).** If Xero creates the invoice but the response is lost (timeout or 5xx), the next retry POSTs again. Two clicks at once can also both POST. Contacts have the same risk.
   - Send Xero's `Idempotency-Key` header, derived from our IDs: `hivic-contact-<owner_id>` and `hivic-invoice-<invoice_id>`.
   - Before creating an invoice, run a read-only lookup by Reference. If one exists, adopt it instead of creating another.
   - Before creating a contact, look one up by email (or else by exact name) and reuse it.
   - Claim a lock with a conditional update (`sync_lock_at` stays null or goes stale after 2 minutes) so only one push runs at a time.
2. **Contact naming.** The contact name currently includes the job number (`Name (HV-1007)`), which makes a new contact for every job. Change it to the owner's full name, matched by email.
3. **Reference and description.** Change the Reference to `HI VIC <job_number>` (for example `HI VIC HV-1007`). Prefix line descriptions with `HI VIC <job_number> –`. Tag every line with the tracking category Projects = Home Insulation Victoria, looked up by name at push time. If it's missing, the push fails with a clear message. The legal entity stays the Xero organisation. `option_label` is kept only in the line text.
4. **Accepted-quote guard.** Push only if the quote's status is `accepted` and the invoice total equals `customer_total_inc_gst`. Otherwise record a sync error, not a Xero call.
5. **Balance due date.** Convert the booking start to an Australia/Melbourne date (a UTC slice can land a day early). Clear or reset it when the installation booking is cancelled or rebooked. Only the portal record changes; Xero's DueDate is not changed.
6. **Payment truth.** Ignore `VOIDED` or `DELETED` Xero invoices (keep the gate locked and show an error). Take `deposit_paid_at` from Xero's payment date where available, not the current time.
7. **Admin retry safety.** One "Sync with Xero" action handles both cases: push if not linked, pull if linked. It's disabled while the lock is held, and shows the last attempt time. The error text stays admin-only.

## Database changes
- `invoices`: add `sync_lock_at timestamptz` and `xero_tracking_option_id text` (admin-only; not added to the `invoice_status` view).
- No other schema changes. RLS and views are unchanged.

## Tests (no live Xero writes)
- Unit-test `xero.server.ts` with a mocked `fetch`:
  - A response that times out after creation, then a retry: the Reference lookup finds and adopts the invoice, so there's one POST in total.
  - Two pushes at once: the lock allows one POST.
  - An existing contact by email is reused, with no contact POST.
  - The Idempotency-Key header is present and stable across retries.
  - The payload has Reference `HI VIC HV-xxxx`, the tracking option on every line, Inclusive GST, and totals matching the accepted quote.
  - A quote that isn't accepted or has a mismatched total gets no POST and a sync error.
  - `AmountPaid` below, equal to and above the deposit sets the right `deposit_paid_at`; a VOIDED invoice keeps the gate locked.
- Workflow tests with the Xero module mocked:
  - Booking is blocked without a deposit, and allowed with an audited override (row plus before/after).
  - PIESA-expired and authority-invalid bookings are still blocked even with a deposit paid.
  - An installation booking at 23:30 UTC sets the next day's Melbourne date as the balance due date.
- Security checks against the database using role sessions:
  - An owner reading `invoice_status` gets no Xero ID or error columns.
  - An installer or electrician gets zero invoice, override or sync-log rows.
- Live Xero only for read-only GETs (connections, tracking categories, invoice lookup by Reference).

## Technical notes
- Files: `src/lib/xero.server.ts` (most changes), `src/lib/portal.functions.ts` (booking date and single sync action), `src/components/portal/panels.tsx` (admin sync button state), one migration.
- The Xero Idempotency-Key header is supported on POST/PUT in the Accounting API.
