# P1-R1-S65 — Enquiry UAT Environment Remediation

| Field | Result |
|---|---|
| Step | `P1-R1-S65-ENQUIRY-UAT-ENVIRONMENT-REMEDIATION-01` |
| Executor | Cloud |
| Starting branch / HEAD | `release/p1-rc1-com04` / `d49af17ead30e1aa03dac2625c9d808c492d1e1b` |
| Implementation branch | `cloud/p1-r1-s65-enquiry-environment` |
| Worktree | Isolated worktree below `wt-p1-rc1-com04-integration` |
| Production access | None |

## Executive summary

F-1 was repaired in the existing TEST-enquiry path. The Test Centre checkbox state was already included in the payload, but `qa_test` deliberately skipped `completeIntake()`, so `recordContactConsent()` never ran. TEST enquiries now use the same consent-recording path as Base44 intake while remaining excluded from live post-intake automation.

F-2 was repaired in the local database only. The repository-controlled VEU v25 fixture was loaded (719 rows), and one dated VEEC spot-price observation was loaded from the existing Ecovantage market-update source used by the application. No saved estimate was changed or repriced.

F-7 is supported by the existing TEST role provisioning flow: Test Centre provisions a per-job namespaced owner account under `@hivic-test.example`, assigns the `owner` role, links it to the TEST owner, and issues a one-use local magic link. The historical shared `homeowner@hivic-local.test` password was not reset.

Browser UAT was not performed. R6 must execute E01, E02, E04 and X06.

## Source change

Changed `src/lib/enquiry.server.ts` in both the new-job and repeat-enquiry branches:

```ts
if (source === "base44" || source === "qa_test") await completeIntake(...)
```

This preserves `granted`, `not_granted`, and `unknown` consent states through `planContactConsent`; it does not fabricate a grant or weaken any authorization gate.

## Local environment verification

- Supabase API: `http://127.0.0.1:54321`, HTTP 200 from local PostgREST.
- PostgreSQL: local Docker container `supabase_db_wvuffpykgnqliikhodzl`, published at `127.0.0.1:54322`.
- Database identity checked with `psql`; PostgreSQL 17.11 in the local container.
- The worktree's tracked `.env` points to a hosted Supabase URL. It was not used. The corrected S64 launcher must be run only after a local-only `.env` is supplied; its fail-closed URL check correctly rejects the tracked hosted URL.
- Provider credentials were not used. Local workflow switches remained `customer_comms_enabled=false` and `save_my_spot_real_send_enabled=false`.

## F-1 consent

### Root cause

`createTestEnquiry()` calls `upsertEnquiry(..., "qa_test", ...)`. Before S65, `upsertEnquiry()` called `completeIntake()` only for `base44`; therefore the Test Centre's explicit checkbox never reached `recordContactConsent()`. `campaignLink()` correctly required a persisted `owner_contact_consents.consent_status = 'granted'`, so the CTA was correctly gated.

### Remediation and expected verification

- Explicitly checked consent: one immutable `owner_contact_consents` row with `consent_status='granted'`.
- Unchecked consent: one immutable row with `consent_status='not_granted'`; no campaign access.
- Missing consent: `unknown`; no campaign access.
- Save My Spot and media-request gates continue to read the persisted consent row.
- No real communication is enabled by this change.

## F-2 pricing reference data

### Root cause

S62 observed zero rows in both `veu_location_variables` and `veec_spot_prices`. The estimator therefore failed closed before a numeric result.

### Data source and remediation

- `veu_location_variables`: repository fixture `src/data/veu-location-variables-v25.json`, source version `25.0`, 719 rows, official VEU Specifications v25 PDF URL, fixture SHA-256 `01d7f1725754a6d7a93058d844269ba88da4c5f7a054938e59f7e07e28d09fcd`.
- `veec_spot_prices`: one local-only row, `$84.85`, dated `2026-10-15`, source `Ecovantage market update (online)`, URL `https://www.ecovantage.com.au/energy-certificate-market-update/`. This is an observation for local test/profit reference, not a replacement for the estimator's immutable saved snapshots.
- Before → after: `veu_location_variables` 0 → 719; `veec_spot_prices` 0 → 1.
- Existing `retail_estimator_settings` was not overwritten. Existing saved estimates were not touched.

Rollback: delete only the S65-added VEEC row by its exact date/source/price, and delete the v25 location rows only where `source_version='25.0'` and `source_sha256` equals the fixture hash, after confirming no other local agent has replaced them. Do not reset or truncate the database.

The existing estimator code's 150 m² assumption path remains unchanged. S65 did not reprice any saved estimate and did not represent 150 m² as measured area.

## F-7 Homeowner authentication

The historical account `homeowner@hivic-local.test` was not reset. The current Test Centre flow in `prepareQaJourneyAccess()` creates a per-job owner identity named `qa.owner.<first-eight-job-id>@hivic-test.example`, confirms it locally, assigns the `owner` role, updates the TEST owner's `user_id`, and opens it through a one-use magic link. R6 should use Test Centre → TEST roles → Open as owner for the retained TEST job. This is a local setup procedure, not a browser PASS claim.

## Safety and DEF-07 checks

- COM-04 dual-switch guard present in `src/lib/hot-leads-send.server.ts`; real sending requires both switches true.
- Local switches after remediation: both OFF.
- `customer_email_sends` remained 0 during S65.
- DEF-07 row `official_form_signed_copies.id=82000000-0000-4000-8000-0000000002a1` remained unchanged: snapshot `{}`, MD5 `99914b932bd37a50b983c5e7c90ae93b` before and after.
- No `originating_installer_business_id` or `originating_installer_user_id` values were changed.

## Verification results

| Check | Result |
|---|---|
| Local API/database identity | PASS |
| S64 launcher shell syntax | PASS |
| F-1 source-path remediation | PASS by source inspection; browser execution not performed |
| F-2 v25 location rows | PASS: 719 rows, version 25.0 |
| F-2 VEEC spot row | PASS: 1 dated local row |
| F-7 namespaced owner provisioning path | PASS by source inspection; browser execution not performed |
| COM-04 switches | PASS: both OFF |
| DEF-07 unchanged | PASS |
| `bun scripts/test-isolated.ts 8` | NOT COMPLETED: command produced no output and was stopped after hanging |
| TypeScript validation / build | NOT COMPLETED: local dependency command produced no output within the execution window |

## R6 browser handoff

Use COM-04 commit `d49af17ead30e1aa03dac2625c9d808c492d1e1b` and the corrected launcher at `docs/phase1/run1/P1-R1-S64_LOCAL_LAUNCH_SCRIPT.sh`. Create a local-only `.env` first; do not run the tracked hosted URL. Use local runtime port 8085 (with the S62 same-origin proxy convention if retained). Retained S62 fixtures are HV-1029 (E01), HV-1030 (E02), HV-1032 (E04); use Test Centre to provision the namespaced owner for X06.

R6 should verify:

1. E01: explicit consent → persisted granted row → Save My Spot CTA and response.
2. E02: explicit consent → media-request/upload path.
3. E04: postcode 3073 now resolves from v25 data and produces a numeric indicative estimate.
4. X06: namespaced homeowner sees only its authorized TEST customer record; unrelated customer access is rejected.
5. Unknown-area case uses the existing estimated 150 m² label, never a measured-area label.

## Final verdict

`ENQUIRY_UAT_ENVIRONMENT_PARTIAL` — F-1 and F-2 are remediated locally and F-7 has a reliable namespaced setup path. Automated TypeScript/build verification and browser UAT remain for R6; Cloud makes no browser PASS claim.

