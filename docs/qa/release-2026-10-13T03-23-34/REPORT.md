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
