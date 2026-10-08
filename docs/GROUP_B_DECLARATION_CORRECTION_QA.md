# Group B — Jo's 22:47 correction

The correction supersedes the earlier declaration office-review stop. Either explicit Yes (loose-fill only / less than R2) qualifies the preliminary queue only when the current recorded non-insulation checks pass. Photos/video alone need office review. No bulk send activation or publication.

## Proof
- `bun test ./tests/group-b-declaration-routing.test.ts`: 17 pass, 68 assertions. Actual campaignLink/campaignPage/recordInsulationDeclaration/saveCampaignSpot/markCampaignMediaReceived code, isolated PGlite fixture using existing campaign migrations. Workflow event persistence is backed by PGlite; stage transitions and ancillary estimate/referral boundaries are mocked. No hosted database schema/data changes.
- Both declaration types: audited raw Yes/question/type/time/basis, same spot page and saved row, preserved present insulation and $2,500 total/$1,400 rebate from existing estimate, repeat save has one row; no invented reviewer or review timestamp.
- Media pending cannot save; actual reviewer fields required by fixture constraint before looks_eligible can save. No/unanswered/unsure and old unauthorised below-R2 history do not qualify. Ineligible/closed/opted-out/expired/revoked/wrong-source/no-consent/review/initial-processing links blocked. Other missing/changed criteria block. Negative office finding overrides earlier Yes. Declaration calculator cannot save absent-insulation pricing.
- `bun test ./tests/insulation-review.test.ts ./tests/enquiry-groups.test.ts ./tests/save-spot.test.ts`: 75 pass, 318 assertions.
- `/tmp/browser/group-b-correction/check_journeys.py`: sealed real UI with intercepted server responses. Desktop 1280×1800 and phone 390×844: both questions Yes→same campaign→Spot saved, No/unsure send no declaration, four choices, invalid file/error/Retry and manhole safety; zero page errors or overflow. Screenshots visually inspected. This is not a hosted end-to-end persistence claim.
- Harness preview check: build OK after correction.

## Boundaries
Hosted declaration/spot persistence, actual guarded workflow transitions and real media storage are not exercised here. Original source answers and official eligibility remain unchanged. Existing office review decisions and historical declaration details remain intact. Existing confirmation delivery guards are unchanged, not activated or tested for delivery. No customer writes, emails, texts, native forms, signatures, approvals, or publication.
