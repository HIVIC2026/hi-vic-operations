# Office build B — proof table (O5 Partners, O5b business file, application review, O6 Money, O7 Communications, O7 Settings)

Branch `office-build-b` (from `installer-mitti-workflow` @ `9bf49321`). Decisions 204/241 ("build for real; every element
traces to a decision, rule or daily action"), 229–232, 240–243, 246, 248, 249. Approved mock-ups:
`docs/templates/office/portal/O5-partners.html`, `O5b-business-file.html`, `O5-partners-application-review.html`,
`O6-money.html`, `O7-communications.html`, `O7-settings.html`. Every built section/tab/button carries a `data-why`
attribute (never visible) with the same source as the "why" column below.

Frame: pages render inside the existing `AppShell` (office top bar). `src/lib/office-nav.ts` and the frame were NOT edited
(owned by office build part A); the new destinations are `/admin/partners`, `/admin/money`, `/admin/communications`,
`/admin/settings` — part A's nav should point Partners / Money and More › Communications / Settings at them.

Test files: **T1** `tests/office-build-b.core.test.ts` (27 tests, pure rules + source guards), **T2**
`tests/office-settings-switches.pglite.test.ts` (7 tests, PGlite practice DB, pending migration + switch CAS/audit).
Updated existing source tests: `admin-record-reliability`, `test-approval`, `jo-answers-7oct`, `no-lead-fee`,
`owner-paperwork-templates`, `qa-launcher-components.test.mjs`, `dad-test-login-ui.test.mjs`.

Legend: route/condition → server fn → test → why. **GAP** = not built / not provable here, stated honestly.

## O5 Partners — `/admin/partners` (`?tab=applications|approved|people|rates|coverage`)

| Element | Route / condition | Server fn | Test | Why |
|---|---|---|---|---|
| Tabs with counts | `?tab=` (default Applications); legacy `?enquiry=<id>` redirects to the review page | `getPartnersBoard` (office-partners.server `partnersBoard`) | T1 (screens reuse guarded fns) | 232, audit §5 |
| Applications · Waiting table (Business · Type · Area · What they sent · Received · Review) | `partner_enquiries` status new/contacted/onboarding, not test; split "Pending approval · signed applications" / "Website enquiries" | `partnersBoard` | `admin-record-reliability` (distinct pending queue) | application queue rule; 107 |
| Applications · Approved/closed, Started not finished, Test applications | Segmented filter | `partnersBoard`, `OnboardingDrafts` (existing) | — | keep follow-up of drafts; tests isolated |
| Approved table (Business · Area · CII cleared · PL insurance · Usual electrician · Taking new jobs) | approved, non-TEST businesses | `partnersBoard` (CII cleared = derived `crewClearance`, PL from `business_credentials`, usual = `partner_relationships.preferred`) | T1 personRow | 153, 193, 157/173 |
| Check expiries | button | `runPartnerExpirySweep` (existing) | — | 193 |
| People table (Person · Business · Role · CII · Privacy notice · Mitti · one action) | non-removed workers of approved businesses | `peopleFor` → `crewClearance`, `noticeAckMap`, `noticeSendHistory`, `mittiAccessOf` | T1 "one next action…", "verified CII without level is NOT cleared" | 153, 130, 22/188 |
| People · Verify CII | action `verify_cii` (uploaded cert not cleared) → dialog (number, level, expiry, open certificate) | `officeVerifyEec` (existing; clearance stays derived), `officeEecFileUrl` | T1 source guard | 153 |
| People · Send notice | action `send_notice` | `SendNoticeLinkInline` → `sendCollectionNoticeLink` (existing guarded senders) | T1 source guard | 130 |
| People · Invite to Mitti | action `invite_mitti` → **"invite needed" state**: exact-email instruction + Check Mitti access | `checkMittiAccess` (existing) | T1 source guard | 22/188 — **GAP: no per-person Mitti invite function exists on this branch** (invite-and-esc-fields agent); when it lands, call it from `MittiInviteDialog` |
| Rates table (Rate card · Business · What it says · Effective) | active `rate_cards` (installer, ex GST) + active `electrician_rates` | `partnersBoard` | T1 rateCardLine | approved partner rates; 142 |
| Rates · Change request · Approve / Decline | pending `installer_rate_requests` → new rate-card version | `reviewHigherRates` (existing) | — | rates change only on office approval |
| Rates · Change request (free text) · Mark done / Decline | open `partner_change_requests` kind rates | `resolvePartnerChangeRequest` (new, admin, audited, only `open` rows) | — | partner change requests |
| Electrician rate cards › | link to `/admin/electrician-rates` (versioned card, unchanged) | existing | — | 157 |
| Coverage table + Edit | approved businesses; Edit dialog (areas, postcodes) | `saveBusiness` (existing: VIC postcode validation, `verify_coverage`) | T1 postcodeSummary + source guard | 229 |

## O5 application review — `/admin/partners/application/$enquiryId`

| Element | Condition | Server fn | Test | Why |
|---|---|---|---|---|
| Header (type, received, name, workers) + "N checks outstanding" | signed application (`raw_payload.rec_onboarding_id`) | `getAdminPartnerEnquiries`, `getRecOnboardingRecord`, `listWorkerCertifications` | T1 applicationChecks | 232 |
| Checks before approval (✓ / ! / ✕) | pure `applicationChecks` (ABN, PL + certificate, agreement signed, rates, CII verified count, licence/REC, bank) | — | T1 | 232 |
| Ask for the missing items | outstanding > 0 → prefilled message (`missingItemsMessage`), editable | `decidePartnerApplication(changes_requested)` (existing; emails applicant; test runs → Jo's test inbox) | T1 | 232 |
| Approve anyway / Approve | scrolls to the existing one-Approve panel | `ApprovePartner` → `getApprovalChecklist`, `activatePartnerApplication` (CII mandatory, insurance override needs reason, counter-offers respected) | `test-approval` | 107, 232 |
| Decline | reason optional | `decidePartnerApplication(declined)` | — | 232 |
| Business / People / Rates proposed / Coverage requested / Documents | from the signed record | `SignedRecAgreement`, `PartnerProfileCard` (existing) | — | 232 |
| Email the applicant | Jo's one-off email | `sendPartnerOfficeEmail` (existing) | — | 107 |
| Full record, status and notes (fold) | `ApplicationDetail recordOnly` | `updatePartnerEnquiry` (existing) | `test-approval` | queue history |
| Website enquiry (no signed application) | no `rec_onboarding_id` | `ApplicationDetail` | — | application queue rule |
| Already decided | `getApplicationReview` returns a decision | `ReviewDecision` display | `jo-answers-7oct` | 232 |

## O5b business file — `/admin/partners/business/$businessId`

| Element | Condition | Server fn | Test | Why |
|---|---|---|---|---|
| Header (type, Taking new jobs, legal name, area, approved since, Call / Text / Email) | — | `getBusinessFile` | — | business file |
| Agreement (version, signed, earlier, ESC notice count) + View agreement | `partner_agreements` | `businessFile` | — | installer agreement rule; 121/130 — **GAP: no agreement PDF renderer; "View agreement" shows the signed text + SHA-256** |
| Rates (items ex GST / electrician rates) + change requests Approve / Mark done / Decline | active rate card | `reviewHigherRates`, `resolvePartnerChangeRequest` | — | approved partner rates |
| Insurance & licences + Upload a new certificate / Verify | `business_credentials` | existing `Credentials` (`addCredential`, `verifyCredential`, `partnerUploadUrl`) | — | 193 |
| People | this business | `peopleFor` + same actions as People tab | T1 | 153/130/22/188 |
| Usual electrician (business, REC, PIESA rate, used on N of M jobs) + Change | installer businesses | `businessFile`; existing `Electricians` (`setPartnerRelationship`), renamed "Usual electrician" | — | 157/173 |
| Bank details masked + **Show full details (logged)** | `business_bank_details` | `revealPartnerBank` → audit row `partner_bank_details_revealed` first; nothing shown if the log fails | T1 maskBank + source guard | payout rule 30/109 |
| Xero supplier | business `xero_contact_status` | `businessFile` | — | Xero supplier |
| Jobs (this month, all time, own jobs) + Open Jobs › | `job_assignments` (non-test, not deleted) | `businessFile` | — | daily action — **GAP: Jobs list filter by business is part A's (link passes `?q=<name>`)** |
| Coverage + Edit | — | `saveBusiness` | T1 | 229 |
| Documents (agreements + credential files, View) | — | `partnerFileUrl` (existing, signed URL) | — | 6-year record — **GAP: application form PDF and CII/notice acknowledgement PDFs are not listed (no stored PDFs)** |

## O6 Money — `/admin/money` (`?tab=payouts|invoices|veecs|prices`)

| Element | Condition | Server fn | Test | Why |
|---|---|---|---|---|
| Tiles: VEECs lodged · Owners owe · We owe trades · Margin this month | Melbourne month; non-test | `getMoneyVeecs`, `getMoneyInvoices`, `getMoneyPayouts`, `getMoneyMargins` | T1 marginTotal | audit §6; 230 |
| Per-job margin table (Job · Owner · Price · Installer pay · Electrician · VEEC net · Margin · %) + click → breakdown | accepted quotes, latest 200 live jobs | `moneyMargins` → **`src/lib/job-margin.core.ts` `jobMargin` (the one pure rule; Job page Money card should import the same)** | T1 decision 230 block (matches mock rows) | 230 |
| Payouts grouped per business + Mark paid (bank reference) | jobs at ready_for_veec/complete; due = Final check + 7 days; owner-direct electricians excluded | `moneyPayouts` + existing `markPayoutPaid` per job/kind | T1 groupPayouts | 30/109 — **GAP (re-checked office-gaps, 24 Oct): "Mark paid sends the remittance" (mock) — no approved remittance template exists in `docs/templates/` or the decisions log, so nothing is sent; the page says "records the bank reference"** |
| Invoices (Invoice · Owner · Job · Total · Steps · Paid · State) | latest installation invoice per live job (80 open + 20 paid) | `moneyInvoices` → existing `jobPaymentView` (payments.core thresholds) | T1 invoiceRowState / stepsLine | 139–144 |
| Overdue → **Chase ›** → Log a call or note | `state = overdue` | existing `recordManualCommunicationFn` (phoned / followup_required; nothing sent) | T1 "no Record payment" | **240** |
| No Record payment anywhere | — | no record fn in `office-money.functions.ts` | T1 | **240** |
| VEECs: spot price entry (the one place) | — | `saveVeecSpotPrice` → `veec_spot_prices` row + `workflow_settings.current_veec_price` + audit | — | audit §6 (one price entry) |
| VEECs tiles (Lodged · Registered · Waiting) + per-job (Install · VEECs · Claimed · Received · Registry) | `veec_lodgements` + completed installs | `moneyVeecs` | T1 veecRegistryLabel | 28–29, 119 |
| Prices: owner price list + Edit (reason, new version for new quotes) | — | existing `getOwnerPrices` / `setOwnerPrices` (`publish_owner_prices`; AP fee owner-only) | — | 26 |
| Prices: fixed rules ($349 safety check, 10% deposit 48h, fixes + $100, AP fee) | constants from payments.core | — | — | 139–142 |

## O7 Communications — `/admin/communications` (`?tab=sent|failed|outlook`; legacy `outgoing/campaigns/overview/inbox` map in)

| Element | Condition | Server fn | Test | Why |
|---|---|---|---|---|
| Held & queued grouped by message type (Message · Waiting · Why) + expand to people | held texts = `sms_messages` blocked attempts (last 30 days, key not since sent); held/queued emails = `customer_followups` pending/queued, `job_communications` blocked_prelaunch emails; non-test, not deleted | `getHeldAndQueued` | T1 groupHeld / heldReason | 159, 165 |
| Cancel these (per type) / Cancel all held | typed CANCEL confirm | `cancelHeldMessages`: queued follow-ups → `suppressed / office_cancelled`; held text/email records hidden via append-only `held_messages_cancelled` event | T1 splitHeldKeys | 16 |
| Sent (last 48h; state only when not arrived) | texts + portal emails | `getSentMessages` | — | audit §7 |
| Failed with reason, **no retry** | texts failed/undelivered, emails failed/bounced (30 days) | `getFailedMessages` | T1 failureReason + "no send and no retry" | SMS rule; audit §7 |
| Outlook matched mail (When · From · Subject · Job · State) + connection/catch-up fold | `outlook_message_work` latest 60 | `getOutlookMail`; existing `OutlookReview` | T1 outlookState | Outlook copier record-only rule |
| **GAP** | Owner emails blocked by `sendGuardedOwnerEmail` leave no stored "held" row, so they can't be listed; window-type reminders (e.g. VEEC days 1/3/7) are recomputed by their own schedule, so cancelling a held text record does not stop a later recomputed send. Installer "Good morning" texts are computed at 6:30am, not queued rows, so they are not in "Queued". | | | 165 |

## O7 Settings — `/admin/settings` (`?tab=switches|rules|mitti|esc|xero|users|deleted|test`, `&key=` for template versions)

| Element | Condition | Server fn | Test | Why |
|---|---|---|---|---|
| Templates register (Message · Who · when · How · Approved/Draft) → click opens the template register | emails with their real `*_APPROVED` flags; every text type from `SMS_MESSAGE_TYPES.wordingApproved` | `getMessageRegister` | — | 15/60 |
| Compliance form versions (Activity 48 register, readiness, versions, Add a version) | merged from `/admin/compliance` (now a redirect; `?key=` kept); caps heading and the installer-declaration intro fixed; retired key hidden | existing `listComplianceTemplates`, `approveComplianceTemplate`, `addComplianceTemplate`, `getComplianceSetup` | T1 | 118a/119/123; audit (merge) |
| Owner documents (gate · document · version · status · Approve with APPROVE) | merged from `/admin/owner-paperwork` (redirect) | existing `paperworkCatalogueFn`, `approvePaperworkFn`, `approvePaperworkTemplateFn` | `owner-paperwork-templates` | audit (merge) |
| **Owner signs again after install switch — REMOVED** | — | (server fns left unused) | T1 | 119 |
| Switches (named) incl. **Automatic installer offers / Automatic electrician offers** | `workflow_settings` columns (`auto_installer_offers`, `auto_electrician_offers` via pending migration), `customer_comms_enabled`, `daily_mitti_text_enabled`, `mitti_pickup_auto_enabled`, per-type `sms_message_switches`; code switches read-only | `getOfficeSwitches`, `setOfficeSwitch` (allow-list, CAS on the value seen, JSON serialised, audit `office_switch_changed`) | **T2** (fail-closed before migration, CAS, audit, rollback), T1 | 159, 154, 246 |
| Every text type (fold) | `SMS_MESSAGE_TYPES`; unapproved wording can't be switched on | same | T1/T2 | 159 |
| Turning on → "Cancel the N held for it first" | held groups matching the switch | `cancelHeldMessages` then `setOfficeSwitch` | T1 heldGroupsFor | 159, 16 |
| Automatic rules (read-only) | pure `AUTOMATIC_RULES` | — | T1 | 220, 238, 2, 141, 120, 130, 158, 246 |
| Mitti forms (+ AP measurement standard moved here from the old Approved partners page) | existing `MittiFormsSection`, `MeasurementStandardCard` | existing | — | Mitti-first pickup |
| ESC fields | existing `EscConfigSection` (reads esc.core; the invite-and-esc-fields agent updates the Registry field list) | existing | — | 118b/121/195 |
| Xero connection + routes (moved from Test Centre) + payments health | explicit connector credential, fail-closed routing (unchanged) | existing `getXeroConnection`; `getXeroPaymentsHealth` (env flags + last `owner_payment_recorded`) | `qa-launcher-components` (card) | 176/179/181/182 — **GAP: "Switch organisation" is done in the Xero connector settings; no portal action** |
| Users & access (Person · Role · Sees and does) + **Prepare Deep's TEST login ›** + Manage roles › | `getAdminUsers` | existing `downloadDadTestLogin` on `/admin/users#test-login` (label now "Prepare Deep's TEST login (private file)", heading no longer caps) | `dad-test-login-ui` | 159/177; TEST handover rule |
| Deleted (Job · Owner · Why · Deleted · Restore ›) | `listDeletedJobs`; restore needs a reason | existing `restoreJob` | — | audit screen 27; 227 — note: Restore is offered for every deleted job (only test jobs and duplicates are deleted, 227) |
| Test Centre cards | links to `/admin/test-centre`, `/admin/users#test-login`; Portal QA = CLI only | — | — | Test Centre rule; Portal QA rule — **GAP: portal-qa results are not stored, so no "last run" status is shown** |

## Audit removals applied on these screens

- Partners overview (`/admin/partners-overview`) → redirect to Partners (cards removed).
- Electrician team-ups (`/admin/team-ups`) → redirect to Partners › People.
- Compliance Setup + Owner paperwork → merged into Settings › Templates (old routes redirect).
- "Owner signs again after install" switch → removed from the office UI.
- Xero card → moved from Test Centre to Settings › Xero.
- Communications: Overview counts, the batch "Outgoing" sender, Campaigns tab, "Retry ineligible email" → removed (Held & queued / Sent / Failed / Outlook only).
- Money: the old tiles + per-job payout list replaced; Prices' separate "Current VEEC sale price" entry removed (VEEC price only in Money › VEECs).
- Legacy routes kept valid as redirects: `/admin/businesses`, `/admin/workers`, `/admin/coverage`, `/admin/pricing`, `/admin/veec`, `/admin/deleted`, `/admin/compliance`, `/admin/owner-paperwork`.
- **Not done here (owned by part A):** the "Invoice route" select is on the Job page (`admin.jobs.$jobId.tsx`), and the job Profit card's own VEEC price entry; part A should remove both and use `job-margin.core.ts` for the Money card.

## Guards kept

- Xero: unchanged explicit connector credential; `pickXeroTenant` fail-closed routing; TEST → Demo Company only. Money reads
  invoices/payments, never writes them.
- SMS: nothing on these screens sends or retries; held texts are only hidden, never released.
- Switch writes: allow-listed columns, CAS, audit; code switches (AUTO_QUOTE_SEND_ENABLED, CONSENT_COPY_EMAIL_APPROVED) read-only.
- TEST (qa_test) jobs and TEST partners are excluded from Money, Partners and Communications lists.
- Approvals, CII, notices, Mitti checks, rates, coverage, credentials all go through the existing guarded server functions.

## Other GAPs

- Browser walk (office-gaps): these pages were rendered from the real route components with fixture-backed server functions (no live backend) and screenshotted; that proves layout and states, not the server reads. Portal QA not run → NOT_RUN.
- Server reads in `office-money.server.ts`, `office-partners.server.ts`, `office-comms.server.ts` are not exercised against a
  database in tests (they use embedded joins the PGlite shim doesn't support); column names were checked against
  `src/integrations/supabase/types.ts`.
- The mock's separate "Customer emails" / "Customer texts" switches are one master switch in the code
  (`customer_comms_enabled`), shown as one row.
- "Payouts" amounts are ex GST from the accepted quote's agreed-rate cost; electrician PIESA from the business's agreed
  PIESA rate (inc GST ÷ 1.1), else the pricing setting.
