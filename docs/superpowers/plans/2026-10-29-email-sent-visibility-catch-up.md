# Seeing What Was Sent — Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring branch `email-sent-visibility` up to date with live `main`, send no-job website-link and follow-up replies through Outlook, and ship the delivery columns the way this repo ships database changes.

**Architecture:** Merge `origin/main` into the branch, resolving `src/lib/emails-tab.server.ts` so live's link-retry and follow-up rules survive and every Emails-tab send uses `sendViaOutlook`. Follow-ups get a once-only claim (new unique partial index) taken before the Outlook call. The delivery-result SQL moves to `docs/pending-migrations/` with a rollback and a PGlite proof.

**Tech Stack:** TanStack Start, Supabase, Bun tests, PGlite helpers in `tests/helpers/`, Microsoft Graph via the Lovable Outlook connector.

**Spec:** `docs/superpowers/specs/2026-10-28-email-sent-visibility-design.md` (see "Addition (29 Oct 2026)")

## Global Constraints

- On-screen wording for no-job replies stays exactly as live `main` (including "… Reply to them from Outlook instead.", "This person has already had a reply with the website link.", "This person's website-link reply is already being sent.", "A reply to this email has already been sent.").
- Live rule kept: a second website-link email only when every earlier one definitely failed (`linkStatesFor` / `failedOnly`).
- Outlook outcomes: `sent`; `uncertain` = counts as sent, status `delivery uncertain: <detail>`, never resent; `failed` = definite, recorded, retry allowed.
- Never two emails from one double tap.
- `workflow_events` is append-only: insert only.
- Database changes ship as `docs/pending-migrations/<name>.sql` + `<name>.rollback.sql`, proven on PGlite; never run on the live database in this work.
- Never touch the live database, Lovable, Resend or Outlook; no real network in tests.

## Review Focus

- Merge drops a live rule (link retry claim, follow-up "already sent" check, `NO_JOB_DRAFT_FAILED_EVENT` drafting) → test each still holds after the merge (Task 1).
- Two taps on a follow-up at once → one Outlook call (Task 2).
- Follow-up definite failure then retry with the same words → second attempt sends once (Task 2).
- New claim event type has no job → must be allowed by `workflow_events_job_required` without dropping any type live already allows (Task 2).
- PGlite: delivery columns migration applies twice cleanly and rollback removes it (Task 3).

---

### Task 1: Merge live `main` and route the website-link reply through Outlook

**Files:**
- Modify: `src/lib/emails-tab.server.ts`, `tests/emails-tab.test.ts`, `tests/emails-tab-outlook-send.test.ts` (and any file `git merge origin/main` reports as conflicted)

**Interfaces:**
- Consumes: `sendViaOutlook(p: { replyToMessageId: string|null; to: string; subject: string; html: string }): Promise<OutlookSendResult>` from `src/lib/outlook-send.server.ts`.
- Produces: `sendNoJobEmailReply` (link path) on live's logic with `resendSend` replaced by `sendViaOutlook({ replyToMessageId: ev.details.message_id, … })`. Outlook `failed` maps where live mapped Resend `rejected`/`not_attempted` (records the failed link event, throws live's message). Outlook `uncertain` maps where live mapped Resend `uncertain`.

- [ ] **Step 1:** `git merge origin/main`; resolve conflicts keeping live's rules and this branch's Outlook sending. Record the merge commit.
- [ ] **Step 2: Failing/updated tests** — link reply calls `sendViaOutlook` with the original message id; definite failure records the failed-link event and throws live's exact message; a second link after only-failed earlier links takes the `:retry<n>` claim and sends; uncertain counts as sent; double tap → one call.
- [ ] **Step 3:** Run `bun test --timeout 30000 ./tests/emails-tab.test.ts ./tests/emails-tab-outlook-send.test.ts` plus every test file live `main` added or changed for the Emails tab (`git diff --name-only 06321bb5 origin/main -- tests/`) — Expected: PASS.
- [ ] **Step 4:** Commit `merge: catch up with live main; website-link replies through outlook`.

