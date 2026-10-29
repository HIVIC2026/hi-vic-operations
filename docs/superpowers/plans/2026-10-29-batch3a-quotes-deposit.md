# Batch 3a — Expired Quotes, Card Deposit, Old Wording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close expired quotes with Jo's approved email and a working "Send me a new quote" button, allow card for the 10% deposit, and remove retired payment wording.

**Architecture:** Existing core/server pairs: quote-expiry, owner My job screens + token-scoped server fns, cancelJobFully/reopen, quote generation, payments/stripe cores. No tables or migrations.

**Tech Stack:** TypeScript, TanStack Start, Supabase admin client, Stripe Checkout, MJML email builder, Bun test.

**Spec:** `docs/superpowers/specs/2026-10-29-batch3a-quotes-deposit-design.md`

## Global Constraints

- Branch `fix/batch3a-quotes-deposit` (on `fix/batch2-messages`); never push to `main`; never rewrite pushed commits.
- No tables or migrations. Owner wording ONLY as approved in the spec (email, thanks line, deposit phrase); everything else office-only.
- Owner email via `sendGuardedOwnerEmail` with a once-only key; TEST (`qa_test`) → test-send; behind `customer_comms_enabled` + consent.
- Server functions: literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)`; owner fns resolve the job from the secure token only.
- Quotes are never auto-issued by this batch — every new quote waits for office Send.
- `bun scripts/scan-retired-terms.ts` → 0 customer-visible.

## Review Focus

1. Owner taps "Send me a new quote" twice / on two devices → one reopen, one draft (Task 2 `double tap`).
2. Expiry sweep runs twice on the same day → one cancel, one email, one installer notice (Task 1 `sweep twice`).
3. A job with another live quote (e.g. a newer issued one) is not closed when an old quote expires (Task 1).
4. The new quote never includes an earlier fixes quote's lines (Task 2).
5. Card Checkout for the deposit charges exactly the deposit due now, not the balance (Task 3).

---

### Task 1: Expired quote closes the job and emails the owner once

**Files:** Modify `src/lib/quote-expiry.server.ts`, `src/lib/quote-expiry.core.ts`; Create `src/lib/quote-expired-email.core.ts` (`QUOTE_EXPIRED_EMAIL_APPROVED = true`, `renderQuoteExpiredEmail({ firstName, address, link })`), `src/lib/quote-expired-email.server.ts` (`sendQuoteExpiredEmail(jobId, quoteId)`), `docs/templates/mjml/owner_O78.mjml`; register in `src/lib/template-hub.core.ts`. Test `tests/batch3a-quote-expired.test.ts`.

- [ ] Failing tests: expired quote with no other live installation quote → `cancelJobFully(job, "Quote expired (14 days)", null, { tell: { owner: false, installer: true } })` once + one email (key `quote-expired:v1:<quoteId>`, subject "Your quote has expired", exact approved body, button "Send me a new quote" linking `/my-job/<token>?screen=newquote`, sign-off "Cheers, the Home Insulation Victoria team"); `sweep twice` → no second cancel/email; another issued/accepted installation quote on the job → no cancel; TEST job → test-send; cancelled/complete job → nothing.
- [ ] RED → implement → GREEN (+ `tests/quote-expiry*`, `tests/cancel-job-fully*`, template hub test baseline noted) → commit `feat(quotes): expired quote closes the job and emails the owner`.

### Task 2: "Send me a new quote"

**Files:** Modify `src/lib/owner-myjob.core.ts` (screen `newquote`), `src/routes/my-job.$token.tsx` (screen showing the approved thanks line), Create `src/lib/new-quote-request.core.ts` (`newQuoteRequestBlocker(facts)`), `src/lib/new-quote-request.server.ts` (`requestNewQuote(token)`), `src/lib/new-quote-request.functions.ts`; Modify `src/lib/quotes.server.ts` (option to exclude accepted fixes lines / force held draft); office Needs me row "New quote asked for — choose installer" (office-needs core/server + CARD_OF). Test `tests/batch3a-new-quote.test.ts`.

- [ ] Failing tests: valid token on a job cancelled "Quote expired (14 days)" → one `new_quote_requested` event, job at `measured_estimate_ready`, installer assignment from that cancel re-activated; our lead → `generateInstallerQuotes` called with today's settings → held draft (not issued), no fixes lines; installer lead → no auto price, installer status line = enter your price; installer not active → Needs me row, no quote; `double tap` → one event/draft, same thanks result; job reopened by office already / other cancel reason / wrong token → refused, nothing written.
- [ ] RED → implement → GREEN (+ `tests/*quote*`, `tests/owner-myjob*`, `tests/batch1-reopen*`) → commit `feat(quotes): owner can ask for a new quote after expiry`.

### Task 3: Card for the 10% deposit

**Files:** Modify `src/lib/payments.core.ts:85-88, 465-486`, `src/lib/stripe.core.ts:9,17`, `src/routes/my-job.$token.tsx:~623-655`, `src/lib/owner-gates.core.ts:25-30` (Gate B statement + version bump), `src/lib/install-booked-email.core.ts`, `src/lib/approved-texts.core.ts:12-13`, `src/lib/deposit-release-notice.core.ts:76`, `src/lib/owner-pages.core.ts:79`, `src/lib/email-reply.core.ts:207`, office `office-job.tsx:217`, `panels.tsx:434`; `src/AGENTS.md` + source-of-truth payment bullets. Test `tests/batch3a-card-deposit.test.ts`.

- [ ] Failing tests: `paymentMethodsFor("install_deposit")` = card + bank; `balance` = bank only; Checkout for the deposit uses exactly the deposit cents due now; every owner deposit line contains "card, bank transfer or PayID" and no balance line contains "card"; Gate B statement has a new version id; no "card fee" anywhere.
- [ ] RED → implement → GREEN (+ `tests/payments*`, `tests/stripe*`, `tests/owner-gates*`, `tests/my-job*`) → commit `feat(payments): card allowed for the 10% install deposit`.

### Task 4: Retired payment wording

**Files:** `src/lib/portal.functions.ts:~808`, `src/lib/xero.server.ts:~156,~209,~357`, `src/components/portal/panels.tsx:~477,~490,~509`; add the retired phrases to `scripts/scan-retired-terms.ts`. Test: scan.

- [ ] Failing: scan flags the old phrases → replace with the spec's acceptance-record line and plain current-step office notes → scan 0 → commit `fix(wording): acceptance record and office notes match today's payment steps`.

### Task 5: Whole-branch check
- [ ] Full suite vs baseline; tsc (only xlsx); retired scan; final whole-branch review; push; ask Jo before opening for review. Tell Jo: approve the new Gate B payment statement version in Settings › Owner documents, or real owners can't sign.
