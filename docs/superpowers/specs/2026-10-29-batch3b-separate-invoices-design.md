# Batch 3b — separate invoices for fixes and repeat safety checks (design)

Date: 29 Oct 2026 · Owner: Jo · Branch `fix/batch3b-separate-invoices` (from main after batch 3a). Ends with an open PR — no merge, no publish (another chat merges). Live database change only after Jo says yes, asked just before.

## In plain words

| | Today | After |
|---|---|---|
| Electrical fixes | Added as a line to the job's one Xero invoice. Xero refuses (the $349 is already paid) → stuck as a Needs me row | Own Xero invoice, made when the owner approves the fixes. Paid in full (card, bank transfer or PayID) before the fixes can be scheduled, like the $349 |
| Fixes approved before the install quote | Folded into the install quote and invoice | Still their own invoice. The install quote never includes fixes |
| Repeat safety check after a reopen | Added as a line to the one invoice → usually stuck | Own Xero invoice, paid before the visit is booked |
| Install invoice | Gets edited when fixes / repeat are added | Install items only — including the $349 safety check (PIESA) and the $349 AP fee, as today. Never edited after it's sent |
| Installer pay | Waits until every dollar on the job is paid | Waits for the install invoice only |

**Payment order (Jo, 29 Oct):** $349 before the safety check (PIESA) → if it finds fixes, all the fixes paid before the fixes day and time is confirmed → once the fixes are done, 10% to book the install date → balance on install day.

References (agreed): "Home Insulation Victoria HV-1234 fixes" and "Home Insulation Victoria HV-1234 safety check 2". No other new owner wording. No live jobs, so nothing old to move.

## Technical detail

**1 Database (one migration, tested on PGlite first; applied live only after Jo's OK).**
- `quote_kind` gains `repeat_safety_check` (used by `invoices.kind` only — no quote rows of that kind).
- `invoices.quote_id` nullable, with a check: required unless `kind = 'repeat_safety_check'`. `invoices_quote_id_key` (unique per quote) stays — a fixes invoice points at its own accepted rectification quote.
- New `invoices.repeat_key text` (the repeat's reopen tag), check: set iff kind is `repeat_safety_check`; unique `(job_id, repeat_key)`.
- `invoice_status` view and owner column grants include the new rows unchanged.

**2 Making the invoices.**
- Fixes: on fixes-quote acceptance (`portal.functions.ts` ~677/793), replace `addRepairsToXeroInvoice` with `createInvoiceForQuote(rectQuote)` → kind `rectification`, reference "… HV-1234 fixes", lines = the fixes quote lines (no VEEC line). Once-only by `quote_id`.
- Repeat: on repeat acceptance (`repeat-piesa.server.ts` ~100-113), replace `addRepeatPiesaToXeroInvoice` with `createRepeatInvoice(job, tag, price)` → kind `repeat_safety_check`, reference "… HV-1234 safety check 2" (3, 4… for later repeats), one PIESA line with today's description. Once-only by `(job_id, repeat_key)`.
- Install quote building (`quotes.server.ts` ~95-101, 165, 177): stop folding accepted fixes lines in.
- `findInvoiceByReference` matches the exact reference, so the three invoices never pick each other up.
- Retired: the "add a line to a paid invoice" path (`xero-repairs.core`, `repairsStep`, `repeatPiesaStep`, `repeatLineDue`, held rows `repairs_xero_held` / `repeat_piesa_xero_held`) — removed, not left half-used.

**3 Payments per invoice.** Each step reads its own invoice's money:
- safety check, 10% install deposit, balance → install invoice (same thresholds as today, minus fixes/repeat).
- fixes → fixes invoice paid in full. Repeat → repeat invoice paid in full.
- `repeatCreditCents`, `planQuoteTotalCents`, `fixesCountedCents` fold maths and `paid_before_cents` are no longer needed and go.
- `jobPaymentView` returns the install invoice plus the fixes / repeat invoices; Stripe checkout uses the invoice of the step being paid (`metadata.invoice_id`); the webhook already records per invoice. Bank-transfer reference shown per step = that invoice's number.
- Gates: fixes scheduling waits for the fixes invoice; repeat visit booking waits for the repeat invoice; install deposit/balance gates unchanged.
- Reopen "was it refunded" check counts reversals on the install invoice only.

**4 Readers that assume one invoice.** Each `kind=installation` reader stays on the install invoice. Fixed where needed: `assignment.server.ts:319` (`maybeSingle` with no limit), office Needs me unpaid alert (`office-needs.server.ts:471`, latest of any kind → one row per kind), `panels.tsx:466` (each card labelled by its kind), installer "paid in full" (`trade-view.core.ts:93`, `installer-pay-timing.server.ts`) → install invoice only; electrician fixes pay → fixes invoice; `workflow.server.ts:318` deposit sum → install invoice. Full list from the read-through goes into the plan.

**5 Owner and office screens.** My job pay card: each step pays its own invoice (wording unchanged). Office Money and job page: install, fixes and repeat invoices listed separately with their reference.

## Testing
Test-first per item. Migration on PGlite (old rows still valid, repeat without quote allowed, fixes needs a quote, duplicates refused). Card/bank payment on fixes and repeat lands on the right invoice and opens the right gate; install steps unaffected by fixes money; installer pay not held by an unpaid fixes invoice; Needs me shows one row per invoice type. Existing payments / stripe / xero / repeat / fixes tests updated; full suite vs baseline; tsc; retired scan.
