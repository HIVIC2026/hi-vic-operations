-- Rollback for migration 0204: Remove save_my_spot_real_send_enabled from workflow_settings
ALTER TABLE workflow_settings DROP COLUMN IF EXISTS save_my_spot_real_send_enabled;
