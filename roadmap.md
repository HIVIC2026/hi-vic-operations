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
- Visual restyle: ON HOLD (Jo, 5 Oct).

## Before live-safety check (Jo, 5 Oct 04:36)
- [ ] Round DOWN to whole VEECs everywhere (21.294 → 21)
- [ ] Ready Check price items: remove Tile lift / Metal sheet access (spec, AI prompt); validator still accepts live template
- [ ] Onboarding: remove pink access-charges note entirely
- [ ] R-value plan: add install-day product check (plan only)
- Note: $299 AP fee ReInsulate ONLY; all others + HIV leads $349
- [ ] Then live-safety check → SAFE TO PUBLISH or blockers; do not publish
