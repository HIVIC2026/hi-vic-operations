# Website owner jobs — workflow audit, 28 Oct 2026

Target: code at `main` 0e5d966 + live settings (read-only). Cloud session: no TEST logins, so every signed-in screen check is **blocked**. This shows the listed checks on this version; it does not prove the portal has no other bugs.

**Verdict: the process is sound and in the right order, but 4 things should be fixed before real money flows through it.**

Your decisions from the walk-through are in `decisions.md`.

## Stop launch

1. **Owner can cancel after paying the $349 and nobody follows up.** "Cancel my job" works until the safety check is *booked* — after the $349 is paid. The trade isn't told or released, the office gets no Needs me row, and the event says "No charge" although a refund is owed. `owner-myjob.core.ts:97-103`, `owner-myjob.server.ts:128-136`. *Verified.*
2. **Reopening a cancelled job can show it as "booked" when nothing is.** Reopen puts the old stage straight back, but cancel already removed the bookings and trades. `office-actions.server.ts:115-118`. *Verified.*
3. **Failed Xero invoice is invisible.** Owner accepts, invoice step fails → logged as `invoice_create_failed`, read by nothing. Owner gets no Pay now; no alert ever. `portal.functions.ts:828-837`. *Verified.*
4. **Electrician pay doesn't show until Final check.** Safety-check bookings are never marked done on real jobs, so the electrician's Approve button only appears at `ready_for_veec`. Breaks "paid 7 days after Approve, never waits on the owner". `office-money.server.ts:127,181`. *Verified.*
5. **One card payment can count twice** if the Stripe payout is entered in Xero without the Stripe id in the reference — that extra $349 can unlock the install deposit. `payments.core.ts:351-366`. *Likely; depends on how Xero is reconciled.*

## Fix soon

6. Texts held after 8pm are lost for spot saved, quote ready, safety-check confirm (+ reminders), rebate-form sign, deposit release, new visit times, no-access; also installer clearance, boss price link, fixes times, Ready Check texts. (Covered by your decision 2.)
7. Approved texts switched off live (your decision 1).
8. Expired quote: job stuck, no alert (your decisions 3–4). `quote-expiry.server.ts:18-20`.
9. AI email drafts for owners still waiting on a spot promise a Ready Check and installer contact — breaks your "spot-only" rule. `ai-email-reply.core.ts:82,97-102`.
10. Re-sending a reopened declined quote sends nothing (same quote id = same once-only key). `office-quote-review.server.ts:80-83`.
11. Needs me misses uncertain sends, held texts and partner-only failures. `send-failed.core.ts:9-11`.
12. Owner STOP after an installer accepted cancels the job but leaves the installer attached and untold. `sms-stop.server.ts`.
13. Owner cancel doesn't save the earlier stage, so it can't be reopened. `owner-myjob.server.ts:128`.
14. Fixes almost never add to the Xero invoice automatically (Xero won't edit an invoice with a payment on it, and the $349 is always paid) → office edits by hand every time. `xero-repairs.core.ts:83-85`.
15. Repeat safety check can be marked paid by the deposit, and a card payment for it isn't picked up until a Xero sync. `repeat-piesa.core.ts:90`.
16. Every owner's signed acceptance record carries retired wording (deposit / 3 instalments). `portal.functions.ts:807`.

## Polish

- Office invoice panel shows the wrong 10% once fixes are on the invoice (`panels.tsx:477`); two event notes say "raise the deposit request in Xero".
- Old 50% / `awaiting_deposit_payment` path and `electrical_variation_pending` stage still in code (legacy jobs only).
- Rule book docs out of date (your decision 7).

## Checked and correct

Spot saved → release → owner confirms → one installer offer; Ready Check times; payment gate blocks safety check until $349 paid, fixes visit until fixes paid, install until 10% paid; owner must confirm the safety check before install booking; deposit = 10% of install price only; one invoice per quote; Stripe double-callback recorded once; trades see owner contact only after accepting; new-sender reply links /homeowner; manual email Send has no 8pm hold; TEST jobs only use test senders and Stripe test keys; enquiry piles don't overlap; retired-word scan 0 customer-visible.

## Tests

763 test files. 7,021 checks pass. 79 files fail on every run: none was a real app bug on checking — ~75 are old tests still checking replaced rules or fake test databases missing new columns, 4 need things this machine can't reach. These old tests should be updated so the suite is useful again.

## Blocked (needs to run inside Lovable with TEST logins)

Every signed-in screen at phone and computer width; `bun run journey` end to end; role refusals; speed. Live probes from here: payment/Xero/robot automations correctly refuse unsigned calls (401); the other hooks and pages couldn't be reached through this network.
