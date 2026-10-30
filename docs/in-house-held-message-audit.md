# I6 — held in-house visit-message audit

Scope: active installer assignment whose business has `in_house=true`, including TEST jobs. `pays_own_electricians` alone never holds. All new sender guards use `inHouseDispatchSkip`, which delegates to the shared paged, fail-closed reader. Suppression is before message preparation events, customer email reservations and provider calls, including TEST senders. No owner template, renderer wording, template rows, SQL, communication switches or published deployment changed.

## Outbound delivery inventory

| File:function (src/lib) | Audience | Channel / existing message | Disposition |
|---|---|---|---|
| install-clearance.server:notifyInstallerClearance; sweepInstallClearance | Installer | I65 email + SMS: cleared, offer owner 3 install days | **Suppressed** before clearance notice event; sweep does not count suppression as notified. Booking card covers held partner. |
| installer-planning-notice.server:notifyInstallerPlanning | Installer | I71 email + SMS: PIESA booked date, provisional install planning | **Suppressed** before preparation event. |
| thirty-day-rule.server:sendInstallWindowReminder; sweepThirtyDayRule | Owner + installer | 20-/10-day email + SMS: agree/pick install day before deadline | **Suppressed** all four deliveries, no reminder event; expiry and payer records unchanged. |
| ready-check-times-email.server:emailOwnerReadyCheckTimes | Owner | O11 email: choose an offered Ready Check time | **Suppressed** at direct sender, not just normal caller. |
| ready-check-booked-email.server:emailOwnerReadyCheckBooked | Owner | O12 email: booked/changed, Change time and installer offers new times | **Suppressed**, including not-sent preparation wrapper. |
| install-booked-email.server:emailOwnerInstallBooked | Owner | O35 email: booked, Change day | **Suppressed** before reads/records. |
| owner-email-triggers.server:onSafetyCheckTimesOffered | Owner | O26 email: pick electrician's offered times | **Already suppressed (Task 3)**. |
| owner-email-triggers.server:onSafetyCheckBooked | Owner | O26 booked email: confirmed time + install-offer/clock wording | **Suppressed** before fireOwnerEmailOnce. |
| owner-email-triggers.server:onInstallDaysOffered | Owner | O33 email: pick installer days / suggest days | **Suppressed** before fireOwnerEmailOnce. |
| owner-email-triggers.server:onInstallDayMoved; onInstallBookingRescheduled | Owner | O42 email: new day, Change day, installer offers other days | **Suppressed** downstream before event. |
| owner-email-triggers.server:onSafetyCheckPaid | Owner | O22 acceptance/receipt email: electrician offers times; installer offers 3 days | **Suppressed** whole mixed-content template rather than changing approved wording. Payment records/gates remain. |
| owner-email-triggers.server:onFixesQuoteIssued | Owner | O29 rectification quote: after rectification owner can book install | **Suppressed** whole mixed-content template; approval/payment still available in portal. |
| owner-template-send.server:sendOwnerTemplateEmail | Owner | Direct approved-owner-emails wrappers below | **Suppressed by purpose**: quote_accepted, safety_check_times, safety_check_booked, fixes_quote, install_days, install_day_changed; all other purposes unchanged. |
| approved-owner-emails.server:emailOwnerYoureIn | Owner | O22 offers-times next steps | **Suppressed** through purpose boundary; no template changes. |
| approved-owner-emails.server:emailOwnerSafetyCheckTimes; emailOwnerSafetyCheckBooked | Owner | O26 selection/booked, install clock coordination | **Suppressed** through purpose boundary, including direct calls. |
| approved-owner-emails.server:emailOwnerFixesQuote | Owner | O29 rectification approval/payment plus owner install booking | **Suppressed** through purpose boundary. |
| approved-owner-emails.server:emailOwnerInstallDays; emailOwnerInstallDayChanged | Owner | O33/O42 installation-day selection/change | **Suppressed** through purpose boundary. |
| approved-texts.server:textOwnerReadyCheckTimes | Owner | SMS: offered 3 times, tap to pick | **Suppressed** at entry. |
| approved-texts.server:textOwnerReadyCheckBooked | Owner | SMS: booked Ready Check, job details | **Suppressed** at public entry before not-sent recorder. |
| approved-texts.server:textOwnerSafetyCheckBooked | Owner | SMS: booked PIESA, job details | **Suppressed** at entry. |
| approved-texts.server:textOwnerVisitTomorrow | Owner | Ready Check / PIESA / install day-before SMS | **Suppressed** at entry for all three visit kinds. |
| approved-texts.server:textOwnerInstallMoved | Owner | SMS: install moved, details | **Suppressed** at entry. |
| approved-texts.server:sweepApprovedTexts | Owner | Independent catch-up of preceding texts | **Suppressed** by actual sender entries; held outcomes excluded from handled counts. |
| installer-texts.server:textInstallerOwnerSuggestedDays | Installer | SMS: owner suggested Ready Check days, pick one/set time | **Suppressed** before preparation event. |
| installer-texts.server:textTradeOwnerChangedVisit | Installer / electrician | SMS: owner changed visit, offer new days/times | **Suppressed** before preparation event for all visit kinds. |
| installer-texts.server:sweepInstallerTexts | Installer | Independent catch-up | **Suppressed** via guarded coordination entry; held outcomes not counted. |
| fixes-times-link.server:textFixesTimesLink | Electrician | SMS: pick 3–5 rectification times | **Suppressed** before link/event. Existing booking card covers held partner. |
| visit-new-times.server:notifyOwnerVisitNewTimes | Owner | O74 email + SMS: trade cancelled, choose new times/new times coming | **Suppressed** before history/event. |
| deposit-release-notice.server:sendDepositReleaseNotice | Owner | Email + SMS: released install day, arrange another | **Suppressed** notice only; payment/provisional booking logic unchanged. |
| install-no-access-notice.server:sendInstallNoAccessNotice; resendInstallNoAccessText; sweepInstallNoAccessTexts | Owner | Email/SMS: couldn't get in, choose new install day | **Suppressed** primary and independent resend before records/provider. |
| quiet-held-texts.server:sweepQuietHeldTexts | Owner / trade | Retry stored quiet-hours bodies bypassing original sender | **Suppressed** coordination types deposit_release, visit_new_times, install_no_access, install_clearance, fixes_times_link, ready_check_days_suggested before provider; commercial/evidence retries unchanged. |
| piesa-times-reminder.server:remindTradeToOfferTimes | Electrician | E14 email + SMS: offer 3 times | **Already suppressed (Task 3)** before records/provider. |
| allocation.server:sweepCoordination | Owner / trade / office | Ready Check/PIESA coordination reminder and record-only other kinds | **Already suppressed (Task 3)** canonical held state before reminder actions. |
| allocation.server:startPiesaAllocation; submitOwnerPiesaWindows; sweepRecOffers | Trade / owner | Offer/select PIESA windows, expire/refill/heal | **Already suppressed (Task 3/I3)**; held TEST jobs included; unheld TEST dispatch preserved. |
| auto-offer.server:autoOfferForJob; sweepAutoOffers | Trade | Ready Check / PIESA offers | **Already suppressed (Task 3/I3)**; no payee-only suppression. |
| ready-check-times.server:tellOwner; acceptOfferWithTimes | Owner / installer | Offered times email / acceptance | **Already suppressed (Task 3)**; direct email boundary now also protected. |
| piesa-times.server:offerSafetyCheckTimes; pilot.functions:proposeTime | Owner | appointment_proposals offered times → onSafetyCheckTimesOffered | **Already suppressed (Task 3)** at owner trigger. |
| install-days.server:installerOfferDays; book; changeInstallDay | Owner | appointment_proposals → O33 / O35 / O42; no separate transport | **Suppressed at downstream sender**, proposal/booking writers unchanged. |
| booking.server:confirmBooking | Owner / installer | PIESA booked/planning follow-ons | **Suppressed at downstream senders**, canonical booking/payment/PIESA/consent/ESC guards unchanged. |
| in-house-batch-email.server:sendInHousePartnerCallEmail | Owner | Partner will call to book Ready Check | **Not applicable to legacy coordination suppression**: intentional in-house handoff notice, already approved-only/idempotent; no edits. |
| installer-texts.server:textInstallerReadyCheckBooked; textInstallerInstallTomorrow | Installer | Recorded appointment/job/form readout, no offer/pick/propose request | **Not applicable**: factual booked-visit/form reminders do not ask owner/HIV to coordinate; unchanged. |
| install-attendance.server:onInstallBooked; sweepElectricianAttendance; declineAttendance; text | Electrician / installer | Required electrician-at-start safety attendance, confirm attendance / decline days | **Not applicable to replacing visit booking**: decision-327 compliance attendance for an already recorded install, not appointment selection; required attendance guards unchanged. Downstream owner changed-day email suppressed. |
| piesa-owner-confirm.server; piesa-fixes-confirm.server | Owner | Confirm completed PIESA / rectification facts, not visit times | **Not applicable**: mandatory evidence declarations; unchanged. |
| piesa-rules-notice.server; coes-check; swms-sign-text; piisa-autosend; install-day-confirm.server | Trade / office | Official safety/evidence/form notices | **Not applicable**: no time selection or owner/HIV visit arrangement; preserve safety delivery. |
| owner-email-triggers.server:sweepQuoteReminders; onFinalInvoiceDue; sweepFinalInvoices; sweepReviewRequests | Owner | Quote commercial reminder, final invoice, review | **Not applicable**: no visit-times coordination. |
| approved-texts.server:textOwnerQuoteReminder | Owner | Accept existing quote / rebate expiry | **Not applicable**: commercial reminder, unchanged. |
| approved-owner-emails.server:emailOwnerInstallComplete; emailOwnerFinalInvoice; emailOwnerCompletionPack; emailOwnerReviewRequest | Owner | Completion, invoice, documents, review | **Not applicable**: post-install/payment/evidence; unchanged. |
| installer-texts.server:textTeamMemberInvite; partner-email/account invites | Trade | Login/onboarding/invitation, no job-bound visit | **Not applicable**: no held job dispatch. Historic agreements/template catalogue remain unchanged. |
| rectification.server:sweepRectQuotes | Office | Recorded-only quote nudge, no delivery | **Not applicable**: no provider call. |
| rectification.server:sweepHeldRectWindows; releaseRectContacts; recordRectificationWindows; owner-fixes.server:bookPickedFixesTime | Owner / electrician | Window persistence/contact release/guarded booking, no message sender | **Not applicable as senders**: “held window” is owner selected time, not in-house holding. Booking progression remains intact. Owner UI time prompts suppressed separately. |
| src/routes/api/public/hooks/allocation-tick | All | Scheduled entry points above | Covered at actual sender boundaries, not blanket skipping tick. There is no src/lib/allocation-tick.ts, owner-install-times sender, or separate install-window server; install-window messages live in thirty-day-rule.server. |

