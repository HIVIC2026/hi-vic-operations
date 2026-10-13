# LIVE public calculator subset — 2026-10-13
Client fingerprint 05:39:04–06Z (fresh dynamic, all HTTP 200): index-DDnZ9Rrz.js 356901 c55ebc4c…2182; TradeShell-fhc5Pq4n.js 6174 844988b3…d6d1; operations-query-CDmrXud9.js 360 a26d339e…1c32; estimate_._token.video-B05SAXMp.js 10954 149cc5a8…2086. Matches 05:37 capture. Server-only: UNKNOWN.

Run 05:40:49–05:42:02Z, HV-2211/2219/2221 (all source=qa_test), 390 and 1280, ?choice=original and ?choice=updated, reload/back/forward. No clicks.
- HV-2211: "Your spot has been saved" panel, $4,348 after $1,750 rebate (180 m²) — exact stored values, no 150 fallback. Both routes, both sizes.
- HV-2219: saved panel, $3,728 after $1,470 rebate (150 m²) — exact stored.
- HV-2221: unsaved calculator form, no price entered; address shows "couldn't find a Victorian match" (known test address). Logo loads.
- No page errors, no sideways scroll, all HTTP 200.
Known saved-resume bug: NOT reproduced live — saved panel shown on visit/reload/back/forward. Client-side evidence only.
DB: view counts +10 each, +2 qa_test engagement events (normal link tracking). Saved rows unchanged. Sends 211→211, outbox 0.
NOT RUN: Save/confirm clicks, entered-price journey, installer/REC/office/owner signing/payment/pipeline, full portal-qa. No whole-portal PASS.
