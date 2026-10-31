# Quote speed + owner paperwork wording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make quote open, Send, Accept, Customer agreement and Consumer rights fast (under 2 s), and fix owner paperwork wording ($ on money, no "lawyer", current payment steps).

**Architecture:** Wording fixes in the acceptance package and gate docs, plus one pending migration (docs/pending-migrations, PGlite-proven, per AGENTS.md) that renames the lawyer version and carries approvals across. Speed: one migration rewrites the two authority SQL functions so `can_access_job` runs once per row only when the caller isn't admin, then independent reads are parallelised in `releaseQuoteToOwner` and `buildAcceptancePackage`.

**Tech Stack:** TypeScript, TanStack Start server fns, Supabase Postgres, drizzle SQL migrations, bun test.

**Spec:** `docs/superpowers/specs/2026-11-01-quote-speed-and-paperwork-wording-design.md`

## Global Constraints
- Owner money always formatted with `aud()` from `src/lib/workflow.ts` (`$5,988.00`).
- The word "lawyer" must not appear in any owner- or office-visible template text, version or approval note.
- "fixes" → "electrical upgrades" in anything people see. Code names stay.
- Signed snapshots/PDFs already stored are never rewritten.
- Approved items stay approved after the rename. A changed body (payment terms) goes to Draft and needs Jo's approval in Settings › Owner paperwork. Flag this to Jo; don't auto-approve.
- No live database change without Jo's yes at that moment. Pull request only. This chat never merges.
- Test jobs (`source = 'qa_test'`) only for timing runs.

## Review Focus
- A non-admin installer/electrician/owner must see exactly the same `job_overview` rows and authority values as before (no access widening). Test in Task 3.
- An owner whose quote has no PIESA line: the payment line must still render with $ and no "NaN"/"undefined". Test in Task 1.
- An already-signed HV-3666-style snapshot must still open, showing its old text unchanged. Test in Task 1.
- Send refusals (closed job, wrong stage, no owner link, comms off) give the same message as before, even with parallel reads. Test in Task 4.
- Two Send presses at once: still exactly one email (claim update stays last and conditional). Test in Task 4.

---

### Task 1: Payment line uses $ and current steps

**Files:**
- Modify: `src/lib/assignment.server.ts:83` (`payment_terms`)
- Modify: `src/lib/owner-gates.core.ts:24-31` (`PAYMENT_TERMS_BODY`: "Electrical fixes" → "Electrical upgrades", "pay for the fixes" → "pay for the electrical upgrades")
- Test: `tests/acceptance-payment-terms-wording.test.ts`

**Interfaces:**
- Consumes: `paymentPlan()`, `paymentTermsMoney()`, `paymentTermsText()` from `owner-gates.core.ts`
- Produces: `acceptancePaymentTerms(items: QuoteLine[], total: number): string` exported from `src/lib/assignment.core.ts`

- [ ] Step 1: Write the failing tests. For the HV-3666 lines (5500 + 349 PIESA + 349 AP fee, total 5988), the result contains `$5,988.00` and `$349.00`. It has no match for `/(?<!\$)\b\d{3,}\.\d{2}\b/`, no "One Xero invoice", and no "fixes". With no PIESA line it has no `NaN`/`undefined`. A stored snapshot with `payment_terms: "One Xero invoice for 5988.00…"` is shown unchanged by the signed-copy view.
- [ ] Step 2: Run `bun test tests/acceptance-payment-terms-wording.test.ts`. Expected: FAIL (function not defined).
- [ ] Step 3: Implement `acceptancePaymentTerms` by building the plan → money → `paymentTermsText`. Use it in `buildAcceptancePackage`. Update `PAYMENT_TERMS_BODY` wording and bump `PAYMENT_TERMS_VERSION` (new body = new version, Draft until Jo approves).
- [ ] Step 4: Run the test plus `bun test tests/owner-gates*`. Expected: PASS.
- [ ] Step 5: Commit `fix: owner payment line shows $ and current payment steps`.

### Task 2: Remove "lawyer" from versions and notes

