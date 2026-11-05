# 50% install deposit — design

Date: 5 Nov 2026 · Asked for by: Jo · Status: approved in chat, spec waiting for Jo's review

## What Jo asked for

"Change our payment to 50% deposit and the rest due on install day. Make sure this reflects in every single template and every single email and text and invoice etc."

## Decisions (Jo, 5 Nov 2026)

| Question | Answer |
| --- | --- |
| 50% of what? | 50% of (quote total after rebate − the $349 safety check already paid). The install-day balance is the other 50%. |
| Open jobs already shown "10%" | Switch them all to 50%. |
| Customer Agreement | New version **1.4**. Only the deposit % changes. New quotes and all open jobs use 1.4. Signed 1.3 copies stay untouched as records. |
| Refund rule | Same as now: deposit refunded if the owner cancels at least 2 business days before the install day. |
| HV-3238, HV-3239, HV-3273 (accepted, signed 1.3) | Switch to 50%, no email. Jo was told this may be a consumer-law risk and to check with her lawyer. |
| HV-3117, HV-3193, HV-3197, HV-3497, HV-3674 (quote sent, not accepted) | Quote page shows 50% from now on. No new email. |

## What changes

1. **The amount.** `INSTALL_DEPOSIT_RATE` in `src/lib/payments.core.ts` goes from `0.10` to `0.50`. Deposit = remaining × 50%, rounded half up to the cent; balance = remaining − deposit (so the halves can differ by 1 cent at most). `workflow-decisions.ts` `deposit.installPct` goes to 50. Every amount is already worked out from this rate, so every screen, email, PDF, Xero and Stripe amount follows.
2. **The wording.** Every place that tells owners, trades or the office "10%" (deposit) or "90%" (balance) says "50%" instead — no other words change. Live code places found (59 files under `src/`), including:
   - Owner emails and texts: quote email, acceptance, "You're clear to install", deposit request + day-3 reminder + "upgrades to come" reminder, deposit received, install booked, "All done"/balance, SMS wording.
   - Owner pages: quote page, My job, confirm-and-pay page (`OwnerConfirmSignPay.tsx`), payment step labels ("Install deposit (10%)" → "Install deposit (50%)").
   - PDFs: Customer Agreement + payment terms, signed acceptance, deposit receipt, final receipt, tax invoice.
   - Xero invoice line descriptions and Stripe payment descriptions.
   - Office screens (job page, Money, Needs me, stage cards, settings) and installer screens/emails (owner accepted, install day, deposit released).
   - AI reply answers in code (`ai-answers.core.ts`) and the 2 matching rows in the `ai_reply_answers` table; 1 row in `compliance_templates`.
   - Code comments that state the rule, so the next builder isn't misled.
3. **Customer Agreement 1.4.** Copy of 1.3 with "10%" → "50%" in the summary, payment terms table and refunds section. Version string → `customer-agreement-1.4`. New database row for 1.4 (the 109 signed 1.3 copies are not touched).
4. **Staff guide** (Tom & Dad doc): the money table and steps say 50% / 50%.

## What does NOT change

- The "10% a year" Victorian penalty interest line in the agreement.
- Payment order, when the deposit is due (straight after the PIESA result), the noon-day-before deposit deadline, and "no install booking until the deposit is paid".
- Payment methods (card, bank transfer or PayID).
- The refund rule.
- Anything else "10%" that isn't the deposit (e.g. layout sizes, the old unused `required_deposit_amount` database function — not called by any code, left alone).

## Existing jobs

No owner has been asked for, or paid, a 10% deposit (checked 5 Nov: furthest job is HV-3682 at PIESA scheduled; stored `invoices.deposit_amount` holds the $349 step only). Because amounts are worked out live, open jobs switch with no data change. Their already-sent emails and PDFs still say 10% — accepted by Jo.

## Checks

- Unit tests that expect 10%/90% are updated to 50%/50%, plus one new test: a $3,349 quote → $349, then $1,500 deposit, $1,500 balance; an odd-cent case shows the 1-cent split.
- A final search of `src/` for deposit "10%"/"90%" wording returns nothing.
- Rendered samples of every changed owner email, text, page and PDF go to Jo to see before anything goes live.
- The Base44 website (homeowner page) is searched for deposit wording; anything found is listed for Jo rather than changed without asking.

## How it goes live

One branch and pull request. Database changes (2 AI answers, 1 template, agreement 1.4 row) are run only after Jo says yes to each. Nothing is merged until Jo says go.
