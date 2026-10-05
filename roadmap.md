# Roadmap

## Current priority (Jo, 5 Oct 21:04; preview only)
- [ ] Delete finished, superseded or contradicted plans/audits/reviews across `.lovable/plan/`, `docs/`, `design-review/`, `roadmap.md` and `.lovable/memory/`; keep only current source of truth, official forms, SQL migrations, final portal design memory and AGENTS rules.
- [ ] Create and maintain `docs/STATUS.md` with every feature marked Built / Partly built / Not built and its route/page; reduce memory index to STATUS + source of truth.
- [ ] Restyle `/partner/bulk-import` in the calculator look without changing its current import capabilities.
- [ ] Fix duplicate skipping, office-review hold before job creation, Past uploads, large photo batches, and stale single-job import copy.
- [ ] Preserve batch permission audit, six-month supplied-photo age, install-day-only photos, 50 m GPS and zero lead fee on installer-owned customers.
- [ ] Scenario E after Bulk upload restyle: TEST installer 25-row messy spreadsheet + PDFs + 10 mixed-GPS roof photos + handwritten 5-customer photo + zip; upload through Past uploads at 390px; fix every exception; verify counts, duplicate skip, office-review hold, 50 m matching, no-GPS non-evidence, business privacy, jobs/draft quotes, no sending; time 300 rows and 60+ photos; repeat as office on behalf; screenshots; fix/retest; clean or retain only as qa_test.
- [ ] Before Scenario E, make each confirmed bulk row complete and correctly placed: normalised owner/property facts and measurement source; permanent installer attribution/no lead fee; same installer assigned for Ready Check/install; preferred electrician recorded first; editable Not visited/Visited/Quoted/Installed mapping; installed rows retained in batch only; installer-handled price/rate quote with existing holds; queued owner confirmation; missing evidence; immediate trade/office visibility; exact batch/person history. Review shows stage choice and planned electrician. Scenario E proves all ten points per row type plus My work and office screenshots.
- [ ] Bulk safety-check choice: batch-wide My electrician / Home Insulation Victoria electricians / job-by-job; saved preferred electrician can change or be added; per-row toggle in full list; preferred electrician gets exclusive normal-window PIESA offer and NEVER auto-falls back. Decline/no-response creates office Needs me and installer Your move; only installer or office-with-reason may switch to HIV allocation. Unknown electrician uses existing queued invite, stays Waiting to join, and also never auto-switches. Scenario E proves all choices and no reassignment.
- [ ] Bulk new-electrician onboarding: approved/saved picker first; when My electrician has no approved selection require name + mobile, optional business/email, with approved explanation; confirm creates pending electrician + queued invite, jobs show Waiting for {name} to sign up, office Needs me aggregates name/mobile/job count/installer, PIESA stays blocked until approval, no auto-reassignment. Scenario E covers validation, pending records, no send and no PIESA offer.
- [ ] Electrician-picker privacy everywhere (bulk, single job, preferred settings): show only electricians previously added by that installer business; never network list/counts. New details silently match mobile/email: approved links existing and shows only “Already signed up ✓”; pending reuses invite; absent creates pending/invite. Never expose other relationships/details. Scenario E proves isolation, silent matching and deduplication.
- [ ] Campaign save-spot update after cleanup/bulk upload (Jo, 5 Oct 21:12; draft only): new Group A/B wording; Free Ready Check everywhere; removal caveats; real remove-enquiry link; matching plain text; one-tap spot confirmation with OwnerHouse level 0 and rebate; Group B optional video; no time picker unless postcode availability setting is on, default off; update campaign preview.
- [ ] Group B video priority addition (Jo, 5 Oct 21:20): “jump the queue” email/video copy and direct video link; upload also saves spot and records video priority; saved-spots sort video first; likely-ineligible video goes to office Needs me for confirmation; corrected no-installer confirmation; report missing active-link counts for both groups and generate links during campaign preparation only, never send.

- [x] Show signed installer applications in the correct office pending approval list without altering records.
- [x] Fix REC business/origin address picker selection races, including outside-click lock during pending details.
- [x] Add focused regression coverage for office visibility, mobile/blur selection, provider failures, VIC validation, and number retention.
- [x] Run focused tests, type checks, wording scan, and verify the preview build.

## Instalment-plan browser click-through (TEST only, switches stay OFF)

- [ ] Pick a TEST job with a current confirmed quote and owner secure page.
- [ ] Office: propose 3-instalment plan; approve; record collection arrangement; mark first instalment verified (fake data).
- [ ] Confirm plan NOT gate-cleared until owner acceptance; then owner accepts on secure page; conditions complete.
- [ ] Confirm PIESA still blocked (payment_option_gate_enabled OFF); no PIESA/booking/quote/invoice/message/Xero/Mitti records created.
- [ ] Access: non-office users cannot reach office plan controls; owner cannot approve office-only steps or verify payments.
- [ ] Desktop + phone layout checks; before/after counts; build/test/wording scan.

