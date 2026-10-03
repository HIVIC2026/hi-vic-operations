# Home Insulation Victoria portal: workflow-control audit (2026-10-03)

This audit was read-only. No code, data, settings, migrations, messages or publishing changed. Method: code inspection of `src/lib`, `src/routes`, `drizzle/migrations` and `tests/`, plus a read-only check of the live RLS policies (`pg_policies`). No tests were run in this pass. A behaviour counts as **Verified** only when code or a live policy proves it. Everything else is **Unverified**, with the check it still needs.

## 1. Executive summary

The portal has one stage field, one guarded transition path, one way to work out the next step, and strong launch controls on outbound messages. Mitti never moves a job forward.

The portal does **not** follow the required workflow. The largest gap is the order of steps:

- **Required:** preliminary quote → Ready Check → confirmed insulation quote → 50% deposit → PIESA → rectification quote → installation.
- **Current:** Ready Check → measure-up → PIESA → rectification scope approval → one combined quote → deposit → rectification/installation scheduling.

These are also missing: the office-approved preliminary quote with a "Request Ready Check" link, a push notice to the installer when PIESA is booked, automatic Mitti sync, and hiding owner and trade contact details from each other.

## 2. Current workflow map

```text
Base44 enquiry -> new_enquiry -> Gate 1 (auto, preliminary) -> ready_check_* (accept/schedule/complete)
 -> measure-up + PIESA (electrician, Mitti) -> [rectification quote -> owner scope approval]
 -> ready_for_installer_quotes -> awaiting_quote_acceptance (combined quote, rectification folded in)
 -> awaiting_deposit_payment (ONE Xero invoice) -> deposit >=50% or audited override
 -> rectification_scheduling/booked -> installation_scheduling/booked (needs PIESA pass, rect done, PIESA window)
 -> evidence_outstanding (PIISA, ESC readiness, hazards) -> ap_review -> ready_for_veec -> complete
on_hold / cancelled via admin-only setHold (reason required)
```

## 3. Current automation map

| Automation | Trigger | Writes stage? |
|---|---|---|
| post-intake cron (`api/public/hooks/post-intake.ts`, 2 min) | queue | Only via `autoAdvanceJob` → `transition()` |
| `autoAdvanceJob` / `planStep` (max 20 steps) | after recorded facts change | Yes, guarded; stops at every human gate |
| `autoDecideEligibility` | inside autoAdvance | No (writes Gate 1 fields only) |
| customer follow-ups cron | hourly | No (messages only, behind both locks) |
| Mitti sync (`syncFromMitti`, `syncPendingMittiAssessments`) | **manual button only** | No |
| Mitti installer Ready Check → draft owner quote | sync | No (draft only, never sent) |
| external_action_outbox | admin approval | No; 'automatic' mode hard-blocked |

## 4. State/status inventory

- `jobs.stage` (enum `job_stage`): the one canonical progression field. 29 active stages plus `on_hold` and `cancelled`. `prior_stage` holds the stage to resume to.
- Separate from the stage: `eligibility_outcome`, `eligibility_review_required`, `eligibility_flags` and `eligibility_decision_source`.
- Other status fields: `quotes.status` (draft/issued/accepted/declined/superseded), `appointment_proposals.status`, `bookings.status`, `invoice_status` (view), `assessments.mitti_*`, `external_action_outbox.status`, `job_communications.delivery_status`.

## 5. Data-source inventory

Base44 signed webhook (enquiry/partner), Property Intelligence (Vicmap WFS), Mitti (polling API), Xero (system of record for payment), Resend/email outbox, the portal user's own actions, and pg_cron.

## 6. Transition table (main paths)

| To stage | Trigger | Key preconditions (`stageEntryBlockers`) | Gap |
|---|---|---|---|
| eligibility_review / ready_check_ready_to_schedule | Gate 1 auto / admin | Gate 1 outcome | No preliminary-quote step |
| ready_check_scheduled | booking confirmed | installer assigned + confirmed booking | — |
| ready_for_installer_quotes | site requirements done | measurement accepted, PIESA recorded | PIESA before quote (order mismatch) |
| awaiting_quote_acceptance | admin generates quotes | PIESA date, window, commercial gate | Generating a quote sends it straight away; there is no separate "office approved" step |
| awaiting_deposit_payment | owner accepts | issued quote, stage match, consent, signed agreement | — |
| rectification_* / installation_* | advanceAfterDeposit / booking | deposit cleared; for install also rect done + PIESA pass + window | — |
| evidence_outstanding | install marked complete | ESC readiness, hazards, PIISA | — |
| ap_review → ready_for_veec → complete | admin | evidence verified, assignment effective, lodgement | — |