**Files:**
- Modify: `src/lib/owner-gates.core.ts:34-38,77` (`LAWYER_V` → `PAPERWORK_V = "2026-10-06-v1"`, `LAWYER_APPROVAL_NOTE` → `PAPERWORK_APPROVAL_NOTE = "Approved by Jo, 6 Oct 2026"`, plus comments)
- Modify: `src/lib/consent.core.ts:11,127` (comments only)
- Create: `docs/pending-migrations/paperwork-version-rename.sql` (+ `.rollback.sql`, proven on PGlite via a new `tests/helpers/pglite-paperwork-rename.ts`` (adds `owner_paperwork_approvals` rows for `2026-10-06-v1` copied from `lawyer-2026-10-06-v1`, same body hash. Sets `compliance_templates` consumer_rights `version = '2026-10-06-v1'`, `source_note = 'Approved by Jo, 6 Oct 2026'`. Updates old rows only, no deletes, and doesn't touch signatures.)
- Modify: tests referencing `LAWYER_V` (`tests/esc-consent-template*.test.ts`, `tests/owner-gates-scenario-f.test.ts`, `tests/a48-b1-life-support.test.ts`)
- Test: `tests/paperwork-no-lawyer.test.ts`

**Interfaces:**
- Produces: `PAPERWORK_V`, `PAPERWORK_APPROVAL_NOTE` (replace every `LAWYER_*` import)

- [ ] Step 1: Write a failing test: every `GATE_DOCS` entry's version, approvalNote, title and body, every `PAPERWORK_SCREENS` string, and `paperworkCatalogue()` output for the TEST db have no `/lawyer/i`.
- [ ] Step 2: Run it. Expected: FAIL.
- [ ] Step 3: Rename the constants and write the migration. `approvedVersions()` must report the renamed items as approved.
- [ ] Step 4: Run `bun test tests/paperwork-no-lawyer.test.ts tests/owner-gates* tests/esc-consent*`. Expected: PASS.
- [ ] Step 5: `grep -rni lawyer src` shows only the email auto-reply keyword list (`owner-email-auto-reply.core.ts`, `ai-email-reply.core.ts`) and the installer/REC draft headers. Those are not owner paperwork, so leave them.
- [ ] Step 6: Commit `fix: remove lawyer reference from owner paperwork versions`.

### Task 3: job_overview authority functions fast

**Files:**
- Create: `docs/pending-migrations/job-authority-fast.sql` (+ `.rollback.sql`, proven on PGlite; live timing measured read-only`
- Test: `tests/job-overview-authority-perf-db.test.ts`; keep `tests/job-overview-c3-role.test.ts` green

**Interfaces:**
- Produces: same `job_authority_status(uuid) → text`, `job_authority_expires_at(uuid) → timestamptz`, same results per caller.

- [ ] Step 1: Write a failing DB test. As admin `info@`, installer, electrician and owner TEST logins, `select id, authority_status, authority_expires_at from job_overview` equals a stored baseline (captured before the migration). As admin, `explain analyze select * from job_overview` executes in under 500 ms.
- [ ] Step 2: Run it. Expected: timing FAIL (~2.9 s).
- [ ] Step 3: Rewrite both functions so the access test is `(select public.is_admin()) or public.can_access_job(_job)`. The `(select …)` initplan is evaluated once per statement, so admins skip the per-row check, and non-admins keep the same check.
- [ ] Step 4: Run the test plus `tests/job-overview-c3-role.test.ts` and `tests/a3-a4-role-isolation-db.test.ts`. Expected: PASS. If admin timing is still over 500 ms, inline the latest `owner_authorities` row as a lateral join in the view and re-run.
- [ ] Step 5: Commit `perf: job_overview authority check once per query`.

### Task 4: Send quote reads in parallel

**Files:**
- Modify: `src/lib/office-quote-review.server.ts:44-76` (`releaseQuoteToOwner`)
- Test: `tests/office-send-quote-speed.test.ts`

- [ ] Step 1: Write failing tests:
  - Each existing refusal (closed job, wrong stage, commercial blocker, no owner link, comms off, TEST link missing) returns the same message as before.
  - Two concurrent `sendOfficeReviewedQuote` calls on one TEST draft give exactly one `customer_email_sends` row.
  - A TEST send completes in under 2 s.
- [ ] Step 2: Run. Expected: timing FAIL.
- [ ] Step 3: Read quote, `officeQuoteBlockers`, delivery permission, `jobs(stage, source)` (one read replacing the two separate ones) and `commercialBlocker` together with `Promise.all`. Then raise refusals in the old order. The stage transition, `ensureOwnerLink`, cobrand, the claim update and the email stay sequential after that.
- [ ] Step 4: Run the test plus `bun test tests/*quote*`. Expected: PASS.
- [ ] Step 5: Commit `perf: Send quote runs its checks together`.

### Task 5: Accept, Customer agreement and Consumer rights pages fast

**Files:**
- Modify: `src/lib/assignment.server.ts:62-68` (`buildAcceptancePackage`: quote first, then job, measurement, rectification and `installerFacts` in one `Promise.all`)
- Modify: whatever the timing step shows as slowest in `src/lib/owner-link.functions.ts` (acceptance loader) and `src/lib/owner-gates.server.ts` (`paperworkCatalogue`, gate loaders)
- Test: `tests/owner-accept-speed.test.ts`

- [ ] Step 1: Write failing timing tests on a TEST job. The owner acceptance loader, the accept action, and the Customer agreement and Consumer rights page loaders each complete in under 2 s.
- [ ] Step 2: Run, and log per-call times. Expected: FAIL. Note the slowest calls in the PR description.
- [ ] Step 3: Parallelise `buildAcceptancePackage`, then fix each call over 300 ms from Step 2 (parallel reads or a narrower select). Results stay the same.
- [ ] Step 4: Run the test plus `bun test tests/*assignment* tests/owner-gates*`. Expected: PASS.
- [ ] Step 5: Commit `perf: owner accept and paperwork pages load together`.

### Task 6: Check and hand over

- [ ] Step 1: `bun run test` and `bun run lint` are all green.
- [ ] Step 2: Open the TEST owner accept page in Playwright and screenshot it. All money has $, no "lawyer", and the page opens in under 2 s.
- [ ] Step 3: Push the branch `quote-speed-paperwork-wording` and open the PR (don't merge). In the PR, list both migrations and the payment-terms version that needs Jo's approval.
- [ ] Step 4: Ask Jo before the migrations run on the live database.
