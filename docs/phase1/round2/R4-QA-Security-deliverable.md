# Phase 1 · Round 2 · Agent R4 (QA / Security) — Deliverable

**Agent:** R4 (QA / Security)
**Worktree commit (evidence baseline):** `b2970e4f5fb5683953d2786d83dcff73b9915cfb`
**Harness:** `bun ./scripts/test-isolated.ts 8` (isolated per-file Supabase env; `ALLOW_PROD_SUPABASE` unset)
**Date:** 13 Oct 2026 (UTC)

---

## 1. Executive summary

| Item | Result |
|---|---|
| **Full-suite baseline** | **320 files · 2940 pass · 22 fail · ~100s** |
| **Failures** | 22, confined to **4 files**, all in the **owner-communication / Save-my-spot / Group-B declaration-routing** feature domain |
| **Security-boundary suites (TASK C)** | **138/138 PASS** by dynamic execution (not static inspection) |
| **TASK A — profiles least-privilege migration** | **Delivered + verified: 5/5 new regression tests pass** |
| **The failing 22** | **NOT R4-owned** (feature/business-logic in R1–R3 scope). Exact reproduction evidence provided below; no feature logic changed by R4. |

> Note on the "23 failures" brief: the current, reproduced count at this commit is **22**, not 23. All 22 are in the same four files and are feature-logic (renderer/routing/consent gating) defects, **not** security, RLS, migration-ledger, or QA-infrastructure defects.

---

## 2. TASK A — `profiles` least-privilege migration (R4-owned) ✅

**Problem (D-6 / GAP-10):** the signed-in browser role (`authenticated`) could read **other users'** sensitive `profiles` columns (`email, phone, business_id, licence_number, mitti_*`) because the original `self_read` policy was `id = auth.uid() OR public.shares_job_with(id)` — i.e. every co-worker on a shared job was fully readable client-side.

**Fix (staged, idempotent, reversible):**

- `docs/pending-migrations/0203_profiles_least_privilege.sql`
  1. `get_my_profile()` — `SECURITY DEFINER` RPC returning **only** `WHERE id = auth.uid()`.
  2. Replaces `self_read` with own-row-only `self_read_own` (`id = auth.uid()`) for `authenticated`.
  3. `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO authenticated`.
  - **Admin** retains full access via the pre-existing generic `admin_all` (`is_admin()`) policy.
  - **Service role** bypasses RLS, so all `*.server.ts` server flows and shared-job workflows are unaffected.
- `docs/pending-migrations/0203_profiles_least_privilege.rollback.sql` — restores the original `self_read` and drops `get_my_profile()`.

**Migration numbering (verified against the live ledger):**
- `drizzle/migrations/meta/_journal.json`: idx `0..148`, last tag `0148_job_soft_delete_claims`.
- `APPLIED_MANUALLY.md`: `0149` and `0202` applied **out of band** to production and deliberately **not** journalled; staged pending files also occupy `0149..0202`.
- ⇒ `0149` and the whole `0150..0202` band are **unsafe to reuse**. First clearly-free number above every consumed value = **`0203`** (this file). Re-derive against the live ledger again immediately before any apply.
- Placed under `docs/pending-migrations/` with the repo's **STAGED — DO NOT APPLY without owner approval** convention.

**Regression test — `tests/profiles-least-privilege-db.test.ts` (PGlite, applies the real migration SQL verbatim):**

```
(pass) get_my_profile() returns ONLY the caller's own row (own-profile access preserved)
(pass) migration installs own-row-only policy; browser can read ONLY itself (not coworker/stranger)
(pass) sensitive columns of another user are not browser-readable after hardening
(pass) admin (is_admin) and service role still read every row (office/admin + server preserved)
(pass) rollback restores the original self_read (shared-job visibility returns)
5 pass · 0 fail
```

---

## 3. TASK C — Security-boundary assertion by dynamic execution ✅

All executed against the isolated harness (not static inspection). **138/138 pass:**

