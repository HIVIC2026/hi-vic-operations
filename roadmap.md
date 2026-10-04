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
- [ ] No real scheduled timer for reminders/expired offers.
- [ ] No rectification reassignment when REC loses approval.
- [ ] VEEC query/rejected statuses missing.
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
- [ ] Rectification quote timing (24h, day 3 nudges, escalate day 5) — separate step
- [x] Step 6: owner picks 3–5 PIESA windows (morning 8–12 / afternoon 12–4 Melbourne); electrician tap = booking; fallback accept-then-arrange; one more-times request then needs-attention
- [x] Re-prove step 5 quote-expiry migration on practice database
- [ ] 48h escalation fix: booking-based SLA + Ready Check in office sweep
