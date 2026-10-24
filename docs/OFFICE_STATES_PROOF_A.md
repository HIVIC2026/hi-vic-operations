# Office build A — proof table (frame, O1 Needs me, O2 Job page, O3 Jobs, O4 Enquiries)

Branch `office-build-a` (from `installer-mitti-workflow` @ `9bf49321`, with build B and office-backend merged in).
Decisions 204/241 ("build for real; every element traces to a decision, rule or daily action"), 216, 218, 220, 224,
226, 227, 230, 233, 238, 239, 240, 245, 246. Audit: `docs/OFFICE_PORTAL_AUDIT_2026-10-24.md` Part 5/6.
Every built section carries a non-visible `data-why` attribute with the same source as the "why" column.

New pure-rule tests (all green, 28 tests):
**N1** `tests/name-address-tidy.test.ts` · **N2** `tests/office-filters.test.ts` · **N3** `tests/contact-history.test.ts` ·
**N4** `tests/office-jobs-piles.test.ts` · **N5** `tests/office-needs-me.test.ts` (also the Next action) ·
**N6** `tests/office-stage-cards.test.ts` · **N7** `tests/job-file-checklist.test.ts`.
Kept green: `tests/enquiry-piles-one-pile-practice-db.test.ts` (0218 one pile per job), `office-phase3`, `templates-hub`,
`quotes-to-check-layout`, `quote-decline`, `portal-qa-screen-rules.test.mjs`, plus every source test updated for the removals.

Server functions (all literal `createServerFn().middleware([requireSupabaseAuth]).inputValidator().handler()`, admin-checked):
`src/lib/office-screens.functions.ts` → `office-needs.server`, `office-job-page.server`, `office-lists.server`,
`office-actions.server`. Email rows/actions use the backend `src/lib/email-office.functions.ts`.

## Frame — every `/admin/*` page

| Element | Route / condition | Server fn | Test | Why |
|---|---|---|---|---|
| Top bar Needs me · Enquiries · Jobs · Partners · Money · More | `src/config/office-nav.ts` `OFFICE_HEADINGS`, `sectionFor` | — | `office-phase3`, `templates-hub` | 218, audit §5 |
| More: Communications · Templates · Settings · Test Centre · Sign out | `MORE_SECTIONS` → `/admin/communications`, `/admin/templates`, `/admin/settings` (build B), `/admin/test-centre` | — | `office-phase3` (OFFICE_TOOLS labels) | 218 |
| Search (job number, owner, address, phone) | `OfficeSearch` | `searchOffice` (existing) | — | daily lookup |
| Initials + sign out | `Initials`, `useOfficeSignOut` | — | — | frame |
| Phone bottom tabs (the five headings) | `OfficeTopBar` < md | — | — | 218 phone use |
| Old admin sidebar | removed from `AppShell` | — | `office-phase3` | audit removal 10 |
| Legacy routes | `/admin` → needs-me; `/admin/today`, `/admin/todo` → needs-me; `/admin/board` → jobs active (`tab=quotes` → `stage=quote`); `/admin/quotes` → stage quote; `/admin/operations` → enquiries/jobs; `/admin/enquiries?status=spot_saved` → stage choose_installer, `ineligible/removed` → closed | — | `todo-retired-7oct`, `portal-qa-screen-rules`, `admin-pipeline-visibility` | intact bookmarks |
| Staff sign-in lands on Needs me | `set-password-link.core` | — | `login.core`, `ffs-field-access.step36` | 218 home |

## O1 Needs me — `/admin/needs-me`

