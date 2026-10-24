# Manually Applied Migrations — Production Release Record

**Project:** Home Insulation Victoria
**Target database:** `wvuffpykgnqliikhodzl` (production)
**Applied by:** project owner, manually, via the Supabase SQL editor.

This file records migrations that were executed directly against production **outside** the Drizzle
migrator. It is the authoritative release record for those applies. See the ledger-reconciliation
decision below for why these are intentionally **not** written into the Drizzle journal.

## Applied migrations

| Order | File (source of the executed SQL) | Purpose | Result |
|---|---|---|---|
| 1 | `docs/pending-migrations/0149_security_owner_quote_rls.sql` | Quote RLS security correction — close owner exposure of issued+queued quotes | Query succeeded |
| 2 | `docs/pending-migrations/0202_signed_webhook_nonces.sql` | Webhook nonce replay protection | Query succeeded |

### Post-apply verification (confirmed by the project owner)
- `public.quotes` policy `quote_visibility` uses `quote_visible_to_current_user(...)`.
- `public.quote_items` policy `quote_items_visibility` uses `quote_visible_to_current_user(...)`.
- `public.signed_webhook_nonces` has `UNIQUE (source, purpose, nonce)`.
- `public.signed_webhook_nonces` has RLS enabled.

Rollbacks remain available: `0149_security_owner_quote_rls.rollback.sql`,
`0202_signed_webhook_nonces.rollback.sql`.

## Drizzle ledger reconciliation decision — DO NOT register these in the Drizzle journal

**Decision: Do NOT write `0149` or `0202` into `drizzle/migrations/meta/_journal.json` or the
`drizzle.__drizzle_migrations` table. Record them here instead.**

### How this repository tracks migrations
- Drizzle config (`drizzle.config.ts`) uses `out: ./drizzle/migrations`; the on-disk ledger-of-record
  is `drizzle/migrations/meta/_journal.json` (version 7, dialect postgresql).
- The journal currently holds **149 entries, `idx` 0 → 148**, last tag `0148_job_soft_delete_claims`.
  (The "ends at id = 149" status refers to 149 rows; the highest applied tag is `0148`.)
- Each journal entry has a Drizzle-generated `idx`, a millisecond `when` timestamp, and a `tag` that
  maps 1:1 to a file in `drizzle/migrations/`. At apply time the Drizzle migrator records one row in
  `drizzle.__drizzle_migrations` per entry, keyed by the **SHA-256 hash of that migration file's text**,
  with `created_at` = the journal `when`.
- **0149 and 0202 do not exist in `drizzle/migrations/` and are not in the journal.** They live only
  under `docs/pending-migrations/` (staged proposals that tests read). Drizzle therefore has no
  generated `idx`, `when`, or file hash for them.

### Why registering them is unsafe
1. **No real Drizzle metadata exists.** Any `idx`, `when`, hash, or tag we wrote would be **invented**.
   The task explicitly forbids inventing migration IDs, hashes, timestamps, or ledger entries, and the
   Drizzle hash must equal the SHA-256 of a journalled file — which these are not.
2. **Hash mismatch / integrity break.** If a hash were fabricated and a real `0149/0202` migration were
   later generated in `drizzle/migrations/`, the migrator would compare file hashes and flag a mismatch,
   corrupting ledger integrity.
3. **Skipped-migration risk.** Inserting rows at `idx` 149+ would make the migrator believe those slots
   are already applied. The **next** `drizzle-kit generate` emits the next free index (`0149_*`), whose
   number now collides with the manually-run 0149. A future `migrate()` could then **skip** a genuine
   new migration occupying that slot — exactly the "skipped migrations" hazard to avoid. (The repo
   already warns that numbers like 0131/0147 have been reused — same class of hazard.)
4. **No Drizzle migrator in the deploy path.** No `drizzle-orm` `migrate()` / `drizzle-kit migrate` call
   exists in `src/` or `scripts/`; migrations here are applied manually/out-of-band. Forcing journal
   rows would create a false record of an automated apply that never happens in this repo.

### Safest reconciliation method (chosen)
- Keep the Drizzle journal **untouched** at `idx 148`.
- Treat 0149 and 0202 as **manually applied, documented here** (this file) — the established pattern for
  out-of-band production SQL in this project.
- Leave the staged SQL + rollbacks in place for audit and reversibility.
- If Drizzle-managed tracking is ever wanted later, the correct path is to **re-generate these as
  properly journalled migrations** (so Drizzle computes real `idx`/`when`/hash from the on-disk files)
  guarded with `IF NOT EXISTS` / `CREATE OR REPLACE` so they are safe no-ops against the already-applied
  production state — **not** to hand-edit the ledger now.

## Production Publish decision

**Publish can proceed.** The production schema already contains the 0149 and 0202 objects (verified
above), and the application code reads the live schema. The Drizzle journal intentionally remaining at
`idx 148` does **not** block Publish, because:
- there is no Drizzle migrator in the deploy/publish path that would try to (re)apply these, and
- the one reconciliation hazard (number reuse on the next `drizzle-kit generate`) is a **future
  authoring** concern, mitigated by this record and the existing README number-reuse warning.

**Follow-up (non-blocking):** the next time a Drizzle migration is generated, ensure it does not silently
reuse the `0149`/`0202` numbers for unrelated changes; refer to this record.
- 0224_installer_quote_visibility.sql — applied live 24 Oct 2026 at Jo's request (installers read accepted installation quotes only on installer_sourced jobs). Verified via function definition. Rollback: 0224_installer_quote_visibility.rollback.sql.
- auto-offer-switches.sql, mitti-auto-quote-switch.sql, email-unmatched-events.sql — applied live 25 Oct 2026 (Melbourne) with Jo's go, via the Lovable database console. Verified: columns auto_installer_offers / auto_electrician_offers / mitti_auto_quote_enabled present (all false); workflow_events.job_id nullable with check constraint workflow_events_job_required; index workflow_events_email_unmatched_idx. All switches OFF. Also verified already live (not previously listed): 0210–0223, 0225, 0226, mitti-pickup-auto-switch, perf-* indexes.
