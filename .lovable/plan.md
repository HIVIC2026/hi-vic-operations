# REC onboarding: nine-screen flow and address fix

## Scope
- Keep the existing REC business-only registration, staff invitation stop, insurance/rate/bank checks, final authority acknowledgement, agreement text, signed records, and no-write samples unchanged in meaning.
- Do not publish, send communications, create applications, sign agreements, or activate partners.

## Implementation
1. Add a pure visible-page definition in the REC onboarding rules. Each of the nine pages will declare its legacy member keys, with helpers that map legacy saved/sample/history keys to the containing page, aggregate all member errors, find the first incomplete visible page, and save a canonical legacy anchor.
2. Recompose the public form into nine screens:
   - About you
   - Business details (including business address)
   - Insurance
   - Work & coverage
   - Availability
   - Rates
   - Payment details
   - Review agreement
   - Sign agreement
3. Shorten the welcome, headings, hints, service copy, and rate guidance exactly as requested while preserving required acknowledgements and the full agreement wording.
4. Replace transient address suppression with resolved-address-aware interaction state. Verified addresses remain closed after resume/remount or copying the business address; edits invalidate verification and clear results; stale debounce/search/detail responses cannot reopen or overwrite state after selection, blur, Escape, outside click, or unmount.
5. Expand focused tests for all merged groups, legacy key mapping, mandatory services in relaxed/sample paths, and address interaction/race behavior where the existing test setup supports it.

## Verification
- Run focused REC onboarding and activation tests.
- Run the TypeScript check and confirm the preview build status.
- Browser-check the no-write samples at desktop and mobile widths, including mouse and keyboard address selection, editing after selection, blur/Escape, remount/back behavior, and “Use business address.”
