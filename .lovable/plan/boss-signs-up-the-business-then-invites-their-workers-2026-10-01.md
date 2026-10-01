# Boss signs up the business, then invites their workers

## The idea (yes, this is the right model)

Two different people, two different sign-ups:

```text
BOSS (REC director / installer business owner)
  -> public onboarding link (electrician or installer)
  -> business details, ABN, insurance, bank, rates, agreement, signs for the business
  -> Home Insulation Victoria approves the business
  -> Boss's portal: "My team" -> Invite worker (name + mobile/email)
        -> worker gets their own personal invite link

WORKER (works for the boss)
  -> opens invite link (already tied to the boss's business, can't pick another)
  -> short form: their name, contact, licence (ESV/A-grade for electricians,
     relevant cards for installers), licence photo, own declarations
  -> signs on their own behalf
  -> boss sees them as "Waiting for approval", Home Insulation Victoria approves
  -> worker can be sent to jobs (existing job links)
```

What the worker never sees: ABN, insurance, bank details, pricing, the business agreement.

## What changes

1. **Public onboarding becomes boss-only.** The "Are you the REC or do you work for one?" question on the electrician sign-up changes: picking "I work for an REC" stops the form and says "Ask your boss to send you an invite link from their Home Insulation Victoria portal" (with a box to give us the boss's name/contact so we can chase them). Same question added at the start of the installer sign-up.
2. **Boss can add a "solo" option.** If the boss is also the one doing the work, one tick ("I'll do the work myself") adds them as their own first worker — no second form.
3. **Invite link for workers.** From "My team" in the boss's portal, the boss enters the worker's name and mobile/email and gets a link to copy/send (we don't send emails or texts automatically yet). Link is single-person, expires after 14 days, can be cancelled.
4. **Worker sign-up page.** Short mobile-friendly form as above, shows "You're joining [Business name]". On submit the worker appears in the boss's team list as waiting for approval — using the existing team/approval records, so nothing about job links changes.
5. **Approval.** Office approves workers in the existing worker approvals list. Changing a licence after approval puts them back to waiting (already how it works).
6. **Test mode.** `?test=1&reset=1` keeps working for both boss sign-ups, plus a test invite link for the worker form.

## Confirmed

- Workers also tick the "customer belongs to Home Insulation Victoria, don't quote/invoice them separately" box.
- Invite links expire after 14 days.

## Technical details

- New table `partner_worker_invites` (business_id, created_by, name, contact, SHA-256 token hash, expires_at, used_at, revoked_at, trade). GRANT to authenticated/service_role, RLS: business admins of that business + admin.
- Pure rules in `worker-invite.core.ts` (token validity, expiry, field validation, declaration texts) with tests in `tests/`.
- Server fns in `worker-invite.functions.ts`: `createWorkerInvite`, `revokeWorkerInvite`, `listWorkerInvites` (auth, business admin), public `getWorkerInvite` / `submitWorkerInvite` (token-verified, write `partner_workers` with `approval_status = pending` via admin client after token check, record signed declarations immutably).
- New public route `/join/$token`; "Invite worker" UI on the existing team screen.
- Remove worker branch content from `electrician-onboarding.tsx` signing; add boss/worker question to `installer-onboarding.tsx`.
- Update `src/lib/AGENTS.md` worker-access rule.
