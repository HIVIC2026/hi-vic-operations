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