## 7. Every place a job can progress

`transition()` in `workflow.server.ts:316-337`. It is called from `portal.functions.ts` (lines 65-915, about 20 call sites), from `autoAdvanceJob` (`autoadvance.server.ts:52-74`), from `booking.server.ts:58`, `pilot.functions.ts:383` and `postintake.server.ts:88`, and from the admin sweep (`autoAdvanceOpenJobs`). `setHold()` (`portal.functions.ts:951-971`) is the only path to hold, cancel or resume. The guarded database function `commit_guarded_stage` (migration 0073) exists but **nothing calls it**.

## 8. Passive events that could progress a job

- **Verified, none directly:** page opens, message sends, delivery receipts, timers and Mitti sync do not write the stage.
- **Indirect:** the post-intake cron and an evidence upload both call `autoAdvanceJob`. Every rule in `stageEntryBlockers` still applies. On its own, an upload can only move a job when every other fact for the next stage is already recorded.
- **Unverified:** whether `autoAdvanceJob` can be reached from any message or delivery callback. Needs a full search of its callers in the communications code.

## 9. Eligibility audit

- **Verified:** `evaluateGate1` order is hard-fail → review → onsite → likely. Existing insulation "Yes" or "unknown" leads to Needs Onsite Confirmation, not a fail. Each fact carries a basis (verified, recorded, declared or unknown).
- **Gap against your requirement 4:** the portal shows "Likely Eligible" from answers the owner declared but nobody has verified. This is the locked Step 2 design. The portal has no separate "verified eligible" state after the Ready Check, and no stop for office review on a Ready Check fail before quoting. This needs a business decision.

## 10. Booking audit

- **Verified:** a new proposal supersedes any earlier open proposal of the same kind (`pilot.functions.ts:423`). Accepting a booking needs an explicit role response (`respondToProposal`). After 48h, the owner or trade can request another electrician, and reassignment supersedes the open proposals. Booking state is stored separately from eligibility.
- **Unverified:** the `proposalResponse` and `confirmBlockers` rules in `pilot.core.ts`. No tests cover proposals or bookings. The 24h no-response warning was not found.
- **Mismatch:** the code comment at `pilot.functions.ts:418` says "PIESA is booked after quote acceptance", but the stage rules require PIESA before the quote.

## 11. Mitti audit

- **Verified, never writes the stage:** sync writes only `assessments`, `ceiling_measurements`, `rectification_items` and `documents`.
- **Verified checks:** Mitti audit ID matches the one stored, the template matches, and the Portal Job Number matches. Completion comes only from Mitti's own completed flag. A synced form is locked once complete. Unknown rate codes become `is_other` items that need office pricing. Report saves cannot duplicate.
- **Gaps:**
  - No check for signature fields.
  - No check that required evidence is present.
  - Rectification items are de-duplicated only in app code, with no database unique index (Sev3).
  - Sync is **manual only**, with no cron (Sev2).

## 12. Quote/payment/Xero audit

- **Verified:**
  - Customer prices include GST, and margins sit only in `quote_internals`.
  - Reissuing a quote supersedes the old one.
  - Accepting needs an issued quote, the matching stage, consent and the signed agreement.
  - There is one invoice per accepted quote.
  - The business-unit barrier fails closed.
  - The deposit gate opens only on `deposit_paid_at`, which needs ≥50% paid in Xero, or on an audited override (`invoice.lifecycle.ts:89-102`, `workflow.server.ts:123-137, 254-257`).
- **Gaps:**
  - PIESA can be requested and done before any deposit (this is the order mismatch; required item 12 fails).
  - There is no preliminary quote and no office-approved-before-send state.
  - The one-invoice rule is enforced in code; whether the database also enforces it (a unique key on `quote_id`) is unverified.

## 13. PIESA and 30-day visibility audit

- **Verified:** `job_piesa_deadlines` sets the window. When it expires, the job is blocked from installation scheduling, installation booked and evidence outstanding.
- **Gap (Sev2):** the installer gets **no push notice** when PIESA is booked. The deadline only appears on the installer's dashboard.

## 14. Rectification audit

