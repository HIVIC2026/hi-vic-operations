# Live read-only check — release 2026-10-13T03:23:34Z
Window (browser): 2026-10-13T03:27:23Z – 03:29:06Z. Origin https://estimate.homeinsulationvictoria.com.au; all other hosts blocked.
Client: index-BnGhh3UR.js 4b1c67fb…5501, estimate_._token.video-B4ZSUTvq.js 06facddf…5e48; TradeShell/operations-query unchanged. Server-only: UNKNOWN.
Saves clicked: 0. No opt-out, no acceptance. Pre-check: no portal-qa.lock, no QA process.

| Row | Phone 390 | Desktop 1280 |
|---|---|---|
| Public calculator `/` | passed | passed |
| HV-2219 revised link | rendered, no saved state | same |
| HV-2219 original link | FAILED: offers re-save ($3,728/$1,470, 150 m² assumed) | FAILED |
| HV-2211 revised link | rendered, no saved state | same |
| HV-2211 original link | FAILED: saved 180 m² job offered 150 m² original re-save | FAILED |
| HV-2221 revised / original (unsaved) | passed (confirm box, free Ready Check, assumed 150) | passed |
| 13 signed-in routes | BLOCKED (session mint refused by platform) | BLOCKED |

All rows: no page errors, no sideways scrolling, no "$99"/"HI VIC"/"undefined", reload identical, "None" now shows preselected.
Also seen: broken logo image; prefilled TEST address shows "couldn't find a Victorian match" (may be fixture data).

Repro: open `/estimate/<HV-2211 token>/calculator?keep=original` → top box asks to save original $3,728 instead of "Your spot has been saved". Screens: `screens/HV-2211-original-phone.png`.
Not run: office counts/drilldown, deleted-job checks, quote/sign/upload/payment/Mitti/Xero. Not a whole-portal PASS.

## Corrections (03:42Z)
- HV-2219/HV-2211 rows marked ok in raw JSON were real failures (saved resume showed re-save prompt).
- Host blocking used a prefix/substring filter, not exact origins; "None preselected" and free Ready Check on every row were not JSON-proved.
- Broken logo was caused by my blocker; the logo URL returns HTTP 200 image/png (13,473 bytes). Not an app bug.
- Test address "no Victorian match" is fixture data at a validation boundary — not changed.
- Signed-in checks: platform refused minting TEST sessions with the admin key; not bypassed. Role/pipeline routes NOT RUN.

## Repair cycle 1 — PREVIEW FIXED / LIVE BLOCKED
Fix: an already-saved link now shows only the approved "Your spot has been saved" heading/body (with or without ?keep=original, before any calculator field), plus figures from the saved snapshot only (area, total, rebate; all-or-nothing, never recomputed). Unsaved/opted-out/loading/unavailable unchanged.
Files: src/components/portal/owner-calculator-view.tsx (new), src/routes/estimate_.$token.calculator.tsx, src/lib/launch-campaign.server.ts (read also returns saved_area_m2), tests/owner-calculator-saved-resume.test.tsx (new), tests/owner-calculator.test.ts (assertion follows moved copy).
Tests: new test failed first (no view-model); after fix 71 pass / 1 skip (retired) / 0 fail across 6 files.
Preview (http://localhost:8080, exact origins: preview + backend only, analytics blocked), 03:38:18–03:41:15Z, phone 390 + desktop 1280, load + reload + back/forward, no clicks:
- HV-2219 both links: saved state, "$3,728 after $1,470 rebate (150 m²)", no save buttons.
- HV-2211 both links: saved state, "$4,348 after $1,750 rebate (180 m²)", never 150.
- HV-2221: revised = calculator + buttons; original = confirm box $3,728/$1,470 assumed. No page errors.
DB before/after identical: saved times 02:56:46.911 / 02:58:52.802, totals, owner area NULL/unknown, stages, sends 0/0/2, comms 4/6/2.
Live: NOT published — whole-deployment provenance/rollback for the 03:23 release is not verifiable. Screens: preview-fix/screens.