## Publish instalment-plan UI slice (approved 3 Oct 21:15)

- [x] Publish office + owner instalment-plan cards (insurance upload fix rides along); gate switch stays OFF, all outbound OFF.
- [x] Post-publish checks on TEST job HV-1003 only: office card visible to staff only, owner acceptance card, four conditions complete, PIESA/scheduling still blocked, no new records, switches OFF.
- [x] Log resolved defect: office plan card briefly visible to non-staff in preview (server actions were already protected); UI now staff-only.

## New (3 Oct evening)
- [ ] Mitti PIISA + PIESA templates: rebuild cleanly from official forms (word for word), Ready Check template already connected
- [x] Dummy Xero invoice (INV-1820 draft created) (TEST, draft): Ready Check $0, PIESA $349, R5.0 ceiling insulation supply & install, removal (only if applicable), AP Management Fee $349, VEU rebate (negative), total; with Home Insulation Victoria logo (Xero branding theme)

- [ ] Short onsite PIESA/PIISA in Mitti (clear plain full-sentence questions, problems-only) -> auto-fill official Word forms

## Electrician workspace follow-ups (4 Oct, preview only)
- [x] Electrician sees only own agreed rate; $349 never shown as electrician fee; "Rate to be confirmed"/block offers without rate; test + wording scan; reseed TEST offer rate
- [x] Replace misleading "Waiting for electrician" tag on assigned jobs + test
- [x] Full-page direct-link privacy audit HV-1414..HV-1421 desktop+phone
- [x] Investigate full-suite "1 error"
- [x] Focused tests, scan, typecheck, full suite, build; no publish

## Launch blockers (open)
- [ ] Real PIESA offers cannot go live until approved electrician PIESA rates are entered for every active electrician/REC, or office explicitly uses rate-to-confirm with an audit reason.
- [x] No real scheduled timer for reminders/expired offers. (15-minute timer live)
- [ ] No rectification reassignment when REC loses approval.
- [x] VEEC query/rejected statuses (added earlier)
- [ ] PIESA path not fully browser-tested (payment_option_gate_enabled OFF).

## Electrician rate card UI cleanup (4 Oct, preview only)
- [x] Discarded draft rows hide the spread and read "Discarded draft - not used for offers."; row visually inactive.
- [x] Focused rate-card tests, wording scan, typecheck, build; no publish, switches unchanged.
## Open tasks
- [x] Deleted previous-VEU-upgrade and occupancy questions from portal eligibility (Gate 1, verified eligibility, intake display, workflow decisions). Base44 form edit must be done in Base44 by Jo — spec delivered in chat. Not published.
- [x] Activity 48 same-ceiling-area wording locked (4 Oct, accepted): "No confirmed previous Activity 48 for the same ceiling area" / "Previous Activity 48 for the same ceiling area confirmed". Preview checks passed on TEST HV-1003.

## Logged limitations (4 Oct, accepted slice)
- [ ] Owner/trade pages were inspected via the office test session, not separate owner/trade sign-ins — acceptable this slice (office-only card did not render there), but a separate role smoke check is required before launch.
- [ ] Base44 TEST enquiry check pending until the two website fields are removed; then submit one TEST enquiry without them and confirm job creation, no blank/stale rows, preliminary eligibility from remaining answers, and the Activity 48 check stays office-only/pending.
- [ ] No Activity 48 answer was saved to a TEST job during the check.
- Step 3 (approved): VEEC Registry query status + AI draft reply + mark reply sent + 3-day overdue flag. Next step after: 'Submitted moves job to Complete' change.
- Step 4 done (4 Oct, preview only): job becomes Complete only when VEEC is Approved; Submitted/Query/Rejected keep it at Ready for VEEC; stage guard for Complete now requires approved VEEC. HV-1001 (TEST) left Complete as-is per Jo. Not published.

- [x] Step 5: installation quote expiry (14 full days) + day 3/10 owner nudges, queued only
- [x] Rectification quote timing (24h, day 3 nudges, escalate day 5) — separate step
- [x] Step 6: owner picks 3–5 PIESA windows (morning 8–12 / afternoon 12–4 Melbourne); electrician tap = booking; fallback accept-then-arrange; one more-times request then needs-attention
- [x] Re-prove step 5 quote-expiry migration on practice database
- [x] 48h escalation fix: booking-based SLA + Ready Check in office sweep
- [x] Electrician matching (OM v2): window/daily-limit eligibility, new ranking, 4 business-hour offers, office booking clears 48h flag
- [x] Office screen box to set an electrician daily job limit
- [x] Record no-shows per electrician (visit events, Part 1)

## Step 9 installer capacity + install booking
- [x] Part A: optional m²/day capacity, install holds (create/move/release), office-only hold card — practice-proven, applied
- [x] Part B: owner install days, installer one-tap booking, 30-day hard gate, 10-days-left + declined flags — practice-proven, applied (not browser-checked)
- [x] Copy onboarding capacity answer onto the business at approval (only if empty)

