# Payment rule (Jo, 7 Oct) — safety check payment + two options

Preview only. Nothing that charges anyone is switched on; the payment gate switch, Xero live calls and sending all stay OFF.

## What changes for people

**Owner, Step B ("Ready to go ahead?")** — the payment section shows the new DRAFT wording:
- Tick (required): "I'll pay the $349 electrical safety check fee now. I understand it is non-refundable once the safety check has been done, even if the check finds the job can't go ahead."
- Choose one:
  - "Pay the balance of {balance} in two instalments: {half} when my install is booked and {half} on install day."
  - "Pay the full {total} now."
- Labelled "Draft, awaiting lawyer". Real jobs cannot sign it until Jo approves it in Settings (same rule as the other draft paperwork). TEST jobs can preview it.

**Office job page** — one Payment card showing:
- Safety check payment: $349 — Not paid / Paid / Refund due / Kept (check done).
- Option chosen: Two instalments or Paid in full, with each amount and its due point (install booked / install day).
- A red PIESA blocker line: "Safety check can't be booked — $349 safety check payment not received" until paid.
- Refund guidance (shown only, no money moves): check never happened → refund all; check done and job can't go ahead → refund everything except $349.

**Electrician** — PIESA offers/booking stay blocked until the $349 is recorded as paid.

## Rules (single source)

```text
Step B accepted ──► $349 paid? ──no──► PIESA blocked
                         │yes
                         ▼
                   PIESA can be booked
Balance = total after VEU discount − $349
  two instalments: half at install booked, half on install day
  paid in full: whole total (incl. $349) at Step B
```
- Install booking still needs the first half (or full payment), install day needs the rest — shown as status, enforced by the existing scheduling gate.
- Refund outcomes are derived labels for the office; the office records any refund manually.

## Technical details

- `workflow_settings`: add `safety_check_payment_inc_gst numeric default 349` (additive migration, proven on PGlite first with undo file, per project rule).
- `src/lib/payment-gate.core.ts`: replace deposit-tier / 3-instalment logic with `safetyCheckCleared`, `balanceSplit(total, fee)` (round DOWN to the cent for halves; second half takes the remainder so it always adds up), `refundOutcome(checkDone, canProceed, paid)`, and new blocker text. `evaluatePaymentGate` / `piesaRequestBlockers` keep their names so callers (autoadvance, workflow, journey) need no restructuring; switch `payment_option_gate_enabled` stays OFF.
- SQL mirror `invoice_deposit_cleared`: updated in a pending migration in `docs/pending-migrations/`, PGlite-proven, not applied live in this task.
- `owner-gates.core.ts`: `PAYMENT_OPTION_TEXT` → new `safety_fee` / `two_instalments` / `pay_in_full` wording; `payment_terms` doc version `draft-2026-10-07`, approved=false.
- `src/config/workflow-decisions.ts` + `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`: record 7 Oct rule; retire 10%/5% deposit and 3-instalment plan (add to retired-terms scan). `instalment-plan.*` left in place read-only for history.
- Office job page (`admin.jobs.$jobId.tsx`) Payment card + My job / owner Step B section updated.
- Tests: fee from settings, $349 block, halves add up for odd cents, pay-in-full, both refund outcomes, draft wording blocks real jobs, gate OFF still blocks. Full suite + typecheck.
- Screenshots (390px Step B payment section, 1280px office job view) on a TEST job; reported back.
