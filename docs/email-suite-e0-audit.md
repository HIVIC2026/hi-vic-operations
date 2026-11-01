# E0 — email path and presentation audit

## Scope and findings

Source-only audit. No sends, settings, secrets, live records, database changes or publishing.
All application-built outgoing messages now use `mail-mjml.core.ts` → `mjml-lite.core.ts`. Transport helpers still accept rendered HTML; guards below cover current builders/call sites, not arbitrary future external HTML.
The hot-leads example was already migrated: it calls `jo-outcome-email.core.ts` → MJML; `jo-email-templates.core.ts` supplies routing/wording metadata, not the outgoing HTML.
Provider-managed invitations, password reset and email sign-in are outside the application renderer. They remain unchanged because this task forbids settings changes.

## Changed paths → old builder → new layout

| Path / message | Previous builder | Approved presentation |
|---|---|---|
| `in-house-batch-email.server::sendInHousePartnerCall` (owner) | `email-kit::emailShell/p` | Suite generic, existing approved stored wording |
| `hot-leads-send::sendMorePhotosRequest` edited-body branch | `enquiry-review-custom::customReviewMail` minimal HTML | Suite generic; exact edited text/upload button |
| `deposit-request.server` request, day3, day7, receipt (owner) | `deposit-request-email` old kit | Suite generic (no matching deposit design) |
| `deposit-request.server::notifyInstallerDepositPaid` | `deposit-request-email` old kit | Suite generic (no matching installer receipt design) |
| `mitti-retry.server` → `sendMittiFailureAlert` | `mitti-retry.core::alertEmail` raw paragraphs | Suite generic, existing content and job link |
| `esc-robot-alert.server::sendRobotFailureAlert` | `esc-robot-alert.core::robotAlertContent` raw paragraphs | Suite generic, existing content and job link |
| `jo-tradie.server` practice welcome/job/booked/reminder/clear messages | `simple-email` old shell | Suite generic; compatibility function preserved |
| `spot-saved-send.server::sendEmail` missing-HTML fallback | raw `<pre>` | Suite generic; existing text |
| `launch-campaign.server::queueSpotSavedConfirmations` TEST fallback | raw `<pre>` | Suite generic; existing text |
| `quote-ready-notify.server::notifyOwnerQuoteReady` dormant database-template fallback | raw `body_markdown` as HTML | Suite generic, existing trusted body markup and text; current O18 branch unchanged |

No matching named designs: in-house partner-call, edited photo-request copy, all four owner deposit steps, installer deposit-paid notice, Mitti failure, Registry failure, TEST utility variants, missing-HTML fallback and dormant database quote copy. Existing generic uses (booking notices/digests, crew reminder, CoES, AI/manual replies and PIESA-rule notices) already reach MJML and were left unchanged.

## All registered messages (unchanged unless listed above)

Paths below are relative to `src/lib/`. Each named design is the existing live renderer assembly, not sample copy substituted into a message.

