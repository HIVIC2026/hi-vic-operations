# Launch readiness — restructured plan (v3)

Incorporates both rounds of your review. Phased order, named evidence, acceptance criteria, measurable go-live gate. "100% ready" is only claimed when every critical item has a recorded passing result in the launch register.

## Phase 1 — Freeze rules and decisions (blocks everything else)
Each open decision gets a named decider and a target date so the plan cannot stall here. No silent choices:
- AP-fee behaviour after quote acceptance (currently locked for everyone)
- Old electrician-visit path: keep, migrate, or retire
- Official PIESA/PIISA mappings and source documents
- Definitions of Eligible / Likely eligible / Not eligible, and declared vs verified evidence — these drive the job-page eligibility checklist labels
- **Existing insulation rule, stated outright: an existing-insulation "Yes" calls for an assessment, never an automatic cross**
- Communication and consent policy by channel (Phase 4 definition)
- Whole-portal test-login: who it's for, exact role and permissions (admin-level access for an outsider stays barred)

## Phase 2 — Identity, access and security (must precede any live customer communication)
- Owner invitation and account-linking process; existing-job linkage or safe migration
- Every intended owner can access only the correct job: wrong-user and wrong-job access tests
- Expired and revoked link behaviour; opening a link performs no booking action
- Job numbers, phone numbers and email addresses never grant access by themselves
- Recovery procedure for owners who cannot sign in
- Installer/electrician access, role permissions and RLS, contact masking between owners and trades, token expiry/revocation, test-account restrictions, audit logging
- **Existing data, split in two:** (a) owner linking for the 253 real jobs stays here in Phase 2; (b) re-checking each job's eligibility classification against the new definitions is a separate business-review item that runs only after the Phase 1 definitions are signed off — named reviewer, and a report of every job whose classification changed. Historical statuses stay unchanged.

## Phase 3 — Core workflow correctness (against dummy data)
- Job stages and next actions; Ready Check flow; later electrician path; PIESA timing
- Hazard-to-rectification flow; payment and evidence gates; 24-hour allocation rule
- Overdue logic; superseded proposal behaviour; booking cancellation and rescheduling
- Test-job exclusion from operational totals
- Stale or retired paths resolved before notifications are built around them

## Phase 4 — Communications (mocks before any live delivery)
**Portal-only communication, defined:** conversation bodies stay in the portal; email and SMS are alerts containing secure links; direct SMS replies are not accepted; direct email replies are not accepted or are safely routed; contact details stay hidden between owners and trades; office users can see delivery failures and correspondence.

**SMS workstream (primary alert channel):**
- Owner, installer and electrician notifications; appointment proposals, acceptance, alternatives, cancellation, rescheduling; new portal-message alerts; 24-hour reminders
- Secure, scoped, expiring job links; provider configuration and approved sender identity
- Delivery callbacks and failure handling; consent and communication-switch enforcement; duplicate-send protection
- Australian phone-number handling; Australia/Melbourne scheduling; segment counts and costs
- End-to-end tests with mock delivery. No paid SMS sending, sender registration or live switch activated automatically.

**Event matrix (each event also states behaviour when the number/email is missing, invalid or not consented):**

| Event | Recipient | Channel | Portal action |
|---|---|---|---|
| New portal message | Relevant participant | SMS, email if approved | View and reply |
| Appointment proposed | Intended responder | SMS, email if approved | Confirm or request another time |
| Alternative requested | Responsible trade or owner | SMS/email | Propose or review |
| Booking confirmed | Relevant participants | SMS/email | View booking |
| Booking cancelled/rescheduled | Relevant participants | SMS/email | Review change |
| Visit reminder | Relevant participants | SMS if approved | View booking |

Plus: customer email templates (brand redesign), verified email domain (DNS records needed from you — templates depend on these), global and channel-level launch locks.

**Compliance check (confirmed properly, not assumed):** whether booking SMS/email messages count as transactional under the Spam Act; privacy handling of owner contact details; how long VEU evidence and records must be kept.

## Phase 5 — Onboarding and forms
- Insurance-document extraction — a reading failure must never silently accept an unread or invalid certificate
- Quarantine and manual-review behaviour; address autocomplete fix; installer and electrician completion screens; invitation content
- Mitti forms A2, B, C (built from briefs, then connected and validated); A1 regression test
- PIESA/PIISA mapping validation; signed-copy storage (0075)

