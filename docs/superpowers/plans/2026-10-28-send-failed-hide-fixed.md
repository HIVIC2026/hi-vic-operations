# Send failed: hide fixed failures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failed email or text drops off the Send failed list once a later send of the same kind to the same job went through.

**Architecture:** `sendFailedRows` already receives rows of any status and ignores non-failures. The server will now also pass in `sent` emails and `delivered` texts, and `sendFailedRows` drops a failure when the same job has a later success of the same kind. The function signature does not change.

**Tech Stack:** TypeScript, Bun test, Supabase.

**Spec:** `docs/superpowers/specs/2026-10-28-send-failed-hide-fixed-design.md`

## Global Constraints
- Email success = `customer_email_sends.status = 'sent'`, same `job_id` and same `purpose`, `created_at` after the failure.
- Text success = `sms_messages.status = 'delivered'` only, same `job_id` and same `message_type`, `created_at` after the failure. `sent` texts do not count.
- Wording, order and the 7-day window of remaining rows do not change. Nothing is resent.

## Review Focus
- Success at the exact same timestamp as the failure: still shown (must be strictly after). Tested in Task 1.
- Success older than 7 days: cannot clear a failure in the window (it is not loaded). Covered because only failures in the window are listed.
- A job with two failed kinds, one later fixed: the row shows only the unfixed one and its count is 1. Tested in Task 1.

---

### Task 1: Drop failures that have a later success

**Files:**
- Modify: `src/lib/send-failed.core.ts` (`sendFailedRows`, and add `SUCCESS_EMAIL_STATUSES = ["sent"]`, `SUCCESS_SMS_STATUSES = ["delivered"]` exports)
- Test: `tests/send-failed.test.ts`

**Interfaces:**
- Produces: `SUCCESS_EMAIL_STATUSES`, `SUCCESS_SMS_STATUSES` (readonly string tuples), used by Task 2. `sendFailedRows` signature unchanged.

- [ ] **Step 1: Write failing tests** in a new `describe("fixed failures are hidden")`:
  - `failed` email `existing_leads_launch_v1` at `ago(5)` + `sent` same job/purpose at `ago(4.9)` → `rows` is `[]` (Watkinson case).
  - same failure + `sent` email for same job but purpose `quote_reminder` → 1 row.
  - same failure + `sent` same purpose at `ago(6)` (before) → 1 row.
  - same failure + `sent` same purpose at exactly `ago(5)` → 1 row.
  - `failed` sms `spot_saved` at `ago(5)` + `delivered` same job/type at `ago(4)` → `[]`.
  - same sms failure + `sent` (not delivered) at `ago(4)` → 1 row.
  - job with failed email `existing_leads_launch_v1` (later `sent`) and failed email `quote_reminder` (not fixed) → 1 row, `count` 1, text contains "Quote reminder email" and not "Save my spot".
- [ ] **Step 2: Run** `bun test tests/send-failed.test.ts` — new tests FAIL, old ones pass.
- [ ] **Step 3: Implement.** In `sendFailedRows`, build the latest success time per `jobId|kind` (emails: `purpose` with a status in `SUCCESS_EMAIL_STATUSES`; texts: `message_type` with a status in `SUCCESS_SMS_STATUSES`; key emails and texts separately). Skip a failure when that key has a success strictly later than the failure.
- [ ] **Step 4: Run** `bun test tests/send-failed.test.ts` — all PASS.
- [ ] **Step 5: Commit** `fix: hide send failures that later went through`.

### Task 2: Load successful sends for the list

**Files:**
- Modify: `src/lib/office-needs.server.ts` (the "failed emails" and "failed texts" queries, ~lines 86–87)

**Interfaces:**
- Consumes: `FAILED_EMAIL_STATUSES`, `SUCCESS_EMAIL_STATUSES`, `FAILED_SMS_STATUSES`, `SUCCESS_SMS_STATUSES` from Task 1.

- [ ] **Step 1: Change queries.** Emails: replace `.eq("status", "failed")` with `.in("status", [...FAILED_EMAIL_STATUSES, ...SUCCESS_EMAIL_STATUSES])`. Texts: replace the status list with `[...FAILED_SMS_STATUSES, ...SUCCESS_SMS_STATUSES]`. Keep the 7-day filter and selected columns.
- [ ] **Step 2: Run** `bun run test` and the type check (`bunx tsc --noEmit`) — PASS.
- [ ] **Step 3: Check live data** read-only: confirm the six 23 Oct jobs (HV-3127, 3131, 3132, 3133, 3135, 3152) each have a `sent` `existing_leads_launch_v1` row after their failed one, so they will drop off.
- [ ] **Step 4: Commit** `fix: load successful sends so fixed failures drop off Send failed`.
