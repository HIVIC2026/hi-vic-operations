# Batch 1 — Money and Cancels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five stop-launch gaps and two cancel gaps found in the 28 Oct owner-path audit, without changing prices, wording Jo approved, or any other flow.

**Architecture:** Each fix lands in the existing pure `*.core.ts` rule + `*.server.ts` I/O pair that already owns the behaviour. Cancels reuse `cancelJobFully`; the reopen repeat check reuses the repeat-PIESA events; Needs me gets one new row kind. No new tables, no migrations.

**Tech Stack:** TypeScript, TanStack Start server functions, Supabase (admin client), Bun test (`bun test`), PGlite practice-DB helpers in `tests/helpers/`.

**Spec:** `docs/superpowers/specs/2026-10-28-batch1-money-cancels-design.md`

## Global Constraints

- Work on branch `fix/batch1-money-cancels` cut from `origin/main`; never push to `main`, never force-push or rewrite pushed commits (Lovable-connected).
- No new tables or migrations; state lives in existing tables and append-only `workflow_events`.
- No price, fee or approved-wording change. $349 = the quote's PIESA line (`safety-check-amount.core.ts`), never a literal.
- Run `bun scripts/scan-retired-terms.ts` after each task: 0 customer-visible.
- Server functions follow the literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)` chain; office-only actions keep a server-side role guard.
- TEST (`source='qa_test'`) jobs keep using test senders; nothing here sends a new message type.
- Run a single test file with the isolated env: `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=sb_secret_local_test_isolated NODE_ENV=test VITEST=1 bun test --timeout 60000 ./tests/<file>`.

## Review Focus

1. Owner taps Cancel in two tabs at once → one cancel, one clean-up, one installer email (Task 1 test `double cancel`).
2. Reopen of a job whose old PIESA record is still on file must not auto-advance past the safety check (Task 6 test `no auto-advance on old PIESA`).
3. Two separate genuine $349 payments (owner paid twice) must still count twice once Jo confirms — the once-only pairing must only pair a card row with ONE Xero payment (Task 4 test `two real payments`).
4. STOP from a phone shared by two jobs → each job handled on its own facts (Task 5 test `shared phone`).
5. Retry invoice pressed twice → one Xero invoice (Task 3 test `retry twice`).

---

### Task 1: Owner cancel — hidden once paid, full clean-up before

**Files:**
- Modify: `src/lib/owner-myjob.core.ts:97-103` (`ownerCanCancel`)
- Modify: `src/lib/owner-myjob.server.ts:117-140` (`cancelOwnerJob`) and every other `ownerCanCancel(` caller (grep; incl. `email-change-reply*.ts`)
- Test: `tests/batch1-owner-cancel.test.ts`

**Interfaces:**
- Produces: `ownerCanCancel(stage: string, bookingKinds: string[], safetyCheckPaid: boolean): boolean`

- [ ] **Step 1: Failing tests** — `ownerCanCancel("measured_quote_accepted", [], true) === false`; `ownerCanCancel("measured_quote_accepted", [], false) === true`; `ownerCanCancel("ready_check_scheduled", ["ready_check"], false) === true`. Server (mock-module pattern as in `tests/owner-myjob*.test.ts`): `cancelOwnerJob` on a `ready_check_scheduled` job with an active installer assignment calls `cancelJobFully(jobId, "Owner cancelled from My job", null, { tell: { owner: false, installer: true } })` exactly once; `double cancel` — second call returns `{ ok: true }` and does not call `cancelJobFully` again.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add the `safetyCheckPaid` parameter (false at a paid safety-check step: `isStepPaid(steps, "safety_check")` from `jobPaymentView`). In `cancelOwnerJob` read the payment view, refuse with the existing message when paid, else call `cancelJobFully` instead of the direct `jobs.update`/bookings/Mitti lines (it already releases bookings, offers, assignments, ESC notices, install holds and keeps `prior_stage`). Keep the Mitti Ready Check release call after it. Update all callers.
- [ ] **Step 4:** Run → PASS; also re-run `tests/owner-myjob*.test.ts`, `tests/email-change-reply*.test.ts`.
- [ ] **Step 5:** Commit `fix(owner-cancel): hide cancel once the safety check is paid; full clean-up before`.

### Task 2: Electrician pay shows when the safety check is done

**Files:**
- Modify: `src/lib/piesa-complete.server.ts` (`completePiesaAssessment`) and the A3 Mitti completion path that records the `initial` PIESA (grep `kind: "initial"` writers in `src/lib/piesa-record.server.ts` / `mitti*.server.ts`)
- Test: `tests/batch1-electrician-pay-visible.test.ts`

- [ ] **Step 1: Failing test** — after an initial PIESA is recorded on a job with a confirmed `assessment` booking, that booking's `status === "completed"`; `moneyPayouts` (office-money) returns an electrician `assessment` line for the job while its stage is `piesa_complete`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In the single place the initial PIESA record is applied, add `bookings.update({ status: "completed" }).eq("job_id", jobId).eq("kind", "assessment").eq("status", "confirmed")`, mirroring `piesa-record.server.ts:45` for rectification. Do it once (shared helper if both paths call it).
- [ ] **Step 4:** Run → PASS; re-run `tests/*piesa*`, `tests/*money*`, `tests/electrician-pay*`.
- [ ] **Step 5:** Commit `fix(electrician-pay): mark the safety check visit done so pay can be approved`.

### Task 3: Failed Xero invoice → Needs me row + Create invoice

**Files:**
- Modify: `src/lib/portal.functions.ts:828-840` — move `invoiceAfterAcceptance` body to exported `createInvoiceAfterAcceptance(quoteId: string, jobId: string, actorId: string | null): Promise<{ ok: boolean; error?: string }>` in new `src/lib/invoice-after-acceptance.server.ts`; `portal.functions.ts` calls it.
- Modify: `src/lib/office-needs.core.ts` — `NeedsFacts.invoiceFailed?: { at: string; text: string }`, new kind `"invoice_failed"`, row `rank: 9, group: "today", line: "Invoice didn't reach Xero · owner can't pay yet", button: { label: "Open job", to: "job", section: "money" }`.
- Modify: `src/lib/office-needs.server.ts` (`gatherNeedsFacts`) — set `invoiceFailed` when the latest `invoice_create_failed` event is newer than the job's newest invoice with a `xero_invoice_id`.
- Create: server fn `retryInvoiceFn` (input `{ jobId }`, office guard as other office money fns) that finds the job's accepted installation quote and calls `createInvoiceAfterAcceptance`.
- Modify: office job Money card component (grep `section: "money"` panel) — button "Create invoice" when the job has an accepted quote and no invoice linked to Xero.
- Test: `tests/batch1-invoice-failed.test.ts`

- [ ] **Step 1: Failing tests** — core: facts with `invoiceFailed` → one row kind `invoice_failed` with the line above; server: event newer than any Xero-linked invoice → `invoiceFailed` set, event older → unset; `retry twice` — two calls produce one invoice row and one Xero create call (existing reference-first check).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as listed.
- [ ] **Step 4:** Run → PASS; re-run `tests/*needs*`, `tests/*xero*`, `tests/measured-quote-accept*`.
- [ ] **Step 5:** Commit `fix(invoice): show failed invoices on Needs me with Create invoice`.

### Task 4: Card + same-amount Xero payment count once

**Files:**
- Modify: `src/lib/payments.core.ts:330-368` (`reconciledPaidCents`)
- Modify: `src/AGENTS.md` owner-payments bullet (the "counts twice" clause)
- Test: `tests/batch1-same-money.test.ts`

- [ ] **Step 1: Failing tests** — card $349 + Xero $349 2 days later, no Stripe id in reference → `paidCents === 34900`, `unclear.length === 1`; `two real payments` — two card rows $349 + one Xero $349 → `paidCents === 69800`; Xero payment 11 days after the card → not paired (`paidCents === 69800`); Stripe id in reference still matches as today.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Let card rows use the same `closest(...)` within-window pairing legacy rows use (one Xero payment per card row, closest in time), so a paired card row is not added to `unmatched`; keep adding the pair to `unclear` so the `payment_match_unclear` Needs me row still asks Jo to confirm.
- [ ] **Step 4:** Run → PASS; re-run `tests/payment*`, `tests/*reconcil*`, `tests/*xero*`.
- [ ] **Step 5:** Commit `fix(payments): count a card payment and its unreferenced Xero copy once`.

### Task 5: STOP after an installer accepted → full clean-up

**Files:**
- Modify: `src/lib/sms-stop.server.ts:30-50` (`closeStoppedEnquiries`)
- Test: `tests/batch1-sms-stop-cleanup.test.ts`

- [ ] **Step 1: Failing tests** — saved-spot job with an active installer assignment → `cancelJobFully(jobId, "Opted out (replied STOP)", null, { tell: { owner: false, installer: true } })` called once, no direct `jobs.update`; job with no assignment and no pending offer → today's direct update unchanged; `shared phone` — two jobs, one with assignment, one without → each handled its own way.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Before the conditional update, read `job_assignments` (active) and `partner_offers` (pending) for the job; when either exists, call `cancelJobFully` (reason `SMS_STOP_CLOSED_REASON`) instead; keep the `stage_changed` audit for the direct path only.
- [ ] **Step 4:** Run → PASS; re-run `tests/*stop*`.
- [ ] **Step 5:** Commit `fix(stop): release and tell the installer when a booked owner replies STOP`.

### Task 6: Reopen to a safe stage; new safety check after the electrical stage

**Files:**
- Modify: `src/lib/office-jobs.core.ts:104-128` (`reopenPlan`) — add `export function reopenStageFor(priorStage: string): { stage: string; needsNewPiesa: boolean }`
- Modify: `src/lib/office-actions.server.ts:89-125` (`reopenJob`)
- Modify: `src/lib/repeat-piesa.core.ts` — `REPEAT_REOPEN_EVENT = "piesa_superseded_on_reopen"`, `REPEAT_REOPEN_WHY = "Your job was reopened, so a new safety check is needed before your insulation can be installed."`; `ownerRepeatView` uses it when the state came from a reopen.
- Modify: `src/lib/repeat-piesa.server.ts` (`repeatPiesaContext`) — latest `piesa_superseded_on_reopen` with `details.had_check === true` and no `piesa_records` row created after it counts as the lapse (`deadline = details.key`).
- Modify: auto-advance (`src/lib/autoadvance.core.ts` / its server caller) — ignore PIESA records created before the latest `piesa_superseded_on_reopen`.
- Test: `tests/batch1-reopen.test.ts`

Mapping for `reopenStageFor`:
- `new_enquiry` … `ready_check_ready_to_schedule` → unchanged, `needsNewPiesa: false`.
- `ready_check_scheduled`, `ready_check_complete`, `measured_estimate_ready` → `ready_check_ready_to_schedule`, false.
- `measured_quote_accepted` → unchanged, false.
- `piesa_and_install_window_pending` and every later stage (`piesa_scheduled`, `piesa_complete`, `rectification_*`, `installation_*`, `evidence_outstanding`, `ap_review`) → `piesa_and_install_window_pending`, `needsNewPiesa: true`.

- [ ] **Step 1: Failing tests** — mapping table above (one assertion per row); `reopenJob` on a job cancelled at `installation_booked` with an initial PIESA on file → stage `piesa_and_install_window_pending`, one `piesa_superseded_on_reopen` event `{ key: "reopen:<iso>", had_check: true }`, one `repeat_piesa_payer_chosen` `{ payer: "owner", price_inc_gst: <quote PIESA line> }`, owner view body = `REPEAT_REOPEN_WHY`; cancelled at `piesa_scheduled` with no PIESA record → `had_check: false`, no payer event, `repeatPiesaGateBlocker` null; `no auto-advance on old PIESA` — auto-advance leaves the reopened job at `piesa_and_install_window_pending`; reopen still refuses `complete` and retired stages as today.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `reopenJob` writes `reopenStageFor(prior).stage` (refuse with its first `stageEntryBlockers` reason if any), then when `needsNewPiesa` logs `piesa_superseded_on_reopen` and, if a PIESA record existed, records the owner payer choice with price from `safetyCheckAmount` of the accepted quote (not the settings repeat price). Existing repeat-PIESA gate, owner Accept and payment then run unchanged.
- [ ] **Step 4:** Run → PASS; re-run `tests/*reopen*`, `tests/repeat-piesa*`, `tests/*autoadvance*`, `tests/payment-gate*`.
- [ ] **Step 5:** Commit `fix(reopen): reopen to a safe stage; new safety check after the electrical stage`.

### Task 7: Whole-branch check and hand-over

- [ ] **Step 1:** Run the full suite with `/tmp/.../scratchpad/run-tests.sh` style per-file runner; compare failing files with the 28 Oct baseline list (`qa/2026-10-28-workflow-audit/report.md` — 79 files). Expected: no new failing files; the batch1 test files pass.
- [ ] **Step 2:** `bun scripts/scan-retired-terms.ts` → 0 customer-visible; `bunx --package @typescript/native-preview tsgo --noEmit` → exit 0.
- [ ] **Step 3:** One fresh reviewer (supermatt:code-review since `origin/main`) on the branch.
- [ ] **Step 4:** Push `fix/batch1-money-cancels`; give Jo a 5-line plain summary and ask before any merge to `main`. Note for Jo: the one new owner line `REPEAT_REOPEN_WHY` needs her OK.
