# Slice 1: Enquiry to confirmed Ready Check booking

## Part A. Where each serious finding stands today

Checked against the current code and the live database rules on 3 Oct 2026.

**Earlier launch-control patch:** partly live.

- **Live:**
  - Migrations 0071–0073 are applied.
  - All 15 outside-action switches are OFF (email, SMS, booking messages, Xero, Mitti and others).
  - Signed-in users have no direct write access to jobs.
- **Not live:** the guarded stage step from migration 0073 exists, but no code calls it.

### Sev 1

| ID | Finding | Status | Evidence |
|---|---|---|---|
| S1.1 | Stage change isn't one locked step; hold/resume skip the stage rules | Still present | `workflow.server.ts:324-336`, `portal.functions.ts:951-971`; nothing calls `commit_guarded_stage` |
| S1.2 | Trades see owner contacts with no record of when they were shared | Still present | Owner phone shown in `field.$jobId.tsx:42`; owners/profiles RLS (live) |
| S1.3 | PIESA entry has no check on quote version or payment; any signed agreement counts | Still present | No rule for entering `piesa_and_install_window_pending`; `agreementSigned` `:64-67` |
| S1.4 | 50% rule; paid date never clears after a refund; override unlocks | Still present | `invoice.lifecycle.ts:30-91` |
| S1.5 | Ready Check completion jumps to estimate with no office review; evidence check passes on read error | Still present | `portal.functions.ts:248-252, 289-292` |
| S1.6 | Rectification items marked done even when PIESA fails; missing evidence passes | Still present | `portal.functions.ts:517-523` |
| S1.7 | Booking confirmation isn't tied to the exact other party | Partly fixed | Proposal response checks role and expiry (`pilot.core.ts:332-337`); `confirmBooking` has no check of who is confirming against the assignment or proposal |
| S1.8 | No separate "installation started" step | Still present | No such command |
| S1.9 | Changed Mitti evidence doesn't cancel later approvals | Unverified | Complete records are locked (`mitti.server.ts:193`); no logic to cancel approvals found |
| S1.10 | Declared generic "previous upgrade = yes" fails eligibility | Still present (locked Gate 1) | `eligibility.core.ts:145`; needs your decision before changing |
| S1.11 | Estimate is emailed without office approval; a failed move after a Ready Check request is only logged | Still present | `followups.server.ts:87-129`; `readycheck-payment.server.ts:93-99` |

### Sev 2

| ID | Finding | Status | Evidence |
|---|---|---|---|
| S2.1 | Old booking is cancelled before the new one is saved | Still present | `booking.server.ts:40-41` |
| S2.2 | Ready Check template ID mismatch on sync | Unverified | The template is chosen the same way at create and at sync; it could only differ if the job's source changes in between |
| S2.3 | Follow-up timing comes from the assignment, not each visit; no 24h/48h Ready Check worker | Still present | `pilot.core.ts:298-306` |
| S2.4 | Failed messages not shown to office | Unverified, likely present | `comms-status.core.ts` tracks reply timing only |
| S2.5 | PIESA stage name mismatch; bulk hold differs from single hold | Unverified | Needs a read of `bulk.functions.ts` |
| Added | Every office-only action checks the user is office staff | Unverified (launch blocker) | Needs a full check of all actions |

Slice 1 fixes S1.1 and S1.7, the booking part of S1.2 (per-visit contact sharing), S1.11, S2.1, S2.3, and S2.4 for this slice. The rest stay listed as open launch blockers.

## Part B. What you'll see

```text
Enquiry -> Preliminary result ("Preliminary: likely eligible")
 -> Office reviews and approves the estimate (estimate only, not binding)
 -> Owner opens their secure page -> presses "Request my free Ready Check"
 -> Installer assigned (or an office alert if no installer fits)
 -> Contact details shared for this visit only (owner sees the notice first)
 -> They talk directly -> one side enters the agreed time
 -> The other side confirms (or office confirms and records how it was agreed)
 -> Ready Check booked
```

- **One next action per job, for each person:**
  - Office: "Approve estimate", "Assign installer", "Confirm time".
  - Owner: "Request Ready Check", "Confirm time".
  - Installer: "Contact owner and enter time".
- **24 hours after details are shared with no time entered:** both sides get one reminder. While sends are switched off, it's recorded as "held, not sent".
- **48 hours with no confirmed booking:** a Needs attention item appears for office, even if a time was entered.
- **Failed or held messages:** they appear in Needs attention with who, what and why, plus a retry button.
- **Every action is recorded** in the job history.
- **Opening a page, sending a message or a timer running out never books or moves a job.**

### Wording

- **Owner:** "To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned installer for this job only."
- **Trade:** "Use these contact details only to arrange and complete this Home Insulation Victoria job."

## Part C. Not in this slice

PIESA, payment options, rectification, installation, Mitti writes and Xero are not touched. All outside sends stay OFF. Nothing is published. No production migration runs until you approve the dry-run in a draft.

## Technical section

### Database (one additive migration, dry-run in a draft first)

