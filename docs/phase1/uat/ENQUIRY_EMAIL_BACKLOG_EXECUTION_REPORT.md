# Phase 1 — Enquiry email backlog: execution report

**Status: PARTIALLY COMPLETE.** Code, tests and the operational scripts are done and pushed. The production
version check, the backlog reconciliation numbers and the actual sending could not be executed from this
environment — there is no Production credential, no Production database access and no publishing authority
here. Nothing in this report is a claim that emails were sent.

Date: 19 Oct 2026 · Branch: `main`

---

## A. Root causes identified

1. **Ineligible replies could use the old template.** `renderPreliminaryIneligibleMail()` fell back to the
   legacy `renderIneligibleEmail()` whenever the job had no active secure estimate link. The automatic
   ineligible route also called the sender *without* refreshing that link first, so the fallback was the
   normal case rather than the exception. This is the most likely source of "old templates still appearing".
2. **Ineligible replies could state no verified reason.** T7 renders a generic fallback line when `reason`
   is empty, and nothing on the automatic path required `jobs.eligibility_reason` to be populated. Jo's rule
   ("actual verified reason, otherwise hold") was not enforced.
3. **Two template surfaces looked authoritative.** `/admin/templates` is the real hub, but its Group B entry
   still said "real sending not approved (held)" and linked to `/admin/campaign-emails`, which renders the
   pre-15-Oct copy. Nothing sends from that page (no send button, drafts go to `admin_config_events` and are
   never read by a sender), but it looks like template management — exactly the confusion Jo described.
4. **Historical enquiries have no re-entry point.** The only trigger that reaches the senders is the
   post-intake worker, which only ever processes newly enqueued work. Jobs whose original trigger was missed
   or failed simply stay outstanding forever; there was no whole-backlog reconciliation and no category view
   (the earlier T6 script covered one category only).

## B. Template consolidation evidence

Single selection chain, verified in source:

```
maybeAutoRouteLeadEmail(jobId)                      src/lib/lead-email-routing.server.ts
  └─ automaticLeadEmail()                            src/lib/enquiry-groups.core.ts
  └─ sendSaveMySpot / sendAutomaticInsulationDetails / sendDecisionIneligibleEmail
       └─ renderJoOutcomeEmail()  (T1–T7)            src/lib/jo-outcome-email.core.ts
            └─ selectJoTemplate()                    src/lib/jo-email-templates.core.ts
```

* `sendOne()` already failed closed for automatic sends when no Jo template applies
  (`if (!joMail && !office && !followup && mode === "send")`). Unchanged, now covered by a test.
* **Fixed:** the ineligible sender no longer imports or calls the legacy renderer. If T7 cannot render
  (no secure link), the send is refused and recorded as `no_approved_template` — never downgraded to old copy.
* **Fixed:** the automatic ineligible route now calls `syncStep3()` first, so the customer's own link exists
  and T7 renders with real pricing/links. It also holds the reply when no verified reason is recorded
  (`ineligibleReplyBlocker`).
* **Fixed:** the hub's Group B entry is now marked *superseded by Jo's T5/T6, 15 Oct 2026* and no longer links
  to the legacy page. The legacy page is retitled "Campaign emails (legacy drafts)" with a warning that its
  drafts are not used by any email and a link to `/admin/templates`.
* `/admin/templates` remains the single Office location; its Jo entries preview through the same renderer the
  sender uses.

## C. Actual Production deployment version

**Not established.** This environment has no access to the hosting dashboard, the Production repo checkout or
the deployment metadata. GitHub `main` is at the commit in §Q; whether Production runs it is unverified, and
this report does **not** claim Production is updated.

## D. Classification rules implemented

| Jo's category | Condition (existing Gate 1 facts) | Route | Template |
|---|---|---|---|
| A — eligible, no insulation | `likely_eligible` + declared insulation `none` | `offer_spot` | T1 (no area → 150 m², labelled "estimated, not measured") / T2 |
| B — clearly ineligible | `does_not_appear_eligible` + **non-empty verified reason** + not review-required | `ineligible` | T7 |
| C — insulation unknown/present, no media | `likely_eligible`/`needs_onsite_confirmation` + `present`/`unknown` + media proven absent | `request_insulation` | T5 (size unknown) / T6 (size known) |
| D — existing insulation with media | media received, or manifest unproven | none — `groupBInvitationBlocker` holds it | Office decides → existing senders |
| E — ambiguous | review required, no official decision, no insulation answer, contradictory facts | none | held |

Guards unchanged and re-verified in tests: consent, opt-out/suppression, duplicate idempotency per purpose,
non-production recipient boundary, media gate, coverage/rules gates, Group B switches.

## E. Exact backlog reconciliation counts

**Not produced.** This needs a read-only query against the Production database, which this environment cannot
reach (no service-role key, no DB connection). Any number here would be fabricated.

`supabase/manual_sql/ENQ_00_RECONCILE_ALL.sql` produces one row per outstanding website enquiry with category
(A–J), disposition, proposed template, media/consent/duplicate facts, plus `category_total` per category.
That output is the authoritative reconciliation.

## F–J. Sent / already responded / held / blocked / failed

All zero / unknown, because no send was executed. The categories map as follows once `ENQ_01` runs:

