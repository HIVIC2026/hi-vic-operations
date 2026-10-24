# Installer screens — every approved state, proven against the code

Jo approved the seven installer screens and every state (decisions 194–237, 24 Oct 2026). Decision 204: "make sure it actually all works" — every screen driven by real data and real actions. Decision 241: every button, panel and piece of information must be needed; anything that cannot be justified is removed.

This file maps **each approved state** (`docs/templates/approved/installer-redesign/*.html` and `states/*.html`) to the route and condition that renders it, the server function(s) each button calls (all business-scoped through `trade-view.server.ts`; no customer prices), the pure state → view rule and its unit test, and **why each element exists**. A state that is not yet backed by real data or a real action is marked **GAP** with what is missing — nothing is faked.

Pure rules: `src/lib/installer-home.core.ts` (M1), `src/lib/installer-screens.core.ts` (M2/M4/M5/M6), `src/lib/trade-view.core.ts` (M7), `src/lib/add-job-flow.core.ts` (M3). Tests: `tests/installer-states.test.ts` (every state below), plus the older `tests/installer-screens.core.test.ts`, `tests/installer-home.test.ts`, `tests/add-job-flow.test.ts`, `tests/trade-view.test.ts`.

Legend for **Why it exists**: *D nnn* = Jo decision number; *rule* = a domain rule in `AGENTS.md` / `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md`; *daily* = an action the installer takes most days.

## M1 · My work (`/field`, `field.index.tsx`, read `getTradeHome` → `tradeHome`)

| State | Condition that renders it | Server function(s) each button calls | Pure rule → test | Why it exists |
|---|---|---|---|---|
| M1 base | installer, ≥1 open offer / jobs | View offer → `/field/offer/$id`; rows → `/field/$jobId`, `/field/day/$jobId`; This month → `/field/money` | `installerHomeGroups`, `installerNext`, `offerPanelWords`, `monthStripWords` → `installer-home.test.ts` | D 194 (approved M1); groups D 36/41/48; exact times D 43; strip = pay actually PAID D 208 |
| M1-empty | `homeIsEmpty(...)` true (no offers, bookings, jobs) | "Add a job" → `/partner/import` | `HOME_EMPTY`, `homeIsEmpty`, `monthStripWords({jobs:0})` → `installer-states.test.ts` "M1 states" | D 235 (new installer sees where work will appear); the one button = daily entry for own customers D 34 |
| M1-more-offers | ≥2 open offers and the installer taps "More offers · N" (`offersOpen`) | rows → `/field/offer/$id`; "Hide the other offers" folds back | `offersListView` → "M1 states" | D 235; wording D 201 ("Owner says ~N m²" / "No size yet"); 24-hour note D 49/51 |

Elements on M1 and why: greeting + "N jobs booked this week" (D 194, orientation); one blue offer panel (D 49–52: one installer, 24 h); Coming up with exact times (D 43); Action needed / In progress / Done (D 36/41, one pile per job); source label (D 48); This month strip, business owner only (D 208, pay paid this month). Electrician view in the same file is unchanged (not an installer screen).

## M2 · Job page (`/field/$jobId`, `field.$jobId.tsx`, read `getTradeJobPage` → `tradeJobPage`; one Next panel from `jobNext`)

