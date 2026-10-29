# Portal Fixes to Match the Guide — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portal follow Jo's rules in the 7 places the business guide found gaps.

**Architecture:** Small changes inside existing modules, each on its own branch and pull request. Part 1 (Tasks 1–4) starts now; Part 2 (Tasks 5–7) starts only after the waiting branches are merged into main.

**Tech Stack:** TypeScript, React (TanStack routes), Supabase, MJML emails, Bun test runner (`bun test <file>`; full suite `bun run test`).

**Spec:** `docs/superpowers/specs/2026-10-29-guide-rule-fixes-design.md`

## Global Constraints
- Tests first; full suite (`bun run test`) green before each pull request.
- One branch + pull request per task: `fix/guide-<n>-<slug>`. Never merge or publish — Jo says go.
- No extra features. Jobs already in progress are not re-priced or re-offered.
- Log each decision in `docs/JO_DECISIONS_LOG.md` as the next number, dated 29 Oct 2026, "Jo".
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01CfFAPEELBLJ27tbMxrNfEh`.

## Review Focus
1. Emails with no calculator URL and emails with one must render the same (no stray "Try a different ceiling size" or empty `<br />`) — Task 1 test covers both.
2. O33 with no balance known (`balanceIncGst` null) must still read correctly without "[deposit]" gaps — Task 2 test.
3. Electrician with licence number but blank or past expiry must be hard-blocked, and the checklist must not offer "approve anyway" — Task 3 tests.
4. A re-generated fixes quote on a job whose first fixes quote was already sent keeps the old price — Task 5 test.
5. Owner asks for new safety-check times after an offer: re-offer goes to one electrician, not a batch — Task 7 test.

---

## Part 1 — now

### Task 1: Remove the calculator line from owner emails

**Files:**
- Modify: `src/lib/jo-outcome-email.core.ts` (`CALCULATOR_LINE` ~169, `bindLinks` ~189–193, `mjRebateAndPrice` ~309–310, `rebateAndPriceText` ~315–318)
- Modify: `src/lib/jo-email-templates.core.ts` (lines ~215, 249, 295 — the "Want to explore a different ceiling size?" lines only; keep the T7 "Checking another property?" block at ~330)
- Modify: `docs/templates/mjml/owner_O1*.mjml`, `owner_O2*.mjml`, `owner_O66.mjml`, `owner_O67.mjml`, `owner_O68.mjml` (line ~30)
- Test: `tests/guide-fix-no-calculator-line.test.ts` (new); update `tests/estimate-followup.test.ts:121`, `tests/jo-email-size-and-branding.test.ts:194`, `tests/p1-s77-single-template-source.test.ts:76`, `tests/step3-email-parity.test.ts:55`

**Interfaces:** `mjRebateAndPrice` and `rebateAndPriceText` keep their input type (`calculatorUrl` stays in the type, now unused) so callers don't change.

- [ ] **Step 1: Write the failing test** — render O1, each O2 version, O66, O67, O68 with a `calculatorUrl` set; assert html and text contain neither `"Try a different ceiling size"` nor `"explore a different ceiling size"` nor the calculator URL. Also assert the O6/T7 email still contains `"Open the calculator →"`.
- [ ] **Step 2: Run** `bun test tests/guide-fix-no-calculator-line.test.ts` — Expected: FAIL.
- [ ] **Step 3: Remove** the line from the template copy and the two price-box helpers; delete the `CALCULATOR_LINE` replace in `bindLinks`.
- [ ] **Step 4: Update** the four existing tests to expect no line.
- [ ] **Step 5: Run** the new test + the four, then `bun run test` — Expected: PASS.
- [ ] **Step 6: Log decision** "Calculator line removed from owner emails (Jo 29 Oct 2026)". Commit on `fix/guide-1-no-calculator`, open PR.

### Task 2: O33 deposit wording

**Files:**
- Modify: `src/lib/install-days-email.core.ts` (`lock1`, `lock2` in `renderInstallDaysEmail`)
- Modify: `docs/templates/mjml/owner_O33.mjml:33-34`
- Test: `tests/install-days.core.test.ts`, `tests/approved-email-designs.test.ts`

- [ ] **Step 1: Write the failing test** — with `balanceIncGst: 3379` (deposit $337.90, rest $3,041.10) the email text contains exactly:
  "To book your day, sign your install consent and pay your 10% deposit of $337.90. Once it's in, your day is locked in." and "The rest, $3,041.10, is due on install day. Or you can pay in full now." and does NOT contain "48 hours". With `balanceIncGst: null`: "…pay your 10% deposit. Once it's in, your day is locked in." and "The rest is due on install day. Or you can pay in full now."
- [ ] **Step 2: Run** `bun test tests/install-days.core.test.ts` — Expected: FAIL.
- [ ] **Step 3: Change** `lock1`/`lock2` to the spec wording; mirror in the MJML file.
- [ ] **Step 4: Run** both test files, then `bun run test` — Expected: PASS.
- [ ] **Step 5: Log decision**; commit on `fix/guide-2-o33-deposit`, open PR.

### Task 3: Electrician licence is a hard block

**Files:**
- Modify: `src/lib/partner-activation.core.ts` — add `electricianLicenceBlockers(d: RecData, now?: Date): string[]` (the two licence lines moved out of `electricianApprovalBlockers`); `mandatoryActivationBlockers(type, data, certifications?, now = new Date())` returns them for `type === "rec"`.
- Modify: `src/lib/partner-activation.functions.ts` (~47 override path, ~336 checklist `hardBlocked`/`needsOverride`) so licence problems show as blocked.
- Test: `tests/electrician-approval-checks.test.ts`, `tests/partner-activation.test.ts`

**Interfaces:** Produces `electricianLicenceBlockers(d: RecData, now?: Date): string[]` returning `"Electrical licence is missing."` or `"Electrical licence is expired or has no expiry date."`.

- [ ] **Step 1: Write failing tests** — `mandatoryActivationBlockers("rec", {licence_number:""})` contains "Electrical licence is missing."; with number + past expiry, or number + blank expiry, contains "Electrical licence is expired or has no expiry date."; with valid licence returns `[]`. `electricianApprovalBlockers` no longer returns licence lines. Checklist for a missing licence reports `hardBlocked: true`.
- [ ] **Step 2: Run** both test files — Expected: FAIL.
- [ ] **Step 3: Implement** as in Files/Interfaces. Insurance, REC number, $5m cover and $349 price stay override-with-reason.
- [ ] **Step 4: Run** both test files, then `bun run test` — Expected: PASS.
- [ ] **Step 5: Log decision** replacing decision 415's licence part; commit on `fix/guide-3-licence-block`, open PR.

### Task 4: Confirm Emails tab sends any time is live

- [ ] **Step 1:** Confirm main has commit `761f6799` and `sendAiDraft` (`src/lib/ai-email-reply.server.ts:160-161`) does not call `aiSendQuietReason`. Run `bun test tests/ai-email-reply.core.test.ts` — Expected: PASS.
- [ ] **Step 2:** Check the live Lovable project is on a commit at or after `761f6799` (Lovable `get_project` → latest commit). Report to Jo whether a publish is needed. No code change; no PR.

## Part 2 — after `fix/batch1-money-cancels`, `fix/batch2-messages`, `fix/batch3a-quotes-deposit` and `fix-held-quote-latest-price` are merged

Before each task: re-read the named files on the new main. If code has moved, record a ruling in the ledger and follow the spec.

### Task 5: $100 fixes markup on our own jobs only

**Files:** `src/lib/fixes-price.core.ts` (`fixesMarginFor`), `src/lib/quotes.server.ts` (`generateRectificationQuote`), `src/lib/journey-branches.server.ts:~370`. Tests: `tests/fixes-price.core.test.ts`, `tests/rectification-pricing.test.ts`, `tests/fixes-quote-a4-isolated.test.ts`, `tests/our-lead-piesa-electrician.test.ts`.

**Interfaces:** `fixesMarginFor(channel: "hivic_sourced" | "installer_sourced"): 0 | 100` (replaces the electrician-source argument).

- [ ] **Step 1: Failing tests** — `fixesMarginFor("hivic_sourced") === 100`; `fixesMarginFor("installer_sourced") === 0`; a website job with the installer's electrician still gets +$100; an installer job with HIV's electrician gets $0; regenerating a fixes quote when one was already sent keeps the sent price.
- [ ] **Step 2: Run** — FAIL. **Step 3:** implement; pass `jobs.channel` from `generateRectificationQuote`. **Step 4:** tests + `bun run test` — PASS.
- [ ] **Step 5:** log decision (replaces 313/349/351 markup rule); commit `fix/guide-5-fixes-markup`, PR.

### Task 6: Quote acceptance without typing a name

**Files:** `src/routes/my-job.$token.tsx` (~320–345 acceptance form, ~674 fixes approval), `src/lib/owner-link.functions.ts` (~41–48), `src/lib/portal.functions.ts` (~649–742), `src/lib/assignment.core.ts` (~97–105), `src/lib/assignment.server.ts` (`signCustomerAgreement` ~110–150). Tests: `tests/measured-quote-accept.test.ts`, `tests/assignment.core.test.ts`, `tests/activity48-agreement-signing.test.ts`, `tests/quote-acceptance-line.test.ts`, `tests/journey-a1-complete-route-db.test.ts`, `tests/journey-a2-complete-route-db.test.ts`.

**Interfaces:** acceptance input drops `signatoryName`, `signatureName`, `over18`; server sets `signatory_name` and `signature_name` from the job's owner name; `signatory_over_18` = null.

- [ ] **Step 1: Failing tests** — accepting with only the accept tick(s) succeeds; the stored agreement has `signatory_name` = owner name on file and `signatory_over_18` null; the My job form renders no name inputs and no "over 18" tick; consent, VEEC form and PIESA confirmation screens still ask for their own names.
- [ ] **Step 2: Run** — FAIL. **Step 3:** implement. **Step 4:** tests + journeys + `bun run test` — PASS.
- [ ] **Step 5:** log decision; commit `fix/guide-6-accept-no-name`, PR.

### Task 7: Safety check offers one at a time

**Files:** `src/lib/auto-offer.core.ts`, `src/lib/auto-offer.server.ts`, `src/lib/allocation.server.ts` (~228–272 batch path, ~268 re-offer on new times), `src/lib/allocation.core.ts`. Tests: `tests/auto-offer.core.test.ts`, `tests/piesa-allocation-db.test.ts`, `tests/offer-dispatch.test.ts`, `tests/electrician-matching-db.test.ts`, `tests/auto-offer-switches-practice-db.test.ts`.

**Interfaces:** new offers on all channels go through the auto-offer path; the batch path is used only to let existing open batch offers finish.

- [ ] **Step 1: Failing tests** — website job: one offer to the nearest approved electrician, expires 24 hours later, then next nearest, after 2 misses the job is back with the office; installer job: chosen electrician first, after 24 hours with no answer back to the office (no second electrician); owner new-times re-offer creates one offer, not a batch; existing open batch offers are untouched.
- [ ] **Step 2: Run** — FAIL. **Step 3:** route new offers and re-offers through auto-offer; stop new batch offers. **Step 4:** tests + `bun run test` — PASS.
- [ ] **Step 5:** log decision; commit `fix/guide-7-one-at-a-time`, PR.

## After all tasks
- One fresh review of all branches against the spec.
- Update the guide's "Coming soon" line as each fix goes live (Jo says go).
