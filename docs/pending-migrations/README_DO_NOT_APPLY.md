# STAGED MIGRATIONS — DO NOT APPLY AUTOMATICALLY

These SQL files are **staged proposals**, not part of the applied baseline (`drizzle/migrations/`).
They stay at this path because automated tests read them.

- Do not apply any file here without Jo's written approval, an independent check of the production
  schema and migration ledger, a verified backup, a rollback plan and a rehearsal on an isolated copy.
- Never apply a migration just because its ledger entry is missing.
- 0150 (D6) and 0204 (T6) are staged and unapplied. 0200/0201 are superseded by the applied 0147/0148.
- Numbers 0131 and 0147 are reused by different migrations — always refer to the full filename.

See `handover/05_PENDING_MIGRATIONS_WARNING.md` and `T9_FINAL_MIGRATION_INVENTORY.md`.