## Step 10 ESC pre-install notification + pre-start check
- [x] ESC AP task entries (window open / urgent 2 days / update in Registry / withdraw and resubmit)
- [x] Pre-start check 12pm Melbourne day before, re-run on changes; locks PIISA send + install evidence on fail
- [x] Certification level (full/provisional) + expiry; legacy verified = not confirmed; office prompt + needs entry when install booked

## Step 11 — Ready Check booking (owner windows + installer one-tap)
- [x] Step 10 tests: safety-form lock, evidence-upload lock, re-run after ESC submission
- [x] Owner picks 3–5 Ready Check windows; price-seen gate if estimate exists
- [x] Installer matching (approved, Full current EEC, postcode, free, capacity), top 3 / 4 business hours, rounds
- [x] First tap = booked; contact release Ready Check only; fallback arrange-a-time
- [x] Practice DB proof, then apply; report installer eligibility given unconfirmed certifications

## Operating Model v2 final items
- [x] Part 1: owner reschedule/cancel link (24h cutoff), owner no-show rebook once, trade cancel → owner new times, trade no-show 4h → needs-attention, per-business visit events feed reliability
- [x] Part 2: 24h/2h visit reminders + 7am daily AP brief (queued, portal "Today")
- [x] Part 3: AP approval queue clean/flagged, per-job approval, never auto
- Trade payouts: blocked until Xero connected (not building)
- [x] Tidy-up: final AP approval only via AP queue (compliance/evidence actions no longer promote)
- [x] Tidy-up: office-only electrician daily job limit field (empty = no limit, 0 refused)

- [x] Capacity limits removed from use; install hold = expected install week note (Jo, 4 Oct)
- [x] Audit fixes: weekly capacity removed, auto-progression cut from Xero, estimate wording, property manager tab hidden, out-of-date tests updated (5 Oct)
- [x] Solar API key stored (GOOGLE_SOLAR_API_KEY); not used by any feature yet
- [ ] Jo to decide: aerial in price range; Ready Check for installer-supplied jobs with measure-up; how 349 waiting jobs pick times at launch

## Onboarding fixes, pricing fixes, profit card (4 Oct night, preview only)
- [x] A1 hide Weekly installations; A2 accepting new work Yes/No; A3 CII level + expiry per worker (Provisional = no work); A4 no draft until first save; A5 brand fonts
- [x] B1 HIV quotes: owner $30/m² R5, removal $15/m², access extras at owner prices; markup = owner price − installer agreed rate (inc GST); 12% retired for new quotes
- [x] B2 installer-supplied jobs can't use HIV quote builder; B3 PIESA $349 + AP fee $349 separate lines on HIV quotes; lead fee note = none
- [x] C office-only profit card (AP fee, VEEC spread with current VEEC price $83, PIESA markup, installer markup, totals)
- [x] D office-editable owner prices with history + Margins view (Prices & margins page)
- [x] Bulk installer import slim build — upload + AI match + sort + review + create jobs; practice DB proven, live migration applied with undo file
- [x] Bulk import next steps (later): auto Mitti install-day tasks from stored missing evidence; owner eligibility link (questions only); installer acceptance notification + CC rules

## Queued after bulk import (plan only, awaiting go)
- [ ] Per-installer-company pricing method (Automatic from onboarding rates / Assessor Form A1 / Installer owner enters price) — Jo decision 5 Oct: top-up pricing stays simple — the installer's "Top up to R5.0" rate per m² applies to the whole top-up area regardless of existing depth/R-value; NO extra "existing R-value" question on the Ready Check. Still awaiting: mixed-removal handling, moderate access price, minimum-charge-as-floor, new-company default method.

