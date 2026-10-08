# Group B final scope correction — Jo 8 October 2026, 23:07 UTC

## Corrected scope
The existing Group B email subject, preview, wording, layout, estimate and CTA are restored unchanged. Only the secure insulation page questions, declaration routing and original-media audience exclusion remain changed. The ChatGPT draft is not used. Separate real-send launch approval is still required; no delivery/global switches changed.

## Implementation
- Reversed precisely the two renderer changes from `deac20f4`: removed the page-copy import and restored its original hardcoded email paragraph. The entire `src/lib/estimate-email.ts` file is byte-identical to `deac20f4^` (before the withdrawn four-options email change). Earlier approved 03:35/03:37 email changes are retained.
- Page copy remains independent: either qualifying audited homeowner Yes can open existing Save my spot when all other initial criteria pass. No/unsure does not approve. Photo/video submissions and original media require office review; final onsite/compliance checks remain unchanged.
- Original-media and uncertain-manifest exclusions remain enforced for invitation/reminder/link paths. Latest read-only initial Group B counts: 71 actual-media exclusions and 469 uncertain legacy records held, zero confirmed media-free. Authoritative legacy upload confirmation remains outstanding; no radio-based absence inferred.
- Group A, other emails/campaigns, installer pages, pricing and delivery switches unchanged. No database changes, live sends, publication or native action.

## Actual verification
- Whole email source comparison: byte-identical to the pre-request revision.
- Temporary direct comparison of the original and restored renderers: identical subject, preview, HTML/plain text for two valid Group B estimate samples; missing-price/area sample produces the identical refusal. Group A and the unrelated video draft renderer also return identical output.
- Focused suite: **46 passed, 0 failed, 170 assertions** across media exclusion, real campaign handlers on isolated PGlite, campaign rules, insulation rules and Step 3 parity.
- Expanded email regression run: **62 passed, 1 skipped, 1 failed**. Existing failing test reads sample constants from the preview route, although they already moved to `step3-email-samples.ts`; the concrete values are present there. This source-layout assertion fails independently of the email correction. No unrelated preview/test changes made.
- Existing sealed browser checks rerun at desktop and phone: both Yes → campaign → saved; No/unsure; media received/uncertain states without questions/uploads; upload error/Retry and video safety. Zero page errors/overflow. Screenshots inspected. Responses are intercepted: hosted persistence/storage and guarded stage transitions are not proven by this browser check.
- Latest preview harness build: OK at 23:08:46 UTC. Retired-term scan: zero customer-visible failing matches. Diff whitespace check passed.