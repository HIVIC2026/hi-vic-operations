-- Migration 0206 (P1-R3-S103 — PROPOSAL ONLY, NOT APPLIED).
-- Owner approval is required before this is run against any environment. See README_DO_NOT_APPLY.md.
--
-- Purpose: one place for the Office-configurable AUTOMATIC Save-my-spot sending rules
-- (P1-R3-S103) on the existing `workflow_settings` singleton row (id = 1).
--
-- Why the existing storage is not sufficient:
--   * `workflow_settings` is a SINGLETON of scalars plus two jsonb switches. There is no generic
--     key/value config table, no settings API and no versioning to reuse.
--   * The two existing jsonb columns are already owned by other features
--     (`office_time_limits` = office time limits, `sms_message_switches` = per-SMS-type switches).
--     Writing Save-my-spot rules into either would couple two unrelated safety controls and make a
--     corrupt SMS switch silently disable or enable customer email selection.
--   * A new table would work, but it would need a singleton/versioning/audit contract of its own for
--     exactly one document. One column on the existing singleton is the smallest safe change.
--
-- Why one column and not two: `enabled` lives INSIDE the jsonb document so a save is atomic. There
-- is no window in which the rules and their on/off state can disagree, and `updated_at`/`updated_by`
-- travel with the document instead of relying on the shared `workflow_settings.updated_at`.
--
-- Default '{}' (an empty object) means NOT CONFIGURED. Every reader treats that as
-- "do not automatically send", so this migration cannot enable anything by itself.
-- The column is declared in src/integrations/supabase/types.ts; until this migration is applied the
-- readers error out and fail closed, which is the intended pre-migration behaviour.

-- Idempotent (IF NOT EXISTS => a re-run is a safe no-op).
ALTER TABLE workflow_settings
ADD COLUMN IF NOT EXISTS save_my_spot_auto_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN workflow_settings.save_my_spot_auto_rules IS
'P1-R3-S103 Office-configurable automatic Save-my-spot sending rules: {version, enabled, rules, updatedAt, updatedBy, activatedAt}. Empty object = not configured = never automatically send. Additional restrictions only: they never widen the automatic route and never authorise delivery on their own.';