## Job 1 (approved 5 Oct) — end-to-end TEST of bulk upload before installer email
- [x] Confirm three notes applied (Ready Check coverage sorting, one permission tick, automatic stage)
- [x] Browser test as TEST installer "TEST – delete": messy Excel (8 customers, odd columns, dup row, typo address), zip folders + loose + unmatched photo, email-text-only leads
- [x] Check matching, stages, sorting reasons, missing evidence, tick blocking, job tagging, draft quote math, nothing sent
- [x] Fix bugs (AI system-message fix), deleted ALL test data; reported pass/fail
## Job 2 (after Job 1) — PLAN ONLY
- [x] Owner eligibility link for installer-supplied customers (questions only, no signatures; installer told result)
- [ ] PLAN READY: 5 booking-control answers + gap list (awaiting Jo's go on fixes)
- [ ] END-TO-END TEST: installer assessor Ready Check flow (worker add/approve/assign, /w/token link, Mitti form, sync back, quote); delete all test data after
- [x] PLAN READY: owner eligibility link (awaiting Jo's go)
- [x] BUILD (approved): Gap 1 — PIESA Mitti form only after confirmed PIESA booking
- [x] BUILD (approved): Gap 3 — 15-min automatic Mitti sync on existing timer (data only; keep manual Sync)
- [x] BUILD (approved): Gap 4 — record which confirmed install booking unlocked installation; AP review requires it completed
- [ ] NOT DOING: Gap 2 (installer keeps date box); Gap 5 later

- [ ] R-value per job (min R5.0) — plan approved 5 Oct; waits for current build (gaps 1/3/4) + Jo go + Jo pricing decisions (R6/R7 owner prices, markup, launch scope, "Other" values, rebate wording)

- [x] R6.0/R7.0 optional installer rates (onboarding, office page, profile request→office approval)

## Queued 5 Oct (Jo approved) — before live-safety check
- [x] BUILD: owner eligibility link for installer-sourced customers (questions only; eligible / needs assessment / not eligible; installer told; copy per job + bulk copy per upload batch; nothing sends)
- [x] BUILD: auto "Create & assign Mitti assessment" when approved worker with confirmed Mitti access is assigned to an installer-sourced job needing a Ready Check; otherwise "needs Mitti access" flag

## In progress — discount cap + $200 minimum (Jo approved, must be in the publish)
- Max discount: RETIRED (Jo, 5 Oct, VEU Industry Pack) — no cap exists; only the $200 minimum contribution applies. Cap columns kept in the database, unused.
- OPEN (Jo decision): calculator values the unrounded figure (21.294 for the Industry Pack example), not whole VEECs (21).
- OPEN (needs plan + Jo go): installed product type is not recorded or checked — block foil/foil-faced, combustible, loose-fill/blow-in, expanding/foaming; batts/blanket/rigid board only, min R5, on the VEU product register.
- Min customer contribution $200 inc GST enforced in same places; reduce discount if needed.
- Wording: calculator never shows more than cap; quote lines when capped/reduced.
- Answer: how calculator computes VEECs (factor per m² by region, max area, source) — no factor changes.
- Test 50/150/300/600 m² metro+regional and a cheap job hitting $200 min.

## Queued AFTER live-safety check + publish (Jo approved 5 Oct) — installer commercial options + installer-sent quotes
- [ ] Per-company AP management fee (office setting, default $349 inc GST; ReInsulate $299 pilot). Discount $70/VEEC for all (no $50 option). PIESA $349 to owner, electrician paid agreed rate.
- [ ] Installer payouts: installer-supplied = full quoted price within 7 days of AP approval AND owner paid in full; HIV leads = agreed rate within 7 days of AP approval. Never wait for VEEC. Payout due date/status on office view + installer portal; office marks paid, no money moves.
- [ ] Per-company "Installer sends own quote" mode: Quote figures panel per job + copyable owner acceptance link (live figures; owner reviews, signs consent + VEEC assignment). Nothing sends.
- Visual restyle: replaced by Final portal design (below).

## Before live-safety check (Jo, 5 Oct 04:36)
- [x] Round DOWN to whole VEECs everywhere (21.294 → 21)
- [x] Ready Check price items: remove Tile lift / Metal sheet access (spec, AI prompt); validator still accepts live template
- [x] Onboarding: remove pink access-charges note entirely
- [x] R-value plan: add install-day product check (plan only)
- Note: $299 AP fee ReInsulate ONLY; all others + HIV leads $349
- [ ] Then live-safety check → SAFE TO PUBLISH or blockers; do not publish

## Final portal design (Jo approved 5 Oct 06:24) — REPLACES "warm and friendly" (discarded). Queued after bulk-upload fixes, file viewer, commercial build
- [ ] Stage 1: calculator look portal-wide (tokens, logo header/menu, cards, buttons, house-progress signature)
- [ ] Stage 2: Office Today + Work/Partners/Money menu
- [ ] Stage 3: Office job page
- [ ] Stage 4: Installer / electrician / homeowner job screens (phone first)
- [ ] Stage 5: Upload leads single screen
- [ ] Stage 6: AP sign-off exception-first
- [ ] Before/after desktop + phone each stage; no rule/gate/data/compliance wording changes

## Onboarding Rates page tidy (Jo, 5 Oct 06:28) — layout/wording only
- [x] Top line, tidy aligned rows, Optional/Required tags, 3 cards, errors after Save, phone stack; before/after screenshots

## URGENT onboarding repeat-questions + CII fix (Jo, 5 Oct 06:30)
- [ ] No repeats (am-I-an-installer, signer prefill, address/email same-as), short CII, kind errors, easy dates, 2 E2E runs
- [ ] Final design Stage 1: structure fix (menu 22→7, renames, one status word per row, fewer columns) — waiting for Jo to approve the menu map and rename list
- [x] Launch campaign to consented existing Base44 leads: Groups A/B owner flows, save-spot/opt-out/video, office counts and desk-check queue, 50-recipient gate; sending remains OFF and final email copy remains unapproved.
- [x] Hot leads preliminary-quote draft (preview only): current owner-area estimate, enquired/applied trade coverage, dedupe/test exclusions, office Leads list and region counts; fresh calculator maths, three draft previews, disabled send; no schema change, no existing-job changes, no sending. Coverage/count reconciliation with Jo's read-only snapshot remains needed before any send approval.

## TEST-only full-role browser harness (5 Oct, preview only)
- [ ] Add admin-only one-click QA role entry for owner, installer boss/worker and REC, restricted to qa_test data.
- [ ] Add qa_test-only time simulations for 24h, 48h and 30-day PIESA expiry without changing global switches.
- [ ] Add guarded cleanup for complete qa_test journeys, preserving real/audit records.
- [ ] Prove any SQL on PGlite with rollback, apply only after proof, then run all five browser journeys and clean up.

## Launch campaign calculator/email rebuild (Jo, 5 Oct 09:21, preview only)
- [x] Rebuild `/estimate/$token/campaign` around the real shared PublicCalculator with enquiry prefill, one Save my spot action, quiet opt-out, and Group B video card.
- [x] Replace the separate campaign email shell with exact shared `renderV2QuoteEmail` / `V2_THEME` pieces, including the same savings, inclusions, next-step, price-change and footer modules; campaign-only CTA/copy and opt-out.
- [x] Capture Group A/B campaign email screenshots at 390px and 640px; sending stays OFF and nothing is published.

## Automatic quote release with exception holds (Jo, 5 Oct 09:46, preview only)
- [x] Confirmed insulation quotes auto-queue after verified eligibility when current-rate pricing is within the configurable estimate variance (default 15%) and has no unrated extras; held quotes show reasons and retain exact-version approval.
- [x] Installer-supplied confirmed quotes optionally hold outside a configurable normal per-m² range; blank means no range check.
- [x] Rectification quotes auto-queue only when every line is standard and agreed-rate priced; other/non-standard/manual-price lines hold for office review.
- [x] Global sending switches remain authoritative: OFF means ready-to-send/queued only, with no external delivery.
- [x] Update workflow source-of-truth and focused tests: within 15%, over 15%, extra item, non-standard fix-up, and switches-off queued only.
- [x] Schema additions have an undo file and passed on PGlite before live application. Not published.

## Priority: full role dummy journeys before portal rebuild (5 Oct)
- [x] Create/reset isolated TEST owner, installer boss, installer worker and electrician accounts on TEST businesses only.
- [ ] Run scenarios A–D through real office, owner and trade screens with all external switches off. Blocked at the first real handoff: TEST imports are not marked `qa_test`, the installer job view remains on Loading, and no safe TEST payment bypass is exposed.
- [ ] Capture every step at 390px for owner/trades and desktop for office; record automation, next person, defects and exact proposed fixes. Entry screens and the first blocked handoff are captured; downstream steps cannot be truthfully tested yet.
- [x] Archive HV-1541–HV-1545 without deleting audit history; cancel and retain the misclassified Scenario A TEST import because the archive guard correctly rejected it as non-`qa_test`.
- [x] Deliver the blocked-run findings and tomorrow-focused ranked fixes; make no workflow fixes and do not publish.

## URGENT trade launch fix before role re-test and portal rebuild (Jo, 5 Oct 10:24)
- [ ] Make approved-worker invitations, password setup, password reset and email sign-in links work; use existing profiles/roles and keep partner invite wording held for Jo approval.
- [ ] Replace trade navigation with one phone-first My work screen: offers, Needs you, Coming up, collapsed waiting work, and Work/Add job/Payments/Business tabs.
- [ ] Replace installer quick-add with one staged own-customer form plus Many at once; preserve entered/imported facts without retyping.
- [ ] Reduce trade job page to status, next action, stage checklist, active-visit contact, address/directions and key facts; put history/documents behind links.
- [ ] Use Mitti only for Ready Check A1 and PIESA onsite forms; show setup notice and office action while PIESA/PIISA template IDs are blank; fix numbering.
- [ ] Apply active-visit direct-contact wording consistently, including worker links; keep optional portal messages.
- [ ] Make every post-Ready-Check owner action available through the secure owner link with one next-step card and six-step tracker.
- [ ] Set partner lead fee to zero, align electrician offer expiry to four business hours, and apply the launch-campaign response migration after PGlite proof with undo files.
- [ ] Review all 16 submitted partner applications; mark only clearly fake entries as test and report requirements for the six named real businesses.
- [ ] Test every change with TEST accounts at 390px, capture screenshots, then run the full role re-test against the fixed preview. No publish; Step 1, Gate 1, payment gate and Xero untouched.

## Role re-test blockers (5 Oct, folded into trade launch)
- [ ] Installer-created customers from TEST accounts/businesses saved as qa_test
- [ ] Installer job page stuck on Loading
- [ ] Assigned jobs show in My work for boss and assigned worker; electricians land on own list
- [ ] Owner picks times -> trade taps -> confirmed booking end to end
- [ ] Guarded TEST-only payment simulation (qa_test only, audited)
- [ ] Hide unrelated old TEST jobs from TEST trade dashboards
- [ ] Plain-words reason when a job can't move
- [ ] Re-run role scenarios A-D and report step by step

## Trade launch — open (5 Oct)
- [ ] Electrician offer screens first, then shared installer Ready Check offer (Jo-approved 5 Oct, preview only): SMS copy; navy Fresh job/countdown card; distance proxy until Maps is connected; installer area + source + existing-insulation tiles; rough value from that installer's own rate × estimated area; no guarantee wording; shared atomic 2-hour first-tap, decline/propose, taken/too-slow states, locked owner/contact/calendar actions. Nothing sends while switches are off.
- [ ] Installer Ready Check day page after installer offer (Jo-approved 5 Oct, preview only): shared electrician on-the-day pattern; Today/window card; Mitti A1 start and self-updating outcome; quoted/not-eligible cards; couldn't-enter reason creates office Needs me rebooking and re-offers to the same installer first; back to My work.
- [ ] Shared trade-day pre-start component + simplified install day (Jo-approved 5 Oct, preview only): photo/video quality warning and four tips; 3-item phone checklist remembered per job; iPhone/Android location steps; Start disabled until all three checks; used on electrician safety check, installer Ready Check and installer Install days. Install day opens Mitti PIISA/photos/bag labels and shows complete or missing-photo outcome only; no page checklist. Ready Check keeps Couldn't get in.
- [ ] Installer My work shared variant (Jo-approved 5 Oct, preview only): greeting + weekly count; navy Ready Check offers strip; green-bordered Your move quote/install-day and missing-photo tasks; Coming up Ready Checks/installs; monthly installs/earnings; Work/Add job/Money/My business tabs using existing customer flow and shared trade tabs.
- [ ] Owner no-login actions after Ready Check (quote accept, payment choice, electrician times)
- [ ] Full owner-picks-times → trade-taps → booked browser run, then scenarios A–D end to end
- [ ] Money tab (Jo-approved 5 Oct, queued with trade screens, preview only): title "Money"; big green card "Landing in your account {next pay date}" + total + "{N} jobs"; two white tiles "This month" / "All time"; Jobs list = owner surname + suburb, what was done (Safety check / Fixes / Install), amount, status pill — "Coming {day}" (blue), "Being checked" (blush: waiting on our sign-off), "Paid {date}" (mint); "Download statements ›" link; NO payment-terms wording (it's in the agreement); bottom tabs Work / Money / My business (+ Add job for installers). Data from payouts records.
- [ ] My business tab (Jo-approved 5 Oct, queued with trade screens, preview only): title "My business" + business name; "Taking new jobs" switch — off shows "Paused, no new offers until you switch back on" and allocation respects it; pink alert card only when licence/insurance expires within 30 days ("{Doc} runs out in {N} days. Snap the new certificate so jobs keep coming") with Upload button — on expiry automatically stop offers and add a Needs me item for the office; "Paperwork" list (electrical licence, public liability, Your rates, Agreement) each with status pill ("All good" / "{N} days" / "Set" / "Signed"); "Where you work" = "Up to {N} min from {base suburb}", editable, controls which offers they get (Google Maps drive time; postcode proxy until Maps connected); "The team" = boss + workers with roles + "+ Add someone" (existing worker invite); footer links Bank details · Your agreement · Sign out.
- [ ] Invite/password email — waiting on Jo's wording approval (copy-link works now)
- [ ] 8 older failing tests (agreement fee clause, PIESA/PIISA templates, ESC) — predate this work

## Office portal restructure (Jo, 5 Oct) — supersedes layout audit/proposal
- [x] 1 Top bar nav + tabbed sections (all old routes kept)
- [x] 2 One status per job rulebook (pure mapping + settings defaults)
- [x] 3 Needs me (rules a–k, Later/snooze)
- [x] 4 Pipeline panels + filtered table
- [x] 5 Job page tracker / Right now / Done when
- [x] 6 Partners cards / Money overview + payouts
- [ ] 7 Proof on practice DB + screenshots

## Full dummy runs with Xero Demo Company (Jo, 5 Oct)
- [ ] Link Xero connection to the Demo Company; show "Connected to: Demo Company (test)" in settings — needs Jo's authorisation
- [x] Routing built (tests → Demo only; real jobs off). [ ] qa_test jobs only → real Demo Company calls (contact, invoice, test payment, read back paid); real jobs never call Xero while switches off
- [ ] Re-run scenarios A–D end to end with real Xero; 390px screenshots; fix until passing

## No-call-owner rule (Jo, 5 Oct) — standing rule
- [ ] Owners never see HIV phone number / "Call us"; use "Got a question? Message us" → in-portal thread
- [ ] Only owner call button = call booked trade on visit card
- [ ] Apply: owner pages, quote pages, campaign emails, reminders; don't publish

## New connectors (Jo, 5 Oct) — after trade launch fixes + Xero Demo loop
- [ ] 1 Resend (HIV domain; comms off, auto_send false)
- [ ] 2 Twilio SMS (off for real people). Owner sign/act items = email+SMS (one line + secure link), one 24h reminder both channels; trade offers SMS+email; info-only stays email
- [ ] 3 Xero Demo Company only
- [ ] 4 Sentry error alerts (owner/trade/office)
- [ ] 5 Stripe TEST mode deposit from quote link → Xero; gate off; no 50% lock
- [ ] 6 Google Maps (autocomplete, directions, travel-distance matching)
- [ ] 7 PostHog (mask owner details in replays)
Each: Jo approves sign-ins/keys; dummy test on qa_test; preview only.

## Choose a trade (Jo, 5 Oct)
- [x] Office job page "Choose a trade" (Ready Check installers, PIESA/fix-up electricians), eligible only, nearest by postcode, area + load
- [x] Offer to one trade only, same offer/window; logged "Office chose X"
- [x] Declined/expired pick -> Needs me with "Pick another" / "Send to all"; no auto-widening
- [ ] Browser run on a TEST job (owner times -> pick -> decline -> Needs me) during the A–D role run
- [ ] Travel-distance "nearest" once Google Maps is connected (postcode proxy now)

## Owner "My job" page rebuild (Jo-approved 5 Oct) — after trade launch fixes, preview only
- [ ] Build per mem://design/owner-my-job-page (token link, hero house fill, navy action card, who's coming, 5 steps, numbers, bottom list); remove badges/progress bar/stacked panels
- [ ] Owner "Save my spot" time picker per mem://design/owner-save-my-spot (with My job page); same 2-hour windows on trade offer cards + PIESA/install pickers; min 3 picks
- [ ] Owner Quote screen rebuild (Jo-approved design, queued with owner pages, preview only): mint hero with green border ("Your Ready Check is done. Here's your price.", big green "You save $rebate", "VEU rebate, taken off for you", big blue "You pay $total" + "incl. GST · was $pre-rebate before rebate"); "What {installer first name} measured" three tiles (ceiling m², existing insulation, access); "Everything in your price" itemised lines (Ready Check FREE green pill, R5.0 ceiling insulation, Electrical safety check $349 "required by law", HIV $349 running-the-job line; removal/access lines only when >0; then green rebate minus line, then bold blue "You pay"); navy "You don't lift a finger" card with 6 green ticks + "Home Insulation Victoria is an Accredited Person under the Victorian Energy Upgrades program." small line; blush "Could it change?" note (only if electrician finds fix-first items, owner OKs before anything extra); one acceptance checkbox (short visible text, existing legal wording + consent records); fixed bottom button grey "Tick the box to accept" → green "Accept quote", "Got a question? Message us" under it (NO phone); payment step "✓ Quote accepted" + "How would you like to pay?" option cards from payment option gate settings (deposit/pay in full/3 instalments — do NOT hard-code percentages, rule pending), button "Pay $X"; confirmation "You're all set. Paid $X. Receipt sent to your email." + green "Pick safety check times". Payment gate stays OFF, Stripe test mode only, don't publish.
- [ ] Owner "Book safety check and install" screen (Jo-approved, queued with owner pages, preview only): ONE screen replacing separate PIESA-times and install-days steps, reached from "Pick safety check times" after payment. Mist hero "Two quick visits. Lower bills for years." / "Pick times for both now and we'll line them up for you. Takes 30 seconds." Two big tabs: "1 · About 1 hour — Safety check" and "2 · About half a day — Install"; active tab navy, finished tab green underline. Safety check tab: same 2-hour windows (8–10am, 10am–12, 12–2pm, 2–4pm), min 3 picks, live counter, helper "A licensed electrician checks your wiring is safe." Install tab: day tiles in 2-column grid, "The team arrives at 8am.", min 3 days; only offer days after the earliest safety check pick AND inside the allowed PIESA→install gap — gap is a WORKFLOW SETTING, Jo confirming the rule, do NOT hard-code. Blush note: "If the electrician finds something to fix, we show you the price first and move your install if needed." Bottom button: "Pick N more…" until valid → "Next: install days" → "Book both visits". Confirmation: "Nearly there. We're booking your electrician and installer now. You'll get a text and email with both times." + summary of picks + "Back to my job". No login via secure link. Don't publish.
- [ ] Owner "All done" screen (Jo-approved 5 Oct, queued with owner pages, preview only, no login via secure link, no HIV phone number). 1) Mist hero: green pill "All done · {date}", "${rebate} saved. Bills down. Job done.", "{m²} of R{x} in your ceiling. Checked and signed off by us.", house outline roof fully pink, tiles "You saved ${rebate}" (green) + "Left to pay ${balance}". 2) Before/after: two photo tiles from install evidence + "See all N photos ›". 3) "How did we go?": 5 star buttons (installer + team); 4–5 → "Thank you! Would you tell others?" + "Leave us a Google review" (link = setting); 1–3 → "Thanks. We'll look into it and message you." + Needs me item for office, never sent to Google. 4) Navy referral card: "Your mates are leaving $1,800 on the table" (typical rebate rounded, from settings) / "Send a mate your link. They can see their savings in 30 seconds." Green "Share my link" via native share sheet; link = calculator + referral code; track referrals (reuse customer_referral_tokens/events); reward = setting, default none (Jo undecided). 5) "Your paperwork": Tax invoice and receipt, Electrical safety check, Installation details, Your signed forms (PDFs) + "Keep these for your records. Handy if you sell your home." Don't publish.
- [x] Shared OwnerHouse (level 0–5, navy outline, 5 pink #F4A9C7 / mist stripes bottom-up, 400ms fill, reduced-motion safe) + email SVG `ownerHouseSvg` — built
- [ ] Use OwnerHouse on every owner screen hero when owner pages are built: Save my spot 0 · RC booked 1 · Quote 2 (small) · Book visits 3 (small) · Install 4 · All done 5 (large); My job large, level from `houseLevelForStage`; owner emails via `ownerHouseSvg` where possible (not the hash-locked likely email)
- [ ] Electrician job offer (Jo-approved 5 Oct, queued after trade launch fixes, preview only). SMS: "HIV: Fresh job in {suburb}, $X in your pocket. First in, best dressed ⚡ {short link}" — link opens offer directly, trade stays signed in on phone. Offer page: logo; navy card with green "Fresh job" pill, pink "Gone in {time left}" countdown (existing offer reply window setting — no rec_offer_expiry_hours exists), headline + small pink bolt "Safety check in {suburb}", "{N} min up the road" (Google Maps drive time from base; postcode fallback until Maps connected), big green "$X" "in your pocket" (their own agreed rate). NEVER show downlights, ceiling size, installer notes or payment terms. "First in, best dressed" / "Tap a time the owner can do and it's yours." Owner 2-hour windows as large tiles; first tap books atomically (reuse accept_partner_offer_slot). Links "Can't make these" (propose time to office) and "Not for me" (decline). "Address and owner details show once you take it." Taken: pill "Locked in", chosen time, owner name + full address, buttons Directions / Call owner / Calendar (.ics), "Nice one. The owner knows you're coming, and we'll ping you the day before." Owner confirmation text+email auto only when sending is on. Lost race: "Too slow this time, someone grabbed it. More coming." Don't publish.

## Electrician "My work" home screen (Jo-approved 5 Oct) — queued with the electrician offer, after trade launch fixes, preview only
- [ ] Build per mem://design/electrician-my-work-home: header logo + today's date; "G'day {first name}" + "{N} jobs this week. Let's go." (friendly 0-job variation e.g. "Quiet week. Fresh jobs will pop up here.")
- [ ] Navy strip only when offers open: pink bolt, "{N} fresh job(s) up for grabs", suburb · "gone in {time}", green "Grab it" -> opens the offer page
- [ ] "Your move" + pink count: only items needing this electrician (e.g. "Fixes approved. Pick a time · {owner}, {suburb} · owner said yes to $X", missing photo), green-bordered card, section hidden when empty
- [ ] "Coming up": booked jobs with day + window tile, "Safety check · {owner surname}", address, chevron to open
- [ ] "This month" mint strip: jobs done + amount earned (own agreed rate only, never customer price/margin)
- [ ] Bottom tabs: Work, Money, My business; mobile-first h-12; no HIV phone number (only "Call owner" on booked visit card)

## Electrician offer "It's yours!" + on-the-day job page (Jo-approved 5 Oct) — queued with the electrician offer, after trade launch fixes, preview only
- [ ] Taken moment: big green banner above the job card — white circle + green tick, "It's yours!" (Outfit 800 ~32px), "Oooft, that was fast clicking.", the time they took e.g. "TUE 14 · 8–10am"; navy card then switches to "Locked in" (owner name, address, Directions / Call owner / Calendar) + "Nice one. The owner knows you're coming, and we'll ping you the day before."
- [ ] On the day: navy card — pink pill "Today · {window}", "Safety check · {owner surname}", address, Directions + Call owner
- [ ] "Ready when you are" white card + fixed green "⚡ Start check" opening the Mitti PIESA form pre-filled for this job; after tap "Over to Mitti" / "Submit the form and this page updates itself."
- [ ] Result cards: no fixes -> mint tick card "All clear. Done and dusted." / "No fixes needed, so the install's good to go."; fixes -> blush card "{N} fixes found. We'll take it from here." + pricing/owner-quote line, then the fixes list from the form; "Back to my work" button
- [ ] Builds on existing guards/paths only: PIESA Mitti form only after a confirmed PIESA booking, setup notice when PIESA template IDs are blank, page refresh from the existing 15-min Mitti sync, install-unlock and 30-day clock via the workflow guards