| Message | Send path | Existing builder | Approved design / new layout |
|---|---|---|
| owner:O1 | `followups.server.ts` | `jo-outcome-email.core.ts::renderJoOutcomeEmail` | owner_O1.mjml |
| owner:O2-some | `hot-leads-send.server.ts` | `jo-outcome-email.core.ts::renderJoOutcomeEmail` | owner_O2-some.mjml |
| owner:O2-dont-know | `hot-leads-send.server.ts` | `jo-outcome-email.core.ts::renderJoOutcomeEmail` | owner_O2-dont-know.mjml |
| owner:O2-questions | `three-questions-reminder.server.ts` | `jo-outcome-email.core.ts::renderJoOutcomeEmail` | owner_O2-questions.mjml |
| owner:O6 | `enquiry-groups.server.ts` | `jo-outcome-email.core.ts::renderJoOutcomeEmail` | owner_O6.mjml |
| owner:O7 | `coverage.functions.ts` | `coverage-email.ts::renderCoverageUnavailableEmail` | owner_O7.mjml |
| owner:estimate-unopened | `followups.server.ts` | `followup-email.ts::renderFollowupEmail` | owner_estimate-unopened.mjml |
| owner:O66 | `estimate-followup.server.ts` | `estimate-followup.core.ts::renderEstimateFollowupEmail` | owner_O66.mjml |
| owner:O67 | `estimate-followup.server.ts` | `estimate-followup.core.ts::renderEstimateFollowupEmail` | owner_O67.mjml |
| owner:O68 | `estimate-followup.server.ts` | `estimate-followup.core.ts::renderEstimateFollowupEmail` | owner_O68.mjml |
| owner:O70 | `new-sender-reply.server.ts` | `new-sender-reply-email.core.ts::renderNewSenderReplyEmail` | owner_O70.mjml |
| owner:O10 | `spot-saved-send.server.ts` | `spot-saved-messages.core.ts::renderSpotSavedEmail` | owner_O10.mjml |
| owner:O11 | `ready-check-times-email.server.ts` | `ready-check-times-email.core.ts::renderReadyCheckTimesEmail` | owner_O11.mjml |
| owner:O12 | `ready-check-booked-email.server.ts` | `ready-check-booked-email.core.ts::renderReadyCheckBookedEmail` | owner_O12.mjml |
| owner:O18 | `quote-ready-notify.server.ts` | `owner-quote-email.core.ts::renderOwnerQuoteEmail` | owner_O18.mjml |
| owner:O19 | `approved-owner-emails.server.ts` | `owner-quote-email.core.ts::renderQuoteReminderEmail` | owner_O19.mjml |
| owner:O22 | `approved-owner-emails.server.ts` | `acceptance-email.core.ts::renderYoureInEmail` | owner_O22.mjml |
| owner:O26 | `approved-owner-emails.server.ts` | `safety-check-emails.core.ts::renderSafetyCheckTimesEmail` | owner_O26.mjml |
| owner:safety-check-booked | `approved-owner-emails.server.ts` | `safety-check-emails.core.ts::renderSafetyCheckBookedEmail` | owner_safety-check-booked.mjml |
| owner:O28 | `piesa-delivery.server.ts` | `piesa-delivery.core.ts::renderPiesaCopyEmail` | owner_O28.mjml |
| owner:install-window | `thirty-day-rule.server.ts` | `thirty-day-rule.core.ts::ownerInstallWindowEmail` | owner_install-window.mjml |
| owner:O29 | `approved-owner-emails.server.ts` | `rectification-quote-email.core.ts::renderFixesQuoteEmail` | owner_O29.mjml |
| owner:fixes-confirm | `piesa-fixes-confirm-send.server.ts` | `piesa-fixes-confirm-email.core.ts::renderPiesaFixesConfirmEmail` | owner_fixes-confirm.mjml |
| owner:install-deposit-request | `deposit-request.server.ts` | `deposit-request-email.core.ts::renderInstallDepositOwnerEmail` | Suite generic / existing MJML assembly |
| owner:install-deposit-day3 | `deposit-request.server.ts` | `deposit-request-email.core.ts::renderInstallDepositOwnerEmail` | Suite generic / existing MJML assembly |
| owner:install-deposit-day7 | `deposit-request.server.ts` | `deposit-request-email.core.ts::renderInstallDepositOwnerEmail` | Suite generic / existing MJML assembly |
| owner:install-deposit-paid | `deposit-request.server.ts` | `deposit-request-email.core.ts::renderInstallDepositOwnerEmail` | Suite generic / existing MJML assembly |
| owner:O33 | `approved-owner-emails.server.ts` | `install-days-email.core.ts::renderInstallDaysEmail` | owner_O33.mjml |
| owner:O35 | `install-booked-email.server.ts` | `install-booked-email.core.ts::renderInstallBookedEmail` | owner_O35.mjml |
| owner:O63 | `consent-copy-email.server.ts` | `consent-copy-email.core.ts::renderConsentCopyEmail` | owner_O63.mjml |
| owner:O42 | `approved-owner-emails.server.ts` | `install-days-email.core.ts::renderInstallDayChangedEmail` | owner_O42.mjml |
| owner:O64 | `deposit-release-notice.server.ts` | `deposit-release-notice.core.ts::renderDepositReleasedEmail` | owner_O64.mjml |
| owner:O65 | `install-no-access-notice.server.ts` | `install-no-access-notice.core.ts::renderInstallNoAccessEmail` | owner_O65.mjml |
| owner:O44 | `approved-owner-emails.server.ts` | `completion-emails.core.ts::renderInstallCompleteEmail` | owner_O44.mjml |
| owner:O61 | `veec-reminders.server.ts` | `veec-emails.core.ts::renderVeecReminderEmail` | owner_O61.mjml |
| owner:O62 | `veec-copy-email.server.ts` | `veec-emails.core.ts::renderVeecCopyEmail` | owner_O62.mjml |
| owner:O47 | `approved-owner-emails.server.ts` | `completion-emails.core.ts::renderCompletionPackEmail` | owner_O47.mjml |
| owner:O73 | `warranty-followup.server.ts` | `warranty-followup.core.ts::renderWarrantyFollowupEmail` | owner_O73.mjml |
| owner:O51 | `approved-owner-emails.server.ts` | `completion-emails.core.ts::renderReviewRequestEmail` | owner_O51.mjml |
| owner:change-reply | `email-change-reply.server.ts` | `email-change-reply.core.ts::renderChangeReplyEmail` | owner_change-reply.mjml |
| owner:O69 | `cancel-notice.server.ts` | `cancel-notice.core.ts::renderOwnerCancelledEmail` | owner_O69.mjml |
| owner:O74 | `visit-new-times.server.ts` | `visit-new-times.core.ts::renderVisitNewTimesEmail` | owner_O74.mjml |
| owner:O74b | `visit-new-times.server.ts` | `visit-new-times.core.ts::renderVisitNewTimesEmail` | owner_O74b.mjml |
| owner:O75 | `paperwork-copy-email.server.ts` | `paperwork-copy-email.core.ts::renderPaperworkCopyEmail` | owner_O75.mjml |
| owner:signing-code | `owner-code-delivery.server.ts` | `owner-code-delivery.core.ts::ownerCodeEmail` | owner_signing-code.mjml |
| owner:O77 | `spot-release.server.ts` | `spot-release-email.core.ts::renderSpotReleasedEmail` | owner_O77.mjml |
| owner:O78 | `quote-expired-email.server.ts` | `quote-expired-email.core.ts::renderQuoteExpiredEmail` | owner_O78.mjml |
| owner:address-request | `address-request.server.ts` | `address-request-email.core.ts::renderAddressRequestEmail` | Suite generic / existing MJML assembly |
| owner:address-request-reminder | `address-request.server.ts` | `address-request-email.core.ts::renderAddressRequestEmail` | Suite generic / existing MJML assembly |
| installer:I53 | `trade-messages.server.ts` | `application-review.core.ts::renderApplicationReceivedEmail` | installer_I53.mjml |
| installer:changes | `application-review.server.ts` | `application-review.core.ts::changesEmail` | installer_changes.mjml |
| installer:decline | `application-review.server.ts` | `application-review.core.ts::declineEmail` | installer_decline.mjml |
| installer:I54 | `partner-activation.functions.ts` | `partner-email.core.ts::partnerWelcomeEmail` | installer_I54.mjml |
| installer:I60 | `esc-collection-notice-send.server.ts` | `esc-collection-notice.core.ts::noticeLinkEmail` | installer_I60.mjml |
| installer:I62 | `esc-collection-notice-send.server.ts` | `esc-collection-notice.core.ts::collectionNoticeEmail` | installer_I62.mjml |
| installer:mitti-invite | `mitti-invite.server.ts` | `mitti-invite.core.ts::renderMittiInviteEmail` | installer_mitti-invite.mjml |
| installer:job-offer | `ready-check-offer-text.server.ts` | `ready-check-offer-email.core.ts::renderReadyCheckOfferEmail` | installer_job-offer.mjml |
| installer:I23 | `installer-accepted-email.server.ts` | `installer-accepted-email.core.ts::renderInstallerAcceptedEmail` | installer_I23.mjml |
| installer:I24 | `installer-declined-email.server.ts` | `installer-accepted-email.core.ts::renderInstallerDeclinedEmail` | installer_I24.mjml |
| installer:I71 | `installer-planning-notice.server.ts` | `installer-planning-notice.core.ts::renderInstallerPlanningEmail` | installer_I71.mjml |
| installer:piesa-copy | `piesa-delivery.server.ts` | `piesa-delivery.core.ts::renderPiesaCopyEmail` | installer_piesa-copy.mjml |
| installer:I65 | `install-clearance.server.ts` | `install-clearance.core.ts::renderInstallClearanceEmail` | installer_I65.mjml |
| installer:install-window | `thirty-day-rule.server.ts` | `thirty-day-rule.core.ts::installerInstallWindowEmail` | installer_install-window.mjml |
| installer:install-deposit-paid | `deposit-request.server.ts` | `deposit-request-email.core.ts::renderInstallerDepositPaidEmail` | Suite generic / existing MJML assembly |
| installer:I70 | `cancel-notice.server.ts` | `cancel-notice.core.ts::renderInstallerCancelledEmail` | installer_I70.mjml |
| electrician:invite | `job-electrician-invite.server.ts` | `job-electrician.core.ts::electricianInviteEmail` | electrician_invite.mjml |
| electrician:E13 | `partner-activation.functions.ts` | `partner-email.core.ts::partnerWelcomeEmail` | electrician_E13.mjml |
| electrician:E1 | `trade-messages.server.ts` | `electrician-offer-email.core.ts::renderElectricianOfferEmail` | electrician_E1.mjml |
| electrician:E14 | `piesa-times-reminder.server.ts` | `piesa-times-reminder.core.ts::renderPiesaTimesReminderEmail` | electrician_E14.mjml |
| electrician:piesa-copy | `electrician-piesa-copy.server.ts` | `electrician-piesa-copy.core.ts::renderElectricianPiesaEmail` | electrician_piesa-copy.mjml |
| electrician:piesa-rules | `piesa-rules-notice.server.ts` | `piesa-rules-notice.core.ts::renderPiesaRulesEmail` | Suite generic / existing MJML assembly |
| office:typed-message | `partner-activation.functions.ts` | `office-email.core.ts::officeEmailCopy` | office_typed-message.mjml |
| installer:trade-invite | `trade-access.functions.ts` | `trade-access.core.ts::renderTradeInviteEmail` | waiting_trade-invite.mjml (preview only; actual Auth send below) |
| owner:O76a | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76a.mjml |
| owner:O76b | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76b.mjml |
| owner:O76c | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76c.mjml |
| owner:O76d | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76d.mjml |
| owner:O76e | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76e.mjml |
| owner:O76f | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76f.mjml |
| owner:O76g | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76g.mjml |
| owner:O76h | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76h.mjml |
| owner:O76i | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76i.mjml |
| owner:O76j | `owner-email-auto-reply.server.ts` | `owner-email-auto-reply.core.ts::renderOwnerAutoReplyEmail` | waiting_O76j.mjml |

