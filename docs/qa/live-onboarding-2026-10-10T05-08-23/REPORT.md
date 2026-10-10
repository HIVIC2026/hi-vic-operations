# LIVE onboarding subset — 10 Oct 2026 (separate from preview evidence in docs/qa/daily-2026-10-10/)

- Run: 2026-10-10T05:08:23Z → 05:09:47Z (84 s, budget 300 s), one serial batch.
- Command: `bun scripts/qa-onboarding.ts --budget 300 --base https://estimate.homeinsulationvictoria.com.au --live-subset` → exit 0.
- Environment on every row: LIVE published canonical site `https://estimate.homeinsulationvictoria.com.au` (shared production backend). No localhost rows.
- Fingerprint at 05:07:50Z: HTML 200, `index-Cu_v9XUr.js` 356585 bytes, sha256 `6845e8ddb583962f49dfd62cf9fad971c20f68c6bcfe833118abbdf3cf2e848f` (matches baseline). Server-only: UNKNOWN.
- Harness source revision: editor HEAD `7e998481` + this harness change (not deployment proof). App code unchanged.

## Results (24 browser rows + 4 database readbacks, all PASSED)
| Trade | Width | TEST banner | Save p1→p2 | Back keeps answers | Fresh browser resume | Server readback p1 | Page errors | DB |
|---|---|---|---|---|---|---|---|---|
| REC | 390 | pass | pass | pass | pass (saved to 3, resumed 2) | pass | none | test_mode=true, draft, signed_at null, answers incl. licence expiry |
| REC | 1280 | pass | pass | pass | pass (3 → 2) | pass | none | same |
| Installer | 390 | pass | pass | pass | pass (3 → 1) | pass | none | test_mode=true, draft, signed_at null |
| Installer | 1280 | pass | pass | pass | pass (3 → 1) | pass | none | same |

Resume lands on the first unfinished page by design (installer page 1 address deliberately left blank). Not a bug.

## Safety / isolation
- Browser: only the exact origin `https://estimate.homeinsulationvictoria.com.au` allowed (scheme+host+port equality, no prefix match). Aborted: 12 × fonts.googleapis.com. No address lookup, Mitti, worker links, Xero, email/SMS or send buttons used.
- Server: start/save code is identical between published `a75f6932` and HEAD (only agreement-view display changed); onboarding table triggers contain no outbound calls. Browser blocking does not cover server egress; this is the source/trigger basis.
- Fixtures: 4 new unsigned TEST drafts from 4 single-use `qa_test` links issued by `admin@hivic.test` (REC started by the live page; installer drafts started server-side from the run's own consumed link, then resumed live). No existing record changed, so no restore needed. New partner enquiries since start: 0. Secret links/resume tokens not stored here.
- Real HV-1981/2010/2015, globals, templates, no-size hold: untouched.

## Not run / blocked
- Final signing (not requested; earlier blocked by verified-address requirement), uploads, office approve/send-back (real email), owner code/signing (Xero path), Mitti/bookings/VEEC: NOT_RUN.
- No whole-portal PASS.