| Suite | Result |
|---|---|
| `a3-a4-role-isolation-db` | 36 pass |
| `a3-intake-progress-access` | 11 pass |
| `admin-pipeline-visibility` | 5 pass |
| `ffs-field-access.step36` | 15 pass |
| `onboarding-security` | 21 pass |
| `owner-link-and-mitti-auto` | 6 pass |
| `partner-login-link-24h` | 4 pass |
| `partner-worker-access` | 3 pass |
| `security-review` | 9 pass |
| `step82-cross-business-access-db` | 6 pass |
| `trade-job-access-db` | 4 pass |
| `trade-job-access` | 13 pass |
| `profiles-least-privilege-db` (new) | 5 pass |

Covered: cross-company isolation, role permissions, direct-DB-access RLS, owner-link/Mitti auto-linking, partner login links, job-visibility.

---

## 4. The 22 failures — exact reproduction evidence (NOT R4-owned)

**Attribution:** all four files target the owner-communication / Save-my-spot / launch-campaign domain. SUT modules `src/lib/launch-campaign.server.ts` and `src/lib/manual-communication.server.ts` were last changed by the feature-engineering bot (main commits "Published Save my spot v3", "Fixed saved-spot render bug", "Blocked read-only calc access"). These are **feature / business-logic** defects in **R1–R3 scope**, not security / RLS / migration-ledger / QA-infra. Per the task, R4 provides **reproduction evidence** and does **not** alter feature logic.

**Reproduce:**
```bash
export SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  SUPABASE_PROJECT_ID=local-test-isolated VITE_SUPABASE_PROJECT_ID=local-test-isolated \
  SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_test_isolated VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_test_isolated \
  SUPABASE_SERVICE_ROLE_KEY=sb_secret_local_test_isolated NODE_ENV=test VITEST=1
unset ALLOW_PROD_SUPABASE
bun test ./tests/existing-insulation-send.test.ts \
         ./tests/group-b-declaration-routing.test.ts \
         ./tests/manual-communication.server.test.ts \
         ./tests/save-spot-uncertain-delivery.test.ts
```

### 4.1 `tests/existing-insulation-send.test.ts` — 2 fail (renderer/content)
- `office below-R2 preview uses follow-up renderer despite original media`
- `audited qualifying owner declaration uses the same truthful renderer`

**Root cause:** the preview renderer does **not** emit the required disclosure clause
`"This estimate does not include removal of existing insulation."`; it instead renders the generic "Existing insulation may need to be removed… budget $15 per m²" Save-my-spot body. Below-R2/qualifying-owner previews use the wrong (likely-eligible) renderer branch.

### 4.2 `tests/group-b-declaration-routing.test.ts` — 8 fail (campaign/declaration business logic)
`loose_fill_only` and `below_r2` declaration→page→save→repeat; photos/video queue gating; current negative office finding overriding an earlier qualifying "Yes"; original image/jpeg + video/mp4 evidence routing; evidence-review unlock; repeated-routing suppression. SUT: `helpers/pglite-launch-campaign` → `src/lib/launch-campaign.server.ts`.

### 4.3 `tests/manual-communication.server.test.ts` — 11 fail (`prepareManualEmail` contract)
`prepareManualEmail` returns the wrong result shape/gating: preview-vs-link mode separation, internal 150 m² assumption labelling, consent/closed/opt-out reason reporting, internal-estimate withholding, Save-my-spot guard pass-through, global-comms-disabled behaviour, previous-manual-send notice, and the render-only static safety guard. SUT: `src/lib/manual-communication.server.ts`.

### 4.4 `tests/save-spot-uncertain-delivery.test.ts` — 1 fail (counted twice in raw output)
- `while the outcome is unknown, Office can't prepare a hand-send copy; after 'not delivered' it can` — uncertain-delivery gating of the manual hand-send copy path.

---

## 5. Files delivered by R4

| File | Purpose |
|---|---|
| `docs/pending-migrations/0203_profiles_least_privilege.sql` | Staged least-privilege migration (`0203`) |
| `docs/pending-migrations/0203_profiles_least_privilege.rollback.sql` | Reversible rollback |
| `tests/profiles-least-privilege-db.test.ts` | 5-case PGlite regression (applies the real migration) |
| `docs/phase1/round2/R4-QA-Security-deliverable.md` | This report |

**No feature/business-logic files were modified by R4.**
