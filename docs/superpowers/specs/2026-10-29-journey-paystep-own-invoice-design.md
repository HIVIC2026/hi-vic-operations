# Test tool pays each step on its own invoice (Jo 29 Oct 2026)

## Why
Lovable's TEST check of batch 3b (29 Oct, HV-3585, branch `m11-fixes-payment`) failed: the portal made the separate
FIXES invoice correctly, but the journey runner's `payStep` paid the $980 onto the INSTALL invoice, because it always
uses `jobPaymentView(...).invoiceId` (the installation invoice). The fixes step stayed unpaid. The repeat check passed
(`m158-owner-pays` pays the repeat invoice directly).

This is a test tool bug only. Real owner payments already use `stepInvoice` (batch 3b).

## Change (test tool only)
- `payStep` in `src/lib/journey.server.ts` pays the step's own invoice, picked with the existing
  `stepInvoice(view, step)` from `payments.server.ts`: fixes → fixes invoice; repeat safety check → repeat invoice;
  safety check, install deposit, balance → installation invoice.
- If that invoice doesn't exist, `payStep` throws a clear error naming the step (never falls back to another invoice).
- The choice lives in one small exported helper, `payStepInvoiceId(view, step)`, so it can be tested without a database.

## Not changing
Anything owners, trades or the office see; real payment code; Xero; Stripe; settings; database.

## Checks
- New test `tests/journey-paystep-invoice.test.ts`: fixes → fixes invoice id; install steps → install id; repeat →
  repeat id; missing fixes invoice → throws, never returns the install id.
- Existing batch 3b and payments tests still pass; type check clean apart from known xlsx errors.
- After merge: Lovable reruns `m11-fixes-payment` on TEST jobs under the same rules as before (report files and
  temporary TEST business settings allowed, put back after). Pass = fixes invoice paid, install invoice unchanged.
