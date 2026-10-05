# Roadmap

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
- [ ] Owner no-login actions after Ready Check (quote accept, payment choice, electrician times)
- [ ] Full owner-picks-times → trade-taps → booked browser run, then scenarios A–D end to end
- [ ] Payments tab: per-job payout due/status
- [ ] Business tab: workers, rates, bulk upload in one place
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
