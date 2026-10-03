# Workflow correction: first slice

## What changes for you

1. **PIESA comes later.** It can be requested only once all of these are true:
   - the Ready Check is done
   - office has recorded verified eligibility
   - the owner has approved the current confirmed insulation quote
   - an approved payment option is verified
2. **The 50% deposit rule is retired.** It's replaced by three payment options. Any one of them unlocks PIESA:
   - **Deposit paid:** 10% for jobs under $20,000, or 5% for $20,000 and over. These percentages are settings, pending legal confirmation.
   - **Paid in full.**
   - **Approved 3-instalment plan active.**
3. **Verified eligibility after the Ready Check.** After the Ready Check syncs, office records one of two results:
   - **Eligible (verified):** quoting unlocks.
   - **Not eligible:** the job stops for office review.

   "Likely eligible" is shown everywhere as **Preliminary: likely eligible**.
4. **Preliminary quote.** The calculator-style estimate stays separate. It's marked "Estimate only, not binding", is never used as the job price, and never unlocks payment.
5. **Owners and trades contact each other directly.** There's no owner/trade chat in the portal. Either side presses **Time arranged**, picks the date and time, and the other side confirms. If there's no response within 24 hours, they get a reminder. If there's still no booking after 48 hours, office sees an alert. Office and compliance messages still go through the portal.
6. **Launch blockers added (cannot be skipped):**
   - Check every office-only action really checks the user is office staff.
   - Failed messages appear in Needs attention.

Not in this slice: rectification-quote re-split, scheduled Mitti sync, installer PIESA notice. Nothing is published or sent.

## Old order vs new order

```text
OLD: ready_check_complete -> measure-up + PIESA -> quote -> accept -> 50% deposit -> scheduling
NEW: ready_check_complete -> eligibility_verified | eligibility_failed(STOP, office)
     -> insulation quote issued -> owner accepts (version locked) -> payment_option_verified
     -> PIESA request allowed -> PIESA -> [rectification] -> installation
```

## Technical section

### Files and functions

- `src/lib/workflow.server.ts`:
  - `TRANSITIONS` and `stageEntryBlockers`: add a PIESA-entry gate, and change the quote gate so it no longer requires a PIESA date.
  - `depositCleared` becomes `paymentOptionCleared`.
- `src/lib/autoadvance.core.ts` (`planStep`) and `src/lib/workflow.ts`: stage order and labels.
- `src/lib/nextstep.core.ts`: the "Preliminary" label.
- `src/lib/invoice.lifecycle.ts`: a new pure function, `paymentOptionStatus(invoice, plan, settings)`.
- `src/lib/eligibility.core.ts`: a new pure function, `verifiedEligibilityBlocker`. Gate 1 itself is untouched.
- `src/lib/portal.functions.ts`: `recordVerifiedEligibility` (admin only), and changes to `respondToQuote` and `generateInstallerQuotes`.
- `src/lib/pilot.functions.ts` / `pilot.core.ts`: `markTimeArranged` and `confirmTimeArranged`. `proposeTime` refuses the PIESA kind until the payment gate is cleared.
- `src/lib/followups.server.ts`: the 24h reminder and 48h office alert, through the outbox. Sends stay off until LR-006.
- UI: the job workspace payment card, the Time arranged button, and the eligibility card label.

### Database (one additive migration, no destructive changes)

- New `jobs.verified_eligibility` (`pending | eligible | not_eligible`, default `pending`), plus `verified_eligibility_by`, `_at` and `_reason`.
- New `payment_plans`: `job_id`, `quote_id`, `option` (`deposit | full | instalments`), `status`, `approved_by`, `approved_at`. Grants and admin-plus-owner RLS included.
- New `workflow_settings` columns: `deposit_pct_under_20k` (10), `deposit_pct_20k_plus` (5) and `deposit_threshold` (20000).
- New `appointment_proposals.arranged_directly` (bool) and `reminder_sent_at`.
- The retired `invoices.deposit_paid_at` 50% logic is kept in place and marked DEPRECATED, not dropped.

### Payment-status model

`not_selected → awaiting_deposit | awaiting_full | plan_pending_approval → deposit_paid | paid_in_full | plan_active → (gate cleared)`.

- Xero `AmountPaid` stays the source of truth.
- The cleared rule is: the deposit is at least the configured percentage of the accepted total, or the full amount is paid, or the plan is approved by admin and active.
- An audited admin override still works.

### Tests

- PIESA proposal and stage entry are blocked when any of these is true:
  - no Ready Check
  - eligibility pending or not eligible
  - quote not accepted
  - quote superseded
  - payment not cleared
  - deposit 1 cent short of the 10% or 5% threshold
- Each of the three payment options unlocks PIESA.
- A stale tab cannot accept a superseded quote version.
- "Time arranged": either side can mark it, the other side confirms, a duplicate or stale mark is rejected, the reminder fires once after 24h, the office alert fires after 48h, and none of this changes the stage on its own.
- A role-guard test covers every admin function in `*.functions.ts`.
- Failed-message visibility test.
- Typecheck, lint, the full `bun test ./tests/` run, and build, with actual results reported.

### Rollback

- The migration is additive, so the code can be reverted without touching data.
- The old deposit fields stay.
- A feature flag (`workflow_settings.payment_option_gate_enabled`) switches between the old and new gate.
- Existing in-flight jobs keep their current stage. They are not migrated forward automatically.
