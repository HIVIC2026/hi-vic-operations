# Bounded production client release verification — 19 Oct 2026

PUBLIC RENDER CHECKS PASSED; INSTALLER SAMPLE COPY FAILED; AUTHENTICATED COVERAGE BLOCKED; NO WHOLE-PORTAL PASS

## Scope and provenance
- Actual client release: fingerprint 04:07:56Z–04:08:07Z; full hashes in results.json. Server-only UNKNOWN.
- Inspected source HEAD 7d68c923, with 7fc608dc/6429230a dashboard/template changes and Jo build/free-Ready-Check corrections. Editor/source history is NOT deployment proof.
- Recent main-thread Jo requests reviewed. No active QA process or live runner lock found; no explicit new human pause found. Full portal-qa not run: it mints sessions and mutates fixtures.
- One serial production browser batch: 2026-10-19T04:11:31.143Z–2026-10-19T04:11:45.850Z (14.707 seconds; under 240 seconds). Fresh unsigned contexts; only GET rendering; no controls clicked.

## Actual browser observations
| Role / route | Viewport | HTTP | Render | Observed navigation ms | Screenshot |
|---|---:|---:|---|---:|---|
| public customer `/` | 390 | 200 | passed | 2570 | screens/calculator-390.png |
| public customer `/` | 1280 | 200 | passed | 1562 | screens/calculator-1280.png |
| public sample `/installer-onboarding?sample=review` | 390 | 200 | passed | 2701 | screens/installer-review-390.png |
| public sample `/installer-onboarding?sample=review` | 1280 | 200 | passed | 2560 | screens/installer-review-1280.png |
| public sample `/electrician-onboarding?sample=review` | 390 | 200 | passed | 2120 | screens/rec-review-390.png |
| public sample `/electrician-onboarding?sample=review` | 1280 | 200 | passed | 2225 | screens/rec-review-1280.png |

- Six renders: zero page errors, zero HTTP failures, zero document horizontal overflow; logos loaded. All six screenshots visually inspected. Timings are observations, not speed benchmarks.
- Calculator visibly says free Ready Check; no $99/error markers. Empty-state estimate only: no address lookup, calculation, registration or Base44 submission tested.
- Installer sample banner shown and signing disabled. REC review banner shown; Save & continue left untouched.

## Approved-copy discrepancy (no repair)
- Installer sample is v1.16; rendered text contains “For 12 months ... workmanship” and ACL, but no five-year product warranty or life-support written consent OR medical plan. Approved memory requires separate minimum five-year product warranty, written product details/Australian contact, and conditional consent OR medical plan. This is a concrete sample-output discrepancy, not a claim about live signed agreements.
- REC sample v2.5 contains conditional “written consent or medical plan” and ACL. Full current schedule/version parity not verified.
- No app patch: versioned legal/compliance wording is outside ordinary bug-repair permission; no protected/signing journey performed.

## Blocked / not tested
- Office dashboard response queue and trade/REC/owner signed-in navigation BLOCKED: available injected session is not a documented dedicated TEST persona; never restored. No new auth or fixtures.
- Owner secure-link page BLOCKED: no approved link with source qa_test and GET side-effect checks established.
- /calculator alternate route, nonempty calculations, enquiry submission, persisted Ready Check/payment state NOT TESTED.
- Local mocked regressions NOT RUN; broad runner, onboarding writes, older Group B branches/office26/pricing journeys not repeated.

## Communications reads since 04:00Z
- Schema-inspected aggregate SELECTs returned zero new customer_email_sends; zero new/attempted external_action_outbox; zero new/updated customer_followups, SMS, email job_communications. No PII or provider references retrieved.
- Read sequence began 04:10:43Z; schema inspection timestamp 04:11:53.727842Z; completed before 2026-10-19T04:12:45Z. Older send-row status changes not fully covered by created_at filter.
- Independent provider acceptance/runtime unavailable = BLOCKED, not zero failures. No provider API called. Native scoped Group A is not a universal lock; Group B/no-size holds/campaign limitations remain unchanged.

## Safety / evidence changes only
- Eleven telemetry POST attempts aborted. Browser interception is not server isolation; source-guarded sample paths were used, unsafe server/API/address requests blocked.
- No app edits, auth, DB writes, sends/retries, settings/publishing, signing/uploads/bookings/payments/Xero/Mitti/VEEC/media backfill. HV-1981/HV-2010/HV-2015 untouched.
- Only this REPORT.md, results.json and six screenshots added. No build/typecheck claim from this verification.
