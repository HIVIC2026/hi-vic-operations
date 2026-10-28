# Repeat safety check: owner page and payment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the owner's job page getting stuck on the repeat safety check card, and make the repeat safety check payment count as its own money (paid when paid, card straight away, never toward the deposit).

**Architecture:** Bug 1 is one pure function (`ownerRepeatView`) returning `null` once accepted/paid. Bug 2 takes the repeat step out of the cumulative payment chain in the pure `payments.core.ts`, using a new pure "repeat credit" helper fed by facts the server already stores (`paid_before_cents` on the accepted event, the repeat paid event). The server wiring passes those facts in; a Stripe hook records a card repeat payment at once.

**Tech Stack:** TypeScript, TanStack Start, Supabase, bun test.

**Spec:** `docs/superpowers/specs/2026-10-29-repeat-safety-check-owner-page-and-payment-design.md`

## Global Constraints

- Branch: `fix/repeat-safety-check-owner-page-and-payment`. Deliver as a PR; do NOT merge. Never force-push (Lovable sync).
- Read `AGENTS.md`, `src/AGENTS.md`, `src/lib/AGENTS.md` before editing `src/lib`.
- Jobs with no repeat check: every payment step, amount, threshold and order of the other four steps unchanged (existing `payments.core.test.ts` cases must still pass untouched, except the one repeat test named in Task 2).
- Not changed: repeat price, who pays, Xero invoice line code, card/bank rules (`paymentMethodsFor`), `grandTotalCents`, completion pack "fully paid" check, office repeat panel (`repeat-piesa.tsx`), owner wording at stages `choose` / `owner_accept` / `owner_pay`, `onsiteChargePaid`.
- Setup once: `bun install`. Tests: `bun test <file>`. Full suite: `bun run test`. Types: `bunx tsc --noEmit`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01CfFAPGhLwrXty5fNxECf5v`

## Review Focus

1. Owner fully paid the repeat money but the paid event isn't recorded yet (Xero line held) → repeat step outstanding is $0 and must NOT be the "pay now" step (Task 2 test `fully credited but not recorded is not pay-now`).
2. Owner pays the install deposit AFTER accepting but BEFORE paying the repeat → first money goes to the repeat (spec rule); deposit stays owing (Task 2 test `money after acceptance goes to the repeat first`).
3. Older accepted events with no `paid_before_cents` → credit treated as 0 until the paid event is recorded, then full price (Task 2 test `missing paid-before counts nothing until recorded`).
4. Stripe webhook delivered twice → repeat paid event logged once (Task 3: second call sees stage `offer` and returns false; pure test `card short of the price is not paid`).
5. Installer- or HIV-pays repeat → `repeatCents` is 0, no repeat step, chain unchanged (Task 2 test `no repeat owed leaves every step as before`).

---

### Task 1: Owner page — no repeat card once accepted

**Files:**
- Modify: `src/lib/repeat-piesa.core.ts` (`ownerRepeatView`, last return line)
- Test: `tests/repeat-piesa.test.ts`

**Interfaces:**
- Produces: `ownerRepeatView(s: RepeatState): OwnerRepeatView | null` — now `null` when `s.stage === "offer"`. Signature unchanged.

- [ ] **Step 1: Write the failing test** in `tests/repeat-piesa.test.ts`

```ts
test("owner page has no repeat card once accepted (and paid if owed) — normal booking area shows", () => {
  expect(ownerRepeatView({ stage: "offer", payer: "owner", priceIncGst: 349, deadline: "2026-10-01" })).toBeNull();
  expect(ownerRepeatView({ stage: "offer", payer: "installer", priceIncGst: 349, deadline: "2026-10-01" })).toBeNull();
  expect(ownerRepeatView({ stage: "choose", payer: null, priceIncGst: null, deadline: "2026-10-01" })!.title).toBe(REPEAT_ARRANGING_TITLE);
  expect(ownerRepeatView({ stage: "owner_accept", payer: "owner", priceIncGst: 349, deadline: "2026-10-01" })!.button).toBe("Accept");
  expect(ownerRepeatView({ stage: "owner_pay", payer: "owner", priceIncGst: 349, deadline: "2026-10-01" })!.body).toContain("Please pay $349 inc GST");
});
```
Update any existing assertion in this file that expects a view at stage `offer` to expect `null`.

- [ ] **Step 2: Run** `bun test tests/repeat-piesa.test.ts` — Expected: FAIL on the `offer` → `toBeNull()` lines.
- [ ] **Step 3: Implement** — replace the final `return { title: REPEAT_NEEDED_TITLE, body: "Thanks for accepting. We're arranging your electrician…" }` with `return null;` and update the function's doc comment ("null = nothing to show, including once accepted/paid").
- [ ] **Step 4: Run** `bun test tests/repeat-piesa.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(owner page): repeat safety check card goes once accepted/paid`

---

### Task 2: Repeat step counts its own money (pure)

**Files:**
- Modify: `src/lib/payments.core.ts` (`PAYMENT_STEP_ORDER`, `PaymentStepFacts`, `paymentSteps`, `payableNow`; new `repeatCreditCents`)
- Test: `tests/payments.core.test.ts`

**Interfaces:**
- Produces:
  - `repeatCreditCents(f: { repeatCents: number; paidCents: number; paidBeforeAcceptCents: number | null; recordedPaid: boolean }): number` — `0` if `repeatCents <= 0`; `repeatCents` if `recordedPaid`; `0` if `paidBeforeAcceptCents == null`; else `min(repeatCents, max(0, paidCents − paidBeforeAcceptCents))`.
  - `PaymentStepFacts` gains optional `recordedPaid?: boolean` and `paidBeforeAcceptCents?: number | null` (read only for `repeat_safety_check`).
  - `PAYMENT_STEP_ORDER = ["safety_check", "repeat_safety_check", "fixes", "install_deposit", "balance"]`. `plan.thresholds` values unchanged (including `repeat_safety_check: grandTotalCents`).
  - `paymentSteps(plan, paidCents, facts, nowIso)` — same signature. Computes `credit = repeatCreditCents(...)` from `facts.repeat_safety_check`; every non-repeat step uses `paidCents − credit` against its threshold. Repeat step: `state` = `"paid"` if `recordedPaid`, else `"requested"`/`"not_yet"` from `requestedAt`; `outstandingCents = recordedPaid ? 0 : repeatCents − credit`; `thresholdCents` reported as `plan.thresholds.safety_check + plan.repeatCents`.
  - `payableNow` — skips any step whose `outstandingCents` is 0.

- [ ] **Step 1: Write failing tests** in the existing `describe("repeat safety check on the owner's plan …")` block. Replace the test "a repeat plan shows it owing until the full total is paid" with these (plan: `paymentPlan({ quoteTotalCents: 400_000, repeatCents: 34_900 })`; first safety check 34_900, deposit 36_510):

```ts
test("repeat money paid after acceptance flips the repeat step and never counts toward the deposit", () => {
  const facts = { repeat_safety_check: { requestedAt: T0, recordedPaid: true, paidBeforeAcceptCents: 34_900 }, install_deposit: { requestedAt: T0 } };
  const steps = paymentSteps(withRepeat, 69_800, facts, T0);
  expect(steps.map((s) => s.key)).toEqual(["safety_check", "repeat_safety_check", "install_deposit", "balance"]);
  expect(steps.find((s) => s.key === "repeat_safety_check")!.state).toBe("paid");
  expect(steps.find((s) => s.key === "install_deposit")!.state).toBe("requested");
  expect(steps.find((s) => s.key === "install_deposit")!.outstandingCents).toBe(36_510);
});
test("part payment: repeat owing is the price less what's been paid since acceptance", () => {
  const r = paymentSteps(withRepeat, 44_900, { repeat_safety_check: { requestedAt: T0, recordedPaid: false, paidBeforeAcceptCents: 34_900 } }, T0).find((s) => s.key === "repeat_safety_check")!;
  expect(r.state).toBe("requested"); expect(r.outstandingCents).toBe(24_900);
});
test("money after acceptance goes to the repeat first; repeat is the pay-now step even with the deposit due", () => {
  const facts = { repeat_safety_check: { requestedAt: T0, recordedPaid: false, paidBeforeAcceptCents: 34_900 }, install_deposit: { requestedAt: T0 } };
  const steps = paymentSteps(withRepeat, 34_900, facts, T0);
  expect(payableNow(withRepeat, steps, 34_900).step!.key).toBe("repeat_safety_check");
  expect(paymentSteps(withRepeat, 50_000, facts, T0).find((s) => s.key === "install_deposit")!.outstandingCents).toBe(36_510);
});
test("fully credited but not recorded is not pay-now", () => {
  const facts = { repeat_safety_check: { requestedAt: T0, recordedPaid: false, paidBeforeAcceptCents: 34_900 }, install_deposit: { requestedAt: T0 } };
  const steps = paymentSteps(withRepeat, 69_800, facts, T0);
  expect(steps.find((s) => s.key === "repeat_safety_check")!.outstandingCents).toBe(0);
  expect(payableNow(withRepeat, steps, 69_800).step!.key).toBe("install_deposit");
});
test("missing paid-before counts nothing until recorded", () => {
  expect(repeatCreditCents({ repeatCents: 34_900, paidCents: 90_000, paidBeforeAcceptCents: null, recordedPaid: false })).toBe(0);
  expect(repeatCreditCents({ repeatCents: 34_900, paidCents: 90_000, paidBeforeAcceptCents: null, recordedPaid: true })).toBe(34_900);
});
test("no repeat owed leaves every step as before", () => {
  const before = paymentSteps(plain, 100_000, { install_deposit: { requestedAt: T0 } }, T0);
  expect(before.map((s) => [s.key, s.state, s.outstandingCents])).toEqual([["safety_check", "paid", 0], ["install_deposit", "paid", 0], ["balance", "not_yet", 300_000]]);
});
```

- [ ] **Step 2: Run** `bun test tests/payments.core.test.ts` — Expected: new tests FAIL (`repeatCreditCents` not exported, order wrong).
- [ ] **Step 3: Implement** the Interfaces above in `src/lib/payments.core.ts`. Update the `PAYMENT_STEP_ORDER` comment (repeat sits after the first safety check and counts its own money).
- [ ] **Step 4: Run** `bun test tests/payments.core.test.ts tests/payment-stall.test.ts` — Expected: PASS, all earlier tests untouched.
- [ ] **Step 5: Commit** `fix(payments): repeat safety check counts its own money`

---

### Task 3: Server wiring — owner page, card payment, office flag

**Files:**
- Modify: `src/lib/repeat-piesa.server.ts` (`repeatPiesaContext` return; new `repeatPaidByCard`)
- Modify: `src/lib/repeat-piesa.core.ts` (new pure `repeatCardPaid`)
- Modify: `src/lib/payments.server.ts:150-170` (`jobPaymentView` facts)
- Modify: `src/lib/stripe.server.ts` (`applyAfterStripeChange`)
- Modify: `src/lib/office-needs.server.ts:376-405` (payment stalled flag)
- Test: `tests/repeat-piesa.test.ts`

**Interfaces:**
- Consumes: `repeatCreditCents`, new `PaymentStepFacts` fields (Task 2).
- Produces:
  - `repeatPiesaContext(jobId)` → `{ state, suggestion, paidBeforeAcceptCents: number | null }` (from `paid_before_cents` on this deadline's accepted event; `null` if absent). Existing callers ignore the new field.
  - `repeatCardPaid(i: { priceCents: number; paidCents: number; paidBeforeAcceptCents: number | null; cardRowAfterAccept: boolean }): boolean` — true only when `cardRowAfterAccept`, `paidBeforeAcceptCents != null`, `priceCents > 0` and `paidCents − paidBeforeAcceptCents >= priceCents`.
  - `repeatPaidByCard(jobId: string, invoiceId: string, paidCents: number): Promise<boolean>` — returns false unless stage `owner_pay`; looks for a ledger `owner_payment_recorded` event (`PAYMENT_EVENT`, `payment-ledger.server.ts`) on this invoice with `details.source === "card"` and `details.step === "repeat_safety_check"` created after the accepted event; if `repeatCardPaid` is true, logs `REPEAT_PIESA_PAID_EVENT` with `{ deadline, amount_inc_gst, reference: "card", invoice_id }` and calls `startRepeatOffer`; returns true.

- [ ] **Step 1: Write failing pure tests** in `tests/repeat-piesa.test.ts`:

```ts
test("card covers the repeat price after acceptance → paid", () => {
  expect(repeatCardPaid({ priceCents: 34_900, paidCents: 69_800, paidBeforeAcceptCents: 34_900, cardRowAfterAccept: true })).toBe(true);
});
test("card short of the price, no card row, or no paid-before → not paid", () => {
  expect(repeatCardPaid({ priceCents: 34_900, paidCents: 60_000, paidBeforeAcceptCents: 34_900, cardRowAfterAccept: true })).toBe(false);
  expect(repeatCardPaid({ priceCents: 34_900, paidCents: 69_800, paidBeforeAcceptCents: 34_900, cardRowAfterAccept: false })).toBe(false);
  expect(repeatCardPaid({ priceCents: 34_900, paidCents: 69_800, paidBeforeAcceptCents: null, cardRowAfterAccept: true })).toBe(false);
});
```
- [ ] **Step 2: Run** `bun test tests/repeat-piesa.test.ts` — Expected: FAIL (`repeatCardPaid` not exported).
- [ ] **Step 3: Implement** `repeatCardPaid`, the `repeatPiesaContext` field and `repeatPaidByCard` as in Interfaces.
- [ ] **Step 4: Wire `jobPaymentView`:** read `paidBeforeAcceptCents` from the same `repeatPiesaContext` call; set `facts.repeat_safety_check = { requestedAt: repeatCents > 0 ? now.toISOString() : null, recordedPaid: repeatState.stage === "offer", paidBeforeAcceptCents }`. `repeatCents` rule unchanged.
- [ ] **Step 5: Wire Stripe:** in `applyAfterStripeChange`, after `applyPaidAmount` and before `afterPaymentsChanged`, call `repeatPaidByCard(inv.job_id, inv.id, total)` with `.catch` logging `"repeat PIESA card check skipped"` (same pattern as the Xero call).
- [ ] **Step 6: Wire office flag:** in the `repeatByJob` loop also keep `paidBeforeCents` from the newest accepted event's `details.paid_before_cents` (`null` if absent). Set `repeatCents = rep && rep.price > 0 && rep.acceptedAt ? toCents(rep.price) : 0` (paid or not); `credit = repeatCreditCents({ repeatCents, paidCents, paidBeforeAcceptCents: rep?.paidBeforeCents ?? null, recordedPaid: !!rep?.paid })`; compare `paidCents − credit` for safety_check / fixes / install_deposit; push the repeat step only when `repeatCents > 0 && rep.acceptedAt && !rep.paid`.
- [ ] **Step 7: Run** `bun test tests/repeat-piesa.test.ts tests/payments.core.test.ts tests/payment-stall.test.ts` — Expected: PASS. Then `bunx tsc --noEmit` — Expected: no new errors versus `main` (run it on `main` first if errors appear, and compare).
- [ ] **Step 8: Commit** `fix(payments): card repeat payment counts at once; office flag uses repeat credit`

---

### Task 4: Full check and PR

- [ ] **Step 1:** `bun run test` — Expected: all pass (or only failures that also fail on `main`; list them).
- [ ] **Step 2:** `bunx tsc --noEmit` and `bunx eslint src/lib/repeat-piesa.core.ts src/lib/repeat-piesa.server.ts src/lib/payments.core.ts src/lib/payments.server.ts src/lib/stripe.server.ts src/lib/office-needs.server.ts` — Expected: no new errors.
- [ ] **Step 3:** Add one line to `AGENTS.md` under the existing repeat PIESA rule: repeat step counts its own money (paid since acceptance, first), paid = repeat paid event, card payment records it at once. Commit `docs: repeat safety check payment rule`.
- [ ] **Step 4:** `git fetch origin main`, merge `origin/main` into the branch if it moved (never rebase or force-push), push, open PR against `main` with the `supermatt:pr` body shape. Do not merge.
