# P1-R1-S69 — Migration Inventory (Phase 1 RC1)

**Executor:** Cloud · **Step:** P1-R1-S69-PRODUCTION-MIGRATION-RECONCILIATION-01
**Authoritative baseline reconciled:** `release/p1-rc1-com04` @ `d49af17ead30e1aa03dac2625c9d808c492d1e1b`
**Inventory location:** `docs/pending-migrations/` (staged proposals) and `drizzle/migrations/` (journalled baseline)
**Reconciled:** 2026-10-16

## Status legend
`VERIFIED_PRODUCTION` (independently confirmed) · `REPORTED_PRODUCTION` (owner-recorded, not independently verified here) · `VERIFIED_LOCAL` (confirmed in local Supabase) · `STAGED` (file exists, not applied) · `SUPERSEDED` · `NOT_APPLIED` · `PLATFORM_MANAGED` · `RESERVED` · `UNKNOWN`

## 1. Drizzle journalled baseline (applied ledger-of-record)

- `drizzle/migrations/meta/_journal.json`: **149 entries, idx 0 → 148**, last tag `0148_job_soft_delete_claims`. **Unmodified by this task.**
- All migration files present in `drizzle/migrations/` end at `0148`. Numbers `0149+` exist **only** as staged proposals under `docs/pending-migrations/`.
- Local Supabase `supabase_migrations.schema_migrations`: 150 rows, max `20260101000149` (contiguous) — i.e. the local environment was advanced to 0149 out-of-band.
- The `drizzle.__drizzle_migrations` table does **not** exist in the local DB — consistent with "no Drizzle migrator in the deploy path" (migrations are applied out-of-band).

## 2. Migration inventory

| Migration (file) | Purpose | Production | Local | Idempotent | Notes |
|---|---|---|---|---|---|
| `0149_security_owner_quote_rls.sql` | Close owner exposure of issued+queued quotes (RLS) | **REPORTED_PRODUCTION** (owner manual apply; post-apply owner-verified) | **VERIFIED_LOCAL applied** — `quote_visibility` & `quote_items_visibility` use `quote_visible_to_current_user(...)` | Yes (8 guards, `CREATE OR REPLACE`) | Deliberately NOT journalled. Security-first. |
| `0202_signed_webhook_nonces.sql` | Webhook replay protection (`UNIQUE(source,purpose,nonce)`) | **REPORTED_PRODUCTION** (owner manual apply) | **VERIFIED_LOCAL NOT applied** — `signed_webhook_nonces` absent locally | Yes (`CREATE TABLE IF NOT EXISTS`) | Deliberately NOT journalled. **Local≠prod divergence.** |
| `0203_profiles_least_privilege.sql` | Profiles least-privilege (own-row `get_my_profile()`, `self_read_own` policy) | **NOT_APPLIED** | **VERIFIED_LOCAL NOT applied** — `get_my_profile` absent; policy is `self_read` | Yes (3 guards, `CREATE OR REPLACE`) | Re-numbered from `0150` on 13 Oct. Label "0150" in older docs is a **stale alias**. |
| `0204` (no file) | Reserved for T6 `external_action_executor` | **RESERVED** | n/a | n/a | Intentionally kept free; the COM-04 save-my-spot migration was renamed **0204 → 0205** to preserve this reservation. |
| `0205_save_my_spot_real_send_enabled.sql` | COM-04 Save-My-Spot real-send switch (`workflow_settings.save_my_spot_real_send_enabled`, default FALSE) | **NOT_APPLIED** | **VERIFIED_LOCAL column present** (effect present locally) | **NO** — bare `ADD COLUMN`, no `IF NOT EXISTS`; re-run fails | Forward-only rename of the original `0204` file. **Idempotency gap (see §5).** |
| `review-A-bucket-mime-types.sql` | Restrict upload MIME types per storage bucket | **NOT_APPLIED** | n/a | n/a | **PLATFORM_MANAGED** — storage settings are platform-managed; apply via bucket settings, not SQL. |
| `perf-property-facts-job-idx.sql` | Perf index on `property_facts(job_id)` | n/a | n/a | Yes (`IF NOT EXISTS`) | **SUPERSEDED** — byte-identical to journalled `0146_perf_property_facts_job_idx` (already applied). Do not re-apply. |
| `0200_*`, `0201_*` | job_soft_delete / pricing_cohort_cutover / claims | n/a | n/a | n/a | **SUPERSEDED** by applied `0147`/`0148`. Not new work. |

## 3. Numbering analysis & collisions

- **Current authoritative numbering (COM-04 baseline):** `0149`, `0202`, `0203`, (`0204` reserved), `0205`.
- **"0150" is a stale alias.** Older docs (`05_PENDING_MIGRATIONS_WARNING.md`, `README_DO_NOT_APPLY.md`) and the S69 brief label the profiles migration "0150". The authoritative file is **`0203_profiles_least_privilege`**; the `0150..0202` band is declared unsafe to reuse (0149–0202 are consumed). The never-committed `0150` file never existed in Git.
- **Number `0203` was reassigned.** The 10-Oct workspace warning doc lists `0203` as `rec_offer_batch_lock`; the current `0203` is `profiles_least_privilege`. The `rec_offer_batch_lock` file is absent from the repo — its disposition is **UNKNOWN**. This is a documented class of number-reuse hazard.
- **`0204 → 0205` rename (COM-04, `d49af17e`).** Deliberate forward-only rename to keep `0204` reserved for T6 `external_action_executor`. On the COM-04 branch the file is `0205_save_my_spot_real_send_enabled.sql`; `0204` has no file. (Note: the older `wt-p1-rc1` worktree still shows the pre-rename `0204_…` name — a stale-checkout artifact, not a second migration.)
- **Pre-existing reuse hazards:** `0131` and `0147` each name two different migrations (applied + pending copy); `0110` is a true duplicate. Always identify by **full filename**.

## 4. Dependencies

- `0149` requires `auth.users` and the `0114 release_state` column.
- `0202` requires `anon`/`authenticated`/`service_role` grants (fails in a minimal harness without those roles).
- `0203` requires `auth.uid()`, `is_admin()`, and an existing `admin_all` policy on `profiles`; depends on the committed `src/lib/my-profile.ts` contract.
- `0205` requires an existing `workflow_settings` table with `id=1` row.

## 5. Destructive / risky operations

- **No destructive drops** in the pending set. `0203` narrows an RLS policy (tightening); `0149` tightens quote visibility; `0202`/`0205` are additive.
- **Rollbacks available** for 0149, 0202, 0203, 0205 (`*.rollback.sql`).
- **Operational risk:** `0205` is **not idempotent** (re-apply aborts with "column already exists"). A partial/failed batch that re-runs the sequence will halt at 0205 unless it is guarded (`ADD COLUMN IF NOT EXISTS`) or applied exactly once.

## 6. Pending execution order (proposed; production only, on approval)

1. **Independently verify production** (the ledger, and the actual presence of 0149/0202 objects) — required before any apply.
2. **`0203` profiles least-privilege** (security hardening, idempotent).
3. **`0205` save-my-spot send switch** (after adding an `IF NOT EXISTS` guard, or as a one-shot).
4. `review-A` — platform bucket-settings action, not SQL.
5. `perf-property-facts-job-idx` — **skip** (superseded by applied `0146`).
6. `0200/0201` — **skip** (superseded).

`0149`/`0202` are **reported** already applied; re-apply only if independent production verification shows them absent (they are guarded, so a no-op re-apply is safe if the schema matches).
