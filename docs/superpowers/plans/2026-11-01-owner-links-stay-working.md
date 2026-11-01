# Owner Links Stay Working Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner links (`customer_estimate_links`) work until the job is cancelled. There's no 30-day limit.

**Architecture:** Drop the date from the shared `linkUsable`/`planLink` check and from the two places that check the date themselves. A `jobs` trigger revokes a job's links on cancel and restores them on reopen. A one-off clean-up revokes the links on jobs that are already cancelled. All SQL lives in `docs/pending-migrations/` and is proven on PGlite. Nothing runs live without Jo's OK.

**Tech Stack:** TypeScript, Bun test, PGlite (`@electric-sql/pglite`), Postgres/Supabase.

**Spec:** `docs/superpowers/specs/2026-11-01-owner-links-stay-working-design.md`

## Global Constraints

- Links stop only when the job stage is `cancelled`. `complete` jobs keep working.
- Reopen (stage leaves `cancelled`) restores the **same** token. Only links revoked with `revocation_reason = 'job_cancelled'` are restored.
- New links get `expires_at = '9999-12-31T00:00:00.000Z'`. `LINK_TTL_DAYS` is removed.
- No new owner-facing wording. Revoked links show the pages' existing messages.
- Other expiry rules (quote 14-day expiry, test logins, verify codes, trade offers) are untouched.
- No live database change without asking Jo right before it runs. Open a PR and stop: never merge.

## Review Focus

