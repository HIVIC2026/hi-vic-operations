# 30-day rule — draft wording for the lawyer (decision 158, Jo 24 Oct 2026)

**Status: DRAFT for Jo's lawyer. Not applied to the owner terms or the installer (partner) agreement.** Agreement wording
changes need a new signed version (see `src/lib/AGENTS.md`, onboarding rule); the portal does not change any agreement
text from this file.

## The rule in plain words
1. A Pre Insulation Electrical Safety Assessment (PIESA) is valid for 30 days. The installation must **start** within 30
   days of the electrical clearance (the signed PIESA pass, or the signed Section C after electrical fixes). Booking a day
   inside the 30 days is not enough — the work has to start inside it.
2. Once cleared, the installer offers three install days inside the window; the owner takes one or suggests up to five of
   their own; the installer takes one or offers three more; and so on until a day is agreed. Either side may change a
   booked day, but only to another day inside the window.
3. Home Insulation Victoria reminds **both** the owner and the installer at 20 days and 10 days before the last day, and
   checks in itself when 10 days are left with nothing booked.
4. If the window lapses with no installation started, a **repeat PIESA** is needed before the installation can go ahead.
   The repeat PIESA is paid by whoever caused the delay:
   - the **owner**, where the owner did not take or answer the installer's offered days, suggested only days outside the
     window, or changed a booked day and no new day was agreed in time;
   - the **installer**, where the installer did not offer days within five days of clearance, did not take or answer the
     owner's suggested days, or changed a booked day and no new day was agreed in time;
   - where both contributed, or the cause was outside both parties' control (including a system failure on Home Insulation
     Victoria's side), Home Insulation Victoria decides, acting reasonably, and may bear the cost itself.
5. The decision and its reason are recorded on the job. Nobody is charged automatically: the office raises the charge.

## Draft clause — owner terms (customer-facing)
> **Your safety check is valid for 30 days.** Your installation must start within 30 days of the electrical clearance
> (the passed electrical safety check, or the sign-off after any electrical fixes). Your installer will offer install days
> inside that window and we will remind you both at 20 and 10 days before it closes. If the window closes before your
> installation starts, a repeat electrical safety check is required before we can install. **If the delay was caused by
> you** — for example you did not respond to your installer's offered days, suggested only days after the window closed,
> or cancelled a booked day and no new day was agreed in time — the repeat safety check is charged to you at our then
> current safety-check price. If the delay was caused by the installer, it is not charged to you. Where the cause is shared
> or outside either party's control, we will decide fairly and tell you why.

## Draft clause — installer (partner) agreement
> **30-day installation window.** The Partner must offer at least three installation days inside the 30-day window within
> five (5) days of electrical clearance, must respond to an owner's suggested days within five (5) days, and must not move a
> booked installation day to a day outside the window. Where the window lapses without the installation starting and the
> delay was caused by the Partner (including a failure to offer or respond to days in time, or cancelling a booked day
> without a replacement agreed inside the window), the Partner bears the cost of the repeat PIESA at the electrician's
> agreed rate, which Home Insulation Victoria may deduct from amounts otherwise payable to the Partner on that job. Where
> the delay was caused by the owner the owner bears that cost. Where the cause is shared or outside either party's control
> Home Insulation Victoria will determine responsibility acting reasonably, and its determination, with written reasons, is
> final for the purposes of this clause.

## Questions for the lawyer
- Is "five days" the right response period for the installer, and should it be business days? (The portal currently uses
  5 calendar days — `RESPONSE_DUE_DAYS` in `src/lib/thirty-day-rule.core.ts` — pending Jo's confirmation.)
- Deduction from partner payments: confirm set-off is permitted under the existing partner agreement.
- Owner charge: confirm the repeat safety check can be charged at the standard safety-check price, and whether it must be
  paid before the repeat PIESA is booked (consistent with the existing "safety check payment before the PIESA" rule).
- Australian Consumer Law: confirm the owner clause is fair where the owner's non-response is the sole cause.

## Where the portal implements this (for reference only)
- Window and days: `src/lib/install-days.core.ts` (`installWindowDeadline`, `installDayTurn`).
- Reminders and payer rule: `src/lib/thirty-day-rule.core.ts` / `.server.ts` (held behind `THIRTY_DAY_REMINDER_APPROVED`).
- The decision is recorded as the internal job event `install_window_expired` with a one-line reason.