- **Verified:** the rectification quote is generated by an admin and needs the owner's scope approval. It is folded into the combined quote. Scheduling is gated by the deposit. Installation is blocked until rectification is done and PIESA has passed.
- **Gap:** the required flow has a separate rectification quote after the deposit and PIESA. Currently, generating the quote sends it; there is no separate review-then-send step.

## 15. Installation and completion audit

- **Verified:** reaching evidence outstanding needs ESC install readiness, resolved PIESA Part 7 hazards and the PIISA gate. AP review needs evidence uploaded; ready for VEEC needs it verified plus `effective_complete`; complete needs the lodgement.
- **Known blocker:** LR-003. PIISA signed-copy storage is not live yet, so jobs cannot move past installation.

## 16. Communications and secure-link audit

- **Verified:**
  - The global lock and consent lock both fail closed.
  - Every send is recorded in `job_communications`, including `blocked_prelaunch`.
  - The outbox prevents duplicates (unique key and facts hash) and starts with every action off.
  - 'Automatic' mode is blocked in the database.
  - Queued sends are cancelled when the job's facts change, and the event log cannot be edited.
  - Estimate links are resolved on the server only, from a 43+ character token, with no job id accepted from the browser.
  - Worker links use hashed tokens that expire after 30 days and are re-checked on every use.
- **Unverified:** whether delivery failures and overdue replies reach the office queue from start to finish, and how engagement tokens are used beyond `resolvePublicEstimate`.

## 17. Permissions and RLS audit

Checked against the live policies:

- `owners.owner_or_assignee`: any trade assigned to a job can read the owner's row, including email and phone.
- `profiles.self_read`: through `shares_job_with`, the owner can read the trade's profile in return. **Fails required item 19 (Sev1 if hiding contacts is a hard rule; needs a decision).**
- `quote_items_visibility` uses `EXISTS (select … from quotes …)`. That subquery is itself filtered by the `quotes` RLS rules, so line items inherit quote visibility. **This is not a leak.** Repeating the job-scoped condition directly in the policy would still be safer (Sev3).
- `businesses` and `workflow_settings` are readable by any signed-in user. No secrets were seen in them; this is Sev3, to confirm.
- **Unverified:** that every handler in a `*.functions.ts` file checks the caller's role before using `supabaseAdmin`. Needs a full inventory.

## 18. Dashboard and queue audit

- **Pipeline board:** shows the job number, next step, address, owner, Ready Check booked banner, and who it's waiting on. Views are In progress, Needs review and Exceptions. `stuck_reasons` covers Xero errors, Ready Check payment problems, booking/stage mismatches and jobs inactive for more than 7 days.
- **Gaps (Sev3):**
  - The All jobs view has no due-date or exception column.
  - "Needs attention" is spread between Needs review and To action, not one queue.
  - Failed deliveries are not shown on the board.

## 19. Test coverage audit

- **Existing tests:** `autoadvance`, `nextstep`, `legacy-path-retired`, `gate1-*`, `admin-pipeline-visibility`, `stuck`, `customer-quote-system`, `installer-quote`, `hazard-rectification`, `xero.core`, `mitti.core`, `comms`, `comms-status`, `worker-links` and the REC suites.
- **Missing tests:**
  - Proposals and bookings.
  - PIESA window and ESC readiness.
  - RLS policies (contact visibility, quote_items).
  - Full clean path, rectification path and every stop path from start to finish.

## 20. Defects

**Sev 1**
1. The workflow order is wrong against the required spec. PIESA happens before the insulation quote and 50% deposit, so the required item "no PIESA before verified 50% payment" fails. *(Needs business confirmation; the code matches its own earlier design.)*
2. Owner and trade contact details can be read by each other through the database (`owners`/`profiles` RLS), if hiding them is a hard rule.

**Sev 2**
3. Mitti sync is manual only. Completed forms can sit unsynced with nothing showing the office.
4. The installer gets no notice when PIESA is booked.
5. There is no preliminary quote, office approval or secure "Request Ready Check" step.
6. There is no verified-eligibility decision after the Ready Check, and no stop for office review before quoting.
7. Generating a quote sends it to the owner immediately; there is no separate office review-then-send step (main quote and rectification quote).
8. `commit_guarded_stage` is never called. `transition()` updates the stage without a database-level expected-stage check (concurrent transitions are possible).
9. LR-003: jobs cannot move past installation.

**Sev 3**
10. The comment at `pilot.functions.ts:418` contradicts the stage rules.
11. Rectification `external_key` has no database unique index.
12. Mitti signature and evidence fields are not checked.
13. No RLS or booking tests.
14. The All jobs view lacks due-date/exception columns, and there is no single Needs attention queue.
15. `quote_items` policy hardening.