## Portal prompt inventory

| File:surface | Existing assumption | Disposition |
|---|---|---|
| routes/_authenticated/field.$jobId:InstallerFlow NextPanel | Offer 3 install days / Ready Check times; answer/wait owner times | **Reworded** only with positively allowed member-checked in-house booking access: Book the install / Ready Check in the portal. Existing booking/readouts/payment/form panels retained. |
| same:FieldJobBody electrician NowPanel | Book PIESA / rectification with owner | **Reworded** to Book the PIESA / rectification in the portal when access positively allowed. |
| same:legacy InstallerReadyCheckTimesCard / A1ReadyCheckTimeCard / InstallerInstallDays / ElectricianPiesaTimesCard / FixesTimesCard | Legacy offer/pick/window controls | **Already suppressed by Task 4** when in-house access positively allowed; booked install stays read-only; denied/loading access retains legacy behavior. |
| components/trade/InHouseBookingCard | Four partner visit bookings | **Not applicable**: canonical in-house card retained with all normal blockers and current visits. |
| job-status.server/core:statusFactsFor/jobStatusLine; components/trade/job-status | Owner choosing times / office arranging; ask office reminder | **Reworded/suppressed** using canonical held facts only on scheduling stages; payment/evidence/booked states unchanged. |
| trade-view.server:tradeHome; installer-home.core:installerNext | My work offer times / reply to owner / office coordinating | **Reworded** scheduling rows to Book the visit in the portal, not by payer flag. |
| job-overview.server; nextstep.core | Derived next_action for authorized trade/owner/office overview | **Held-aware presentation**, no stored history/rule changes. |
| worker-links.functions:getWorkerJobView → routes/w.$token | Raw next_action heading asks trade to offer/arrange times | **Reworded** scheduling heading after token/business access validation; evidence and booked headings unchanged. |
| waiting.functions:getJobWaiting → components/portal/waiting:WhoHasTheBall | Propose date / arranging together / draft nudge | **Reworded** trade/office held scheduling banner; **suppressed** owner banner and generic scheduling nudge controls. |
| portal.functions:getJobScope → components/portal/requirements | Requirement scope nextAction can describe arranging visits | **Suppressed** presentation string for held visit-coordination text; underlying jobScope and progression untouched. |
| office-needs.server/core:needsCandidates | Legacy offer lapsed, booking overdue, select trade, rectification-times missing | **Suppressed** coordination candidates with canonical held/failed state; Task-6 stalls and real payment/evidence/owner declarations retained. |
| job-next-action.core:nextAction | Generic status waiting owner/HIV scheduling | **Reworded** held scheduling fallback only after substantive Needs-me candidates. |
| owner-myjob.server:resolveOwnerJob | Pick-times owner action card | **Suppressed** booking button/coordination sentence only, no new owner wording. |
| owner-link.functions:ownerBookingStateFn → my-job.$token:BookPickers/BookScreen | Pick/suggest/change PIESA/install times; waiting-for-offers prompts | **Suppressed** on held/failed state, recorded booked dates and repeat/payment controls retained. |
| owner-link.functions:ownerReadyCheckTimesFn → components/owner/OwnerReadyCheckTimes | Ready Check offer/take/suggest/change and waiting prompts | **Suppressed**; booked date readout retained. |
| owner-fixes.server:ownerFixesState → my-job.$token:FixesHomeCard/FixesScreen | Pick/wait rectification times | **Suppressed** coordination branches; quote approval/payment and booked date remain. |
| routes/_authenticated/owner.$jobId | PiesaTimesCard, install picker, owner change/booking CTA | **Suppressed/read-only** for held state from authorized overview; records/payment/documents retained. |
| next_action writers (workflow transition/STORED_NEXT_ACTION, allocation, ready-check-times, piesa-times, install-days, visit-events, requirements, payments, intake/pickup) | Persist historical domain next action | **Not changed**: display/read boundaries above adapt current held state without rewriting history or changing stage/payment guards. Gate 1/intake, decision 316 and workflow-decisions.ts untouched. |

Search evidence: requested sender families and terms offer 3 / install days / pick / choose a time / times / window / propose / next_action / send_sms / sendOwnerEmail / customer_email_sends were searched. Pure renderers, template catalogue/design rows and historic agreements are not independent senders and were not edited.

## Verification and limitations

- Test-first initial sender suite: 16 pass / 19 fail; presentation rule initially missing (0 pass / 1 fail / 1 error). Final sender matrix: 109 pass / 0 fail. Final presentation rules: 5 pass / 0 fail.
- Tests execute real sender bodies with canonical held reader, explicit local provider doubles, and fail-closed unknown imports. They cover held and failed read before event/provider, non-held and payee-only normal delivery, direct template entry, and clearance sweep. Requested isolated run also has a fetch-denial preload and scrubbed environment.
- Hosted multi-user journeys and real provider deliveries **NOT RUN**: forbidden by this request. No live SQL or publication. No claim of hosted end-to-end verification.
- Full isolated totals, every run, commit trace and changed files: `docs/in-house-i6-test-results.md`.