| Element | Route / condition | Server fn | Test | Why |
|---|---|---|---|---|
| Today / This week / Watch groups, one line per row, one button | `NEEDS_GROUPS`, `buildNeedsRows` | `getNeedsMePage` → `loadNeedsMePage` | N5 | 218 |
| Choose installer | spot saved, no installer offer | `gatherNeedsFacts` (`loadOffice` batched by id) | N5 | 49, 220 |
| Choose again | offer lapsed/declined (`tradeChoice`/`offerChoice no_taker`) or `auto_offer_returned_to_office` event (details kind/reason/misses; cleared by a newer offer of that kind) | `gatherNeedsFacts` | N5 | 220, 246 |
| Quotes to check | held/ready drafts and owner-declined quotes | `loadQuotesToCheck` (new `installer-quote-review.server.ts`, shared with the functions file) | N5, `quotes-to-check-layout`, `quote-decline` | 7, Jo 24 Oct |
| Sign consent (AP Part A/B) | consent awaiting office signature | consents read | N5 | 123 |
| VEEC Part A | form at AP step and `apPrerequisites` met | VEEC forms read | N5 | 119/120 |
| ESC window | ESC notice due/unsent within window | ESC notices read | N5 | 130 |
| Final check | job at `ap_review` | `loadOffice` | N5 | 104 |
| Payments not in Xero (Watch) | provisional deposits / payments recorded outside Xero (`jobPaymentView`) | `gatherNeedsFacts` | N5 | 139–144 |
| Send failed | `send-failed.core` classification of failed sends | send failures read | N5 | 170 |
| 10 days left | single install-window alert | 10-day flags | N5 | 2, Jo 24 Oct |
| Second no-access | second `install_no_access` event | events read | N5 | 214/215 |
| VEEC day 10 | owner Section 4 unsigned at day 10 | `veec-reminders` events | N5 | 169 |
| Lapsed window | 30-day window lapsed | `loadOffice` | N5 | 2 |
| Email change → Apply / Ignore | backend `openEmailItems().changes` (`email_change_request`, intent cancel/reschedule/contact_change/attachment) | `applyEmailChange`, `ignoreEmailChange`; reschedule opens `#stage-install` | N5 (`CHANGE_LINE`) | 245 |
| Match this email | backend `openEmailItems().unmatched` with guesses | `matchOutlookEmail({messageEventId, jobId|null})` | N5 (`emailRow`) | 247 |
| Email-change Cancel uses the decision-227 helper | `email-office.server.ts` cancel case → `cancelJobFully` | — | `tests/cancel-job-fully.test.ts` | 227 |
| Partner & system fold line | Mitti pickups to link, Mitti sync problems, quotes not drafted | existing mitti-pickups and sync caches | — | Mitti-first rule |
| Include TEST jobs toggle | `includeTest` | `getNeedsMePage` | — | practice isolation |
| Removed: dispatch switch "Office picks first / Automatic", "Send to all", numbers strip, "Later" | — | — | — | audit removal 3 |

## O2 Job page — `/admin/jobs/$jobId` (`?section=`, `?act=cancel`, hash `#stage-<key>`)

| Element | Route / condition | Server fn | Test | Why |
|---|---|---|---|---|
| Header: job number, owner, split address (street / suburb / postcode), source, permission, "Last heard from us" | `JobHeader` | `getOfficeJobPage` → `loadJobPage` | N3 (`lastHeardFromUs`) | 216, 218 |
| ONE Next panel, one button | `NextPanel` | `nextAction` (pure `job-next-action.core.ts`) | N5 | 218 |
| Six stage cards Enquiry · Ready Check · Quote · PIESA · Install · Final check, each opens its tools | `StageCards`, `StageWorkspace` | `buildStageCards` | N6 | 218 |
| Choose installer / Choose electrician (one; usual electrician pre-marked) | Ready Check / PIESA workspaces | existing guarded offer fns | — | 49, 157 |
| Declined quote → Reopen for Send | Quote workspace | `reopenDeclinedQuote` (existing) | `quote-decline` | Jo 24 Oct |
| Final check Approve (one job) | Final check workspace | `approveApJob` | `ap-flags` | 104 |
| Money card: one invoice, four steps, office-only margin line + breakdown; NO Record payment | `MoneyCard` | `getOfficeJobMoney` → `loadJobMoney` using `jobMargin`/`veecValueReceived` from `job-margin.core.ts` | `job-profit` | 139–144, 230, 240 |
| Sync from Xero, deposit-gate override with reason | `MoneyCard` | `syncInvoice`, `overrideDepositGate` (existing) | — | 152, 209 |
| Contact history (customer_email_sends + job_communications + sms_messages + messages), channel filter, "Waiting for" | `ContactHistory` | `loadJobPage` → `mergeContactHistory` | N3 | 216 |
| Log a call or note | `LogNoteDialog` | `logOfficeCallOrNote` → `recordCommunication` (office_log) + `office_waiting_for` | — | 216 |
| File list incl. area diagram, SWMS, PIESA, consent, VEEC | `FileList` | `fileChecklist` | N7 | 118, 123, 119 |
| More › Hold / Resume (dialog, reason, revisit date) | `HoldDialog` | `holdOfficeJob` → `applyHoldOrCancel` | — | 227 |
| More › Mark as test | `JobMoreMenu` | `markOfficeJobTest` | — | practice isolation |
| More › Cancel (reason, tell-them ticks off by default; releases install day + installer, stops reminders, keeps history) | `CancelDialog` | `cancelOfficeJob` → `cancelJobFully` (also releases the active expected install week) | `tests/cancel-job-fully.test.ts` (mocked DB) | 227 |
| More › Reopen (cancelled, ineligible or marked-as-test jobs; never Completed) | `JobMoreMenu` | `reopenOfficeJob` → `reopenJob` (`reopenPlan`) | N4 (`reopenPlan`), `cancel-job-fully` | 227 |
| More › Delete (TEST jobs only) | `JobMoreMenu` | existing `bulkJobAction` delete | — | test isolation |
| Removed: Invoice route select, Profit card VEEC price entry, Generate installer quotes, Internal pricing, Offer Ready Check booking, expected install week, installer intake review, JobRightNow/StageTracker/CompactJobStatus | — | — | `job-profit`, `office-page-safety`, `admin-record-reliability`, `daily-job-limit` | audit removals 1, 5, 6, 9, 10 |

