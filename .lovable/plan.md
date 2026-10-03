# Slice 1: Enquiry to confirmed Ready Check booking (revised with your 8 corrections)

## Part A. Where each serious finding stands today

Checked against the current code and the live database rules on 3 Oct 2026.

**Earlier launch-control patch:** partly live.

- **Live:**
  - Migrations 0071–0073 are applied.
  - All 15 outside-action switches are OFF.
  - Signed-in users have no direct write access to jobs.
- **Not live:** the guarded stage step from migration 0073 exists, but no code calls it.

### Sev 1

| ID | Finding | Status | Evidence |
|---|---|---|---|
| S1.1 | Stage change isn't one locked step; hold/resume skip the stage rules | Still present | `workflow.server.ts:324-336`, `portal.functions.ts:951-971`; nothing calls `commit_guarded_stage` |
| S1.2 | Trades see owner contacts with no record of when they were shared | Still present | Owner phone shown in `field.$jobId.tsx:42`; owners/profiles RLS (live) |
| S1.3 | PIESA entry has no check on quote version or payment; any signed agreement counts | Still present | `agreementSigned` `:64-67` |
| S1.4 | 50% rule; paid date never clears after a refund; override unlocks | Still present | `invoice.lifecycle.ts:30-91` |
| S1.5 | Ready Check completion jumps to estimate with no office review; evidence check passes on read error | Still present | `portal.functions.ts:248-252, 289-292` |
| S1.6 | Rectification items marked done even when PIESA fails; missing evidence passes | Still present | `portal.functions.ts:517-523` |
| S1.7 | Booking confirmation isn't tied to the exact other party | Partly fixed | `pilot.core.ts:332-337`; `confirmBooking` has no check of who is confirming |
| S1.8 | No separate "installation started" step | Still present | No such command |
| S1.9 | Changed Mitti evidence doesn't cancel later approvals | Unverified | `mitti.server.ts:193` |
| S1.10 | Declared "previous upgrade = yes" fails eligibility | Still present (locked Gate 1) | `eligibility.core.ts:145`; needs your decision |
| S1.11 | Estimate is emailed without office approval; a failed move after a Ready Check request is only logged | Still present | `followups.server.ts:87-129`; `readycheck-payment.server.ts:93-99` |

### Sev 2

| ID | Finding | Status | Evidence |
|---|---|---|---|
| S2.1 | Old booking is cancelled before the new one is saved | Still present | `booking.server.ts:40-41` |
| S2.2 | Ready Check template ID mismatch on sync | Unverified | Same selection at create and sync |
| S2.3 | Follow-up timing comes from the assignment, not each visit | Still present | `pilot.core.ts:298-306` |
| S2.4 | Failed messages not shown to office | Unverified, likely present | `comms-status.core.ts` |
| S2.5 | PIESA stage name mismatch; bulk hold differs from single hold | Unverified | `bulk.functions.ts` |
| Added | Every office-only action checks the user is office staff | Unverified (launch blocker) | Needs real unauthorised-call tests |

Slice 1 fixes S1.1, S1.2 (both directions, for this visit), S1.7, S1.11, S2.1, S2.3 and S2.4. The rest stay open launch blockers.

## Part B. What you'll see

```text
Enquiry -> Preliminary result
 -> Office approves the estimate (estimate only, not binding)
 -> Owner presses "Request my free Ready Check" on their secure page
 -> Installer assigned (or office alert if none fits)
 -> Contacts shared for this visit only, both ways, after each side sees the notice
 -> They talk directly -> one side enters the agreed time
 -> The exact other party confirms (or office confirms and records how it was agreed)
 -> Ready Check booked
```

- **Job page stays simple:** one main next action at the top of the job summary and a short open-task list per person. Approval and visit controls sit inside the summary (no new big cards); full detail stays under Job records.
- **24 hours after sharing with no time entered:** one reminder to each side. While sends are off it's recorded as "held, not sent".
- **48 hours with no confirmed booking:** a Needs attention item for office.
- **Failed or held messages:** shown in Needs attention with who, what and why. Retry resends only to the person it failed for, and only if switches, consent and assignment still allow it.
- **Opening a page, a message or a timer never books or moves a job.**

### Wording

- **Owner:** "To arrange this visit, Home Insulation Victoria will share your name, phone number and email with the assigned installer for this job only."
- **Trade (full notice, recorded before details show):** "These contact details are shared only so you can arrange and complete this Home Insulation Victoria job. Do not use them for marketing, unrelated work or future work unless the owner separately agrees with you. Do not pass them on. Access ends if the job is reassigned or cancelled."
- **Installer details shown to owner:** business name, contact name and phone for this visit only, recorded and revoked the same way.

## Part C. Boundaries

- PIESA, payments, rectification, installation, Mitti writes and Xero are untouched. All outside sends stay OFF. Nothing is published. No production migration until you approve the dry-run in a draft.
- **No running on:** a new database rule stops any job leaving the Ready Check booking stages unless the visit is confirmed for the current assignment. Every route goes through it: auto-advance, eligibility change, hold/resume, bulk actions and booking screens. Tests try each route.
- **Jobs already in progress:** they get no automatic request, visit or sharing record. Their stage is never treated as the owner asking or agreeing to share contacts. They show "Office review: set up visit" until office records the owner's request and consent, and how it was obtained.
- **Your decision needed (S1.10):** proposed change: a declared "previous upgrade = yes" goes to office review, marked preliminary, until the earlier activity is established. Gate 1 is locked, so nothing changes without your yes.

## Technical section

### 1. Atomic actions

Each action is one `security definer` database function in a single transaction:

```text
lock job (FOR UPDATE) -> lock visit / assignment / proposal
-> verify caller (auth.uid() or owner-token hash) and role
-> check expected versions (job.updated_at, assignment.version, proposal.version, approval id)
-> re-check stage rules inside the lock
-> write request/booking + stage + workflow_events + visit_tasks + outbox
-> commit, or roll back everything
```

- Functions: `rc_approve_estimate`, `rc_request_ready_check`, `rc_release_contacts`, `rc_enter_time`, `rc_confirm_time`, `rc_set_hold`. Server code only calls them; no check-then-write in TypeScript.
- A blocked Ready Check request raises an error, so no acceptance, payment or request row survives. `acceptReadyCheck` moves into the same function.
- `autoAdvanceJob`, `setEligibility`, `bulkJobAction`, `setHold`, `transition()`, `confirmBooking` and the proposal reply in `pilot.functions.ts` all go through `commit_guarded_stage`. That function gets the rule that `assessment_booked` needs a confirmed visit for the current assignment version. A test finds every write to `jobs.stage` and fails if any skips it.

### 2. Contact protection (both directions)

- **Column privileges, not RLS:** revoke `SELECT` on contact columns of `owners` and `profiles` (phone, email, address detail) from `authenticated`. Grant only non-contact columns.
- **Restricted views** (`owners_public`, `profiles_public`) for job lists, exports, documents and form prefills.
- **Contacts only via `get_visit_contacts(visit_id)`:**
  - Checks that the caller is the current party, the assignment version matches, nothing is revoked or expired, and the notice was accepted.
  - Owners get the installer side; trades get the owner side.
  - Writes the `contact_disclosures` row before returning anything.
- **`contact_disclosures` records:**
  - job, visit, and assignment id and version;
  - who disclosed, and the recipient's user and role;
  - exact fields shared;
  - purpose, consent basis and version, notice version;
  - when shared, expiry, revocation and reason;
  - follow-up state.
- Reassignment, cancellation or expiry revokes access in the same transaction.

### 3. Owner token actions

- The token is stored as a hash only.
- Each function checks the job, purpose `ready_check`, expiry and revocation. It also checks that the token is bound to the current approved estimate version, the owner is on file and contact consent is current.
- A GET only displays. Every change is a POST with an idempotency key.
- A confirmation is bound to the exact proposal id and version and the exact counterpart party.
- An estimate change replaces the approval, cancels open requests and proposals, and asks again where needed.

### 4. Reminders and delivery

- The `post-intake` cron is a 2-minute schedule, independent of new enquiries. A test runs the tick with zero enquiries and due visit tasks.
- `visit_tasks` gets `lease_until`, `attempts` and `last_error`; expired leases can be reclaimed.
- New `visit_task_recipients` table: one row per person with its own outcome. Retry targets failed recipients only.
- With sends off, a message is recorded `suppressed` and closed. It never becomes a backlog later. Retry re-checks switches, consent, assignment and delivery-unknown through `enqueue_external_action`.

### 5. Database (one additive migration, dry-run in a draft first)

- **New tables:** `estimate_approvals`, `ready_check_requests`, `visits`, `contact_disclosures`, `visit_tasks`, `visit_task_recipients`.
- **New views and functions:** two public views, the `rc_*` functions and `get_visit_contacts`.
- **`appointment_proposals`:** gains `visit_id`, `version`, `entered_by_party` and `office_evidence`.
- **Flags:** two in `workflow_settings`, default off and fail closed.
- Grants and RLS on every new table. The only removals are the contact-column privileges.

### 6. Tests

- Pure rules run with `bun test ./tests/`. Transaction logic runs on PGlite.
- A disposable draft database checks the real roles, grants, RLS and exposed functions. It signs in as anon, owner, assigned trade, earlier trade, unrelated trade and office.
- Cases covered:
  - non-admins calling each admin action;
  - contacts read through every API, job list, export, document and prefill;
  - every alternative route;
  - blocked requests leaving no rows;
  - concurrent confirmations;
  - lease recovery;
  - retrying only the failed recipient.
- The report marks each check as ran, passed, failed or unverified.

### 7. Safe rollback

Turning a flag off stops the new automation and moves affected jobs to "Office review: manual coordination". It does not reopen contact access, accept unconfirmed times or skip approvals. Confirmed bookings and all history are kept.

### Acceptance criteria

1. No route reaches `assessment_booked` without all three: an approved estimate, the owner's explicit request and confirmation by the exact counterpart. Each route is tested.
2. A blocked action leaves no partial rows.
3. No contact field is readable except through `get_visit_contacts`, with a disclosure row.
4. Owner token actions fail on expiry, revocation, a stale estimate or the wrong proposal version.
5. Reminders run with zero enquiries, recover after a crash and retry only failed recipients. Suppressed messages never send later.
6. Unauthorised-call tests pass on a real database; any gaps are listed.
7. Jobs already in progress are untouched until office review.
8. The job page shows one main action plus per-person tasks.

### Files touched

- **Server:** `workflow.server.ts`, `autoadvance.server.ts`, `portal.functions.ts`, `bulk.functions.ts`, `booking.server.ts`, `readycheck-payment.server.ts`, `followups.server.ts`, `postintake.server.ts`, `pilot.*`, `nextstep.core.ts`, `todo.functions.ts`, `stuck.core.ts`, estimate-token functions.
- **New:** `readycheck-flow.core.ts`, `readycheck-flow.functions.ts`.
- **Screens:** `field.$jobId.tsx`, `owner.$jobId.tsx`, `estimate.$token.tsx`, `admin.jobs.$jobId.tsx`.
- **Other:** one migration, tests, `AGENTS.md`, `roadmap.md`.