1. A link revoked for another reason (Gate 1, `revocation_reason` not `job_cancelled`) must stay revoked when the job is reopened. Test in Task 3.
2. Stage changes that aren't to or from `cancelled` (e.g. `complete`, `on_hold`) must not touch links. Test in Task 3.
3. An old row with a past `expires_at` (all existing rows) must be usable and reused, not re-issued with a new token. A new token would break the owner's emails. Test in Task 1.
4. The clean-up must skip test jobs (`jobs.source = 'qa_test'`, or the owner's email or name contains "test") and non-cancelled jobs. Test in Task 4.
5. The trigger and the clean-up must be safe to run twice. Test in Tasks 3 and 4.

---

### Task 1: Shared link check ignores the date

**Files:**
- Modify: `src/lib/estimatelink.core.ts` (`LINK_TTL_DAYS`, `planLink`, `expiryFrom`, `linkUsable`)
- Test: `tests/estimatelink.test.ts`, `tests/enquiry-dispatch-link-renewal.test.ts`, `tests/com09-personal-estimate-cta.test.ts`

**Interfaces:**
- Produces: `linkUsable(l: {status: string; expires_at: string} | null, now?: number): boolean`, which is true iff `l?.status === "active"`. `planLink(active, allowed, now?)`: `{action:"reuse"}` whenever allowed and an active row exists. `expiryFrom(now?): string` returns `"9999-12-31T00:00:00.000Z"`. The `now` params stay so existing callers compile.

- [ ] **Step 1: Update the tests.** In `estimatelink.test.ts`, replace the "30-day expiry, expired link is renewed" test with `planLink(expired, true, NOW)` → `{ action: "reuse" }`, and `expect(linkUsable(expired, NOW)).toBe(true)`. Replace the `LINK_TTL_DAYS` expectation with `expect(expiryFrom(NOW)).toBe("9999-12-31T00:00:00.000Z")`. Keep "revoked links fail closed" (revoked → false). In `enquiry-dispatch-link-renewal.test.ts`, change the expired-link case to expect reuse with no new token and no stale-row expiry. Read that file's header first and keep its backlog-not-blocked intent. In `com09-personal-estimate-cta.test.ts`, drop the `LINK_TTL_DAYS` import and its `toBe(30)` line.
- [ ] **Step 2: Run** `bun test tests/estimatelink.test.ts tests/enquiry-dispatch-link-renewal.test.ts tests/com09-personal-estimate-cta.test.ts`. Expected: the new expectations FAIL.
- [ ] **Step 3: Implement** the Interfaces above in `estimatelink.core.ts`. Delete `LINK_TTL_DAYS`, and update the `planLink` doc comment.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `bunx tsc --noEmit`. Expected: no errors.
- [ ] **Step 5: Commit** `fix: owner links no longer stop after 30 days`

### Task 2: Pages that check the date themselves

**Files:**
- Modify: `src/lib/owner-capture.core.ts:59-65` (`captureLinkState`)
- Modify: `src/components/portal/estimate.tsx:318`
- Test: `tests/enquiry-groups.test.ts` (existing `captureLinkState` cases) or a new `tests/owner-capture-link-state.test.ts`

**Interfaces:**
- Consumes: `linkUsable` from Task 1.

- [ ] **Step 1: Write the failing test.** `captureLinkState({status:"active", expires_at:"2026-10-30T23:10:13Z"}, {stage:"preliminary_estimate_ready", outcome:"needs_onsite_confirmation", decisionSource:"system", reviewRequired:false}, Date.parse("2026-11-01"))` → `"ok"` (the Chris Machar case). Also `{status:"revoked", ...}` → `"invalid"`.
- [ ] **Step 2: Run** `bun test <that file>`. Expected: the first case FAILS (returns `"invalid"`).
- [ ] **Step 3: Implement.** `captureLinkState` uses `!linkUsable(l)` instead of the inline date test. In `estimate.tsx`, `active = linkUsable(l ?? null)` (import from `@/lib/estimatelink.core`). Then sweep: `grep -rn "expires_at" src | grep -i "estimate_link\|link\b"`. Switch any other inline date check on `customer_estimate_links` rows to `linkUsable`, and list them in the commit message.
- [ ] **Step 4: Run** the test file, then `bunx tsc --noEmit`. Expected: PASS, no errors.
- [ ] **Step 5: Commit** `fix: photo page and office link box use the shared link check`

### Task 3: Cancel stops links, reopen brings them back (trigger)

**Files:**
- Create: `docs/pending-migrations/owner-links-follow-cancel.sql` and `owner-links-follow-cancel.rollback.sql`
- Test: `tests/owner-links-follow-cancel.pglite.test.ts`

**Interfaces:**
- Produces: function `public.owner_links_follow_cancel()` (plpgsql, `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`). Trigger `trg_owner_links_follow_cancel` is `AFTER UPDATE OF stage ON public.jobs FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage)`.
  - To `cancelled`: `update customer_estimate_links set status='revoked', revoked_at=now(), revocation_reason='job_cancelled' where job_id=NEW.id and status='active'`.
  - From `cancelled`: `update ... set status='active', revoked_at=null, revocation_reason=null where job_id=NEW.id and status='revoked' and revocation_reason='job_cancelled'`. If the table has a unique "one active per job+purpose" index, restore only where no other active row exists for that job and purpose.
  - The rollback drops the trigger and the function.

- [ ] **Step 1: Write the failing PGlite test**, in the style of `tests/trade-messages-paused.pglite.test.ts`. Use minimal `jobs(id, stage text)` and `customer_estimate_links(id, job_id, purpose, token, status, expires_at, revoked_at, revocation_reason)` tables. Copy the real unique index on `customer_estimate_links`, if any, from the Supabase types or the live schema. Cases:
  - Cancel: active → `revoked`/`job_cancelled`.
  - Reopen to `preliminary_estimate_ready`: the same token is `active` again.
  - A row revoked with `'Gate 1 ...'` stays revoked on reopen.
  - `complete` and `on_hold` changes leave links alone.
  - Applying the SQL twice is fine.
  - The rollback removes the trigger, so cancelling no longer revokes.
- [ ] **Step 2: Run** `bun test tests/owner-links-follow-cancel.pglite.test.ts`. Expected: FAIL (file missing).
- [ ] **Step 3: Write the SQL and the rollback** per the Interfaces. Add a header comment: Jo 1 Nov 2026 rule, pending, proven on PGlite, run live only with Jo's OK.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: cancelling a job stops its owner link, reopening restores it (pending SQL)`

### Task 4: One-off clean-up for jobs already cancelled

**Files:**
- Create: `docs/pending-migrations/owner-links-cancelled-cleanup.sql` and `.rollback.sql`
- Test: `tests/owner-links-cancelled-cleanup.pglite.test.ts`

**Interfaces:**
- The clean-up revokes (`'job_cancelled'`) active links where the job stage is `cancelled`, `jobs.source <> 'qa_test'`, and the owner's email and full name don't contain "test" (case-insensitive). It records affected link ids in a new table `public.owner_links_cleanup_20261101(link_id uuid primary key)`. The rollback sets those back to `active` and clears the reason, then drops the table.

- [ ] **Step 1: Write the failing PGlite test.** Seed:
  - one cancelled real job (gets revoked);
  - one cancelled `qa_test` job (untouched);
  - one cancelled job whose owner email contains "test" (untouched);
  - one open job (untouched).

  Then check that running it twice changes nothing more, and that the rollback restores exactly the revoked row.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Write the SQL and the rollback.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `chore: pending clean-up for links on already-cancelled jobs`

### Task 5: Full check and pull request

- [ ] **Step 1:** Run `bun run test`, `bunx tsc --noEmit` and the lint script in `package.json`. Expected: all pass. Fix only failures caused by this branch.
- [ ] **Step 2:** Get push access (`add_repo` with `access: "push"`), push `fix/owner-links-stay-working`, and open the PR using the `supermatt:pr` body shape. List the two pending SQL files as needing Jo's OK to run live, in this order: trigger first, then clean-up. Then stop. Don't merge.