## 21. Recommended target state machine

```text
enquiry -> prelim_result -> prelim_quote_office_review -> prelim_quote_sent
 -> ready_check_requested (owner explicit) -> ready_check_arranging -> ready_check_booked
 -> ready_check_result_received (Mitti, validated) -> [verified_ineligible -> office_review STOP]
 -> insulation_quote_draft -> insulation_quote_sent -> quote_accepted -> deposit_due -> deposit_cleared
 -> piesa_arranging -> piesa_booked (installer notified, 30-day clock visible) -> piesa_result_received
 -> {no_rect: install_request} | {rect: rect_quote_draft -> rect_quote_sent -> rect_accepted -> rect_arranging
    -> rect_booked -> rect_result_received(pass)} -> install_arranging -> install_booked
 -> install_result_received -> final_compliance -> complete      (+ on_hold / cancelled overlays)
```

## 22. Hard-stop rules

- No PIESA proposal or booking until the deposit is cleared.
- No installation proposal until PIESA passes or the rectification passes, and the window is open.
- No quote reaches the owner without an office send action.
- Mitti results are only ever recorded as evidence. They are applied only after checks on job number, template, version, completed flag, required fields, signatures and duplicates.
- A verified ineligible result always stops for office review.
- Owner and trade contact details are never shown across parties.
- Every stage write goes through `commit_guarded_stage`, with the expected stage checked.

## 23. Automation rules

- Run the Mitti sync on a schedule, with failures shown to the office.
- Notify the installer when PIESA is booked (through the outbox, behind the launch lock).
- Create a draft rectification quote automatically from the PIESA result, but never send it automatically.
- Raise 24h and 48h response alerts in Needs attention.
- Every automatic action goes through the outbox with an idempotency key.

## 24. First implementation slice

1. Business decisions first (section 27).
2. Safe changes that don't depend on the new order:
   - Route `transition()` through `commit_guarded_stage`.
   - Scheduled Mitti sync with office visibility.
   - Installer notice when PIESA is booked.
   - Database unique index on rectification `external_key`.
   - RLS tests.
3. Then the reorder: move the PIESA booking gate behind the deposit and split the quote into insulation and rectification.

## 25. Files/functions likely to change

`src/lib/workflow.server.ts` (`TRANSITIONS`, `stageEntryBlockers`, `transition`), `src/lib/workflow.ts`, `autoadvance.core.ts` (`planStep`), `nextstep.core.ts`, `portal.functions.ts` (`generateInstallerQuotes`, `regenerateRectificationQuote`, `respondToQuote`), `quotes.server.ts`, `pilot.functions.ts`/`pilot.core.ts`, `mitti.server.ts`/`mitti.core.ts` (`parseAudit`, schedule), `eligibility.core.ts` (verified stage), a new migration (stages, unique index, contact-safe views/RLS), `admin.index.tsx`, `todo.functions.ts`, `stuck.core.ts`, and a new `tests/workflow-paths.test.ts` plus RLS tests.

## 26. Manual acceptance checklist and automated test matrix

| Path | Manual check | Automated test |
|---|---|---|
| Clean path | Enquiry to complete on a qa_test job, with every gate shown | Full path in PGlite, no rectification |
| Rectification path | Rectification quote is a draft until office sends; install blocked until pass | Full path with rectification |
| Ineligible Gate 1 / Ready Check | Stops for office review | Stop path |
| Deposit <50% | PIESA/install can't be proposed | Gate test |
| PIESA expired | Install blocked | Window test |
| Stale proposal | Accepting a superseded proposal is rejected | Proposal test |
| Duplicate or mismatched Mitti sync | Rejected or ignored; no stage change | mitti.core |
| Contact privacy | Trade can't see owner's phone/email, and owner can't see trade's | RLS test |
| Comms lock | Every send blocked while the lock is off | comms |

## 27. Risks and decisions

1. Confirm the required order (quote and deposit before PIESA). This reverses the current locked design and affects the agreement and invoice timing.
2. Is the preliminary quote binding? Does it use the calculator's figures?
3. Should owners and trades contact each other directly for scheduling, or only through the portal?
4. Should the Gate 1 "Likely Eligible" wording change to "Preliminary" until the Ready Check?
5. LR-003 and LR-006 remain open launch blockers.
