# Existing-insulation Save your spot follow-up — 8 October 2026

## Verified gap
- Standard Step 3 Save your spot ignored existing insulation in its price qualifier. The initial Group B invitation already had its own exclusion and is locked separately.
- Office photo/video review recorded `below_r2` but did not invoke a follow-up sender. The existing sender routed onsite leads to the initial invitation and correctly excluded original enquiry media.

## Narrow correction
- Optional follow-up-only removal facts come from the primary headline scenario, not an alternate hypothetical removal scenario. Zero cost AND zero removal area means excluded; positive priced area means included with its amount; absent/inconsistent facts remain unknown.
- HTML and plain text put Jo’s exact exclusion beside the estimate price only for a removal-excluded existing-insulation follow-up. Priced removal has its own included line and reconciles to the gross total.
- Secure estimate and Save your spot page show the same primary-scenario clarification. Snapshot fee figures are retained where available; pricing calculations and declared insulation are unchanged.
- Office below-R2 rows have a separate preview/send action through an admin-protected function. It rechecks preliminary criteria, review/declaration, current secure link, source, consent, opt-outs, current estimate, prior attempts and global communications lock. It does not invoke the original-media invitation exclusion or activate that campaign.
- Prior follow-up attempts, including uncertain outcomes, stop subsequent delivery. Sending remains blocked by the existing global lock. No email was sent or queued by this task; no database or live customer changes, activation or publication.

## Checks
- Approved initial Group B and no-insulation email outputs match their pre-edit SHA-256 hashes byte-for-byte.
- Focused renderer and regression suite: 43 passed, 1 retired test skipped, 363 assertions. The stale preview-source test now reads the existing shared sample module instead of its former location.
- Actual office sender exercised with isolated mocks: reviewed original media and qualifying owner declaration select the correct follow-up; unqualified and globally locked sends are refused; prior attempts prevent repeats. No external calls.
- Actual campaign handlers on PGlite: 22 passed, 96 assertions; declarations, original media/review, consent, opt-out, stage and idempotent spot saving preserved. No database migration.
- Sealed browser: desktop 1280×1800 and phone 390×844, both excluded/included prices; reviewed original media opens Save my spot without another invitation; no overflow or page errors. These are rendered fixture checks, not hosted customer persistence or delivered-email verification.
- Preview harness reported build OK. Hosted delivery and authenticated office-button end-to-end execution remain unverified; delivery is intentionally not activated.