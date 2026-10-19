# STEP82 — W4 Cross-Business Field Access Report

**Observation ref:** STEP81-D1 • **Worktree:** `wt-w4-step82-cross-business` • **Date:** 2026-10-12
**Posture:** local-only; W0/MAIN read-only; no authorization check weakened.

---

## 1. Status
**CONFIRMED SYNTHETIC-FIXTURE ISSUE — NO PRODUCTION CODE CHANGE REQUIRED.**
The STEP81-D1 field-access event is **not** a production-reachable cross-business bypass. It was caused by a **manually-inserted, stray `business_admin` membership** in the local UAT database. Production authorization logic and RLS behaved exactly as designed.

## 2. The observation
During STEP81 UAT, `ffsadmin.uat` (`bc6ce692-3360-48f3-9c8d-3b68fbdc7b6a`) opened installation job `UAT-STEP81-A3-INSTALL` (`81000000-…-000000000203`) at `/field/<uuid>`. Suspicion: a `source = 'qa_test'` job loosens access.

## 3. Root cause
- **The job belongs to business `79000000-…-000000000101`** (its assigned business), **not** the STEP81 "other" business `81000000-…-000000000301`.
- **`job_assignment_role` (migration `0115_trade_job_access.sql`) branch 3 is intended behaviour.** The migration header states the design: *"Approved staff … reach the jobs they were sent to, **and the business boss sees the business's assigned jobs**."* Branch 3 grants a role when
  `business_members.business_id = job_assignments.business_id AND member_role = 'business_admin' AND active`.
  This is the **assigned** business only — a correctly scoped "business boss sees own-business jobs" grant, **not** an over-broad or source-driven rule.
- **ffsadmin.uat wrongly held a second active `business_admin` membership on the assigned business `790…101`** (`business_members.id = 79000000-…-000000000104`). Because of it, `job_assignment_role(203, ffsadmin)` returned `installer`, so `can_access_job` returned true. The guard did exactly what the data told it to.

## 4. Evidence (captured before/after; reproduction preserved)
- **Stray row (raw):**
  `{ id: 79000000-…-000000000104, business_id: 79000000-…-000000000101, user_id: bc6ce692…(ffsadmin), member_role: "business_admin", active: true, added_by: null, created_at: 2026-10-12T07:07:04Z }`
- **Reproduction (live, service-role):** `job_assignment_role(203, ffsadmin)` → **`"installer"`** (access granted). ffsadmin's *legitimate* membership is `business_admin` of her **own** business `bbbb0000-…-0000000b0001` (unaffected).
- **Not in any committed fixture:** grep for `79…104` and for ffsadmin's uuid across all `*.sql` / seed files → **no match**. This worktree ships **no committed seed files**; UAT data is populated at runtime.

## 5. `source='qa_test'` hypothesis — DISPROVEN
`source` appears in authorization SQL **only** in migration `0113` to *restrict archiving*; it never appears in `can_access_job` / `job_assignment_role` / RLS. A dedicated test proves `qa_test` and `office` yield **identical** access decisions. The STEP81 suspicion is refuted.

## 6. Runtime origin of the stray row — NOT production-reachable
- Every application insert of a `business_admin` membership uses the **service-role** client and runs behind an **admin/office gate**. The test-account provisioner (`src/lib/test-accounts.functions.ts`) is guarded by `requireTestAdmin` → `has_role('admin')` (*"Admin only."*) and **only links a user as admin of the business it itself creates (keyed by `spec.name`)** — it has **no path** that links ffsadmin to an unrelated existing business.
- **Decisive signal: `added_by = null`.** Every committed code path sets `added_by = context.userId`; this row has `added_by = null`, so it was **not** produced by application code. It is a **direct manual/ad-hoc DB insert** made during the STEP81 session.
  Evidence — every `business_admin` membership insert in the codebase stamps the actor:
  - `src/lib/test-accounts.functions.ts:158` — `upsert({ … member_role: "business_admin", active: true, added_by: context.userId }, …)`
  - `src/lib/test-approval.server.ts:34` — `upsert({ … member_role: "business_admin", active: true, added_by: p.actorId }, …)`
  - `src/lib/partner-activation.functions.ts:175` — `upsert({ … member_role: "business_admin", active: true, added_by: actorId }, …)`
  - `src/lib/jo-tradie.server.ts:57` — `upsert({ … member_role: "business_admin", active: true, added_by: actorId }, …)`
  - `src/lib/pilot.functions.ts:216` — `upsert({ … member_role: data.memberRole, active: true, added_by: context.userId }, …)`
  No committed insert path leaves `added_by` null, so `added_by = null` is airtight evidence of an out-of-band manual insert.
- **Conclusion:** no user-reachable self-service path, and no reachable server bug, can create a cross-business `business_admin` membership. The bypass exists **only** under hand-inserted test data — **isolated test conditions**, not production.

## 7. Remediation
- **No production authorization code changed** (correct per the fixture-only rule).
- **Fixture correction (documented, not silently applied to shared state):** deactivate the stray row
  `business_members.id = 79000000-…-000000000104` (set `active = false`) in any environment that reproduces STEP81's seed. When applied, `job_assignment_role(203, ffsadmin)` flips **`"installer"` → `null`** (verified during investigation). The live shared UAT row was **restored to `active = true`** after verification so the defect remains reproducible for W0.
- **Regression test added** — `tests/step82-cross-business-access-db.test.ts` (PGlite; extracts the real `0115` SQL): admin of **assigned** business → role (intended); admin of **unrelated** business → `null`; stranger admin → `null`; plain member (non-assigned user) → `null`; assigned installer → role (no regression); `qa_test` vs `office` → **no difference**.

## 8. Verification
- New regression test: **6 pass / 0 fail**.
- Existing authz DB suites (`trade-job-access-db`, `a3-a4-role-isolation-db`): **40 pass / 0 fail** (no regression).
- `tsc --noEmit -p tsconfig.json`: **exit 0**.
- **Build:** skipped — **no application code changed** (tests + docs only); per TASK D, build runs only on app-code changes.
- Live DB: reproduction preserved (`role(203, ffsadmin) = "installer"` after row restored).

## 9. W0-merge recommendation & residual risk
- **Recommendation: SAFE to merge W4 to W0.** W4 adds only a test + this report; it changes no production code, migrations, or RLS. There is nothing in W4 that can weaken access.
- **Residual risk: LOW.** The only defect was hand-inserted local test data. **Release action for W0 seed hygiene:** ensure the stray `790…104` membership is not carried into any shared/seeded dataset (deactivate or omit). No product fix is owed.
  **Note for W0:** the live shared UAT row is intentionally left `active = true` to preserve the reproduction for W0 review. **W0 must apply the documented fixture correction (deactivate/remove `business_members.id = 79000000-…-000000000104`) after confirming the reproduction**, so it is not left enabled indefinitely.
- **Commit SHA:** `afb33e70b2a140b69c938903b68cf2559aaf225a` (W4 local: test + report only; no app code).
