# P1-R1-S69 — Production Migration Reconciliation (Phase 1 RC1)

**Executor:** Cloud · **Step:** P1-R1-S69-PRODUCTION-MIGRATION-RECONCILIATION-01
**Priority:** P1 — Release preparation
**Reconciled:** 2026-10-16
**Authoritative baseline:** `release/p1-rc1-com04` @ `d49af17ead30e1aa03dac2625c9d808c492d1e1b`
**Isolated worktree/branch:** `wt-r1-s69-migration-reconciliation` / `p1-s69-migration-reconciliation`
**Verdict:** `MIGRATION_PARTIAL`

---

## 1. Executive summary

This is a **read-only reconciliation**. No production migration was executed, no production database was written, no deployment occurred, nothing was pushed or merged, and no other agent's worktree was modified. The Drizzle journal was **not** touched.

The reconciliation established the actual migration state and resolved several documentation/numbering ambiguities:

- **0149** (owner-quote RLS) and **0202** (webhook nonces) are **REPORTED_PRODUCTION** (owner-recorded manual applies, deliberately not journalled). They could **not** be independently verified here because no production read-only schema access is available in this environment.
- **Drizzle journal confirmed at idx 148** (149 entries, last `0148_job_soft_delete_claims`) — matching the existing `APPLIED_MANUALLY.md` record. Unmodified.
- The profiles least-privilege migration is authoritatively **`0203`**, not "0150" (that label is a stale alias across older docs and the S69 brief).
- `0204` is **reserved** (T6); the COM-04 save-my-spot migration was deliberately renamed **`0204 → 0205`**.
- Two "staged" files are not real pending SQL: `perf-property-facts-job-idx.sql` is a **superseded duplicate** of applied `0146`, and `review-A` is **platform-managed** (storage bucket settings, not SQL).
- One actionable defect surfaced in rehearsal: **`0205` is not idempotent** (re-apply aborts), unlike the other pending migrations.

**Why `MIGRATION_PARTIAL` and not `MIGRATION_RECONCILED`:** production state for 0149/0202 could not be independently verified (no read access), and the inventory labels in the S69 brief do not match the authoritative files. Both require an owner decision / production check before the inventory can be declared fully reconciled.

## 2. Scope & authority observed

- **Authorized & performed:** read-only repo inspection; read-only local DB inspection; local migration inventory analysis; **isolated** local rehearsal (in-memory PGlite, never the shared local DB); documentation correction; local commits.
- **Not performed (not authorized):** production migration execution; production writes; deployment; push; merge; edits to other agents' worktrees. **Production writes: NONE.**

## 3. Production state evidence

### 3.1 0149 — Owner quote RLS
- **Status: `REPORTED_PRODUCTION`.** `APPLIED_MANUALLY.md` records a manual production apply by the project owner via the Supabase SQL editor, with owner-confirmed post-apply checks: `public.quotes` policy `quote_visibility` and `public.quote_items` policy `quote_items_visibility` both use `quote_visible_to_current_user(...)`.
- **Independent production verification: NOT PERFORMED** (no read access — §3.6). Not presented as verified.
- **Local corroboration (`VERIFIED_LOCAL`):** both policies use `quote_visible_to_current_user(job_id, kind, status, release_state, sent_at)` — the 0149 state is present locally.

### 3.2 0202 — Webhook nonce replay protection
- **Status: `REPORTED_PRODUCTION`** (owner manual apply; `signed_webhook_nonces` `UNIQUE(source,purpose,nonce)` + RLS enabled, per owner confirmation).
- **Independent production verification: NOT PERFORMED** (§3.6).
- **Local divergence (`VERIFIED_LOCAL`):** `signed_webhook_nonces` is **absent** locally — i.e. local and production are **not** in the same state for 0202. Local cannot be used to infer production here.

### 3.3 Drizzle journal
- **Status: unchanged at idx 148.** `drizzle/migrations/meta/_journal.json` = 149 entries, idx 0→148, last `0148_job_soft_delete_claims`. This matches `APPLIED_MANUALLY.md` and its decision **not** to register 0149/0202. **Journal not modified by this task.**
- `drizzle.__drizzle_migrations` does not exist in the local DB, consistent with the documented "no Drizzle migrator in the deploy path."

