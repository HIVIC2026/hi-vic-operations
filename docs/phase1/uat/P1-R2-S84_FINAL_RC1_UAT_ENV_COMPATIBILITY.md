# P1-R2-S84 — Final RC1 Candidate ↔ Disposable UAT Environment Compatibility

**Step:** P1-R2-S84 · **Agent:** R2 · **Date:** 2026-10-16 AEDT
**RC1 candidate under test:** HEAD `4194630dfb1a1312d59967c61879c983388e5084` (integration/p1-rc1-s67; includes S74 DEF-07 + S86 COM04 Option A + S87 S64).
**Environment (only):** S75/S82 disposable UAT stack — project `hivic-uat-disposable`, API `127.0.0.1:54331`, PostgreSQL `127.0.0.1:54332`, app `127.0.0.1:8091`. No new environment provisioned. No DB writes/migrations/reset.

## Method (read-only + ephemeral app start; nothing destructive)
1. Ran the purpose-built non-destructive `verify-uat-env.sh` (SELECTs/GETs/container-listing only).
2. Started the **RC1** app from the integration worktree against the **disposable** env via the S75
   `launch-uat-app.sh` guard model (process-env overrides the production `.env`; every provider key blanked;
   binds `127.0.0.1:8091`; asserts no `wvuffpykgnqliikhodzl`/`supabase.co` in env; verified the disposable
   anon key returns HTTP 200 before serving), probed HTTP/auth/routes, then stopped it.
3. Read-only SQL against the disposable DB for schema/COM04/fixtures/electrician scenario.

## Results
| # | Check | Result |
|---|---|---|
| V1 | Integration HEAD + clean worktree | `4194630d…`, **0 uncommitted** ✓ |
| V2 | Disposable stack isolated & running | `supabase_db_hivic-uat-disposable` up on :54332 / Kong :54331; **prod-ref `wvuffpykgnqliikhodzl` separate on :54321/54322, untouched** ✓ |
| V3 | RC1 code ↔ UAT schema | core tables present (workflow_settings, profiles, jobs, quotes, ready_checks, piesa_records, assessments, documents); **RC1 SSR rendered 200 against it** ✓ |
| V4 | Migration 0205 + COM04 switches | `save_my_spot_real_send_enabled` column present; `customer_comms_enabled=false` and `save_my_spot_real_send_enabled=false` (both OFF); `0202 signed_webhook_nonces` present; `0203 get_my_profile()` present ✓ |
| V5 | Synthetic accounts + fixtures | **10 synthetic auth users / 10 profiles** (`@uat.example.test`); roles admin2/electrician2/installer2/owner3/property_manager1; **0 non-synthetic (no production data)** ✓ |
| V6 | App starts vs disposable only | `GET /` → **200**, `/calculator` → 200, `/auth` → 200 (SSR compiled; only createServerFn deprecation warnings) ✓ |
| V7 | Local auth + critical API routes | gotrue `/auth/v1/health` → **200**; disposable PostgREST anon `workflow_settings` → **200**; app routes render ✓ |
| V8 | S64 electrician manual-result fixture | **GAP** — see below |
| V9 | No real email/SMS possible | all provider keys blanked in the launcher env; COM04 both switches OFF ✓ |
| V10 | No production/shared DB accessed | app env pinned to `:54331`; production-ref guard passed; disposable DB touched read-only only; app process stopped ✓ |

## V8 — Electrician manual-result fixture: exact gap + requirement for R2
The S64 manual-result path renders only when a job is at `assessment_booked`/`piesa_scheduled`, has an **active
electrician assignment** to an **approved** `partner_workers` electrician, and its `assessments` row has
**`external_mitti_id IS NULL`**, then completes via the normal gated `completeAssessment`.
Observed on the disposable DB (read-only):
- Live job stages present: `new_enquiry(2)`, `eligibility_review(1)`, `awaiting_electrician(1)`,
  `assessment_booking(1)`, `ready_for_installer_quotes(1)`, `awaiting_quote_acceptance(1)`, `installation_scheduling(1)`
  → **no job at `assessment_booked` or `piesa_scheduled`** (the `assessment_booking` job `…a003` is one step short).
