-- Migration 0204: Add save_my_spot_real_send_enabled to workflow_settings
-- Purpose: Add runtime control for Save My Spot real email sending
-- This enables runtime send-control boundary for automatic Save My Spot emails
-- Default is FALSE (fail-closed) per COM-04 requirements

-- Add the new column with default FALSE (fail-closed)
ALTER TABLE workflow_settings
ADD COLUMN save_my_spot_real_send_enabled boolean NOT NULL DEFAULT false;

-- Update the existing row (id=1) to have the default value
-- This is a no-op since the default is already false, but explicit for clarity
UPDATE workflow_settings
SET save_my_spot_real_send_enabled = false
WHERE id = 1;

-- Add comment for documentation
COMMENT ON COLUMN workflow_settings.save_my_spot_real_send_enabled IS
'When true AND customer_comms_enabled is true, allows automatic Save My Spot emails to be sent via real provider. Default false (fail-closed). Part of COM-04 send control.';

-- Rollback
-- ALTER TABLE workflow_settings DROP COLUMN save_my_spot_real_send_enabled;
