# Pending Migrations Warning — RECONCILED (Phase 1 RC1)

**Reconciled by:** Cloud · **Step:** P1-R1-S69-PRODUCTION-MIGRATION-RECONCILIATION-01 · **Date:** 2026-10-16
**Supersedes the inventory in the 10-Oct `05_PENDING_MIGRATIONS_WARNING.md` / `README_DO_NOT_APPLY.md`** (those are retained unchanged for audit history; their earlier uncertainty is preserved, not rewritten).
**Authoritative baseline:** `release/p1-rc1-com04` @ `d49af17e`.

> **No migration was applied to production by this reconciliation.** Production writes: NONE. The Drizzle journal was not modified.

## Status legend
`VERIFIED_PRODUCTION` · `REPORTED_PRODUCTION` (owner-recorded, **not** independently verified) · `VERIFIED_LOCAL` · `STAGED` · `SUPERSEDED` · `RESERVED` · `PLATFORM_MANAGED` · `UNKNOWN`

## Ledgers

| Ledger | State |
|---|---|
| Drizzle journal (`drizzle/migrations/meta/_journal.json`) | **149 entries, idx 0→148**, last `0148_job_soft_delete_claims` — **unchanged**. |
| Local Supabase (`supabase_migrations.schema_migrations`) | 150 rows, max `…0149` (contiguous). No `drizzle.__drizzle_migrations` table (no Drizzle migrator in deploy path). |
| **Production** (`wvuffpykgnqliikhodzl`) | **0149 / 0202 REPORTED applied (owner).** `0203` / `0205` NOT applied. **No independent verification from this environment (no read access).** |

## Migration state (authoritative)

| File | Status | Notes |
|---|---|---|
| `0149_security_owner_quote_rls` | `REPORTED_PRODUCTION` | Owner manual apply. `VERIFIED_LOCAL` applied. Not journalled (deliberate). |
| `0202_signed_webhook_nonces` | `REPORTED_PRODUCTION` | Owner manual apply. `VERIFIED_LOCAL` **NOT** applied → local/prod diverge. Not journalled. |
| `0203_profiles_least_privilege` | `STAGED` / `NOT_APPLIED` | The authoritative profiles migration. `VERIFIED_LOCAL` not applied. **"0150" is a stale alias**; the `0150..0202` band is unsafe to reuse. |
| `0204` (no file) | `RESERVED` | Held for T6 `external_action_executor`. |
| `0205_save_my_spot_real_send_enabled` | `STAGED` / `NOT_APPLIED` (prod) | COM-04 send switch; `VERIFIED_LOCAL` column present. **Not idempotent.** Renamed `0204 → 0205` to keep `0204` reserved. |
| `review-A-bucket-mime-types` | `PLATFORM_MANAGED` | Storage bucket MIME settings — apply via platform bucket config, not SQL. |
| `perf-property-facts-job-idx` | `SUPERSEDED` | Identical to applied journal migration `0146_perf_property_facts_job_idx`. Skip. |
| `0200_*`, `0201_*` | `SUPERSEDED` | By applied `0147`/`0148`. Not new work. |

## Numbering hazards (identify by full filename)
- `0203` was **reassigned** (rec_offer_batch_lock → profiles_least_privilege); `rec_offer_batch_lock` is now absent (`UNKNOWN`).
- `0204 → 0205` rename (COM-04). Older checkouts (e.g. `wt-p1-rc1`) still show the pre-rename `0204_…` name — a stale-checkout artifact, not a second migration.
- Pre-existing: `0131` and `0147` each name two migrations; `0110` is a true duplicate.
- The `0150..0202` band and the `0149`/`0202` values are **consumed** — do not reuse.

## Before any production migration (unchanged requirements)
Owner approval · verified recoverable backup · confirmed production DB identity · independent production migration-history check · controlled in-order apply · per-migration post-apply verification · ready rollback · stop on any mismatch. See `README_DO_NOT_APPLY.md`.

## Pending order (proposed, on approval)
1. Independently verify production (esp. 0149/0202). 2. `0203` (idempotent). 3. `0205` (guard with `ADD COLUMN IF NOT EXISTS` or apply once). 4. `review-A` via platform. 5. Skip `perf` (superseded) and `0200/0201` (superseded).
