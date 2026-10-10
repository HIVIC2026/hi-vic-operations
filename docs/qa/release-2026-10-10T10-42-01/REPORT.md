# Post-release read-only QA — 2026-10-10 (window 10:43–10:50 UTC)

Production client (canonical https://estimate.homeinsulationvictoria.com.au, captured 10:42:01Z):
- index-Bk03pPYx.js sha256 23b75f731ef85360a466a957d4e54d10169f92050fd370433e26fcd9a867d334
- estimate_._token.video-DYPN-NDj.js sha256 781b35255aba1a0ad1338ba2609a094c9ce6676fe46789ab2bec20742fb85eb4
- Server-only version: UNKNOWN. Local editor commit 4b999393 is NOT proof of what is served.

| Area | Env | Result |
|---|---|---|
| TEST sign-in office/REC/installer/owner | live DB | PASSED (existing TEST accounts, no role/account changes) |
| Role screens 390px + 1280px (13 routes × 2) | live site | 22 PASSED, 4 FAILED — /admin/operations and /admin/partners-overview show stored text "HI VIC" (TEST job title "HI VIC FINAL LOCK QA" HV-1048; business name "DC Construction Solutions (HI VIC)"). Data/source finding, not repaired. |
| HV-2218 saved / HV-2221 unsaved campaign pages, phone+desktop, reload/back | live site (10:43:57Z) | PASSED (see previous report); no Save pressed |
| Email log last 24h | live DB | 6 real `save_my_spot` records status `sent` 2026-10-09 21:34 → 2026-10-10 05:52 (HV-2188/2190/2199/2205/2206/2207, all owner-entered size, none no-size); provider_message_id null on all, so provider acceptance NOT confirmed by this read. TEST: 1 failed 10:30:49 (recipient not on test allowlist), 1 sent 10:31:16 (HV-2221). Outbox: 0 rows. |
| Offline email/no-size tests | local mocked | PASSED 40/40 per file via project runner model. Earlier 6/40 failure = running files in one Bun process; `mock.module` is process-wide (reproduced: existing-insulation-send → no-size-save-journey 5 fail; group-b-prehandoff → no-size-save-journey 1 fail). Project `bun run test` already isolates per file; no correction needed. |
| Agreement versions/onboarding pages | — | NOT_RUN (cannot prove page load triggers no address/provider lookups) |
| Signing, uploads, address lookup, payment/booking, office approve/send, Mitti, Xero, VEEC | — | NOT_RUN (no proven provider isolation) |
| Real HV-1981/2010/2015 | live DB | still deleted, untouched |

Screenshots: `screens/`. Machine results: `screens-results.json` (no session values).