## Phase 6 — Xero (non-production or controlled environment first; depends on Phase 3 payment gates)
- Correct Xero organisation; contact and item mapping; tax and rounding rules
- Invoice line layout; VEU discount; Inclusive-GST wording; Home Insulation Victoria business unit
- Duplicate-invoice prevention; 50% deposit calculation; refund, credit and overpayment behaviour; audited override permissions
- Preflight shows the exact invoice payload and rendered invoice before any real invoice is created

## Phase 7 — UX and public routing
- **Job-page redesign and terminology (the original goal): compact job page, eligibility checklist with ticks and crosses, consistent labels (Eligible / Likely eligible / Not eligible per Phase 1 definitions), field/source register**
- Compact staff portal; owner booking view; installer/electrician mobile screens
- Correspondence collapsed by default; one clear current status and next action
- Public homepage and calculator routing; staff sign-in route; no development branding on customer pages
- Accessibility and keyboard operation; empty, error, expired-link and offline states

## Phase 8 — Full regression and launch rehearsal
All six scenarios plus: appointment conflict and simultaneous acceptance; cancelled/rescheduled reminder; invalid phone and failed delivery; invalid email and bounced delivery; expired/revoked access link; wrong-role access; duplicate webhook; Xero unavailable; document extraction failure; communication switch disabled; rollback rehearsal.
Each test records: expected result, actual result, evidence, pass/fail.

## Phase 9 — Post-publish live checks (after deployment, before communications go live)
- Onboarding start works; rate limits clean; forged test mode refused; staff test links once/expiry/revoke; insurance quarantine
- Each shorthand check becomes its own register item with a one-line expected result: address suggestion list closes after selecting; insurance certificate details are read and shown for confirmation; the partner enquiry detail box closes on X; the Active Jobs count matches its list; REC-2.3 and INST-1.10 are the live agreement versions
- On a live job: eligibility labels match the Phase 1 definitions, and owner/trade contact details are hidden from each other
- No lead fee anywhere; all 15 external-action controls OFF; no external actions

## Work waiting for publish approval (each gets its own register entry with evidence and an approval line)
- INST-1.10 pricing acknowledgement (installer-brought jobs: no lead fee, no margin, only the $349 AP fee)
- Compact staff portal redesign (audit fixes, preview-verified)
- Signed-copy storage (0075) and hazard-to-rectification wiring (0077/0074) — staged and throwaway-tested

## After launch — running it
- Monitoring of failed deliveries and errors; a single kill switch for all external actions
- Short support process: owner can't sign in, wrong booking, SMS didn't arrive
- Named person watching the first week

## Launch register
Every item tracked with: ID, workstream, requirement, business owner, technical owner, dependency (e.g. Phase 6 depends on Phase 3 payment gates; Phase 4 email templates depend on domain records), risk level, acceptance criteria, test method, evidence link, current status, blocker, production action required, rollback step, approval required, approval recorded by and when. Controlled statuses only: Not started, In progress, Blocked, Ready for verification, Passed, Approved for production. Until the register exists with real owners, evidence and statuses, every item is effectively Not started.

## Severity definitions
- **Sev 1:** security breach, wrong-job access, a wrong charge, a wrong eligibility outcome, or a message sent to the wrong recipient or containing another party's contact details
- **Sev 2:** a blocked core journey with no workaround

## Go-live gate (measurable)
Launch only when every critical item has a named owner, acceptance criteria, evidence and a passing result; no unresolved severity-one or severity-two defect remains; typecheck, lint, automated tests, production build and security checks pass; migrations and rollback have been rehearsed; production secrets and domains are verified; all external-action controls remain off until approval (b) is recorded, then are enabled one at a time and checked; and you provide **separate explicit approvals** for (a) deployment and (b) live communications — so the portal can deploy safely without sending messages, creating invoices or triggering any external action.

## Boundaries (unchanged)
Locked Step 1 (Base44 handoff), Gate 1 rules, pricing and payment guards stay untouched. Test jobs stay flagged qa_test and excluded from live totals. No publication, sending, charging or production mutation without explicit approval for that specific action.