| Disposition in ENQ_00 | What happens |
|---|---|
| `AUTO_SEND`, `AUTO_SEND_RETRY` (A/B/C) | enqueued by `ENQ_01` → existing worker → existing senders |
| `OFFICE_REVIEW` (D/E) | never enqueued; visible in `/admin/enquiry-groups` with its next action |
| `NO_ACTION` (F) | already correctly answered — purpose-specific, not "any email" |
| `BLOCKED` (G/H/J) | opt-out, no consent, invalid recipient, in flight — reported, not sent |

## K. Sending provider evidence

None. No email was sent from this environment. After the operational run, `ENQ_02_VERIFY.sql` §3b/§3d is the
evidence: `customer_email_sends` rows per purpose with `provider`, `provider_message_id` and status, and
separately the count of rows that carry a provider id. Provider acceptance is not recorded as delivery.

## L. Future enquiry automation

The same selector (`automaticLeadEmail`) and the same senders serve new enquiries through the post-intake
worker, so the fixed ineligible behaviour applies to new records automatically. Not browser-verified here
(see §M). Automated coverage: the new 27-case suite asserts every routing branch, the assumed-area
disclosure, the fail-closed render, the media gate, duplicate/retry rules and the recipient boundary.

## M. Browser UAT

**Not performed — documented blocker.** The admin app requires an authenticated Supabase session for an
Office user; this environment has no credentials and no browser session, and Production must not be driven
from here. Checks still required: `/admin/templates` shows only current entries under Jo's group; the legacy
campaign page cannot send; `/admin/enquiry-groups` shows the D/E queue with media and decisions;
`/admin/communications` shows real statuses.

## N. Tests executed and results

| Check | Result |
|---|---|
| `tsc --noEmit` | pass, 0 errors |
| `npm run build` (production) | pass, exit 0 |
| New suite `tests/enquiry-backlog-classification.test.ts` (27 cases) | 27 pass, 0 fail |
| Existing suites: `jo-email-templates`, `group-b-media`, `group-b-globals`, `save-spot-only-approved`, `portal-presentation`, `admin-pipeline-visibility`, `admin-record-reliability`, `comms-status`, `nextstep` | 80 pass, 0 fail |
| Total | **107 pass, 0 fail** |

No failure was caused by this work. Tests are unit/source-level: no DB, no network, no email.

## O. SQL or Production actions performed

**None executed.** Four scripts were added (idempotent, no schema change):

```
supabase/manual_sql/ENQ_00_RECONCILE_ALL.sql   read-only — categories A–J
supabase/manual_sql/ENQ_01_ENQUEUE_SAFE.sql    the only write — enqueue A/B/C
supabase/manual_sql/ENQ_02_VERIFY.sql          read-only — progress + provider evidence
supabase/manual_sql/ENQ_03_ABORT.sql           write — remove not-yet-started queue items
```

The earlier single-category `T6_*.sql` files were removed so nobody runs a stale script; `ENQ_00`/`ENQ_01`
supersede them.

## P. Remaining user action

### ACTION REQUIRED — 1. publish, 2. reconcile, 3. enqueue

**Why:** sending only happens from the deployed app; the scripts choose who is attempted and the deployed
sender decides and records every send.

**Exact steps**

1. Publish the current `main` to Production (Jo's call; not performed here).
2. Supabase → SQL Editor → run `supabase/manual_sql/ENQ_00_RECONCILE_ALL.sql` (read-only). Record
   `category_total` for A, B, C and the `OFFICE_REVIEW` rows.
3. Confirm the two switches are on: `workflow_settings.customer_comms_enabled = true` and
   `customer_delivery_settings.enabled = true`. If either is false, stop — the sender will block everything.
4. Run `supabase/manual_sql/ENQ_01_ENQUEUE_SAFE.sql`. It returns `enqueued`; expect it to equal
   A + B + C (plus `AUTO_SEND_RETRY`) from step 2, minus anything already processing.
5. Do nothing else. The existing pg_cron worker drains 5 items / 2 minutes.
6. Verify with `ENQ_02_VERIFY.sql`: §3a progress, §3b per-home provider rows, §3c processed-but-no-send,
   §3d status counts.
7. Stop the batch with `ENQ_03_ABORT.sql` if anything looks wrong.

**Expected result:** A/B/C records progress from `queued` to `complete`, each producing at most one
`customer_email_sends` row per purpose (T1/T2, T5/T6 or T7).

**Risk / rollback:** the enqueue is data-only and idempotent; `ENQ_03` cancels unstarted items. Sends cannot be
unsent — which is why `ENQ_00` is run and reviewed first.

### Decision still open (not blocking A/B/C)

Office-triggered emails still use the pre-15-Oct copy: `prepareOfficeSaveSpot()` (manual copy variants) and
`sendExistingInsulationSaveSpot()` (existing-insulation follow-up). They are deliberate Office actions with
their own approvals, so they were **not** changed. If Jo wants those on T1–T8 as well, that is a wording
decision for her.

## Q. Final GitHub commit SHA

See the commit that adds this report on `main` (the report is committed with the code it describes).

---

## Confirmations

* No workflow logic, stage transition, eligibility rule or customer safeguard was changed.
* No database migration or schema change was created; no SQL was executed.
* No email — real, test or otherwise — was sent from this environment.
* No Production deployment was performed.
* Production version and backlog counts remain **unverified**, and are reported as such.
