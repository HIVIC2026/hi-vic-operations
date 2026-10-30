# Batch 2 — messages (design)

Date: 29 Oct 2026 · Owner: Jo · Source: `qa/2026-10-28-workflow-audit/report.md` (fix-soon 6, 9, 10, 11; polish) + batch-1 carry-over.
Branch `fix/batch2-messages`, built on `fix/batch1-money-cancels` (needs its STOP event). Nothing goes live until Jo says so.

## In plain words

| # | Problem today | After the fix |
|---|---|---|
| 0 | 16 approved texts switched off live | **Done 29 Oct**: all switched on (logged in settings history) |
| 1 | A one-off text due after 8pm is held and never sent | Sent at 7am — skipped if it's no longer true |
| 2 | Needs me misses texts/emails we're unsure arrived, failed trade texts, and a failed STOP clean-up | They show on Needs me. Texts just waiting for 7am don't |
| 3 | AI email drafts promise a Ready Check / visit to owners still waiting on a spot | Drafts for not-yet-released owners follow the spot-only rule, and Send refuses a draft that breaks it |
| 4 | Re-sending a reopened, declined quote sends nothing | The owner gets the quote text and email again |
| 5 | The old, switched-off reply writer has banned wording | Banned wording removed |

No new owner wording. No price or approved-wording change.

## Technical detail

**1 — 7am send.** One sweep on the 15-minute tick, after 7am Melbourne, next to `sweepJobOfferTexts`: read `sms_messages` rows `status='blocked'`, held key (`isHeldAttemptKey`), `detail = SMS_QUIET_REASON`, created in the last 24h, whose real key (`claimKeyOf`) is unclaimed. For each, a per-type "still true" check (pure, one function per type, reusing the existing predicates: owner not yet confirmed/signed, booking still current, quote still issued+released, no rebook, price still not entered, fixes times still missing…); if true, re-send the stored body through `sendRealSms` with the REAL key and `event: { at: <hold time>, current: true }` so the normal freshness limit still applies. Types not on the list, or with no check, are left alone. One send per key, as today.
Covered types: spot_saved, quote_ready, piesa_owner_confirm, piesa_owner_fixes_confirm, veec_sign_request, veec_sign_reminder, deposit_release, visit_new_times, install_no_access, install_clearance, boss_price_link, fixes_times_link, ready_check_days_suggested, ready_check_booked_installer.

**2 — Needs me.** `send-failed.core.ts` + `office-needs.server.ts`: also count text `sent_unknown`, email `delivered_unrecorded` and email `sending` older than 1 hour as "not sure it arrived"; partner texts with no job show as job-less rows (by business); quiet-hours holds never show. Add a rule for `stop_installer_release_failed` (raise; clear on the job's next cancel-release event) via the existing `RULES` / `NEEDS_TEXT` route. Office line: "STOP received, but releasing the installer failed — open the job and cancel again".

**3 — AI drafts.** Pass the owner's release state (`spotReleaseState`) into the draft; for not-yet-released owners the prompt uses the spot-only lines from `spot-only-copy.core.ts` instead of the Ready Check line (ai-email-reply.core.ts:83, 101-102). `aiReplyProblems(body, { preRelease })` adds `preReleaseViolations`; checked when the draft is made and again on Send.

**4 — Quote resend.** Keys become `quote-ready:v1:${quoteId}` for the first send and `…:r${n}` after the n-th `quote_reopened_by_office` for that quote (same for the email key). First sends keep their old keys.

**5 — Old composer.** Remove the pre-release phrases at email-reply.core.ts:247-248 and 327/339 (use the spot-only lines); add `email-reply.core` to the decision-388 scanner test.

## Testing
Each item test-first (RED then GREEN), plus the existing sms / needs / AI-draft / quote-ready tests. Full suite compared with the 28 Oct baseline; type-check; retired-terms scan 0 customer-visible.
