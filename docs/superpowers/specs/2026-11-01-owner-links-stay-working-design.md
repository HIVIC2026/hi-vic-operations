# Owner links stay working — design

Date: 1 Nov 2026 · Approved in chat by Jo (design), spec awaiting her review

## Why

Owner links (`customer_estimate_links`) stop 30 days after they are made (`LINK_TTL_DAYS`). Emails reuse the existing link and never restart the 30 days, so an owner can get an email with only days left on the link. Chris Machar (HV-1083) got his email on 20 Oct, his link died on 31 Oct, and on 1 Nov he saw "This link isn't available" on the photo page.

Already done in the live database (1 Nov, Jo approved): the 142 dead links and the 478 due to stop within 7 days on open jobs had their stop date moved out a year. That was a stopgap. This change is the real fix.

## Rule (Jo, 1 Nov 2026)

- An owner's link works until their job is cancelled. There's no time limit.
- Finished (complete) jobs keep working.
- If a cancelled job is reopened, the **same** link works again, so the owner's old emails still work.

## What changes

1. **Shared check.** `linkUsable()` in `src/lib/estimatelink.core.ts` returns true when `status === "active"` and no longer looks at `expires_at`. `planLink()` no longer treats a past `expires_at` as expired, so it reuses the active link instead of issuing a new one.
2. **Pages that check the date themselves** switch to `linkUsable()`:
   - `captureLinkState()` in `src/lib/owner-capture.core.ts` (photo/video page)
   - `src/components/portal/estimate.tsx` line ~318 (office estimate box)
   - Any other inline `expires_at` check on `customer_estimate_links` found while building it.
3. **New links** no longer get a 30-day date. `expiryFrom()` returns a far-future date (`9999-12-31`), so the column can stay required and old code reading it doesn't break. `LINK_TTL_DAYS` is removed.
4. **Cancelling a job stops its link, and reopening brings it back.** A database trigger on `jobs`:
   - stage changes **to** `cancelled`: active links on that job become `status = 'revoked'`, `revocation_reason = 'job_cancelled'`.
   - stage changes **from** `cancelled` to anything else: links revoked with reason `job_cancelled` go back to `active` (the same token).
   - Links revoked for any other reason (for example Gate 1 no longer allowing an estimate) are left alone.

   A trigger is used because 7 different places in the code set a job to cancelled. A trigger covers all of them, plus any future ones.
5. **What the owner sees on a cancelled job.** Pages already show their existing "link isn't available / this request has closed" messages for a revoked link. No new wording.
6. **One-off clean-up of old cancelled jobs.** 86 cancelled jobs (not counting test jobs) still have active links. They get the same `job_cancelled` revoke, so reopening them later works the same way. This is a live database change: **ask Jo right before running it.**

## Not changing

- Other link types (`dad-test-login`, owner verify codes, trade offers, quote expiry) keep their own time limits.
- The 14-day quote expiry rule is separate and stays.
- The `on_hold` stage keeps its current photo-page behaviour.

## Database work

Following the repo's rule: the trigger and the one-off clean-up go in `docs/pending-migrations/` with an undo file each, proven on the practice database (PGlite) first. Jo is asked before anything runs on the live database.

## Tests

- `linkUsable`: active with a past date → usable; revoked → not usable.
- `planLink`: active link with a past date → reuse (no new token).
- `captureLinkState`: active link with a past date on an open job → `ok`.
- `expiryFrom` gives the far-future date.
- Trigger (PGlite): cancel → link revoked `job_cancelled`; reopen → same token active again; a link revoked for another reason stays revoked on reopen; non-cancel stage changes don't touch links.
- Clean-up (PGlite): only active links on cancelled, non-test jobs are revoked.
- Existing test suite still passes.

## Delivery

Pull request from a branch. This chat opens the PR and stops. The coordinating chat merges, per Jo's rule.
