# STAGED MIGRATIONS — DO NOT APPLY AUTOMATICALLY

These SQL files are **staged proposals**, not part of the applied baseline (`drizzle/migrations/`).
They stay at this path because automated tests read them.

## Authorisation

The client has provided **written instructions delegating technical implementation ownership** of the
existing live portal to the project lead. Under that standing delegation, the **project lead is
responsible for deciding and implementing the necessary technical changes**, including applying the
staged migrations below as part of the approved technical release plan. A separate, individual written
approval is **not** required for every single migration.

This delegation covers the decision to apply; it does **not** waive the operational safety requirements
below. Every apply must still follow the controlled procedure, and any change outside the approved
release plan — or anything with unclear scope or risk — must be raised with the project lead before
proceeding.

## Operational safety requirements (always required)

Before and during any apply, the operator must:

1. **Confirm production database identity** — verify you are connected to the intended production
   project before running anything.
2. **Verify a recoverable backup** — confirm a recent, completed backup (or a valid PITR target)
   exists that covers the apply window. Do not proceed without one.
3. **Confirm the migration baseline** — independently check the production schema and migration ledger
   so the expected prior migrations are present and the ones being applied are genuinely absent. Never
   apply a migration just because its ledger entry is missing.
4. **Execute migrations in controlled order** — apply in the planned sequence, one transaction per
   migration.
5. **Verify each migration** — run the post-apply checks for each migration before moving on.
6. **Maintain rollback procedures** — keep the matching `*.rollback.sql` ready for each migration and
   confirm it before apply.
7. **Stop on unexpected results** — on any mismatch, error, or unexpected behaviour, stop and decide
   whether to roll back; do not continue blindly.

## Current approved migration plan

| Migration | Purpose | Rollback |
|---|---|---|
| **0149** — `0149_security_owner_quote_rls.sql` | **Quote RLS security correction.** Closes the exposure where owners can read issued+queued quotes through direct queries; preserves installer/electrician/admin/history access. **Apply first (security-first).** | `0149_security_owner_quote_rls.rollback.sql` (restores the previous, less-restrictive 0126 visibility policy and the 0133 autolink). |
| **0202** — `0202_signed_webhook_nonces.sql` | **Webhook nonce replay protection.** Adds the `signed_webhook_nonces` table with `UNIQUE(source, purpose, nonce)` so replayed timestamped webhooks are rejected. **Apply after 0149.** | `0202_signed_webhook_nonces.rollback.sql` (drops the table; webhook degrades to signature+timestamp fail-open). |

Apply order: **0149 → 0202** (security-first; otherwise independent).

## Other staged files (not part of this plan)

- 0150 (D6) is staged and unapplied; 0204 (T6) remains reserved in the README plan (no file).
- 0205 — `0205_save_my_spot_real_send_enabled.sql` (COM-04 Save My Spot send control; forward-only rename of the original 0204 file, kept 0204 free for T6). Staged and unapplied.
- 0200/0201 are superseded by the applied 0147/0148.
- Numbers 0131 and 0147 are reused by different migrations — always refer to the full filename.

See `handover/05_PENDING_MIGRATIONS_WARNING.md` and `T9_FINAL_MIGRATION_INVENTORY.md`.
