# Monday full-production launch plan

## Goal
By Monday 5 October, HI VIC has one clear operating portal that staff can test as real people, run a disposable job from enquiry to completion, and only unlock for live work after every required proof passes.

The launch standard is not “the screens exist.” Every important button must perform its real action, every role must see the correct work, every automatic step must leave an audit record, and every failure must create a visible **To action** item rather than disappearing.

## What the audit confirms today

- The underlying workflow rules, stage guards, pricing, payment gates, audit history and role-specific pages are implemented and extensively unit-tested.
- The database currently has login roles, but there is no clear in-portal process to create the separate installer, electrician and owner test accounts you need.
- Installer/electrician onboarding creates an application, but approval does not yet complete the login invitation and role access in one reliable flow.
- Portal chat stores real messages, but labels such as email/SMS do not send externally.
- Customer communications are locked, and the configured delivery bridge is disabled. SMS/WhatsApp delivery is not connected.
- Xero is connected to the project. Quote acceptance can create the one full invoice and payment sync exists, but branding is currently left to Xero's default invoice theme, payment sync is manual, and the native 50% deposit request still requires the team to click it in Xero.
- The invoice preview exists, but it must be reconciled line-by-line against the payload before any real Xero record is approved.
- All Mitti template IDs are currently empty, the installer measurement standard is unapproved, and the negotiated own-electrician PIESA cost is unset.
- Official PIESA/PIISA PDF filling exists behind the scenes, but the on-screen completion, signing and delivery journey is not finished.
- The per-job AP evidence register is still missing.
- There are already QA jobs available, but no guided start-to-finish launch runner or evidence report.

## 1. Create a safe, repeatable launch-testing workspace

- Add an admin-only **Test Centre** that clearly separates test records from live work.
- Add a guided **Create dummy journey** action that creates a disposable owner, property and job marked as QA/test from the outset.
- Support the required test scenarios:
  1. HI VIC lead with no measurements.
  2. Installer-brought job with complete approved measurements, photos and quote.
  3. Installer-brought job with partial measurements.
  4. Installer-brought job with no usable measurements.
  5. Own electrician with an agreed PIESA rate.
  6. HI VIC electrician at $349 inc GST.
  7. Rectification required.
  8. No rectification required.
  9. Gate 1 fail, onsite confirmation and internal review cases.
- Add a reset/delete action limited to unsigned QA records; preserve anything legally/audit locked.
- Show a journey checklist with pass/fail evidence, current stage, expected stage, next action and any blocker.

## 2. Make separate role logins simple and real

- Create four separate test identities: admin, installer, electrician and owner, using the real test team's details supplied for launch testing.
- Add an admin flow that invites a person, assigns the correct role and links installer/electrician accounts to the approved partner business in one operation.
- Complete the approval-to-login bridge for installer and electrician onboarding.
- Give each invited person a clear sign-in instruction and role-specific landing page.
- Add role-aware access checks so entering another role's page directly cannot show an unusable or misleading screen.
- Add a **Test as** helper in Test Centre for navigation convenience, while keeping separate-account testing as the authoritative permission proof.

## 3. Turn every workflow step into an actual user action

For the dummy journey, expose and test the real action at each stage:

```text
Dummy enquiry
  → Gate 1 decision
  → Ready Check or approved installer measure-up
  → electrician nomination and PIESA booking
  → assessment / rectification
  → installer quote options
  → owner acceptance and signatures
  → invoice preview
  → deposit request task and payment state
  → installation scheduling
  → ESC notice and PIESA-copy gate
  → installation / PIISA / evidence
  → AP review
  → VEEC lodgement
  → complete
```

- Remove or label any control that is only a mockup.
- Put the exact action, responsible role and deadline on every job.
- Ensure completion of the underlying record automatically removes the related **To action** item.
- Add mismatch alarms for stage, assignment, payment, communications, signatures, evidence and deadlines.
- Make “all clear” impossible when a required check failed to load.

## 4. Finish the installer-brought-job experience

- Complete the owner invitation journey as a real, controlled action.
- Complete **Add my electrician**, including agreed PIESA price capture during onboarding and office approval.
- Make complete, partial and missing installer submissions visibly distinct.
- Require office approval before installer measurements can skip the free Ready Check.
- Ensure the installer sees their own jobs, HI VIC-allocated jobs and accepted leads with the correct source and customer-relationship label.
- Ensure the owner sees one coherent co-branded journey and one total, not the internal commercial breakdown.

## 5. Complete communications and prove delivery

