# Repeat safety check: owner page and payment — 2 fixes

Date: 29 Oct 2026. Design approved by Jo in chat. This spec is for her sign-off.

Both bugs came from Lovable's issue scanner and were checked against the code first — both are real.
A third item (restore the step 8 completion pack check in `journey.server.ts`) needs no work: it is already
back on main in commit 8a013c3f (29 Oct, 08:51).

## 1. Owner's job page stuck on the repeat card

**Today:** after the owner accepts the repeat safety check (and pays it, if they owe it), `ownerRepeatView`
returns the "We're arranging your electrician" card at stage `offer`, and that stage never ends. While the card
shows, `my-job.$token.tsx` (`Home` and `BookPickers`) replaces the whole booking area with it, so the
electrician's safety check times and the install day picker never appear.

**Fix:** the repeat card only shows while the owner or office has something to do:

| Repeat stage | Owner page |
|---|---|
| `choose` (office picking who pays) | Repeat card: "We're arranging the next step" (unchanged) |
| `owner_accept` | Repeat card with Accept (unchanged) |
| `owner_pay` | Repeat card asking them to pay (unchanged) |
| `offer` (accepted, and paid if they owe it) | **No repeat card.** Normal page and booking area, as for any job |

- Change: `ownerRepeatView` returns `null` at stage `offer`. The page code needs no change.
- At `offer` the normal booking area already shows "Your electrician will offer you 3 safety check times
  shortly", then the times to tap, then later the install day picker.
- Not changed: the office repeat panel, the repeat gate on booking, wording on the other stages.

## 2. Repeat safety check still owing after the owner pays

**Today:** the repeat step sits last in the payment steps and counts as paid only once ALL money for the job
is in (its threshold is the grand total, balance included). Money the owner pays for it is counted toward the
install deposit instead. Card payments for it only count at the next Xero sync.

**Fix (Jo: "repeat is due first", "card counts straight away"):**

1. **Its own money.** The repeat step is taken out of the running total that the other steps use.
   - Money credited to the repeat check = the money paid since the owner accepted it, up to its price
     (the same "paid since acceptance" rule the repeat gate already uses, `paid_before_cents` on the accepted
     event). Once the repeat paid event is recorded, the full price is credited.
   - The repeat step shows **paid** when the repeat paid event is recorded for the current lapsed deadline
     (the same fact the booking gate uses, so the page and the gate always agree). Before that it shows
     owing the price less what's been credited.
   - All other steps (safety check, fixes, deposit, balance) count the money paid **minus** the repeat credit,
     against their existing amounts. Their amounts and order do not change.
2. **Due first.** While the repeat check is owing it is the "pay now" step on the owner's page (it is placed
   straight after the first safety check in the step list).
3. **Card counts straight away.** When a Stripe card payment for the repeat step comes in, and the money paid
   since acceptance reaches the price, the repeat paid event is recorded at once (reference "card") and the
   normal electrician offer starts — the same thing the Xero sync does today. Bank payments still count at the
   Xero sync, as now.
4. **Office "payment stalled" flag** (`office-needs.server.ts`) uses the same rule, so it stops showing the
   repeat check owing once it's paid and stops counting repeat money toward the deposit.

Not changed: the repeat price, who pays, the Xero invoice line, card-or-bank rules, the grand total, the
completion pack "fully paid" check, the office repeat panel, the owner-pays acceptance flow.

## Checking

- Update the existing tests that expect the old behaviour (`tests/payments.core.test.ts` "owing until the full
  total is paid"; `tests/repeat-piesa.test.ts` view at stage `offer`).
- New tests:
  - owner view is `null` at `offer`, unchanged at `choose` / `owner_accept` / `owner_pay`;
  - repeat money paid after acceptance flips the repeat step to paid and does NOT count toward the deposit;
  - part payment: repeat owing shows price less what's been paid since acceptance;
  - repeat owing is the pay-now step even when the deposit is also due;
  - jobs with no repeat check: steps and amounts exactly as before;
  - card payment for the repeat step records it paid once (a second webhook delivery does nothing) and not when
    the amount is short.
- Run the full test suite and the type check.
- Delivered as a GitHub pull request on branch `fix/repeat-safety-check-owner-page-and-payment`, not merged
  until Jo says so.
