-- Rollback for 0206_save_my_spot_auto_rules (P1-R3-S103).
-- Removes the Office-configurable automatic Save-my-spot rule document. Readers then fail closed
-- (no configuration => nothing automatically sent), so rollback never re-enables sending.
ALTER TABLE workflow_settings DROP COLUMN IF EXISTS save_my_spot_auto_rules;