- Keep live customer communications locked while building.
- Connect one real email delivery path and one real SMS delivery path, or explicitly remove SMS promises from launch scope if no provider is approved in time.
- Build a safe launch-testing mode that redirects every outbound message to the named test team while preserving the intended recipient and content in the audit record.
- Wire the actual events: invitations, appointment proposals/responses, quote issued, signing requests, deposit/payment updates, ESC notice, PIESA copy, reassignment and exceptions.
- Add delivery states: queued, sent, delivered when confirmed, failed, suppressed and retry required.
- Surface every failed/overdue delivery in **To action** with a retry button where safe.
- Test two-way portal chat separately as owner ↔ office ↔ installer/electrician, including contact masking and unread states.
- Only enable real-recipient delivery after the test-team matrix passes and Jo approves the launch switch.

## 6. Finish Mitti, official forms and AP evidence

- Build and validate the separate Mitti templates for Ready Check, PIESA and PIISA; connect only verified template IDs.
- Record and approve the measurement standard before any installer-supplied measure-up can become final.
- Add the on-screen action that fills the official PIESA/PIISA PDFs from completed answers.
- Show missing fields before generation; never guess an answer or official wording.
- Complete electronic signing in the required sequence and save signed forms privately to the job.
- Automate PIESA-copy delivery only after the signed document exists; enforce the 24-hour gate.
- Build the per-job AP evidence register with required/not-required, uploaded, verified/rejected, verifier, date and notes.
- Block AP review and VEEC readiness until every required evidence item and official form passes.

## 7. Finalise invoice design before any Xero write

- Make the portal preview the authoritative preflight view for installer-led and HI VIC-sourced jobs.
- Reconcile every line: installer work, PIESA, rectification, AP fee, VEU discount, GST, $200 minimum co-payment, deposit amount and remaining balance.
- Add co-branding data and a printable invoice/PDF preview matching the intended Xero presentation.
- Confirm the connected Xero organisation's branding theme, invoice numbering, account codes, tax treatment, tracking category, payment terms and email wording.
- Add a launch-check panel showing Xero connected, invoice preflight passed, contact ready and totals reconciled.
- For now, stop at preview as requested. Before full production launch, require Jo's separate approval for one controlled Xero test invoice; never create it silently.
- Verify the automatic quote-acceptance invoice, duplicate protection, native deposit-request **To action**, 50% payment sync, due-date update behaviour, error recovery and void handling.
- Decide whether payment sync runs automatically at a safe interval or remains a clearly assigned office action; it must not rely on staff remembering an invisible step.

## 8. Reliability, security and recovery proof

- Add browser-driven end-to-end tests for all four separate accounts and both installer-led/HI VIC-led paths.
- Test desktop admin screens and mobile installer/electrician/owner screens.
- Test refresh, duplicate clicks, expired links, missing consent, wrong role, network failure, failed external delivery, Xero timeout, Mitti mismatch, late PIESA and changed installation date.
- Verify row-level access: owners and trades see only their permitted jobs and never internal margin or other customers.
- Confirm all private evidence links expire and no protected file is public.
- Run the full unit, security, type and build checks after every launch-critical correction.
- Produce a launch evidence report containing screenshots, test identities, scenario results, remaining manual actions and every unresolved blocker.

## 9. Monday execution and go/no-go gates

### Thursday
- Build Test Centre, dummy journeys and test-account invitation/linking.
- Confirm test-team contact details.
- Finish the invoice preflight and identify the exact Xero branding/settings decisions.

### Friday
- Finish owner invite, Add my electrician, communications test routing, Mitti/form actions and AP evidence register.
- Run each role through its own login.

### Saturday
- Run complete installer-led and HI VIC-led journeys, including both PIESA routes and rectification/no-rectification branches.
- Repair every incorrect stage, action, permission or missing notification found.

### Sunday
- Regression run across desktop/mobile and all failure cases.
- Review the launch evidence report, unresolved blockers, manual operating guide and rollback procedure.
- Obtain explicit approval before any controlled Xero write or real-recipient message.

### Monday
Launch only if all of these are green:

- Four separate role logins pass.
- At least one complete installer-led journey and one HI VIC-led journey pass.
- Every required message reaches the real test team and failures surface in **To action**.
- Mitti, official forms, signatures and AP evidence pass.
- Invoice totals and branding are approved; one controlled Xero invoice has been explicitly authorised and reconciled.
- Deposit and scheduling gates cannot be bypassed.
- No stage/action mismatch exists.
- No critical security, build, runtime or data-access error remains.
- Staff have a one-page operating guide and know how to recover failed sends/syncs.
- Jo explicitly approves enabling live communications and live-job use.

If any mandatory gate is red, the portal remains safely locked and Monday becomes a controlled pilot/go-no-go review rather than an unsafe production launch.

## Technical implementation boundaries

- Preserve the locked Gate 1 and Base44 handoff.
- Keep test data permanently marked and excluded from operational totals, follow-ups and VEEC work.
- Keep customer communications and external writes fail-closed until explicit approval.
- Use existing central workflow, next-step and **To action** rules rather than adding screen-specific logic.
- Use the existing private job-file storage and permanent workflow audit trail.
- Do not invent rates, Activity 48 wording, Xero settings or external-provider capabilities.