- **`estimate_approvals`:** `job_id`, `estimate_id`, `estimate_version`, `approved_by`, `approved_at` and `note`. Office-only RLS; owners read through the server.
- **`ready_check_requests`:** `job_id` and `estimate_approval_id`, plus `requested_at`, `ip`, `user_agent` and `idempotency_key` (unique). This reuses or extends `ready_check_acceptances` where it fits.
- **`visits`:** `id`, `job_id`, `kind` (`ready_check`), `assignment_id`, `assignment_version`, `status` and `coordination_started_at`. Status is one of `awaiting_assignment`, `awaiting_contact`, `awaiting_time`, `awaiting_confirmation`, `booked`, `cancelled`.
- **`contact_disclosures`:** `visit_id`, `owner_id`, `recipient_user`, `fields[]`, `disclosed_at`, `notice_version`, `revoked_at` and `reason`.
  - Trades read contacts only through `get_visit_contacts(visit_id)`. This is a security-definer function that re-checks the active assignment and that sharing hasn't been revoked.
  - The direct trade read of `owners` and `profiles` is removed for contact columns: a policy change plus a safe view.
- **`appointment_proposals`:** add `visit_id`, `version`, `entered_by_role` and `office_evidence` (method and note). Unique: one open proposal per visit.
- **`visit_tasks`:** `visit_id`, `kind` (`reminder_24h` or `office_alert_48h`), `episode`, `due_at`, `claimed_at`, `outcome` (`sent`, `suppressed` or `failed`) and `error`. Unique on `(visit_id, kind, episode)`.
- **`workflow_settings`:** add `ready_check_coordination_enabled` and `appointment_reminders_enabled`, both default false. If either is missing, the check fails closed.
- **Grants and RLS** on every new table. No drops. Old columns are kept.

### Server (literal createServerFn chains)

- **`transition()`:** re-route through `commit_guarded_stage` (expected stage, actor, audit in one transaction). `setHold` resume re-runs `stageEntryBlockers`. This fixes S1.1 for every caller.
- **New in `src/lib/readycheck-flow.functions.ts`:**
  - `approveEstimate` (admin).
  - `requestReadyCheck` (owner token; idempotent; a GET never changes anything).
  - `releaseVisitContacts` (system, after assignment; writes the sharing record before contacts are returned).
  - `enterArrangedTime` (owner or installer).
  - `confirmArrangedTime` (the exact other party, or admin with evidence).
- **New pure rules in `src/lib/readycheck-flow.core.ts`:** visit status, the next action for each role, the confirmation rule (role, assignment version, proposal version, not stale) and the timer schedule.
- **`booking.server.ts` `confirmBooking`:** one RPC that keeps the old booking until the new one commits, and binds the proposal version (S2.1).
- **`sendInitialEstimateEmail`:** requires the current `estimate_approvals` row.
- **`acceptReadyCheck`:** a blocked transition now returns an office exception instead of silent success.
- **Timers:** the existing `post-intake` 2-minute worker also claims due `visit_tasks`, so no new cron is added. Reminders go through `external_action_outbox` (`booking_messages` = off, recorded as suppressed). The 48h alert is always created.
- **Needs attention:** `todo.functions.ts`/`stuck.core.ts` gain rows for failed or suppressed messages (from `job_communications` and the outbox), 48h alerts, and missing installer.
- **Launch blocker:** a test lists every exported admin server function and asserts it checks the user's role before any `supabaseAdmin` use.

### UI

- **Admin job page:** an "Approve estimate" card and a visit card (status, the time entered, who confirms, timer due).
- **Owner page and estimate token page:** a "Request my free Ready Check" button, the sharing notice, confirm/enter time, and the "estimate only" disclaimer.
- **`field.$jobId.tsx`:** contacts come only from `get_visit_contacts`, plus the Enter time button.
- **`nextstep.core.ts`:** takes its action from the visit status.

### Tests (`bun test ./tests/`, plus PGlite for the RPCs and RLS)

- **Normal path:**
  - Office approval is required before the estimate goes out.
  - A GET creates no request.
  - Requesting twice creates one request.
  - Assignment creates a visit; no installer creates an office alert.
- **Access:**
  - Contacts are invisible before sharing, to unrelated users, to an earlier installer, and after revoking.
  - Sharing is recorded before contacts are returned.
- **Booking:**
  - A time entry stays "awaiting confirmation".
  - Confirmation by the same role, a stale proposal, the wrong job or a reassigned trade fails.
  - Two confirmations at once create one booking.
  - A failed replacement keeps the old booking.
- **Timers (frozen clock):**
  - 23h59: nothing.
  - 24h01: one reminder, or suppressed while sends are off.
  - 48h01: one office alert, even if a time was entered.
  - Rescheduling or reassignment starts a new episode.
  - Two workers running together still send once.
- **Delivery:** a simulated failure keeps the booking and creates Needs attention; unknown results are not re-sent.
- **State:** one primary action per role; booking never changes eligibility.
- **Rollback:** a database failure rolls back the state, audit, task and outbox together.
- **Admin role-guard inventory.**

Then: typecheck, lint, full test run and build, with actual results reported.

### Rollback

- The migration is additive, and the new behaviour sits behind the two flags (default off).
- Turning a flag off restores today's flow.
- No live data is migrated; existing jobs keep their stage.

### Files touched

- **Server:** `workflow.server.ts`, `portal.functions.ts` (`setHold`), `booking.server.ts`, `readycheck-payment.server.ts`, `followups.server.ts`, `postintake.server.ts`, `pilot.functions.ts`/`pilot.core.ts`, `nextstep.core.ts`, `todo.functions.ts`, `stuck.core.ts`.
- **New files:** `readycheck-flow.core.ts` and `readycheck-flow.functions.ts`.
- **Screens:** `field.$jobId.tsx`, `owner.$jobId.tsx`, `estimate.$token.tsx`, `admin.jobs.$jobId.tsx`.
- **Migration:** one new file.
- **Tests:** new test files.
- **Records:** `AGENTS.md` and `roadmap.md`.
