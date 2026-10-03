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