| State | Condition (`jobNext` facts from `tradeJobPage`) | Server function(s) each button calls | Pure rule → test | Why it exists |
|---|---|---|---|---|
| M2 base (cleared → offer 3 install days) | `installTurn === "installer_to_offer"` (install-days.core via `useInstallerInstallDays`) | day grid + times → `offerInstallDays` (install-days.functions, `InstallerInstallDays`) | `jobNext` → `installer-screens.core.test.ts` | D 198; install days D 1/19/43/163/186; 30-day line D 23/137 |
| M2-own-before-ready-check | `channel = installer_sourced`, form linked, not completed, no booking → panel `ready_check_set_time` | "Save the day and time" → `setA1ReadyCheckTimeFn` → `tradeSetReadyCheckTime` (confirmBooking + Mitti form, nothing to owner); Ready Check group "Open Mitti form" → Mitti link | `jobNext` own-customer branch, `quoteStatusRow(null,{formLinked})` → "M2 states" | D 110/116 (installer arranges own visit); D 115 (form ready at Add a job); "Prepared once you press Complete" D 24 Oct no-approval rule |
| M2-needs-finishing | `form.needsFinishingItems` non-empty (from `jobs.next_action` "Needs finishing: …", `needsFinishingList`) | "Open Mitti form" → Mitti link; nothing else (the fix happens in Mitti) | `needsFinishingList`, `jobNext` → "M2 states" | Ready Check basics rule (`ready-check-basics.core`, D 24 Oct "Quotes to check"); one list, one button D 36/41 |
| M2-quote-sent | `quote.line === QUOTE_SENT_LINE` (installer-quote-status) | none (nothing for the installer) | `quoteNextWords`, `quoteStatusRow` sent → "M2 states" | D 24 Oct: installer sees read-only quote status; dates only when recorded (`quotes.sent_at`) |
| M2-quote-held | `quote.line === QUOTE_HELD_LINE` | none | `quoteNextWords` held → "M2 states" | same; "You pressed Complete on …" from the latest `ready_check_basics` event with `completed=true` |
| M2-quote-declined | `quote.line === QUOTE_DECLINED_LINE` | none; pay row hidden (no install) | `quoteNextWords` declined, `quoteStatusRow` declined → "M2 states" | same; declined date = `quote_declined` event |
| M2-piesa-booked | `piesa.bookedAt` (confirmed `assessment` booking) and not yet cleared | none; Electrician row names the electrician + time | `jobNext` PIESA branch, `electricianRow` → "M2 states" | D 27/157 (office-arranged electrician), D 186 (nothing for the installer until clearance) |
| M2-install-booked | `installTurn === "booked"` | "Change day" → `changeInstallDay` (`InstallerInstallDays`); "Today's job" → `/field/day/$jobId`; owner line read by `tradeJobPage` → `ownerReadyFacts` (no button) | `jobNext` install_booked, `ownerReadyLine` → "M2 states" | D 43/97/98 (exact time), D 19 (change day), 30-day line D 23; owner line D 251 |
| M2-sign-rebate-form | `install.form.complete` (signed `installer_declarations`), not yet `rebateSigned` | "The install is finished" → `completeInstallation` (idempotent `recordInstallationComplete`, fallback to D 213 auto-record); then `InstallerFinalDeclaration` → `signFinalAssignmentFn` (Section 3 Part B) | `jobNext` sign_rebate, `signRebateChecks`, `installRow` → "M2 states" | D 196/213 (nothing about the rebate form until Mitti Complete), D 119/120 (lead installer declares completed facts) |
| M2-complete | `job.stage === "complete"` | "See it in Money" → `/field/money/$jobId` | `completeView` → "M2 states" | D 234; `contactVisible` rule hides owner contact once every visit is done; paperwork from `customer_assignments` + `installer_declarations` only |
| M2-change-allocation | business owner taps Change/Choose in "Who's doing this" | `getVisitAllocation` → `visitAllocationView`; "Allocate to X" → `allocateVisitFn` → `allocateVisit` (append-only `visit_allocated`, Mitti hand-over) | `allocationSheet` → "M2 states" | D 161 (owner runs own crew), D 153 (install days only CII-cleared) |

Other M2 elements and why: back + heading street/suburb (D 36); Call/Text/Directions (D 36; trades get contact on acceptance via `contact_releases`); Quote group Status (D 24 Oct read-only status) + "Your pay for this job" + pay note (D 25/30: own pay only, never the owner price) + "See the owner's quote" on the installer's OWN customers only (`OwnerQuoteCard`, Jo 24 Oct: installer sees the owner quote on their own jobs; on our leads it renders nothing); Ready Check group Visit / Mitti form / Open Mitti form (D 198; Mitti hidden until `mitti_account_invited`); Who's doing this (D 161); Messages with three quick replies (D 36/40); "More · staff job links" (D 39).