- `active_elec_assignments = 0` (no active `job_assignments` role=electrician).
- `assessments`: 3 total, **all 3 already `external_mitti_id IS NULL`**; 3 `piesa_records` — but none tied to a
  job at the right stage with an active electrician assignment.

**Required synthetic fixture (isolated, owner-authorized; NOT created here — no shared/prod write):**
1. Advance one TEST/`base44` job to `piesa_scheduled` (or `assessment_booked`).
2. Create an **active** `job_assignments` row role=`electrician` to one of the 2 electrician synthetic accounts,
   backed by an approved `partner_workers` row (`approval_status='approved'`, current licence/certification) so the
   S64 worker path + authorization gates are exercised — **satisfy** the gates, never bypass them.
3. Ensure that job's `assessments` row has `external_mitti_id IS NULL` (already the case for existing assessments)
   and the prerequisite current measure-up/plan/rectification records the `completeAssessment` gates require.
This is a UAT-prep seeding task for R2/R5 in the disposable stack (a scoped, reversible fixture action), not a code
or environment incompatibility.

## Compatibility verdict
- **Environment + schema + COM04 + synthetic accounts + RC1 app startup + auth/API**: all **compatible and green**.
- The only gap is a **missing electrician manual-result fixture (V8)** — a data-prep prerequisite, not an
  environment/code incompatibility. It does not block the rest of unified UAT.

## S85 entry-gate recommendation
**CONDITIONAL GO to S85 unified UAT on RC1 `4194630d`** against `hivic-uat-disposable`:
- Proceed for enquiry/save-my-spot/estimate, quote/acceptance, office/homeowner, installer flows, COM04 safety,
  PIESA/PIISA gates, authorization/RLS, and DEF-07 fail-closed.
- Before exercising the **S64 electrician manual-result** scenario, have R2/R5 seed the fixture above (isolated,
  owner-authorized). Until seeded, mark electrician manual-result UAT **BLOCKED_NO_FIXTURE**.
- Formal browser UAT is **R6-only**; not started here (this task is compatibility verification, no browser).
- Confirm at UAT start that both COM04 switches remain false and no provider keys are set.

## Boundaries honoured
No production writes; no shared/prod-ref DB access; no DB modification/reset; no migration applied; no real
email/SMS (providers blanked, switches OFF); no push, no merge, no deployment. Disposable DB used read-only;
the ephemeral dev server was bound to `127.0.0.1:8091` and stopped.

## Fields
FINAL_RC1_SHA: 4194630dfb1a1312d59967c61879c983388e5084
UAT_ENVIRONMENT_STATUS: HEALTHY_ISOLATED (hivic-uat-disposable; verify-uat-env.sh all PASS; prod-ref untouched)
MIGRATION_COMPATIBILITY: COMPATIBLE (0202/0203/0205 objects present; RC1 SSR runs against schema)
COM04_SWITCHES: BOTH_OFF (customer_comms_enabled=false; save_my_spot_real_send_enabled=false)
SYNTHETIC_FIXTURES: PRESENT_10 (10 accounts/10 profiles, no production data) — EXCEPT electrician manual-result (see V8)
APPLICATION_STARTUP: PASS (/, /calculator, /auth → 200 against disposable only)
AUTHENTICATION: PASS (gotrue health 200; disposable anon API 200; auth route renders)
ELECTRICIAN_FIXTURE: MISSING (needs piesa_scheduled/assessment_booked job + active approved-electrician assignment; requirement recorded for R2)
BLOCKERS: electrician manual-result fixture (data-prep, R2/R5); formal browser UAT not run (R6); migrations 0149/0202 still REPORTED-only in production (unrelated to UAT env)
S85_ENTRY_GATE_RECOMMENDATION: CONDITIONAL GO (proceed for all flows except S64 electrician manual-result, which needs the fixture first)
FINAL_VERDICT: RC1_UAT_ENV_COMPATIBLE