### 3.4 0150 / profiles least-privilege — number ambiguity resolved
- The S69 brief and older docs call this "**0150**". The authoritative file is **`0203_profiles_least_privilege.sql`**, which documents (13 Oct 2026) that the whole `0150..0202` band is unsafe to reuse and the first free number is `0203`. A never-committed `0150_profiles_least_privilege.sql` never existed in Git.
- **Status: `STAGED` / `NOT_APPLIED`.** **Local (`VERIFIED_LOCAL`): not applied** — `get_my_profile()` absent; `profiles` policy is `self_read` (not `self_read_own`).
- Additional collision: the 10-Oct warning doc lists `0203` as `rec_offer_batch_lock`; that file is now absent and `0203` means `profiles_least_privilege`. Disposition of `rec_offer_batch_lock` is **UNKNOWN**.

### 3.5 0203 conflict / 0204 / 0205
- **`0203` conflict:** the number `0203` was **reassigned** (rec_offer_batch_lock → profiles_least_privilege). This is a historical number-reuse hazard of the same class as the pre-existing `0131`/`0147` reuse and the `0110` true duplicate. **No renumbering performed** (no approved plan).
- **`0204`: `RESERVED`** for T6 `external_action_executor`; intentionally no file. The COM-04 migration was renamed **`0204 → 0205`** (forward-only) to preserve this reservation, per `d49af17e` and the COM-04 `README_DO_NOT_APPLY.md`. (The older `wt-p1-rc1` checkout still shows the pre-rename `0204_…` filename — a stale-checkout artifact, **not** a second migration.)
- **`0205` (COM-04 save-my-spot send switch):** `STAGED` / not applied to production. **Local (`VERIFIED_LOCAL`):** `workflow_settings.save_my_spot_real_send_enabled` **column present** (effect present locally). **Defect: not idempotent** (§5).

### 3.6 Production read-only verification: **NOT AVAILABLE**
- The repo `.env` exposes only `SUPABASE_URL` + a *publishable* key — **no service-role key and no direct Postgres connection string**. Schema introspection (`pg_policies`, `information_schema`) of production is therefore impossible from this environment. No attempt was made to reach production.
- Consequently, 0149/0202 production status is **REPORTED_PRODUCTION only** and is explicitly **not** claimed as independently verified.

## 4. Drizzle journal status
**`DRIZZLE_JOURNAL_STATUS: UNCHANGED_AT_IDX_148`** (149 entries; 0149/0202/0203/0205 are staged-only and intentionally not registered; journal not edited).

## 5. Local rehearsal results (isolated; shared local DB untouched)

Rehearsal used an **in-memory PGlite** (not the shared local Supabase) seeded with a minimal `workflow_settings`/`profiles` schema:

- **`0205` apply #1: OK.** After apply, `save_my_spot_real_send_enabled = false` → **COM-04 default-OFF confirmed** in the rehearsal.
- **`0205` re-apply: FAIL** — `column "save_my_spot_real_send_enabled" ... already exists`. **0205 is NOT idempotent** (it has zero `IF NOT EXISTS`/`OR REPLACE` guards, unlike 0149/0202/0203). Actionable: add `ADD COLUMN IF NOT EXISTS` or apply exactly once.
- **`0202` apply #1: FAIL in the minimal harness** — `role "anon" does not exist` (the harness lacks Supabase roles). This is a **harness limitation, not a migration defect**; 0202 is structurally guarded (`CREATE TABLE IF NOT EXISTS`) and is reported already applied to production.
- `0203` / `0149` depend on a richer schema (`auth.uid`, `is_admin`, `admin_all` policy, `auth.users`, `0114 release_state`); not fully rehearsed here. Both are structurally guarded (`CREATE OR REPLACE`) and their header/`0203` file document idempotency.

## 6. Documentation reconciliation

- **Updated/prepared:** a corrected migration-state summary is provided in this report and in `P1-R1-S69_MIGRATION_INVENTORY.md`. It supersedes the stale 10-Oct `05_PENDING_MIGRATIONS_WARNING.md` inventory (which mislabels 0203/0204 and lists a non-existent 0150) **without rewriting history** — the older document is left intact and its earlier uncertainty is preserved.
- Every item is now classified with an explicit status: `VERIFIED_LOCAL`, `REPORTED_PRODUCTION`, `STAGED`, `SUPERSEDED`, `RESERVED`, `PLATFORM_MANAGED`, or `UNKNOWN`. A reported production change is **not** presented as independently verified.

