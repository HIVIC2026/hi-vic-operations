# Daily read-only verification — 10 Oct 2026 (UTC), evidence folder dated 11 Oct (Melbourne)

Environment: canonical production https://estimate.homeinsulationvictoria.com.au. Read-only: no app, database or settings writes; no sends, sign-ins, provider calls or publishing. Only these evidence files were written.

## 1. Production client fingerprint (19:48:40–19:48:44Z, new folder)
All four files fresh HTTP 200, unchanged vs 18:18:20–18:18:27Z baseline:
- index-Bk03pPYx.js 356585 23b75f731ef85360a466a957d4e54d10169f92050fd370433e26fcd9a867d334
- TradeShell-fhc5Pq4n.js 6174 844988b33731e2eb08fed19fa61043bcc683b6cf52adec0e8f27c212a4f0d6d1
- operations-query-CDmrXud9.js 360 a26d339e87a184b7738b3583cfbf256cfeaa7543c98ee2f16d9197b1b1f31c32
- estimate_._token.video-DYPN-NDj.js 10954 781b35255aba1a0ad1338ba2609a094c9ce6676fe46789ab2bec20742fb85eb4 (reference extracted from the fresh index)
Server-only: UNKNOWN.

## 2. Agreement viewer
- Normal server agreement viewer / signing: **BLOCKED (not tested)**. Reaching the review step requires saving steps; existing drafts reopen only through a browser-held token (stored hashed server-side).
- **LIVE deployed-client SAMPLE VIEW ONLY** — first browser batch 19:52:16–19:52:33Z (four pages, in results.json). Clean anonymous browser. URLs not starting with the canonical prefix were aborted (prefix check, not an exact-origin allowlist, not server isolation); observed aborts were Google Fonts (external) and two POSTs to `__l5e/trackevents` (analytics) per page. Every non-GET request was aborted. Save, sign and the review checkbox were never clicked. Presentation manually reviewed alongside raw checks; this is not an automated four-PASS.

| Page | Width | Sample notice | Version | Schedule | Overflow | Page errors | Result |
|---|---|---|---|---|---|---|---|
| /installer-onboarding?sample=review | 390 | detector false (case); manually seen in screenshot | HI-VIC-A48-INST-1.19-2026-10-09 | A48-COMPLIANCE-1.0-2026-10-09 | none | none | sample view reviewed |
| /installer-onboarding?sample=review | 1280 | detector false (case); manual: unknown | same | same | none | none | sample view reviewed |
| /electrician-onboarding?sample=review | 390 | yes | HI-VIC-A48-REC-2.6-2026-10-09 | A48-COMPLIANCE-1.0-2026-10-09 | none | none | sample view reviewed |
| /electrician-onboarding?sample=review | 1280 | yes | same | same | none | none | sample view reviewed |

Full clause text below came from a separate second phone (390) browser read after the batch (same restrictions); results.json holds only excerpts.

Rendered clauses observed:
- Installer: "Defects and workmanship warranty. For twelve months after completion of each Job, the Installer must return and correct any defect caused by its workmanship at its own cost within a reasonable time after notice. This twelve-month period does not exclude, restrict or modify any non-excludable guarantee, right or remedy under the Australian Consumer Law."
- Installer: "Product warranty. … warranty against defects for a minimum of five years … The product warranty is separate from, and does not replace or reduce, the Installer's responsibility to rectify defects caused by its workmanship …"
- REC: "Defects. For 12 months after completion of each Job, the REC must return and correct any defect in its workmanship at its own cost within a reasonable time after notice. This does not limit any guarantee under the Australian Consumer Law."
- Installer's own agreement has the product-warranty clause; the REC agreement has no own product-warranty clause and shows it only through the shared Schedule 4.11, which assigns product details to the Installer and document delivery to the AP.
- Schedule 4.11 (both): minimum five-year product warranty-against-defects document; Australian warranty contact where warrantor is overseas; "separate twelve-month workmanship warranty and all non-excludable Australian Consumer Law rights".
- Life support (both): "written consent or a medical plan must be obtained before the PIESA starts".
- No sentence pairs workmanship with a five-year period (superseded wording absent).
- The installer page's sample notice reads "Sample preview — no data is saved…" (sentence case), seen by the agent in the 390 screenshot; raw detector recorded false. REC detector matched "SAMPLE PREVIEW".
- The only blocked requests were page analytics (`__l5e/trackevents`, POST) and Google Fonts (external). Back navigation: NOT_TESTED.

## 3. Email records (read-only, 19:49:29Z; area facts from 19:50:56Z read)
- 7 real base44 `existing_leads_launch_v1` rows recorded `sent`, 9 Oct 21:34Z – 10 Oct 11:06Z (latest HV-2222); all provider IDs NULL, so the email service's acceptance is not proven. The stored areas currently read 100, 105, 90, 150, 109, 125 and 70, all with estimated_area_unknown=false. These are current values; whether each owner originally entered the area is not inferred.
- TEST HV-2221 (area null, unknown=true): failed on the test allowlist at 10:30:49Z, then recorded sent at 10:31:16Z with a NULL provider ID. Not retried.
- external_action_outbox: no rows in the last 24 hours and nothing pending. That does not prove every send path is idle.
- customer_email_sends, all purposes, last 24h: only the 9 `existing_leads_launch_v1` rows (7 real + 2 TEST); no other purpose rows. This covers only that table, not all provider logs.

Screens: `screens/*-sample-review-{390,1280}[-end].png`. Raw rows: `results.json`.
