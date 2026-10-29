# Batch 2 — Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make held, failed and drafted messages behave the way Jo decided, without new owner wording.

**Architecture:** Pure rules in `*.core.ts`, I/O in `*.server.ts`, one new sweep on the existing 15-minute tick. No tables or migrations.

**Tech Stack:** TypeScript, TanStack Start, Supabase admin client, Bun test.

**Spec:** `docs/superpowers/specs/2026-10-29-batch2-messages-design.md`

## Global Constraints

- Branch `fix/batch2-messages` (on top of `fix/batch1-money-cancels`); never push to `main`, never rewrite pushed commits.
- No new tables or migrations; no new owner-facing wording; no change to approved wording or prices.
- Every real text goes only through `sendRealSms`; TEST (`qa_test`) jobs keep the test sender.
- Quiet hours 8pm–7am Melbourne stay as they are; sign-in codes stay exempt.
- One send per idempotency key; a held row never claims the real key.
- `bun scripts/scan-retired-terms.ts` → 0 customer-visible after each task.

## Review Focus

1. A text held twice overnight (two holds, same real key) is sent once at 7am (Task 1 test `two holds one send`).
2. A held text whose fact changed overnight (visit moved, owner already signed) is not sent (Task 1 per-type `stale` tests).
3. The 7am sweep never runs between 8pm and 7am, and never touches `qa_test` jobs (Task 1).
4. A held row older than 24h is not sent (Task 1).
5. An AI draft for a released owner may still mention the Ready Check (Task 3 `released owner unchanged`).

---

### Task 1: Send quiet-hours-held texts at 7am if still true

**Files:**
- Create: `src/lib/quiet-held-texts.core.ts` — `QUIET_RESEND_TYPES`, `quietResendDue(rows, claimed, nowIso): HeldRow[]`, per-type `stillTrue` dispatch type.
- Create: `src/lib/quiet-held-texts.server.ts` — `sweepQuietHeldTexts(nowIso?: string): Promise<{ sent: number; skipped: number }>` and one `stillTrue<Type>(row)` reader per type, reusing the existing predicates named in the spec.
- Modify: the 15-minute tick next to `sweepJobOfferTexts` (`src/routes/api/public/hooks/allocation-tick.ts:~224`).
- Test: `tests/batch2-quiet-held-texts.test.ts`

**Interfaces:**
- Produces: `sweepQuietHeldTexts`; `QUIET_RESEND_TYPES` = the 14 types in the spec.

- [ ] **Step 1: Failing tests** — core: held row 22:00 for `spot_saved`, real key unclaimed, now 07:05 → due; now 06:55 → nothing; real key claimed → nothing; held 25h ago → nothing; `two holds one send` (two held rows, one real key) → one due; type not in the list → nothing; `qa_test` job → nothing. Server: due + stillTrue true → `sendRealSms` called once with the real key, stored body, `event.at` = hold time; stillTrue false → not called. One `stale` test per type for its stillTrue reader.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as listed. Read rows with `status='blocked'`, `detail = SMS_QUIET_REASON`, held key, last 24h; group by `claimKeyOf`; skip any group whose real key exists in `sms_messages`.
- [ ] **Step 4:** Run → PASS; re-run `tests/*sms*`, `tests/ready-check-offer-text*`.
- [ ] **Step 5:** Commit `feat(texts): send quiet-hours-held texts at 7am when still true`.

### Task 2: Needs me shows sends that need the office

**Files:**
- Modify: `src/lib/send-failed.core.ts`, `src/lib/office-needs.server.ts:~89-100` (selection), `src/lib/office-needs.core.ts` (job-less partner row if needed).
- Modify: `src/lib/ready-check-chase.core.ts` (`RULES`, `MittiOfficeCode`), `src/lib/allocation.core.ts` (`NEEDS_TEXT`), `src/lib/needs.server.ts:~160` (event types) for `stop_installer_release_failed`.
- Test: `tests/batch2-needs-sends.test.ts`

- [ ] **Step 1: Failing tests** — text `sent_unknown` → row "not sure it arrived"; email `delivered_unrecorded` → row; email `sending` 2h old → row, 20 min old → none; partner text `failed` with no job → job-less row naming the business; text `blocked` quiet hours → no row; later `delivered` clears as today. `stop_installer_release_failed` event → one row with line "STOP received, but releasing the installer failed — open the job and cancel again"; a later `job_cancel_released` event on the job clears it.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as listed, reusing existing row shapes and wording style.
- [ ] **Step 4:** Run → PASS; re-run `tests/*needs*`, `tests/send-failed*`.
- [ ] **Step 5:** Commit `fix(needs-me): show unsure, partner-only and STOP clean-up failures`.

### Task 3: AI drafts follow the spot-only rule before release

**Files:**
- Modify: `src/lib/ai-email-reply.core.ts:~75-110, ~182` — prompt builder takes `{ preRelease: boolean }`; `aiReplyProblems(body: string, opts?: { preRelease?: boolean }): string[]` adds `preReleaseViolations(body)` when `preRelease`.
- Modify: `src/lib/ai-email-reply.server.ts:~49, ~70, ~158` — read release state with `spotReleaseStates` / `spotReleaseState`; pass it to the prompt and to both checks (draft creation and `sendAiDraft`).
- Test: `tests/batch2-ai-draft-prerelease.test.ts`; add `ai-email-reply.core` to `tests/decision-388-spot-only.test.ts` scan.

- [ ] **Step 1: Failing tests** — pre-release prompt contains no `PRE_RELEASE_FORBIDDEN` phrase and includes the spot-only lines; `aiReplyProblems("…free Ready Check…", { preRelease: true })` non-empty; `released owner unchanged` — same body with `preRelease: false` → no pre-release problem; `sendAiDraft` refuses a pre-release violating draft.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as listed; spot-only lines come from `spot-only-copy.core.ts`, no new wording.
- [ ] **Step 4:** Run → PASS; re-run `tests/*ai-email*`, `tests/decision-388-spot-only.test.ts`.
- [ ] **Step 5:** Commit `fix(ai-drafts): spot-only wording for owners not yet released`.

### Task 4: Re-sending a reopened declined quote reaches the owner

**Files:**
- Modify: `src/lib/quote-ready-notify.server.ts:~105-120` — key suffix from the count of `quote_reopened_by_office` events with `details.quote_id = quoteId`: 0 → unchanged keys, n → `:r${n}`.
- Test: `tests/batch2-quote-resend.test.ts`

- [ ] **Step 1: Failing tests** — first send keys unchanged; after one reopen, keys end `:r1` and `sendRealSms` + email are called; second Send without another reopen → `already` (no duplicate).
- [ ] **Step 2–5:** RED, implement, GREEN (+ `tests/*quote-ready*`, `tests/*quote-review*`), commit `fix(quotes): re-sent quote after reopen reaches the owner`.

### Task 5: Old reply composer loses pre-release wording

**Files:**
- Modify: `src/lib/email-reply.core.ts:~247-248, ~327-339` — replace the pre-release phrases with the spot-only lines from `spot-only-copy.core.ts`.
- Modify: `tests/decision-388-spot-only.test.ts` — add `email-reply.core` renderers.

- [ ] **Step 1–5:** failing scan → replace → scan passes (+ `tests/email-reply*`, `tests/templates-hub*` baseline noted) → commit `fix(reply-composer): spot-only wording`.

### Task 6: Whole-branch check

- [ ] Full suite per file vs 28 Oct baseline (no new failing files); `tsc --noEmit` (only the 4 `xlsx` errors); retired scan 0; final whole-branch review; push branch; ask Jo before opening for review.