## 7. Remaining blockers

1. **No production read access** — 0149/0202 production state cannot be independently confirmed from here. Requires an owner-run schema check (or granting a read-only inspection path) before publish sign-off.
2. **Numbering label drift** — the S69 brief's "0150 / 0204 reserved / 0205 COM-04" and older docs' "0150 / 0203 rec_offer_batch_lock / 0204 external_action_executor" disagree with the authoritative files. Needs an owner decision to fix the canonical labels (this task did **not** renumber).
3. **`0205` non-idempotency** — must be guarded (`ADD COLUMN IF NOT EXISTS`) or applied exactly once, or a re-run will halt.
4. **`rec_offer_batch_lock` disposition UNKNOWN** — a previously-listed `0203` migration is now missing from the repo; confirm whether it was superseded, renamed, or dropped.

## 8. Required approvals before any production apply
Per `README_DO_NOT_APPLY.md`: owner approval + a verified recoverable backup + confirmed production DB identity + an independent production migration-history check + controlled in-order apply + per-migration post-apply verification + a ready rollback. This task authorizes none of the apply steps.

---

## FINAL RESPONSE FORMAT

```
STEP: P1-R1-S69-PRODUCTION-MIGRATION-RECONCILIATION-01
EXECUTOR: Cloud

PRODUCTION_READ_ONLY_VERIFICATION: NO   (no service-role/DB access in env; 0149/0202 are REPORTED only)

0149_STATUS: REPORTED_PRODUCTION  (owner manual apply per APPLIED_MANUALLY.md; VERIFIED_LOCAL applied locally; not journalled; not independently verified)
0202_STATUS: REPORTED_PRODUCTION  (owner manual apply; VERIFIED_LOCAL NOT applied -> local/prod diverge; not journalled; not independently verified)
0150_STATUS: STALE_ALIAS -> authoritative file is 0203_profiles_least_privilege. STAGED / NOT_APPLIED (VERIFIED_LOCAL: get_my_profile absent, policy self_read)
0203_CONFLICT: NUMBER_REUSED — 0203 reassigned from rec_offer_batch_lock (10-Oct doc) to profiles_least_privilege; rec_offer_batch_lock now absent (disposition UNKNOWN); no renumbering performed
0204_STATUS: RESERVED for T6 external_action_executor (no file); COM-04 save-my-spot was renamed 0204 -> 0205 to preserve it
0205_STATUS: STAGED / NOT_APPLIED to prod; VERIFIED_LOCAL column present; NOT idempotent (re-apply fails); forward-only rename of original 0204

DRIZZLE_JOURNAL_STATUS: UNCHANGED_AT_IDX_148 (149 entries, last 0148_job_soft_delete_claims; 0149/0202/0203/0205 staged-only & not registered; journal not edited)

LOCAL_REHEARSAL: Isolated in-memory PGlite (shared local DB untouched). 0205 applies OK with COM-04 default OFF (false) but RE-APPLY FAILS (not idempotent). 0202 harness-fail only (missing anon role; structurally idempotent). 0203/0149 not fully rehearsed (richer schema deps) but guarded.

DOCUMENTATION_UPDATED: YES  (two release reports added; stale 10-Oct inventory superseded without rewriting history; explicit status classification applied)

PRODUCTION_WRITES: NONE

REMAINING_BLOCKERS:
  1) No production read access -> 0149/0202 production state not independently verified (needs owner-run check).
  2) Numbering label drift across brief/older docs vs authoritative files -> owner decision needed (no renumbering done).
  3) 0205 not idempotent -> guard with ADD COLUMN IF NOT EXISTS or apply exactly once.
  4) rec_offer_batch_lock disposition UNKNOWN (previously 0203, now absent).

REPORT_PATHS:
  docs/phase1/release/P1-R1-S69_PRODUCTION_MIGRATION_RECONCILIATION.md
  docs/phase1/release/P1-R1-S69_MIGRATION_INVENTORY.md

COMMIT_SHA: (see local commit on branch p1-s69-migration-reconciliation; local only, not pushed/merged)

FINAL_VERDICT: MIGRATION_PARTIAL
```
