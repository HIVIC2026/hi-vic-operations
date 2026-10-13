# LIVE public calculator subset — 2026-10-13
Client fingerprint 05:39:04–06Z (fresh dynamic, all HTTP 200): index-DDnZ9Rrz.js 356901 c55ebc4c…2182; TradeShell-fhc5Pq4n.js 6174 844988b3…d6d1; operations-query-CDmrXud9.js 360 a26d339e…1c32; estimate_._token.video-B05SAXMp.js 10954 149cc5a8…2086. Server-only: UNKNOWN.

## Earlier runs — DIAGNOSTIC DEFAULT VIEWS ONLY (results.json, screens/)
- Run A 05:39:39–05:40:22Z: read function blocked, pages showed "This link isn't available". Discarded.
- Run B 05:40:49–05:42:02Z: used ?choice=… which the route ignores (only ?keep=original), so all 12 rows were default views. The saved_heading regex was wrong (false on all rows). Not original/revised proof.

## Corrected run (results-corrected.json, screens-corrected/) 05:44:33–05:45:56Z
3 qa_test jobs × 390/1280 × visit keep=original → reload → visit normal → reload → back → forward = 36 checkpoints. **36 PASS, 0 FAIL.**
- HV-2211 / HV-2219 at every checkpoint: "Your spot has been saved", testid spot-saved, exact "$4,348 … $1,750 … (180 m²)" / "$3,728 … $1,470 … (150 m²)", no Save button, no dialog; 2211 shows no 150 m².
- HV-2221 keep=original: confirm dialog "Save your spot using the original estimate: $3,728 after an estimated $1,470 rebate (150 m², assumed)?". Normal route: calculator, no dialog. Not clicked.
- HTTP 200, no page errors, no sideways scroll at every checkpoint.
Known saved-resume bug: not reproduced live on the keep=original or normal routes (public client view only).

DB 05:46:03Z: view counts +12 each; saved rows unchanged; 0 new comms on test jobs. Global email sends 211→212 came from a real Base44 repeat enquiry (HV-2181, 05:46:02Z), not this run.
NOT RUN: Save/confirm clicks, entered-size price journey, address lookup, installer/REC/office/owner signing/payment/pipeline, full portal-qa. No whole-portal PASS.