## O3 Jobs — `/admin/jobs/active` (`?stage=`), `/admin/jobs/closed`

| Element | Route / condition | Server fn | Test | Why |
|---|---|---|---|---|
| Active / Closed tabs | `JobsScreen` | — | `office-phase3` | 218 |
| Six stages + Installers' own jobs | `jobsStage`, `JOBS_STAGES` | `getActiveJobsList` → `loadActiveJobsList` (statuses via batched `loadOffice` onlyIds ≤150) | N4 | 224, 239 |
| Three folded piles (New from installers, Mitti pickups to link, Mitti sync problems) | `JobsScreen` | existing fns | `installer-new-jobs` | 0218 one pile |
| Filter chips (insulation, size, last heard, source, region) | `ChipGroup`, `matchesChips` | — | N2 | 226 |
| Sortable columns, paging | `SortHead`, `sortRows`, `pageOf` | — | N2 | 226 |
| Actions › bulk Cancel (reason required) | `ActionsMenu`, `ReasonDialog` | `bulkCancelOfficeJobs` → `cancelJobFully` per job | — | 227 |
| Closed tab: All · Completed · Cancelled · Ineligible · Removed / test chips (All default, count = sum of the exclusive piles); per-row "Closed as", why closed, Reopen + reason on every row except Completed (rows that cannot be undone say "Stays closed" with the reason) | `ClosedJobs` | `getJobListPage` closed mode (`closedView: "all"`, page rows enriched by `closedRowFacts`), `reopenOfficeJob` | N4 (`closedWhy`, `reopenPlan`, `CLOSED_FILTERS`) | 227, O3 |

## O4 Enquiries — `/admin/enquiries`

| Element | Route / condition | Server fn | Test | Why |
|---|---|---|---|---|
| Two piles: Fix details · Waiting on owner | `ENQUIRY_PILES`, `enquiryPile` | `getEnquiriesList` → `loadEnquiriesList` | N4, `enquiry-piles-one-pile-practice-db` | 238, 239 |
| Inline fix with capitalisation tidy + address split, applied on save | `FixForm` | `saveEnquiryFixDetails` → `tidyEnquiryDetails`, `fixDetailsErrors` | N1 | 216 |
| Tidy/split also at intake | `enquiry.server.ts` (one-line address, no suburb; not installer-sourced) | — | N1 | 216 |
| Filters + priority rank (1 = hottest) | `rankByPriority` | — | N2 | 226 |
| "Waiting on" column | `waitingOnLine` | — | N4 | 238 |
| New enquiry (phone) | `NewEnquiryDialog` | `createEnquiry` (existing) | — | audit gap 5 |
| Actions › Cancel / Remove | `ActionsMenu` | `bulkCancelOfficeJobs`, existing remove | — | 227 |
| Removed: photo review pile on Enquiries, New/never-contacted pile, Quotes to check block, Quote approvals links, office tools strip | — | — | `quotes-to-check-layout` | audit removals 1, 8 |

## Audit top-10 removals