## Additional sends, delegated entry points and exceptions

| Path | Builder / delegate | Status |
|---|---|---|
| `office-first-response.server::sendOfficeFirstResponse` | Current Jo outcome preparation | Already MJML |
| `verified-ineligible-email.server` retry/send | `followups::renderPreliminaryIneligibleMail` → Jo outcome | Already O6 |
| `three-questions-reminder.server` | Jo outcome | Already O2 questions |
| `email-preliminary-offer.server::savePreliminarySpot` | Shared Spot saved builder/sender | Already O10 |
| `quick-taps.server::finishDecline` | `quick-taps-email::renderQuickTapsDeclineEmail` | Already MJML |
| `coes-owner-copy.server::sendCoesOwnerCopy` | Direct `mjEmail` assembly | Already suite generic |
| `piesa-owner-confirm-send.server` | Delegates current PIESA copy/declaration delivery | Existing merged O28/O71 path |
| `crew-reminder.server::sweepCrewReminders` | `crew-reminder` → `partnerEmailLayout` | Already suite generic |
| `in-house-booking.server::notifyOwnerBooked` | `bookingNotice` → `partnerEmailLayout` | Already suite generic, owner booking |
| `in-house-booking-notices::sweepInHouseInstallOfficeEmails` | `partnerEmailLayout` | Already suite generic, office-only digest |
| `in-house-booking-notices::notifyOfficeOwnerCancelled` | `partnerEmailLayout` → office alert | Already suite generic |
| `test-approval.server::sendTestWelcome` | `partnerWelcomeEmail` | Already I54/E13 |
| `ai-email-reply.server::sendAiDraft` / `ai-auto-send.server` | `aiReplyEmailHtml` | Already MJML, exact composed text |
| `emails-tab.server::sendNoJobEmailReply` and follow-up | `aiReplyEmailHtml` → Outlook | Already MJML |
| `email-reply.server` | `composeReply` | Draft-only; never sends. Unchanged |
| `trade-access.functions` invitation | Managed Auth mail | NOT MIGRATED: settings prohibited |
| `SignInCard.tsx` OTP/reset and `reset-password.tsx` reset | Managed Auth mail | NOT MIGRATED: settings prohibited |

