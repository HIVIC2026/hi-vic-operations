-- Rollback for esc-registry-robot-switch.sql: removes the switch column. The code fails closed without it
-- (robot off, Settings row not editable). Robot history (workflow_events, documents) is untouched.
alter table public.workflow_settings
  drop column if exists esc_registry_robot_enabled;