| # | Done | Where |
|---|---|---|
| 1 Pipeline board + Quote approvals | Yes | `/admin/board`, `/admin/quotes` redirect to Jobs; links gone; board no longer runs `sweepAuthorities`/`autoAdvancePipeline` on open |
| 2 Office booking forms / Arrange the visit | Office side yes (AppointmentPanel, office BookingPanel uses gone); one by-hand override kept in More ("Set a visit time by hand": Ready Check or PIESA by stage, `manualVisitKind`, reason required, `admin_booking_override` logged; `scheduling.test.ts`) | owner/field pages untouched (other agents) |
| 3 Dispatch switch, Send to all, Offer PIESA to approved, Offer to partner | Yes (office screens) | `choose-electrician.tsx` one REC; `AdminPartnerPanel` export removed |
| 4 50% deposit leftovers, 3-instalment card | Yes: `OfficeInstalmentPlanCard`, the `PaymentsPanel` deposit-request button and the owner `OwnerInstalmentPlanCard` removed | `office-page-safety` |
| 5 Offer Ready Check booking on the job page | Yes: `OfficeReadyCheckBooking`, the Settings "Owner Ready Check booking" switch and the `spot_saved_waiting` status removed | `office-page-safety`, `ready-check-chase`, `office-status` |
| 6 Installer intake review panel, facts card, InstallerFactsLine | Yes | components deleted |
| 7 Owner-signs-again switch / Compliance intro | Yes: switch already gone (build B); the separate post-install "Installer Declaration" row removed from the Activity 48 register (118a/119) | `office-page-safety` |
| 8 Today's brief, second Quotes to check / New from installers | Yes | `/admin/today` redirects; one copy each |
| 9 Expected install week, Partner & relationship, Invoice route select | Yes on the Job page | Team-ups / Partners overview = build B |
| 10 Dead code + retired status words | Yes: sidebar, JobRightNow/StageTracker, ManualCommunicationActions, EscInstallPanel, Internal pricing, `job-wording.ts` words | — |

## GAPs (honest)

1. ~~Ready Check manual time override~~ CLOSED (office-gaps): "Set a visit time by hand" sets the Ready Check at the Ready Check stages and the PIESA at the PIESA stages (`manualVisitKind`); admin only, reason required, `admin_booking_override` logged; a Ready Check override also starts the Mitti form. Nothing is sent (phone booking).
2. ~~No cancelJobFully proof~~ CLOSED (office-gaps): `tests/cancel-job-fully.test.ts` (mocked DB) proves stage → cancelled with prior stage kept, future bookings incl. the held install day cancelled, day offers superseded, trade offers withdrawn, assignments ended, unsent ESC notices cancelled, expected install week released, nothing deleted, nothing sent, reopen restores the stage. Not proven: that every individual reminder sweep skips cancelled jobs (they key on stage; not re-tested here).
3. Cancel / Hold "tell them" ticks are recorded as `cancel_notice_requested` only; nothing is sent (`CANCEL_HOLD_NOTICE_WORDING_APPROVED=false`, wording unapproved).
4. ~~Closed All chip / Reopen~~ CLOSED (office-gaps): "All" chip (default) + Reopen on every closed reason except Completed. Still not reopenable (by design, shown as "Stays closed"): leads removed as duplicate/junk (the list view's `removed` flag is EXISTS `lead_removed`, permanent without a view change), second contacts (contact_rank > 1), and jobs born as TEST or marked as test before `prior_source` was recorded. Closed only by an old photo review "over R2.0" outcome (no stage/eligibility change) also stays closed.
5. ~~spot_saved_waiting + Settings switch~~ CLOSED (office-gaps). NOTE: `workflow_settings.ready_check_booking_enabled` still gates the owner taking an installer's Ready Check time (`assertOwnerReadyCheckBooking`, which ALSO needs a per-job `ready_check_booking_offered_at` that only the removed office "Offer" button set), the 24h Ready Check offer sweep and automatic installer offers. With the switch and the offer button gone there is no office control for either flag — needs a decision (see report).
6. ~~Deposit-request button / owner instalment card~~ CLOSED (office-gaps).
7. ~~Owner-signs-again switch / Compliance intro~~ CLOSED (office-gaps): switch already gone; Activity 48 register no longer lists the separate post-install Installer Declaration. The `installer_declaration` compliance template key stays: it holds the PIISA Part 8 wording.
8. "Opened" email tracking is not shown in the Waiting-on line; the usual electrician is not named on the Needs me row.
9. The 0218 SQL (`office_enquiry_page`) was not changed; the two new piles are computed in TS. The old practice-DB one-pile test stays green, but the new piles have only the pure N4 proof.
10. ~~Coverage link~~ CLOSED (office-gaps): the job page's Trade coverage link opens Partners › Coverage; Settings page grouping is build B's.
11. Browser walk (office-gaps, 24 Oct): every O1–O7 screen/tab/state was rendered in headless Chromium from the real route components with fixture-backed server functions (no live backend); 86 screenshots and an honest per-screen INDEX were handed back with the office-gaps report. Not an E2E run against data: server reads/writes are proven only by the unit / mocked-DB tests. `bun run portal-qa` remains NOT_RUN.
12. Log a call or note, Hold, Mark as test and New enquiry (phone) have no dedicated tests (they reuse existing guarded writers).