### Task 2: Follow-up replies through Outlook with a once-only claim

**Files:**
- Create: `docs/pending-migrations/followup-send-claim.sql`, `docs/pending-migrations/followup-send-claim.rollback.sql`
- Modify: `src/lib/emails-tab.server.ts` (`sendNoJobFollowUp`), `src/lib/emails-tab.core.ts` (constant), test helper loading pending migrations if needed
- Test: `tests/emails-tab-followup-outlook.test.ts`, `tests/followup-send-claim-practice-db.test.ts`

**Interfaces:**
- Produces: `NO_JOB_FOLLOWUP_CLAIM_EVENT = "email_nojob_followup_claim"`; claim key `${noJobFollowUpSentKey(mid)}:try${failures}` where `failures` = count of earlier definite follow-up failures for that message; failure event `email_nojob_followup_failed` (job-less).
- Migration: unique partial index on `workflow_events ((details->>'claim_key')) where event_type = 'email_nojob_followup_claim'`; widen `workflow_events_job_required` to also allow the two new types — rebuild it from the latest definition across all of `docs/pending-migrations/` so no existing allowed type is dropped. Rollback restores the previous definition and drops the index.

Rules (`sendNoJobFollowUp`): keep live checks in order; after the "already sent" check, insert the claim (23505 → throw `A reply to this email has already been sent.`); then `sendViaOutlook({ replyToMessageId: mid, … })`; `failed` → insert failure event, throw live's message; `uncertain`/`sent` → live's recording, dismissal and archive.

- [ ] **Step 1: Failing tests** — two concurrent calls → one Outlook call; definite failure then retry with same words → sends once; uncertain then retry → refused, no Outlook call; PGlite: index rejects a duplicate claim, job-less claim/failure rows are allowed, every type the previous constraint allowed is still allowed, rollback restores it.
- [ ] **Step 2:** Run the two new test files — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them plus `./tests/emails-tab.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit `feat(email): follow-up replies through outlook with a once-only claim`.

### Task 3: Ship the delivery columns as a pending migration

**Files:**
- Create: `docs/pending-migrations/email-delivery-result.sql`, `docs/pending-migrations/email-delivery-result.rollback.sql`
- Remove: `drizzle/migrations/0178_email_delivery_result.sql`, its `meta/_journal.json` entry and `meta/0178_snapshot.json`
- Test: `tests/email-delivery-result-practice-db.test.ts`

Rules: same SQL as 0178 (additive, idempotent); rollback drops the two check constraints, two indexes and three columns per table; header comment in the style of other pending migrations naming the proof test.

- [ ] **Step 1: Failing test** — PGlite: apply twice cleanly; accepts `bounced`, rejects `sent`; rollback removes the columns.
- [ ] **Step 2:** Run it — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it plus `./tests/email-delivery.core.test.ts ./tests/resend-delivery-hook.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit `chore(email): delivery result columns as a pending migration`.

### Task 4: Allow the job-less AI-draft failure record

**Files:**
- Modify: `docs/pending-migrations/followup-send-claim.sql`, `docs/pending-migrations/followup-send-claim.rollback.sql`
- Test: `tests/followup-send-claim-practice-db.test.ts`

Rules: add `email_nojob_ai_draft_failed` to the forward `workflow_events_job_required` list; add it to the rollback's refusal check (rollback refuses while such rows exist); the rollback's restored list stays exactly the previous live definition; header comment updated.

- [ ] **Step 1: Failing test** — job-less `email_nojob_ai_draft_failed` row is allowed after the forward script; rollback refuses while one exists.
- [ ] **Step 2:** Run `bun test --timeout 30000 ./tests/followup-send-claim-practice-db.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it plus `./tests/emails-tab.test.ts` — Expected: PASS.
- [ ] **Step 5:** Commit `fix(email): allow the job-less AI-draft failure record`.