## Delivery boundaries

`sendGuardedOwnerEmail`, `sendOwnerTemplateEmail`, `resendSend`/`resendDeliveryAdapter`, `sendOfficeEmail`, `sendTestEmail`, `sendViaOutlook`, `configuredDeliveryAdapter`/`bridgeAdapter`, `sendMittiFailureAlert`, `sendRobotFailureAlert`, `sendInHouseOfficeAlert`. These retain the same recipients, approval/consent/TEST/quiet-hour guards, attachments, reservation keys, retries and transport behaviour. No universal HTML rewriting at transport boundaries.

## Retirement

`email-kit.core.ts` retains copy constants, number formatting, text rendering and attachment types; unused HTML shell/cards/buttons retired. `simpleEmail` keeps its caller API but delegates layout to the suite. `jo-email-templates.core.ts` retained because canonical routing and wording still use it.

## Results

Four new E0 checks pass, including 84 registered email entries, migrated generic messages, source graph reachability and retired-builder import prohibition. The existing simple-email snapshot test was deliberately changed: it pinned the retired shell; existing message text and button destination remain asserted.

Comparable full isolated run, with identical exclusions for register-interest-validation and save-spot-uncertain-delivery:
- Before: 987 files, 9,985 passing tests / 243 failures, 98 failing files.
- After plus final individual rechecks: 988 files, 9,989 passing tests / 243 failures, 98 failing files.
- No original file lost passes or gained failures; only the four added passing tests changed totals.
- Requested historical 97/243 was not reproduced: current before-run already has 98 failing files. No claim of matching 97 files.
- Initial baseline staging omitted SQL/config/report fixtures; those comparison results were discarded. Complete fixtures and generous individual rechecks confirm the final numbers above.
- Targeted sender checks: 19/0 (quote TEST routing, in-house call, Mitti-office alert); Registry alert 11/0, deposit server 9/0, campaign 8/0, Spot saved 18/0.
- 78 approved MJML designs compile; retired-term scan has zero customer-visible failures; automatic checks show build OK.
- Nine migrated fixture samples preserve subject/plain text/preview and ordered button/link labels and destinations exactly. Existing 84-entry comparison changed only the five deposit layouts; other registered layouts unchanged.

No sends or live delivery verification. No settings, secrets, live records, database changes, migrations or publishing. Provider-managed Auth mail remains outside scope; TEST banner, unsubscribe substitution and tracking pixel remain existing post-render decorations.

## Changed files
- `src/lib/mail-mjml.core.ts`
- `src/lib/email-kit.core.ts`
- `src/lib/simple-email.core.ts`
- `src/lib/in-house-batch-email.server.ts`
- `src/lib/deposit-request-email.core.ts`
- `src/lib/enquiry-review-custom.core.ts`
- `src/lib/mitti-retry.core.ts`
- `src/lib/esc-robot-alert.core.ts`
- `src/lib/spot-saved-send.server.ts`
- `src/lib/launch-campaign.server.ts`
- `src/lib/quote-ready-notify.server.ts`
- `tests/email-suite-e0.test.ts`
- `tests/simple-email.test.ts`
- `src/lib/AGENTS.md`
- `roadmap.md`
- `docs/email-suite-e0-audit.md`
