# Owner paperwork — "Payment" (Gate B) — version `steps-2026-10-25` — DRAFT for Jo's approval

Decision 365 (Jo 25 Oct 2026, "Yes, replace it"): the 50/50 instalment choice (version `jo-2026-10-21`) is replaced by
ONE plain statement of the real payment steps from `paymentPlan()` (`src/lib/payments.core.ts`). The owner makes no
choice; they tick "I agree" and type their name. Owners who already signed `jo-2026-10-21` keep that signed copy as
history and are not asked again.

Status: **NOT approved.** Until Jo approves it, real owners cannot sign this item (TEST jobs only), so Gate B stays open
on new real acceptances. To approve: Office › Settings › Owner paperwork › "Payment" › Approve (records an
`owner_paperwork_approvals` row for this exact version and wording). Any change to the wording below needs a new version.

Placeholders are filled by the server from the accepted quote (never from the owner):
`{total}` quote total after the VEU discount · `{fee}` the quote's PIESA line (decision 302) · `{remaining}` = total − fee ·
`{deposit}` = 10% of remaining · `{balance}` = remaining − deposit.

## Exact wording (stored body)

```
How I'll pay for this job. Everything is on one invoice of {total} inc GST, and there is no card fee.

1. Safety check: {fee} for the Pre Insulation Electrical Safety Assessment (PIESA), now that I accept, by card or bank transfer. I understand it's non-refundable once the PIESA is done, even if it finds the job can't go ahead.

2. Electrical fixes, only if the electrician finds they're needed: I'll see the price first, and if I approve them I pay for the fixes in full then, by card or bank transfer.

3. Install deposit: {deposit} (10% of the remaining {remaining}) to book my install day, by bank transfer or PayID.

4. Balance: {balance} on install day, by bank transfer or PayID.

I can pay whatever is left at any time by bank transfer or PayID.
```

Tick: **I agree**

## Example ($3,728.00 quote, $349 safety check)

How I'll pay for this job. Everything is on one invoice of $3,728.00 inc GST, and there is no card fee.

1. Safety check: $349.00 for the Pre Insulation Electrical Safety Assessment (PIESA), now that I accept, by card or bank transfer. I understand it's non-refundable once the PIESA is done, even if it finds the job can't go ahead.
2. Electrical fixes, only if the electrician finds they're needed: I'll see the price first, and if I approve them I pay for the fixes in full then, by card or bank transfer.
3. Install deposit: $337.90 (10% of the remaining $3,379.00) to book my install day, by bank transfer or PayID.
4. Balance: $3,041.10 on install day, by bank transfer or PayID.

I can pay whatever is left at any time by bank transfer or PayID.
