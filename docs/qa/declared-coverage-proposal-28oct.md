# Declared coverage proposal — 28 Oct 2026

## Requested behaviour
- Office-only proposal on the existing business details screen, for installer and electrician businesses without verified coverage.
- Uses the declared address's known 3xxx postcode centroid and straight-line travel radius.
- Radius 9999 proposes `["3*"]`, displayed as “All Victorian postcodes (3xxx)”.
- Non-3xxx centroid entries are excluded. Declared exclusions are displayed, not applied.
- Confirm coverage calls the existing saveBusiness action with the proposed list and verify_coverage=true. Existing verification stamps and manual postcode field remain unchanged.
- Only the service_postcodes array cap changed, from 500 to 750; other validation and matching are unchanged.

## Verification
- New proposal tests: 5 passed.
- Save-limit test: 1 passed (750 accepted, 751 refused).
- Local confirmation journey: 2 passed; both installer and electrician fixtures require office confirmation, save only the selected business, and leave the second business unchanged. Partner view has no confirmation action. This uses local fixtures, not hosted data.
- All coverage-named test files: 27 passed, 0 failed.
- Preview compilation and typecheck: build OK at 06:55:34 UTC.
- `bun run test` was attempted but its output aggregation crashed with ERR_STRING_TOO_LONG. An equivalent per-file isolated run, using the same local-only environment and per-file Bun commands, completed all 766 files: **7354 passed, 225 failed, 36 skipped; 78 failing files**. No unrelated failures were repaired.
- Hosted business save was deliberately not exercised: Jo prohibited business-data changes. No business records, switches, matching rules, delivery settings or publication were changed.