**Removed from M2 under decision 241:** the legacy Mitti sync card (`MittiCard`) that rendered inside the Ready Check group when the form was not yet linked (office-style sync detail, not on any approved M2 state), and the second "missing in Mitti" list (`MittiMissingInfo`) under the Ready Check group (duplicated the Next panel's list; the approved state shows the count row only).

**CLOSED (M2-install-booked, decision 251):** the Next panel shows "Consent signed ✓ · 10% deposit paid ✓", or which part is still outstanding ("Consent not signed yet" / "10% deposit not paid yet"). `tradeJobPage` (after `requireTradeJob`, so business-scoped) calls `ownerReadyFacts` only while the install booking is confirmed: consent = the current `owner_esc_consents` row (not stale/cancelled) has `owner_signed_at`; deposit = the `install_deposit` step from `jobPaymentView` (ledger `owner_payment_recorded` + `payments.core` thresholds) is paid. Only the two states leave the server — no amounts, no owner prices, no ledger rows. A part with no record (no consent yet, no invoice) is left out, never shown as done. Pure rule `ownerReadyLine` → "M2 states" (`tests/installer-states.test.ts`). "Raj gets the install form in the 6:30am text" is carried by the Who's doing this note.

## M3 · Add a job (`/partner/import`, `partner.import.tsx` → `AddJobFlow`; save = `startOnsiteReadyCheck`, status = `onsiteFormStatus`)

| State | Condition | Server function(s) | Pure rule → test | Why it exists |
|---|---|---|---|---|
| M3 base (heavier) | default | "Add job" → `startOnsiteReadyCheck` (unchanged guarded handler + validators) | `customerProblems`, `visitProblems` (unchanged); layout pinned by "M3 heavier Add a job" test | D 237 (heavier design), D 34 (basics only), D 207 (permission wording), D 116 (one optional visit day/time), D 115/163 (form within ~15 min) |
| M3-errors | `problems()` non-empty on tap | none (client validation first; server validators unchanged) | `fieldErrors`, `errorSummary` → "M3 heavier Add a job" | D 237: red 2 px borders, one short line per field, summary banner; `ADD_JOB_OFFLINE_NOTE` = draft kept on phone (poor signal on site) |
| M3-added | save succeeded (`saved` set) | "Open Mitti form" → Mitti URL from `onsiteFormStatus` (`kind: open`); "Try again" → `onsiteFormStatus({retry:true})`; "Go to the job" → `/field/$jobId`; "Add another job" → resets the form | `addedView` → "M3 heavier Add a job" | D 237; "What we do now" three steps = D 115 (nothing sent until Complete), $349 fee rule, PIESA after acceptance |

Elements and why: Owner card fields name/address (Google pick, D 24 Oct)/mobile/email/permission (D 34/207); Ready Check visit card (D 116); Add job 56 px (D 237); footer note (D 115/163).

## M4 · Today's job (`/field/day/$jobId`, `field.day.$jobId.tsx`, reads `getTradeDayView` → `tradeDay`, `getTradeDayExtras` → `tradeDayExtras`)

| State | Condition | Server function(s) each button calls | Pure rule → test | Why it exists |
|---|---|---|---|---|
| M4 base (install day) | latest booking kind `installation`, no outcome yet | three ticks (local) → "Open install form" (Mitti link via `MittiFormLink`); `PiisaCrewPicker` → crew RPCs; "Couldn't get in?" sheet | `dayNext`, `dayChecks`, `electricianOnSite`, `areaLine`, `payNote` → `installer-screens.core.test.ts` | D 199; checks D 178 (geotag); electrician-on-site = signed PIESA B1; crew D 153/161; own pay D 25 |
| M4-ready-check-day | booking kind `ready_check` | third tick = pricing rule; "Open Mitti form" → `confirmHivicReadyCheckPricingFn` (our leads, records `HIVIC_READY_CHECK_PRICING_TICK`) then Mitti link | `dayChecks`, `dayNext`, `whatWeKnow` → "M4 states" | D 199/28 (no pricing talk), D 201 (owner's own words only), free visit = agreement |
| M4-couldnt-get-in | installer taps "Couldn't get in?" (`asking`) | reason → `tradeCouldntGetInFn` → `tradeCouldntGetIn` (install: `changeInstallDay` + owner notice O65 + office alert on 2nd; Ready Check: transition + reoffer) | `couldntGetInSheet`, `couldntGetInPlan`, `couldntGetInMessage` → "M4 states" + `trade-view.test.ts` | D 214/215/217 |
| M4-sign-rebate-form | install form Complete (`installForm.complete`), not signed | "The install is finished" → `completeInstallation` (if D 213 auto-record was held); sign → `signFinalAssignmentFn` | `dayNext` wrap, `signRebateChecks`, `leadInstallerDeclaration`, `signRebateThen` → "M4 states" | D 213 (Mitti Complete = finished), D 119 (declaration), D 125 (typed-name signature) |

Elements and why: arrival pill (D 43); Call/Text/Directions (daily); Next panel (D 36/41); electrician card only when the PIESA requires one (D 199); "The job" rows product/area/access/your pay (D 25); "What we know" on Ready Check days (D 201, no prices); crew today (D 153/161); "Who's on this · Allocated to" on Ready Check days (D 161); "Couldn't get in?" (D 214); after-visit result cards (trade designs 5–6 Oct, kept: they are the day's outcome).

**Removed from M4 under decision 241:** the "How do I turn location on?" help toggle (not on any approved M4 state) and the separate pricing checkbox under the three ticks (the approved state makes the pricing rule the third tick; the exact recorded sentence is shown under it).

Notes: "Owner says" insulation comes from the website (Base44) answers on the property; jobs from other sources show "No details yet". "SWMS and PIISA signed" is shown only when both the signed PIISA declaration and the evidence summary's `swmsComplete` are recorded; PIISA alone reads "PIISA signed".

## M5 · Job offer (`/field/offer/$offerId`, `field.offer.$offerId.tsx`, read `getTradeOffer` → `tradeOffer`)

| State | Condition | Server function(s) each button calls | Pure rule → test | Why it exists |
|---|---|---|---|---|
| M5 base | `status === "pending"`, kind `ready_check` | "Accept this job" (3 day+time picks) → `offerTradeReadyCheckTimes` → `acceptOfferWithTimes` | `offerTopLines`, `OFFER_STEPS`, `OFFER_ONLY_YOU` → `installer-screens.core.test.ts` | D 200–202 (two plain lines, no aerial), D 49–52/76 (one installer, 24 h, accept by offering 3 times) |
| M5-accepted | `accepted` (this business holds the active assignment) and no booking yet | `InstallerReadyCheckTimesCard` (owner-suggested days → `takeTradeReadyCheckDay` / `offerTradeReadyCheckNewTimes`); "Back to My work" | `offerAcceptedView` → "M5 states" | D 52 (owner picks), D 82 (address released on booking) |
| M5-not-for-me | installer taps "Not for me" (`confirmDecline`) | "Yes, not for me" → `replyTradeOffer` (`not_for_me`) → `respondToReadyCheckOffer`; "Keep the offer" closes the sheet | `NOT_FOR_ME_SHEET` → "M5 states" | D 51 (goes back to the office, nothing counts against you) |

**GAP (M5-accepted) — not chosen by Jo, decision 251:** "Change these times" after sending Ready Check times is not allowed; the button stays off the screen (`installerOfferNewTimes` only runs when the turn is the installer's). Nothing to build.
**GAP (M5-accepted, minor):** the approved sheet prints the owner's name before booking; the portal withholds name AND address until the booking exists (`contact_releases` / decision 82), so the Name row reads "Shown once a time is booked".

The electrician's PIESA offer shares this route unchanged (not an installer screen).

## M6 · Money (`/field/money`, `field.money.tsx`, read `getTradeMoneyView` → `tradeMoney`, `getTradeMoneyExtras`; detail `/field/money/$jobId`, `field.money_.$jobId.tsx`, read `getTradeMoneyJob` → `tradeMoneyJob`)

| State | Condition | Server function(s) each button calls | Pure rule → test | Why it exists |
|---|---|---|---|---|
| M6 base | business owner | rows → `/field/money/$jobId`; "All paid jobs"; "Change" → `/field/business/bank`; "Download statement" (CSV of the same rows) | `moneyTotals`, `payPill`, `moneyRowSub`, `bankLine` → `installer-screens.core.test.ts` | D 203; own pay only D 25/30; pay states D 109 |
| M6-all-paid | `showAll` (search `?all=1` or the link) | month chips (All / month); rows → detail; "Download statement" | `paidByMonth` → "M6 states" | D 235 |
| M6-job-detail | `/field/money/$jobId` | "Open the job" → `/field/$jobId` | `moneyJobDetail` → "M6 states" | D 235; D 109 (own customers wait for approval AND the owner's balance); account masked |

Elements and why: four totals (D 203); How pay works (D 30/109/29); Paid to (bank on file, masked); statement (D 203 one action). Staff logins are refused server-side (`tradeMoney` owner-only).

## M7 · My business (`/field/business`, `field.business.tsx`, read `getTradeBusiness` → `tradeBusiness`) and sub-pages (`getTradeBusinessFile` → `tradeBusinessFile`)

| State | Route | Server function(s) each button calls | Pure rule → test | Why it exists |
|---|---|---|---|---|
| M7 base | `/field/business` | Taking new jobs → `setTradeTaking`; rows → sub-pages; Sign out | `businessNext`, `teamFactsLine`, `teamCiiLine`, row lines → `trade-view.test.ts` | D 204; team facts D 130/153/161; one NEXT panel D 36/41 |
| M7-team-add | `/field/business/team`, "Add a team member" sheet | "Create the invite link" → `createWorkerInvite` (business owner only, single-use 14-day `/join` link; with a mobile → `textTeamMemberInvite`, D 251); per-person "Send login invite" → `requestTeamLoginInvite`; notice link → `sendCollectionNoticeLink`; CII link → `CertLinkInline` | `TEAM_ADD_SHEET`, `inviteContact`, `inviteTextLine`, `teamCountLine` → "M7 sub-page states"; `teamMemberInviteText` → `installer-texts.test.ts` | D 153/161/130; worker onboarding rule (workers join only via the `/join` invite); text D 251/252 |
| M7-electrician | `/field/business/electrician` | `UsualElectricianSettings` → `saveTradeUsualElectrician` (append-only config event) | `usualElectricianLine` → `trade-view.test.ts` | D 27/157/173 |
| M7-details | `/field/business/details` | "Ask us to change something" → `sendTradeChangeRequest` | `detailsLine` | audit KEEP; D 229 coverage |
| M7-rates | `/field/business/rates` | "Request a rate change" → `sendTradeChangeRequest("rates")` | `ratesLine` | D 26/30; rates change only through the office (`installer_rate_requests` / office review) |
| M7-bank | `/field/business/bank` | "Change bank details" → `setBankDetails` (pilot.functions, owner only) | `bankOnFileRows`, `BANK_CHANGE_NOTE` → "M7 sub-page states" | audit KEEP; bank numbers never shown in full |
| M7-insurance | `/field/business/insurance` | upload → `partnerUploadUrl` + `addCredential`; View → `partnerFileUrl` | `expiryPill`, `insuranceRowSub` → `trade-view.test.ts` | D 193 (PL expiry re-check); `publicLiabilityBlocker` rule |
| M7-agreement | `/field/business/agreement` | "View the PDF" → `getTradeAgreementPdf` | `AGREEMENT_COVERS`, `signedOnLine`, `agreementLine` → "M7 sub-page states" | D 171 (installer agreement = AP contract), D 23 (30-day clause) |
| M7-esc-notice | `/field/business/esc-notice` | own tick → `acknowledgeTradeCollectionNotice`; "Send again" → `sendCollectionNoticeLink` (guarded senders) | `noticeLine`; `escNoticeRowLine` (ready for the link dates, see GAP) → "M7 sub-page states" | D 122/130/146/147 (each person ticks for themself) |
| M7-guide | `/field/guide` | "Back to My work" | `GUIDE_STEPS`, `GUIDE_WORDS` → "M7 sub-page states" | D 21/107/145/236 |

**Replaced under decision 236/241:** the installer guide's five G55 steps (decision 145) are superseded by the approved M7-guide steps (decision 236); the page now renders `GUIDE_STEPS` verbatim.

**CLOSED (M7-team-add, decision 251):** with a mobile on the sheet, `createWorkerInvite` texts the new person their single-use link right after the invite row exists: SMS type `team_member_invite` (installer/partner audience, wording "{Business} added you to Home Insulation Victoria. Set up your login: {link}" — approved as written, decision 252), through `textTeamMemberInvite` (`installer-texts.server.ts`): TEST businesses → test-send only; real businesses → `sendRealSms` behind `customer_comms_enabled` + the `team_member_invite` switch, quiet hours, approved-and-active business, idempotency key per invite link + mobile (`teamMemberInviteKey`). The link always stays on screen; the sheet says whether it was texted (`inviteTextLine`) and keeps the "send this link to them yourself" fallback when there is no mobile or the text did not go.
**GAP (M7-bank):** "we text you a code before the change takes effect" and the "Updated 3 Oct 2026 by Deep Singh" row are not built — `setBankDetails` saves directly and `business_bank_details` carries no updated-by read here. The note says the office confirms the first payment to a new account (true today). Missing: a 6-digit code step (owner-verify style) on the bank change and an updated-at/by read.
**GAP (M7-esc-notice):** per-person "link sent …, reminder …" dates are not shown — `tradeNoticeView` returns acknowledgement state/date only. `escNoticeRowLine` is ready; missing: the link/reminder timestamps from the collection-notice link table in `tradeNoticeView`.
**GAP (M7-electrician):** the approved "On file" card shows Business, Mobile, Status ("Approved HIV electrician") and "Changed … by …"; the saved nomination holds name, REC/licence and price only. Missing: optional business/mobile fields on the nomination event, the approved-REC match (`our-lead-piesa-electrician.core`) surfaced as a status line, and the event's actor/time.
**GAP (M7-details):** the approved "Areas" row lists coverage suburbs (decision 229); `tradeBusinessFile` returns the radius/base only. Missing: a business-scoped read of the coverage list.

## Removed from the routes (decision 241)

| Screen | Removed | Why it could not be justified |
|---|---|---|
| M2 Job page | `MittiCard` sync card inside the Ready Check group (unlinked form) | Office-style sync detail; not on any approved M2 state; the row "Mitti form · Not linked yet" + link remain |
| M2 Job page | `MittiMissingInfo` list under the Ready Check group | Duplicate of the Next panel's "Add N things in Mitti" list; approved state shows the count row only |
| M4 Today's job | "How do I turn location on?" help toggle | Not on any approved M4 state; the geotag check line itself stays (D 178) |
| M4 Today's job | Separate pricing checkbox under the three ticks | Approved state makes the pricing rule the third tick; one tick, same recorded sentence |
| M7 Guide | G55 step list, amber 30-day box, emerald pay box | Superseded by the approved M7-guide wording (D 236) |

## Checks run

- `bun scripts/scan-retired-terms.ts` — 0 customer-visible matches (warnings are test-only, pre-existing).
- `bun test tests/installer-states.test.ts tests/installer-screens.core.test.ts tests/installer-home.test.ts tests/add-job-flow.test.ts tests/add-job-confirmations.test.ts tests/mitti-link.test.ts` — see the commit message for the counts.
- Decision 251 gaps: `bun test tests/installer-states.test.ts tests/installer-texts.test.ts tests/approved-flags.test.ts tests/sms-sender.test.ts tests/trade-view.test.ts` — see the commit message.
- `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p .` — see the commit message.
